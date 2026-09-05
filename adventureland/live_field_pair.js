#!/usr/bin/env node
"use strict";
/**
 * Live field-delivery prove: Jazwyn + Puppygirl only.
 * Leader pot floor (150) should trigger requests while farming bats.
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

function flattenLogs(logs) {
  return ((logs && logs.logs) || []).map((x) =>
    typeof x === "string" ? x : (x.message || x.text || x.line || (x.values && x.values.join(" ")) || JSON.stringify(x))
  );
}

const SLOTS = {
  Jazwyn: "CH_xOVr1MS2DN8qlv1ntZ0VB1IEy3Sp9",
  Sarene: "CH_0EquGf0dJfIrmvKmlb5pa6KfSITh3",
  Zarook: "CH_d4UbsANUGP3e4HGOB2DrwV3uLyeLz",
  Puppygirl: "CH_q7h90Mhg5era0mD5DBIMAKFcLp9xe",
};
const PAIR = ["Jazwyn", "Puppygirl"];
const ALL = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];

async function waitConnected(name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    const rt = ch.runtime || {};
    if (rt.game_connected) {
      console.log("[%s] CONNECTED map=%s", name, (ch.profile && ch.profile.map) || rt.map || "?");
      return true;
    }
    console.log("[%s] waiting phase=%s", name, rt.phase || rt.state || "?");
    await sleep(6000);
  }
  return false;
}

async function main() {
  console.log("Deploy...");
  const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
  process.stdout.write(dep.stdout || "");
  if (dep.status) throw new Error("deploy failed");

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-field2", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  console.log("Disconnect all...");
  for (const c of ALL) {
    try {
      await tool("mainframe_disconnect_character", { character: c });
      console.log("disconnect", c);
    } catch (e) {
      console.log("disconnect", c, (e.message || "").slice(0, 80));
    }
  }
  console.log("Wait 45s for auth release...");
  await sleep(45000);

  const stamp = Date.now();
  const cutIso = new Date().toISOString();
  console.log("log cut", cutIso);
  for (const c of PAIR) {
    const r = await tool("mainframe_link_character", {
      character: c,
      request_id: "field2-" + c + "-" + stamp,
      code_slot: SLOTS[c],
      server: "US III",
    });
    console.log("link", c, r.success || r.queued || r);
    await waitConnected(c, 180000);
    await sleep(4000);
  }

  const cut = Date.now() - 5000;
  const seen = {};
  const stats = {
    req: 0,
    doneOk: 0,
    doneFail: 0,
    meet: 0,
    goto: 0,
    toss: 0,
    cancel: 0,
    maps: {},
  };
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    for (const c of PAIR) {
      const ch = await tool("mainframe_get_character", { character: c });
      const prof = ch.profile || {};
      if (c === "Jazwyn" && prof.map) stats.maps[prof.map] = (stats.maps[prof.map] || 0) + 1;
      const raw = await tool("mainframe_get_logs", { character: c, limit: 100 });
      for (const entry of raw.logs || []) {
        const at = Date.parse(entry.at || 0);
        if (!(at >= cut)) continue;
        const s = Array.isArray(entry.values) ? entry.values.join(" ") : String(entry.message || entry);
        const sk = c + "|" + entry.at + "|" + s;
        if (seen[sk]) continue;
        seen[sk] = 1;
        if (/dlv:|LIVE_DLV|toss |Dry|goto |mapxy|pack |Dlv |ReferenceError|TypeError|Off to |Bank|Stand/i.test(s)) {
          console.log("[%s] %s", c, s.slice(0, 280));
        }
        if (/dlv:req /.test(s)) stats.req++;
        if (/dlv:done .*ok=1|LIVE_DLV_OK/.test(s)) stats.doneOk++;
        if (/dlv:done .*ok=0/.test(s)) stats.doneFail++;
        if (/wait_meet|meet -> potions/.test(s)) stats.meet++;
        if (/dlv:meet ignored/.test(s)) {
          /* ok - fighter staying put */
        }
        if (/dlv:goto |dlv:mapxy|dlv:pack |dlv:player/.test(s)) stats.goto++;
        if (/toss /.test(s)) stats.toss++;
        if (/dlv:cancel |reason=dry/.test(s)) stats.cancel++;
      }
    }
    console.log("--- doneOk=%s req=%s goto=%s meet=%s maps=%s ---", stats.doneOk, stats.req, stats.goto, stats.meet, JSON.stringify(stats.maps));
    if (stats.doneOk >= 1 && stats.meet === 0) break;
    await sleep(15000);
  }

  fs.writeFileSync(path.join(ROOT, "_live_field_result.json"), JSON.stringify({ stats, at: new Date().toISOString() }, null, 2));
  if (stats.doneOk < 1) {
    console.error("FAIL: no successful field delivery");
    process.exit(2);
  }
  if (stats.meet > 0) {
    console.error("FAIL: meet/town path still used");
    process.exit(3);
  }
  console.log("SUCCESS field deliveries=", stats.doneOk);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
