#!/usr/bin/env node
"use strict";
/** Full-party live gear session: link all four, seed ads if needed, observe offer/got. */
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

const SLOTS = {
  Jazwyn: "CH_xOVr1MS2DN8qlv1ntZ0VB1IEy3Sp9",
  Sarene: "CH_0EquGf0dJfIrmvKmlb5pa6KfSITh3",
  Zarook: "CH_d4UbsANUGP3e4HGOB2DrwV3uLyeLz",
  Puppygirl: "CH_q7h90Mhg5era0mD5DBIMAKFcLp9xe",
};
const ALL = ["Puppygirl", "Sarene", "Zarook", "Jazwyn"];
const FIGHTERS = ["Jazwyn", "Sarene", "Zarook"];
const MERCH = path.join(ROOT, "merchant.js");
const GEAROPS = path.join(ROOT, "gear_ops.js");
const MARK = "\n/*LIVE_GEAR*/\n";
// Seed ads + force gear session once bank is up. Meet is GEAR_HOME US/II.
const INJECT = MARK + `setInterval(function(){if(character._lgBusy||(typeof busy!=="undefined"&&busy)||gear_session)return;character._lgBusy=1;(async function(){try{if(typeof cycle_at!=="undefined")cycle_at=Date.now();if(!character.bank&&typeof go_npc==="function"){await go_npc("bank");if(typeof snap_bank==="function")snap_bank()}var empty={mainhand:"-",offhand:"-",helmet:"-",chest:"-",pants:"-",shoes:"-",gloves:"-",cape:"-",belt:"-",amulet:"-",ring1:"-",ring2:"-"};["Jazwyn","Sarene","Zarook"].forEach(function(n){if(!gear_ads[n]||Date.now()-(gear_ads[n]._t||0)>50000)gear_ads[n]={gear_ad:1,name:n,esize:5,_t:Date.now(),slots:Object.assign({},empty,n==="Jazwyn"?{offhand:"shield@0"}:{})}});var g=plan_gifts();game_log("LIVE_GEAR_PLAN "+g.length+(g[0]?" "+g[0].it.name+"->"+g[0].who:""));if(!g.length){if(!character._lgWait)character._lgWait=Date.now();if(Date.now()-character._lgWait>90000){game_log("LIVE_GEAR_NOGIFT");character._lg=1}return}if(character._lg)return;if(typeof busy!=="undefined")busy=true;game_log("LIVE_GEAR_START");var r=await run_gear_session();game_log("LIVE_GEAR "+r);if(r==="ok")character._lg=1;if(typeof busy!=="undefined")busy=false}catch(e){game_log("LIVE_GEAR_FAIL "+((e&&e.message)||e));if(typeof busy!=="undefined")busy=false}finally{character._lgBusy=0}})()},5000);\n`;

function strip() {
  let s = fs.readFileSync(GEAROPS, "utf8");
  const i = s.indexOf(MARK);
  if (i >= 0) fs.writeFileSync(GEAROPS, s.slice(0, i));
  else {
    const j = s.indexOf("/*LIVE_GEAR*/");
    if (j >= 0) fs.writeFileSync(GEAROPS, s.slice(0, j).replace(/\s+$/, "") + "\n");
  }
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

async function waitConnected(name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    const rt = ch.runtime || {};
    if (rt.game_connected) {
      console.log("[%s] CONNECTED srv=%s map=%s", name, rt.server, obs(ch).map);
      return true;
    }
    console.log("[%s] waiting %s", name, rt.phase || "?");
    await sleep(5000);
  }
  return false;
}

