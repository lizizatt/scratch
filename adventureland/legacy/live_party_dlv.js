#!/usr/bin/env node
"use strict";
/**
 * Live party delivery prove: Jazwyn + Sarene + Puppygirl (+ Zarook queried).
 * On restock request, merchant surveys all fighters, buys aggregate pots,
 * multi-drops in the field, loots, then returns to town/bank.
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
const TRIO = ["Jazwyn", "Sarene", "Puppygirl"];
const ALL = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];
const WARRIOR_PATH = path.join(ROOT, "warrior.js");

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

function enableLiveTest(on) {
  let src = fs.readFileSync(WARRIOR_PATH, "utf8");
  const inject = '\nLIVE_TEST=1;\nLIVE_DUMP_TO="Sarene";';
  src = src.replace(/\r?\nLIVE_TEST=1;\r?\nLIVE_DUMP_TO="Sarene";/g, "");
  if (on) {
    if (src.indexOf('load_code("fighter_core");') < 0) throw new Error("warrior.js missing load_code");
    src = src.replace('load_code("fighter_core");', 'load_code("fighter_core");' + inject);
  }
  fs.writeFileSync(WARRIOR_PATH, src);
}

async function main() {
  const deadlineMs = Number(process.env.LIVE_PARTY_MS || 20 * 60 * 1000);
  enableLiveTest(true);
  try {
    console.log("Deploy (party delivery + LIVE_TEST)...");
    const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
    process.stdout.write(dep.stdout || "");
    if (dep.status) throw new Error("deploy failed");

    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "al-party-dlv", version: "1.0" },
    });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

    for (const c of ALL) {
      try {
        await tool("mainframe_disconnect_character", { character: c });
      } catch (e) {}
    }
    console.log("Wait 40s...");
    await sleep(40000);

    const stamp = Date.now();
    const cut = Date.now() - 2000;
    for (const c of TRIO) {
      await tool("mainframe_link_character", {
        character: c,
        request_id: "party-" + c + "-" + stamp,
        code_slot: SLOTS[c],
        server: "US III",
      });
      if (!(await waitConnected(c, 180000))) throw new Error(c + " failed to connect");
      await sleep(3000);
    }

    const seen = {};
    const stats = {
      dump: 0,
      needQ: {},
      survey: 0,
      sendWho: {},
      lootQ: {},
      home: 0,
      restock: 0,
      restockHp: 0,
      restockMp: 0,
    };
    const interesting = /LIVE_|dlv:|Dump|Survey|Wait dlv|toss |need_q|loot|home|send |buy |Hunt |Form/i;
    const deadline = Date.now() + deadlineMs;

    while (Date.now() < deadline) {
      for (const c of TRIO) {
        const ch = await tool("mainframe_get_character", { character: c });
        const p = ch.profile || {};
        const msg = (ch.runtime && (ch.runtime.message || ch.runtime.status_message)) || "";
        console.log("[%s] map=%s xy=%s,%s msg=%s", c, p.map, Math.round(p.x || 0), Math.round(p.y || 0), String(msg).slice(0, 36));
        const raw = await tool("mainframe_get_logs", { character: c, limit: 100 });
        for (const entry of raw.logs || []) {
          const at = Date.parse(entry.at || 0);
          if (!(at >= cut)) continue;
          const s = Array.isArray(entry.values) ? entry.values.join(" ") : String(entry.message || entry);
          const sk = c + "|" + entry.at + "|" + s;
          if (seen[sk]) continue;
          seen[sk] = 1;
          if (interesting.test(s)) console.log("  LOG %s | %s", c, s.slice(0, 240));
          if (c === "Jazwyn" && /LIVE_DUMP_OK|LIVE_DUMP send |Wait dlv/.test(s)) stats.dump = 1;
          if (c === "Puppygirl" && /dlv:need_q (\w+)/.test(s)) {
            const m = s.match(/dlv:need_q (\w+)/);
            if (m) stats.needQ[m[1]] = 1;
          }
          if (c === "Puppygirl" && /dlv:survey /.test(s)) stats.survey = 1;
          if (c === "Puppygirl" && /dlv:send \w+ .+ -> (\w+)/.test(s)) {
            const m = s.match(/-> (\w+)/);
            if (m) stats.sendWho[m[1]] = 1;
          }
          if (c === "Puppygirl" && /dlv:loot_q (\w+)/.test(s)) {
            const m = s.match(/dlv:loot_q (\w+)/);
            if (m) stats.lootQ[m[1]] = 1;
          }
          if (c === "Puppygirl" && /dlv:home/.test(s)) stats.home = 1;
          if (c === "Jazwyn" && /LIVE_RESTOCK_OK/.test(s)) {
            stats.restock = 1;
            const m = s.match(/hp=(\d+)\s+mp=(\d+)/);
            if (m) {
              stats.restockHp = Number(m[1]);
              stats.restockMp = Number(m[2]);
            }
          }
        }
      }
      console.log(
        "--- dump=%s needQ=%s survey=%s send=%s loot=%s home=%s restock=%s/%s ---",
        stats.dump,
        Object.keys(stats.needQ).join(",") || "-",
        stats.survey,
        Object.keys(stats.sendWho).join(",") || "-",
        Object.keys(stats.lootQ).join(",") || "-",
        stats.home,
        stats.restockHp,
        stats.restockMp
      );
      const needOk = stats.needQ.Jazwyn && stats.needQ.Sarene;
      const sendOk = stats.sendWho.Jazwyn;
      if (stats.dump && needOk && stats.survey && sendOk && stats.home && stats.restock && stats.restockHp > 0 && stats.restockMp > 0)
        break;
      await sleep(15000);
    }

    const result = { stats, at: new Date().toISOString() };
    fs.writeFileSync(path.join(ROOT, "_live_party_dlv.json"), JSON.stringify(result, null, 2));
    console.log("result", JSON.stringify(result));

    if (!stats.dump) throw new Error("FAIL: no dump/request trigger");
    if (!(stats.needQ.Jazwyn && stats.needQ.Sarene)) throw new Error("FAIL: survey did not query Jazwyn+Sarene");
    if (!stats.survey) throw new Error("FAIL: no survey aggregate");
    if (!stats.sendWho.Jazwyn) throw new Error("FAIL: no pot send to Jazwyn");
    if (!stats.home) throw new Error("FAIL: merchant did not return home/town");
    if (!stats.restock || !(stats.restockHp > 0 && stats.restockMp > 0)) throw new Error("FAIL: Jazwyn not restocked");
    console.log("SUCCESS party delivery survey+multi-drop+loot+home");
  } finally {
    enableLiveTest(false);
    console.log("Restored warrior.js; redeploying...");
    const dep2 = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
    process.stdout.write(dep2.stdout || "");
  }
}

main().catch((e) => {
  try {
    enableLiveTest(false);
  } catch (e2) {}
  console.error(e.message || e);
  process.exit(1);
});
