#!/usr/bin/env node
"use strict";
/**
 * Prove field potion delivery: merchant must path via move_pack (not wait_meet).
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
const ORDER = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];

async function main() {
  console.log("Deploy...");
  const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
  process.stdout.write(dep.stdout || "");
  if (dep.status) throw new Error("deploy failed");

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-field-prove", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  for (const c of ORDER) {
    try {
      await tool("mainframe_disconnect_character", { character: c });
    } catch (e) {}
  }
  console.log("Waiting 40s...");
  await sleep(40000);

  const stamp = Date.now();
  const cut = Date.now();
  for (const c of ORDER) {
    await tool("mainframe_link_character", {
      character: c,
      request_id: "field-" + c + "-" + stamp,
      code_slot: SLOTS[c],
      server: "US III",
    });
    console.log("linked", c);
    for (let i = 0; i < 25; i++) {
      const ch = await tool("mainframe_get_character", { character: c });
      if (ch.runtime && ch.runtime.game_connected) {
        console.log(c, "CONNECTED");
        break;
      }
      await sleep(5000);
    }
    await sleep(3000);
  }

  // Wait until fighters are actually at the spider pack (live observation, not stale profile)
  console.log("Waiting for fighters at spider pack...");
  const farmReady = Date.now() + 8 * 60 * 1000;
  let relinkTried = 0;
  while (Date.now() < farmReady) {
    let away = 0;
    for (const c of ["Jazwyn", "Sarene", "Zarook"]) {
      const ch = await tool("mainframe_get_character", { character: c });
      const rt = ch.runtime || {};
      const obs = rt.observation || {};
      if (!rt.game_connected && relinkTried < 6) {
        console.log(c, "disconnected — relinking");
        try {
          await tool("mainframe_disconnect_character", { character: c });
        } catch (e) {}
        await sleep(8000);
        await tool("mainframe_link_character", {
          character: c,
          request_id: "field-relink-" + c + "-" + Date.now(),
          code_slot: SLOTS[c],
          server: "US III",
        });
        relinkTried++;
        await sleep(5000);
        continue;
      }
      const x = Number(obs.x),
        y = Number(obs.y);
      if (obs.map === "main" && isFinite(x) && x > 700) {
        console.log(c, "at pack-ish", Math.floor(x), Math.floor(y));
        away++;
      } else if (obs.map === "main" && isFinite(x)) {
        console.log(c, "pos", Math.floor(x), Math.floor(y), rt.message || "");
      } else if (obs.map === "mtunnel") {
        console.log(c, "in mtunnel", Math.floor(x), Math.floor(y));
      }
    }
    if (away >= 1) break;
    await sleep(12000);
  }

  // Seed log baseline so stale wait_meet/sent from prior runs don't poison the prove
  const seen = {};
  const puppyBaseline = {};
  for (const c of ORDER) {
    for (const line of flattenLogs(await tool("mainframe_get_logs", { character: c, limit: 80 }))) {
      seen[c + "|" + String(line)] = 1;
      if (c === "Puppygirl") puppyBaseline[String(line)] = 1;
    }
  }
  let fieldOk = false;
  let usedMeet = false;
  let packMove = false;
  let sent = false;
  let farming = false;
  const deadline = Date.now() + 12 * 60 * 1000;

  while (Date.now() < deadline) {
    for (const c of ORDER) {
      const ch = await tool("mainframe_get_character", { character: c });
      const rt = ch.runtime || {};
      const obs = rt.observation || {};
      if (rt.performance && rt.performance.session && (rt.performance.session.kills > 0 || rt.performance.session.xp_gained > 0))
        farming = true;
      if (obs.map === "main" && Number(obs.x) > 700) farming = true;
      for (const line of flattenLogs(await tool("mainframe_get_logs", { character: c, limit: 80 }))) {
        const s = String(line);
        const sk = c + "|" + s;
        if (seen[sk]) continue;
        seen[sk] = 1;
        if (/dlv:|LIVE_DLV|Hunt |Form|Off to |move_pack|wait_meet|walk |status |mtunnel /i.test(s)) console.log("[%s] %s", c, s.slice(0, 260));
        if ((/move_pack /.test(s) && !/move_pack.*_fail/.test(s)) || /dlv:walk /.test(s) || /dlv:mtunnel /.test(s) || /dlv:status (enroute|tunnel|field|On my way|Crossing|Almost)/i.test(s))
          packMove = true;
        if (/wait_meet/.test(s) || /dlv:status meet/i.test(s) || /Meet me in town/.test(s)) usedMeet = true;
        if (/dlv:sent /.test(s)) sent = true;
        if (/Hunt |Form|Off to /.test(s)) farming = true;
      }
    }
    // Only this-run merchant lines for east-island proof
    const plogs = flattenLogs(await tool("mainframe_get_logs", { character: "Puppygirl", limit: 80 })).map(String).filter((s) => !puppyBaseline[s]);
    const trail = plogs.join("\n");
    const eastOk = /status field|Almost there|@main [789]\d{2},|@main 1\d{3},|walk [789]\d{2},|walk 1\d{3},|Crossing tunnel @mtunnel [5-9]|mtunnel (rail|exit_approach|exit)/.test(
      trail
    );
    if (packMove && sent && !usedMeet && eastOk) {
      const sentI = trail.lastIndexOf("dlv:sent");
      const markers = [
        trail.lastIndexOf("status field"),
        trail.lastIndexOf("Almost there"),
        trail.lastIndexOf("mtunnel exit_approach"),
        trail.lastIndexOf("mtunnel rail"),
        trail.search(/@main [789]\d{2},/),
        trail.search(/@main 1\d{3},/),
        trail.search(/walk [789]\d{2},/),
        trail.search(/walk 1\d{3},/),
        trail.search(/Crossing tunnel @mtunnel [5-9]/),
      ];
      const eastI = Math.max.apply(null, markers);
      if (sentI >= 0 && eastI >= 0 && eastI < sentI) fieldOk = true;
    }
    console.log("--- fieldOk=%s packMove=%s sent=%s usedMeet=%s farming=%s eastOk=%s ---", fieldOk, packMove, sent, usedMeet, farming, eastOk);
    if (fieldOk) break;
    await sleep(12000);
  }

  const result = { fieldOk, packMove, sent, usedMeet, farming, at: new Date().toISOString() };
  fs.writeFileSync(path.join(ROOT, "_live_field_result.json"), JSON.stringify(result, null, 2));
  if (!fieldOk) {
    console.error("FAIL: field delivery not proven", result);
    process.exit(2);
  }
  console.log("SUCCESS field delivery", result);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