async function main() {
  strip();
  fs.appendFileSync(GEAROPS, INJECT);
  try {
    deploy();
    await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "al-gear", version: "2" } });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

    console.log("Disconnect all...");
    for (const c of ALL) {
      try { await tool("mainframe_disconnect_character", { character: c }); } catch (e) {}
    }
    console.log("Wait 55s for auth release...");
    await sleep(55000);

    const stamp = Date.now(), cut = Date.now() - 2000;
    // Same-server meet on GEAR_HOME: hold must reach fighters without a hop race.
    const servers = { Jazwyn: "US II", Sarene: "US II", Zarook: "US II", Puppygirl: "US II" };
    for (let pass = 1; pass <= 3; pass++) {
      let failed = null;
      for (const c of ALL) {
        try {
          const link = await tool("mainframe_link_character", {
            character: c, request_id: "gear-" + c + "-" + stamp + "-p" + pass,
            code_slot: SLOTS[c], server: servers[c],
          });
          console.log("link", c, JSON.stringify(link).slice(0, 120));
          if (link && link.failed) { failed = link.reason || "failed"; break; }
          await sleep(1200);
        } catch (e) {
          failed = String(e.message || e);
          console.log("link err", c, failed.slice(0, 140));
          break;
        }
      }
      if (!failed) break;
      for (const c of ALL) {
        try { await tool("mainframe_disconnect_character", { character: c }); } catch (e2) {}
      }
      console.log("retry link after 55s because", failed);
      await sleep(55000);
    }
    for (const c of ALL) {
      if (!(await waitConnected(c, 180000))) throw new Error(c + " failed to connect");
    }

    const seen = {};
    let start = false, offer = false, got = false, done = false, fail = false, here = false, hop = false;
    let planN = -1, planDetail = "";
    const deadline = Date.now() + 480000;
    while (Date.now() < deadline) {
      for (const c of ["Puppygirl", "Jazwyn"]) {
        const logs = await tool("mainframe_get_logs", { character: c, limit: 80 });
        for (const e of logs.logs || []) {
          const at = Date.parse(e.at || 0); if (!(at >= cut)) continue;
          const s = Array.isArray(e.values) ? e.values.join(" ") : String(e.message || e);
          const sk = c + "|" + e.at + "|" + s; if (seen[sk]) continue; seen[sk] = 1;
          if (/LIVE_GEAR|gear:|Hold sent|Resume|Hold:|gear_ad|gear_offer|gear_got/i.test(s)) console.log("LOG", c, s.slice(0, 200));
          if (c !== "Puppygirl") continue;
          const m = s.match(/LIVE_GEAR_PLAN (\d+)(.*)$/);
          if (m) { planN = +m[1]; planDetail = (m[2] || "").trim(); }
          if (/LIVE_GEAR_START|gear:start|gear:resume/.test(s)) start = true;
          if (/gear:hop/.test(s)) hop = true;
          if (/gear:here/.test(s)) here = true;
          if (/gear:offer/.test(s)) offer = true;
          if (/gear:got id=.*ok=1/.test(s)) got = true;
          if (/gear:done|LIVE_GEAR ok|LIVE_GEAR hop|LIVE_GEAR null/.test(s)) done = true;
          if (/LIVE_GEAR_FAIL|LIVE_GEAR_NOGIFT|gear:send fail|gear:pull fail/i.test(s)) fail = true;
        }
      }
      const snap = {};
      for (const c of ALL) {
        const ch = await tool("mainframe_get_character", { character: c });
        const o = obs(ch);
        snap[c] = { msg: (ch.runtime && ch.runtime.message) || "", map: o.map, xy: [Math.round(o.x || 0), Math.round(o.y || 0)], srv: ch.runtime && ch.runtime.server };
      }
      console.log("snap", JSON.stringify(snap), "plan", planN, planDetail, "here", here, "offer", offer, "got", got);
      if (offer || got) break;
      if (done && here) break;
      const blob = Object.keys(seen).join("\n");
      if (/LIVE_GEAR_NOGIFT/.test(blob)) break;
      await sleep(10000);
    }
    const blob = Object.keys(seen).join("\n");
    const result = {
      start, offer, got, done, fail, here, hop, planN, planDetail,
      far: /gear:far/.test(blob), tried: /gear:try/.test(blob), wait: /gear:wait/.test(blob),
      at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(ROOT, "_live_gear.json"), JSON.stringify(result, null, 2));
    console.log("RESULT", result);
    if (offer || got) {
      console.log("SUCCESS gear handoff observed");
      return;
    }
    if (!start && planN === 0) throw new Error("FAIL: no upgrades to gift from bank/bag");
    if (!start && !here && !tried) throw new Error("FAIL: gear session never started");
    throw new Error("FAIL: no offer/got — handoff incomplete");
  } finally {
    strip();
    deploy();
    for (const c of ALL) {
      try { await tool("mainframe_disconnect_character", { character: c }); } catch (e) {}
    }
  }
}
main().catch((e) => { try { strip(); } catch (e2) {} console.error(e.message || e); process.exit(1); });
