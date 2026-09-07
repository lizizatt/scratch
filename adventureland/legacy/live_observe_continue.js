#!/usr/bin/env node
"use strict";
/** Observe already-linked party for hunt/restock/world (no redeploy). */
const fs = require("fs");
const path = require("path");
const https = require("https");
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
const ALL = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];
function pots(inv) { let hp = 0, mp = 0; for (const it of inv || []) { if (!it) continue; if (("" + it.name).indexOf("hpot") === 0) hp += it.q || 1; if (("" + it.name).indexOf("mpot") === 0) mp += it.q || 1; } return { hp, mp }; }
function invOf(ch) { return (ch.runtime && ch.runtime.observation && ch.runtime.observation.inventory) || (ch.profile && ch.profile.inventory) || []; }
function posOf(ch) {
  const obs = (ch.runtime && ch.runtime.observation) || {}, p = ch.profile || {}, rt = ch.runtime || {};
  return { map: obs.map || p.map, x: obs.x != null ? obs.x : p.x, y: obs.y != null ? obs.y : p.y, server: rt.server || null, ident: rt.server_identifier || null, region: rt.server_region || null };
}
function nearArm(pos) { return pos && pos.map === "main" && Math.abs((pos.x || 0) - 526) < 500 && Math.abs((pos.y || 0) - 1846) < 500; }

async function main() {
  const farmMs = Number(process.env.FARM_MS || 8 * 60 * 1000);
  const worldMs = Number(process.env.WORLD_MS || 12 * 60 * 1000);
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "al-obs-cont", version: "1" } });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});
  const cut = Date.now() - 2000;
  const seen = {}, lastPos = {}, stuck = {};
  const result = { started: new Date().toISOString(), hunt: { allHunting: false }, restock: { dlvOk: 0, chatThrottle: 0, pupStuckHits: 0, notes: [] }, world: { switched: false, huntingAfter: false, dlvOk: 0, dispatched: false }, shield: null };

  async function poll(phase) {
    for (const c of ALL) {
      const raw = await tool("mainframe_get_logs", { character: c, limit: 80 });
      for (const entry of raw.logs || []) {
        const at = Date.parse(entry.at || 0); if (!(at >= cut)) continue;
        const s = Array.isArray(entry.values) ? entry.values.join(" ") : String(entry.message || entry);
        const sk = c + "|" + entry.at + "|" + s; if (seen[sk]) continue; seen[sk] = 1;
        if (/dlv:|LIVE_|World |go_s|You can't chat|chat this fast|Dlv |Hunt armadillo|Form|stuck|cm fail/i.test(s)) console.log("  LOG", c, "|", s.slice(0, 200));
        if (/You can't chat|chat this fast/i.test(s)) { result.restock.chatThrottle++; result.restock.notes.push(s.slice(0, 100)); }
        if (/dlv:done id=.* ok=1|dlv:got id=.* ok=1|dlv:send /.test(s)) { if (phase === "world") result.world.dlvOk++; else result.restock.dlvOk++; }
        if (/LIVE_WORLD_CMD|World US\/II|go_s:US\/II/.test(s)) { result.world.dispatched = true; if (/US\/II/.test(s)) result.world.switched = true; }
      }
    }
  }

  console.log("=== OBSERVE farm", Math.round(farmMs / 60000), "m ===");
  const farmEnd = Date.now() + farmMs;
  while (Date.now() < farmEnd) {
    await poll("farm");
    let hunting = 0; const bits = [];
    for (const c of ALL) {
      const ch = await tool("mainframe_get_character", { character: c });
      const pos = posOf(ch), msg = String((ch.runtime && (ch.runtime.message || ch.runtime.status_message)) || "");
      const key = [pos.map, Math.round(pos.x || 0), Math.round(pos.y || 0)].join(",");
      stuck[c] = lastPos[c] === key ? (stuck[c] || 0) + 1 : 0; lastPos[c] = key;
      if (c === "Puppygirl" && stuck[c] >= 8) { result.restock.pupStuckHits++; result.restock.notes.push("stuck@" + key + " " + msg.slice(0, 40)); }
      if (c !== "Puppygirl" && (/armadillo/i.test(msg) || nearArm(pos))) hunting++;
      const po = pots(invOf(ch));
      bits.push(c.slice(0, 3) + ":" + msg.slice(0, 14) + "@" + (pos.map || "?") + " p=" + po.hp + "/" + po.mp + " st=" + (stuck[c] || 0));
      if (c === "Jazwyn") {
        const oh = ((ch.runtime && ch.runtime.observation && ch.runtime.observation.slots) || (ch.profile && ch.profile.slots) || {}).offhand;
        result.shield = oh;
      }
    }
    if (hunting >= 3) result.hunt.allHunting = true;
    console.log("farm hunt=%s dlv=%s spam=%s pupStuck=%s | %s", hunting, result.restock.dlvOk, result.restock.chatThrottle, result.restock.pupStuckHits, bits.join(" "));
    await sleep(20000);
  }

  console.log("=== OBSERVE world", Math.round(worldMs / 60000), "m ===");
  const worldEnd = Date.now() + worldMs;
  while (Date.now() < worldEnd) {
    await poll("world");
    let onII = 0, hunting = 0; const bits = [];
    for (const c of ALL) {
      const ch = await tool("mainframe_get_character", { character: c });
      const pos = posOf(ch), msg = String((ch.runtime && (ch.runtime.message || ch.runtime.status_message)) || "");
      const srv = String(pos.server || "") + " " + String(pos.ident || "") + " " + String(pos.region || "");
      if (/\bII\b/.test(srv) || /US II/i.test(String(pos.server || ""))) onII++;
      if (c !== "Puppygirl" && (/armadillo/i.test(msg) || nearArm(pos))) hunting++;
      bits.push(c.slice(0, 3) + "@" + (pos.server || pos.ident || "?") + " " + msg.slice(0, 18));
    }
    if (onII >= 3) result.world.switched = true;
    if (hunting >= 2 && (result.world.switched || result.world.dispatched)) result.world.huntingAfter = true;
    console.log("world onII~%s hunt=%s dlv=%s | %s", onII, hunting, result.world.dlvOk, bits.join(" | "));
    await sleep(20000);
  }
  result.finished = new Date().toISOString();
  fs.writeFileSync(path.join(ROOT, "_live_party_verify.json"), JSON.stringify(result, null, 2));
  console.log("RESULT", JSON.stringify(result, null, 2));
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
