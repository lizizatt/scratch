#!/usr/bin/env node
"use strict";
/** Deploy + link Puppygirl; force ponty_buy once; confirm browse/buy logs. */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");
const ROOT = __dirname;
const token = fs.readFileSync(path.join(ROOT, ".al_mcp_token"), "utf8").trim();
let headers = { Authorization: "Bearer " + token, Accept: "application/json, text/event-stream", "Content-Type": "application/json" };
let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function post(body) {
  const data = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: "adventure.land", path: "/mcp", method: "POST", headers: Object.assign({}, headers, { "Content-Length": data.length }) }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { if (res.headers["mcp-session-id"]) headers["mcp-session-id"] = res.headers["mcp-session-id"]; resolve(b ? JSON.parse(b.replace(/^\uFEFF/, "")) : {}); });
    });
    req.on("error", reject); req.write(data); req.end();
  });
}
async function rpc(m, p) { const r = await post({ jsonrpc: "2.0", id: id++, method: m, params: p }); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result; }
async function tool(name, args) {
  const result = await rpc("tools/call", { name, arguments: args || {} });
  const text = ((result && result.content) || []).map((c) => c.text || "").join("\n");
  try { return JSON.parse(text); } catch (e) { return { raw: text }; }
}
const SLOT = "CH_q7h90Mhg5era0mD5DBIMAKFcLp9xe";
const MERCH = path.join(ROOT, "merchant.js");
const MARK = "\n/*LIVE_PONTY*/\n";
const INJECT = MARK + `setInterval(function(){if(character._lpDone||character._lpBusy||busy)return;character._lpBusy=1;busy=true;(async function(){try{game_log("LIVE_PONTY_START");set_message("Ponty");var r=await ponty_buy();game_log("LIVE_PONTY "+r);if(r==="ok"||r==null)character._lpDone=1}catch(e){game_log("LIVE_PONTY_FAIL "+((e&&e.message)||e))}finally{busy=false;character._lpBusy=0}})()},5000);\n`;

function strip() {
  let s = fs.readFileSync(MERCH, "utf8");
  const i = s.indexOf(MARK);
  if (i >= 0) fs.writeFileSync(MERCH, s.slice(0, i));
}
function deploy() {
  const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
  process.stdout.write(dep.stdout || "");
  if (dep.status) throw new Error("deploy failed");
}

async function main() {
  strip();
  fs.appendFileSync(MERCH, INJECT);
  try {
    deploy();
    await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "al-ponty", version: "1" } });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});
    try { await tool("mainframe_disconnect_character", { character: "Puppygirl" }); } catch (e) {}
    await sleep(40000);
    const stamp = Date.now(), cut = Date.now() - 2000;
    await tool("mainframe_link_character", { character: "Puppygirl", request_id: "ponty-" + stamp, code_slot: SLOT, server: "US III" });
    for (let i = 0; i < 36; i++) {
      const ch = await tool("mainframe_get_character", { character: "Puppygirl" });
      if (ch.runtime && ch.runtime.game_connected) { console.log("CONNECTED", ch.runtime.message || ""); break; }
      console.log("waiting", (ch.runtime && ch.runtime.phase) || "?");
      await sleep(5000);
    }
    const seen = {};
    let ok = false, fail = false, browsed = false;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const logs = await tool("mainframe_get_logs", { character: "Puppygirl", limit: 80 });
      for (const e of logs.logs || []) {
        const at = Date.parse(e.at || 0); if (!(at >= cut)) continue;
        const s = Array.isArray(e.values) ? e.values.join(" ") : String(e.message || e);
        const sk = e.at + "|" + s; if (seen[sk]) continue; seen[sk] = 1;
        if (/LIVE_PONTY|ponty |Ponty|secondhand|go_npc/i.test(s)) console.log("LOG", s.slice(0, 200));
        if (/LIVE_PONTY ok|ponty \w+ @/i.test(s)) ok = true;
        if (/LIVE_PONTY null|LIVE_PONTY ok|ponty none/i.test(s)) browsed = true;
        if (/LIVE_PONTY_START|ponty try|ponty list /i.test(s)) console.log("PROG", s.slice(0, 120));
        if (/LIVE_PONTY_FAIL|LIVE_PONTY fail/i.test(s)) fail = true;
      }
      const ch = await tool("mainframe_get_character", { character: "Puppygirl" });
      console.log("msg=", (ch.runtime && ch.runtime.message) || "", "map=", (ch.runtime && ch.runtime.observation && ch.runtime.observation.map) || (ch.profile && ch.profile.map));
      if (browsed || ok) break;
      await sleep(8000);
    }
    const result = { ok, browsed, fail, at: new Date().toISOString() };
    fs.writeFileSync(path.join(ROOT, "_live_ponty.json"), JSON.stringify(result, null, 2));
    console.log("RESULT", result);
    if (!browsed && !ok) throw new Error("FAIL: ponty_buy never finished");
    console.log("SUCCESS ponty browse", ok ? "bought" : "no match/null");
  } finally {
    strip();
    deploy();
    try { await tool("mainframe_disconnect_character", { character: "Puppygirl" }); } catch (e) {}
  }
}
main().catch((e) => { try { strip(); } catch (e2) {} console.error(e.message || e); process.exit(1); });
