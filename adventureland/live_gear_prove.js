#!/usr/bin/env node
"use strict";
/** Puppygirl-only live gear session: fighters stay on Steam client and advertise via CM. */
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
const GEAROPS = path.join(ROOT, "gear_ops.js");
const MARK = "\n/*LIVE_GEAR*/\n";
const INJECT = MARK + `setInterval(function(){if(character._lgBusy||(typeof busy!=="undefined"&&busy)||gear_session)return;character._lgBusy=1;(async function(){try{GEAR_HOME=[parent.server_region||"US",parent.server_identifier||"III"];if(typeof cycle_at!=="undefined")cycle_at=Date.now();if(!character.bank&&typeof go_npc==="function"){await go_npc("bank");if(typeof snap_bank==="function")snap_bank()}var empty={mainhand:"-",offhand:"-",helmet:"-",chest:"-",pants:"-",shoes:"-",gloves:"-",cape:"-",belt:"-",amulet:"-",ring1:"-",ring2:"-"};["Jazwyn","Sarene","Zarook"].forEach(function(n){gear_ads[n]={gear_ad:1,name:n,esize:5,_t:Date.now(),slots:Object.assign({},empty,n==="Jazwyn"?{offhand:"shield@0"}:{})}});var g=plan_gifts();game_log("LIVE_GEAR_PLAN "+g.length+(g[0]?" "+g[0].it.name+"->"+g[0].who:""));if(!g.length){if(!character._lgWait)character._lgWait=Date.now();if(Date.now()-character._lgWait>60000){game_log("LIVE_GEAR_NOGIFT");character._lg=1}return}if(character._lg)return;character._lg=1;if(typeof busy!=="undefined")busy=true;game_log("LIVE_GEAR_START");game_log("LIVE_GEAR "+(await run_gear_session()));if(typeof busy!=="undefined")busy=false}catch(e){game_log("LIVE_GEAR_FAIL "+((e&&e.message)||e));if(typeof busy!=="undefined")busy=false}finally{character._lgBusy=0}})()},5000);\n`;

function strip() {
  let s = fs.readFileSync(GEAROPS, "utf8");
  const i = s.indexOf(MARK);
  if (i >= 0) fs.writeFileSync(GEAROPS, s.slice(0, i));
}
function deploy() {
  for (const f of [GEAROPS, MERCH]) {
    const n = fs.readFileSync(f, "utf8").split(/\r?\n/).length;
    if (n > 176) throw new Error(path.basename(f) + " has " + n + " lines");
  }
  const dep = spawnSync("node", [path.join(ROOT, "deploy_mcp.js")], { encoding: "utf8" });
  process.stdout.write(dep.stdout || "");
  if (dep.status) throw new Error("deploy failed");
}
function obs(ch) { return (ch.runtime && ch.runtime.observation) || {}; }

async function main() {
  strip();
  fs.appendFileSync(GEAROPS, INJECT);
  try {
    deploy();
    await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "al-gear", version: "1" } });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});
    try { await tool("mainframe_disconnect_character", { character: "Puppygirl" }); } catch (e) {}
    await sleep(15000);
    const stamp = Date.now(), cut = Date.now() - 2000;
    const link = await tool("mainframe_link_character", { character: "Puppygirl", request_id: "gear-" + stamp, code_slot: SLOT, server: "US III" });
    console.log("link", JSON.stringify(link).slice(0, 160));
    for (let i = 0; i < 40; i++) {
      const ch = await tool("mainframe_get_character", { character: "Puppygirl" });
      if (ch.runtime && ch.runtime.game_connected) { console.log("CONNECTED Puppygirl"); break; }
      console.log("waiting", (ch.runtime && ch.runtime.phase) || "?");
      await sleep(5000);
    }
    // Keep merchant on US III with Steam fighters for this prove
    const seen = {};
    let start = false, offer = false, got = false, done = false, fail = false, planN = -1, planDetail = "";
    const deadline = Date.now() + 360000;
    while (Date.now() < deadline) {
      const logs = await tool("mainframe_get_logs", { character: "Puppygirl", limit: 100 });
      for (const e of logs.logs || []) {
        const at = Date.parse(e.at || 0); if (!(at >= cut)) continue;
        const s = Array.isArray(e.values) ? e.values.join(" ") : String(e.message || e);
        const sk = e.at + "|" + s; if (seen[sk]) continue; seen[sk] = 1;
        if (/LIVE_GEAR|gear:|Hold sent|Resume/i.test(s)) console.log("LOG", s.slice(0, 220));
        const m = s.match(/LIVE_GEAR_PLAN (\d+)(.*)$/);
        if (m) { planN = +m[1]; planDetail = (m[2] || "").trim(); }
        if (/LIVE_GEAR_START|gear:start/.test(s)) start = true;
        if (/gear:offer/.test(s)) offer = true;
        if (/gear:got id=.*ok=1/.test(s)) got = true;
        if (/gear:done|LIVE_GEAR ok|LIVE_GEAR null/.test(s)) done = true;
        if (/LIVE_GEAR_FAIL|LIVE_GEAR_NOGIFT|gear:server|gear:send fail|gear:far|gear:pull fail/i.test(s)) fail = true;
      }
      const pup = await tool("mainframe_get_character", { character: "Puppygirl" });
      console.log("pup", (pup.runtime && pup.runtime.message) || "", "map", obs(pup).map, "srv", pup.runtime && pup.runtime.server, "plan", planN, planDetail);
      if (done) break;
      const blob = Object.keys(seen).join("\n");
      if (/LIVE_GEAR_NOGIFT/.test(blob)) break;
      if (/gear:far|gear:offer|gear:done|gear:pull fail|gear:try/.test(blob) && /gear:done|LIVE_GEAR /.test(blob)) break;
      await sleep(8000);
    }
    const blob = Object.keys(seen).join("\n");
    const result = { start, offer, got, done, fail, planN, planDetail, far: /gear:far/.test(blob), tried: /gear:try/.test(blob), at: new Date().toISOString() };
    fs.writeFileSync(path.join(ROOT, "_live_gear.json"), JSON.stringify(result, null, 2));
    console.log("RESULT", result);
    if (!start && planN === 0) throw new Error("FAIL: no upgrades to gift from bank/bag");
    if (!start) throw new Error("FAIL: gear session never started");
    if (!(offer || got || result.far || result.tried)) throw new Error("FAIL: no try/offer/far after start");
    console.log("SUCCESS gear session loop observed");
  } finally {
    strip();
    deploy();
    try { await tool("mainframe_disconnect_character", { character: "Puppygirl" }); } catch (e) {}
  }
}
main().catch((e) => { try { strip(); } catch (e2) {} console.error(e.message || e); process.exit(1); });
