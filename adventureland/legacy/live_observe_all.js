#!/usr/bin/env node
"use strict";
/**
 * Boot all four chars and observe ~30m of farming for stuck states.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const token = fs.readFileSync(path.join(ROOT, ".al_mcp_token"), "utf8").trim();
let headers = {
  Authorization: "Bearer " + token,
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};
let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(body) {
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "adventure.land",
        path: "/mcp",
        method: "POST",
        headers: Object.assign({}, headers, { "Content-Length": data.length }),
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          if (res.headers["mcp-session-id"]) headers["mcp-session-id"] = res.headers["mcp-session-id"];
          resolve(b ? JSON.parse(b.replace(/^\uFEFF/, "")) : {});
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function rpc(method, params) {
  const r = await post({ jsonrpc: "2.0", id: id++, method, params });
  if (r.error) throw new Error(method + ": " + JSON.stringify(r.error));
  return r.result;
}

async function tool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args || {} });
  if (result && result.isError) throw new Error(name + ": " + JSON.stringify(result));
  const text = ((result && result.content) || []).map((c) => c.text || "").join("\n");
  try {
    return JSON.parse(text);
  } catch (e) {
    return { raw: text };
  }
}

const SLOTS = {
  Jazwyn: "CH_xOVr1MS2DN8qlv1ntZ0VB1IEy3Sp9",
  Sarene: "CH_0EquGf0dJfIrmvKmlb5pa6KfSITh3",
  Zarook: "CH_d4UbsANUGP3e4HGOB2DrwV3uLyeLz",
  Puppygirl: "CH_q7h90Mhg5era0mD5DBIMAKFcLp9xe",
};
const ALL = ["Puppygirl", "Sarene", "Zarook", "Jazwyn"];
const WATCH = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];

async function waitConnected(name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    const rt = ch.runtime || {};
    if (rt.game_connected) {
      console.log("[%s] CONNECTED map=%s", name, (ch.profile && ch.profile.map) || "?");
      return true;
    }
    console.log("[%s] waiting %s", name, rt.phase || "?");
    await sleep(5000);
  }
  return false;
}

function potCounts(inv) {
  let hp = 0,
    mp = 0;
  for (const it of inv || []) {
    if (!it || !it.name) continue;
    if (it.name.indexOf("hpot") === 0) hp += it.q || 1;
    if (it.name.indexOf("mpot") === 0) mp += it.q || 1;
  }
  return { hp, mp };
}

async function main() {
  const minutes = Number(process.env.OBSERVE_MIN || 30);
  const deployFirst = !process.argv.includes("--no-deploy");
  if (deployFirst) {
    console.log("Deploy...");
    const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
    process.stdout.write(dep.stdout || "");
    if (dep.status) throw new Error("deploy failed");
  }

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-observe-all", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  console.log("Disconnect all...");
  for (const c of ALL) {
    try {
      await tool("mainframe_disconnect_character", { character: c });
    } catch (e) {}
  }
  console.log("Wait 60s for bank/auth release...");
  await sleep(60000);

  const stamp = Date.now();
  const cut = Date.now() - 2000;
  let linkPass = 0;
  while (linkPass < 4) {
    linkPass++;
    let failed = null;
    for (const c of ALL) {
      try {
        await tool("mainframe_link_character", {
          character: c,
          request_id: "obsall-" + c + "-" + stamp + "-p" + linkPass,
          code_slot: SLOTS[c],
          server: "US III",
        });
        console.log("link queued", c);
        await sleep(1200);
      } catch (e) {
        failed = String(e.message || e);
        console.log("link fail", c, failed.slice(0, 140));
        break;
      }
    }
    if (!failed) break;
    for (const x of WATCH) {
      try {
        await tool("mainframe_disconnect_character", { character: x });
      } catch (e2) {}
    }
    console.log("retry link pass after 55s...");
    await sleep(55000);
  }
  for (const c of ALL) {
    if (!(await waitConnected(c, 180000))) throw new Error(c + " failed to connect");
  }

  const seen = {};
  const interesting =
    /Hold|Wait party|go_s|Off to|Hunt |Form|Dump|Dry|Vendor|Bank|Stand|Combine|Upgrade|Ponty|Dlv |dlv:|park |cycle |stock |busy|stuck|ReferenceError|TypeError|logistics fail|Jail|RIP|rip|party:|cm fail|Survey|loot|home|LIVE_/i;
  const lastPos = {};
  const stuck = {};
  const summary = { kills: {}, hunts: {}, errs: [], stuckNotes: [] };
  const deadline = Date.now() + minutes * 60 * 1000;
  console.log("Observing for %sm until %s", minutes, new Date(deadline).toISOString());

  while (Date.now() < deadline) {
    const snap = [];
    for (const c of ALL) {
      const ch = await tool("mainframe_get_character", { character: c });
      const p = ch.profile || {};
      const rt = ch.runtime || {};
      const obs = rt.observation || {};
      const msg = rt.message || rt.status_message || "";
      const pots = potCounts(obs.inventory || p.inventory);
      const map = obs.map || p.map;
      const x = obs.x != null ? obs.x : p.x;
      const y = obs.y != null ? obs.y : p.y;
      const key = [map, Math.round(x || 0), Math.round(y || 0)].join(",");
      if (lastPos[c] === key) stuck[c] = (stuck[c] || 0) + 1;
      else stuck[c] = 0;
      lastPos[c] = key;
      const kills = (rt.performance && rt.performance.session && rt.performance.session.kills) || 0;
      summary.kills[c] = kills;
      snap.push(
        c.slice(0, 3) +
          " " +
          (map || "?") +
          "@" +
          Math.round(x || 0) +
          "," +
          Math.round(y || 0) +
          " hp/mp=" +
          pots.hp +
          "/" +
          pots.mp +
          " g=" +
          (obs.gold != null ? obs.gold : p.gold || 0) +
          " k=" +
          kills +
          " stuck=" +
          (stuck[c] || 0) +
          " msg=" +
          String(msg).slice(0, 28)
      );
      if ((stuck[c] || 0) >= 6) {
        const note = c + " immobile ~" + stuck[c] * 20 + "s @" + key + " msg=" + String(msg).slice(0, 40);
        if (!summary.stuckNotes.includes(note)) summary.stuckNotes.push(note);
      }
      const raw = await tool("mainframe_get_logs", { character: c, limit: 80 });
      for (const entry of raw.logs || []) {
        const at = Date.parse(entry.at || 0);
        if (!(at >= cut)) continue;
        const s = Array.isArray(entry.values) ? entry.values.join(" ") : String(entry.message || entry);
        const sk = c + "|" + entry.at + "|" + s;
        if (seen[sk]) continue;
        seen[sk] = 1;
        if (/Hunt /.test(s)) summary.hunts[c] = (summary.hunts[c] || 0) + 1;
        if (/ReferenceError|TypeError|logistics fail|cm fail|tick_fail|park left|cycle fail|busy timeout|smart stuck/.test(s))
          summary.errs.push(c + ": " + s.slice(0, 160));
        if (interesting.test(s)) console.log("  LOG %s | %s", c, s.slice(0, 220));
      }
    }
    console.log("--- " + new Date().toISOString().slice(11, 19) + " ---");
    snap.forEach((line) => console.log("  " + line));
    await sleep(20000);
  }

  fs.writeFileSync(path.join(ROOT, "_live_observe_all.json"), JSON.stringify(summary, null, 2));
  console.log("SUMMARY", JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
