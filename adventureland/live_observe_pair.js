#!/usr/bin/env node
"use strict";
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
  Puppygirl: "CH_q7h90Mhg5era0mD5DBIMAKFcLp9xe",
  Sarene: "CH_0EquGf0dJfIrmvKmlb5pa6KfSITh3",
  Zarook: "CH_d4UbsANUGP3e4HGOB2DrwV3uLyeLz",
};
const PAIR = ["Jazwyn", "Puppygirl"];
const ALL = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];

async function waitConnected(name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    if (ch.runtime && ch.runtime.game_connected) {
      console.log("[%s] CONNECTED map=%s", name, (ch.profile && ch.profile.map) || "?");
      return true;
    }
    console.log("[%s] waiting %s", name, (ch.runtime && ch.runtime.phase) || "?");
    await sleep(5000);
  }
  return false;
}

async function main() {
  const deployFirst = process.argv.includes("--deploy");
  if (deployFirst) {
    console.log("Deploy...");
    const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
    process.stdout.write(dep.stdout || "");
    if (dep.status) throw new Error("deploy failed");
  }

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-observe", version: "1.0" },
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
  const cut = Date.now();
  for (const c of PAIR) {
    await tool("mainframe_link_character", {
      character: c,
      request_id: "obs-" + c + "-" + stamp,
      code_slot: SLOTS[c],
      server: "US III",
    });
    await waitConnected(c, 180000);
    await sleep(3000);
  }

  const seen = {};
  const deadline = Date.now() + 8 * 60 * 1000;
  const interesting = /dlv:|Dlv |Combine|Upgrade|Ponty|Bank|Stand|park |cycle |toss |Dry|goto |mapxy|send |done |req |ack /i;
  while (Date.now() < deadline) {
    for (const c of PAIR) {
      const ch = await tool("mainframe_get_character", { character: c });
      const p = ch.profile || {};
      const msg = (ch.runtime && (ch.runtime.message || ch.runtime.status_message)) || "";
      console.log("[%s] map=%s xy=%s,%s msg=%s", c, p.map, Math.round(p.x || 0), Math.round(p.y || 0), String(msg).slice(0, 40));
      const raw = await tool("mainframe_get_logs", { character: c, limit: 60 });
      for (const entry of raw.logs || []) {
        const at = Date.parse(entry.at || 0);
        if (!(at >= cut - 2000)) continue;
        const s = Array.isArray(entry.values) ? entry.values.join(" ") : String(entry.message || entry);
        const sk = c + "|" + entry.at + "|" + s;
        if (seen[sk]) continue;
        seen[sk] = 1;
        if (interesting.test(s)) console.log("  LOG %s | %s", c, s.slice(0, 220));
      }
    }
    console.log("---");
    await sleep(20000);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
