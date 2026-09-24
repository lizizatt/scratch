#!/usr/bin/env node
/**
 * Independent 5m solo trials: Jazwyn, Sarene, Zarook each alone on US III.
 * Pass: connected, farm activity (near armadillo pack and/or combat/gold/xp),
 * no fatal CODE errors, not dead-stuck.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = __dirname;
const token = (process.env.AL_MCP_TOKEN || fs.readFileSync(path.join(ROOT, ".al_mcp_token"), "utf8")).trim();
let headers = {
  Authorization: "Bearer " + token,
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};
let id = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVER = process.env.AL_SERVER || "US III";
const MINUTES = Number(process.env.OBSERVE_MIN != null && process.env.OBSERVE_MIN !== "" ? process.env.OBSERVE_MIN : 5);
const ALL = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];
const FIGHTERS = (process.env.AL_FIGHTERS || "Jazwyn,Sarene,Zarook").split(",").map((s) => s.trim());
const ARM = { map: "main", x: 526, y: 1846 };
const PACK_R = 600;

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

function dist(a, b) {
  if (!a || !b || a.map !== b.map) return 1e9;
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  return Math.sqrt(dx * dx + dy * dy);
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

async function resolveSlots() {
  const listed = await tool("list_codes", {});
  const byName = {};
  for (const c of listed.codes || []) byName[(c.name || "").toLowerCase()] = String(c.slot);
  const need = {};
  for (const n of FIGHTERS) {
    need[n] = byName[n.toLowerCase()];
    if (!need[n]) throw new Error("missing CODE slot for " + n);
  }
  return need;
}

async function disconnectAll() {
  for (const c of ALL) {
    try {
      await tool("mainframe_disconnect_character", { character: c });
      console.log("disconnect", c);
    } catch (e) {
      console.log("disconnect skip", c, (e && e.message) || e);
    }
  }
}

async function waitConnected(name, msMax) {
  const t0 = Date.now();
  while (Date.now() - t0 < msMax) {
    const ch = await tool("mainframe_get_character", { character: name });
    const rt = ch.runtime || {};
    if (rt.game_connected) {
      console.log("[%s] CONNECTED", name);
      return true;
    }
    console.log("[%s] waiting %s", name, rt.phase || "?");
    await sleep(5000);
  }
  return false;
}

async function trialOne(name, slot) {
  console.log("\n=== SOLO TRIAL", name, MINUTES + "m ===");
  await disconnectAll();
  console.log("auth cooldown 55s...");
  await sleep(55000);

  await tool("mainframe_link_character", {
    character: name,
    request_id: "solo_" + name + "_" + Date.now(),
    code_slot: slot,
    server: SERVER,
  });
  const okConn = await waitConnected(name, 180000);
  if (!okConn) {
    return { character: name, pass: false, reason: "not_connected" };
  }

  const cut = Date.now() - 3000;
  const samples = [];
  const tEnd = Date.now() + MINUTES * 60000;
  while (Date.now() < tEnd) {
    const ch = await tool("mainframe_get_character", { character: name });
    const rt = ch.runtime || {};
    const obs = rt.observation || {};
    const pots = potCounts(obs.inventory);
    const d = dist(obs, ARM);
    const perf = (rt.performance && rt.performance.session) || {};
    const row = {
      t: Date.now(),
      map: obs.map,
      x: obs.x,
      y: obs.y,
      msg: rt.message || rt.status_message || "",
      connected: !!rt.game_connected,
      rip: !!obs.rip,
      pots,
      near_pack: obs.map === ARM.map && d < PACK_R,
      dist_pack: Math.round(d),
      stationary_ms: (obs.movement && obs.movement.stationary_ms) || 0,
      kills: perf.kills || 0,
      damage: perf.damage || 0,
      gold_net: perf.gold_net || 0,
      xp_net: perf.xp_net || 0,
    };
    samples.push(row);
    console.log(
      "[%s +%ss] map=%s xy=%s,%s near=%s d=%s pots=%s/%s kills=%s dmg=%s msg=%s",
      name,
      Math.round((Date.now() - cut) / 1000),
      row.map,
      row.x != null ? Math.round(row.x) : "?",
      row.y != null ? Math.round(row.y) : "?",
      row.near_pack ? 1 : 0,
      row.dist_pack,
      pots.hp,
      pots.mp,
      row.kills,
      row.damage,
      (row.msg || "").slice(0, 36)
    );
    await sleep(15000);
  }

  const logs = await tool("mainframe_get_logs", { character: name, limit: 100 });
  const lines = [];
  let fatal = false;
  let chatThrottle = 0;
  for (const L of logs.logs || []) {
    const at = L.at ? Date.parse(L.at) : 0;
    if (at && at < cut) continue;
    const line = (L.values || []).join(" ");
    lines.push(line);
    if (/ReferenceError|TypeError|SyntaxError/.test(line)) fatal = true;
    if (/You can't chat this fast|chat this fast/.test(line)) chatThrottle++;
    if (/Transfer |farm:|Hunt |V2 |tick:|rip:|metrics /.test(line)) {
      console.log("LOG", line.slice(0, 120));
    }
  }

  const late = samples.slice(Math.floor(samples.length / 2));
  const nearLate = late.filter((s) => s.near_pack).length;
  const last = samples[samples.length - 1] || {};
  const anyCombat =
    samples.some((s) => s.kills > 0 || s.damage > 0) ||
    (last.kills || 0) > 0 ||
    (last.damage || 0) > 0 ||
    (last.xp_net || 0) > 0;
  const reachedPack = samples.some((s) => s.near_pack);
  const stuckOffPack =
    late.length >= 4 &&
    late.every((s) => !s.near_pack && s.stationary_ms > 90000 && s.map === late[0].map);
  const connectedOk = samples.filter((s) => s.connected).length >= Math.max(1, samples.length - 1);
  const ripStuck = late.length >= 3 && late.every((s) => s.rip);

  const pass =
    connectedOk &&
    !fatal &&
    !ripStuck &&
    !stuckOffPack &&
    reachedPack &&
    anyCombat &&
    nearLate >= 1;

  const out = {
    character: name,
    at: new Date().toISOString(),
    samples: samples.length,
    near_pack_samples: samples.filter((s) => s.near_pack).length,
    near_pack_late: nearLate,
    reached_pack: reachedPack,
    any_combat: anyCombat,
    last_map: last.map,
    last_xy: [last.x, last.y],
    last_kills: last.kills,
    last_damage: last.damage,
    last_xp_net: last.xp_net,
    chat_throttle: chatThrottle,
    fatal,
    stuck_off_pack: stuckOffPack,
    rip_stuck: ripStuck,
    pass,
    reason: pass
      ? "ok"
      : [
          !connectedOk && "disconnect",
          fatal && "fatal_log",
          ripStuck && "rip_stuck",
          stuckOffPack && "stuck_off_pack",
          !reachedPack && "never_on_pack",
          !anyCombat && "no_combat",
          nearLate < 1 && "not_on_pack_late",
        ]
          .filter(Boolean)
          .join(","),
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

async function main() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-solo-fighter", version: "1.0" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  const dash = await tool("mainframe_get_dashboard", {});
  console.log(
    "dashboard shells=%s free_h=%s",
    dash.shells,
    dash.free_time && dash.free_time.remaining_hours
  );
  const slots = await resolveSlots();

  const results = [];
  for (const name of FIGHTERS) {
    results.push(await trialOne(name, slots[name]));
  }

  await disconnectAll();

  const summary = {
    at: new Date().toISOString(),
    minutes: MINUTES,
    server: SERVER,
    results,
    pass: results.every((r) => r.pass),
  };
  fs.writeFileSync(path.join(ROOT, "_live_solo_fighters.json"), JSON.stringify(summary, null, 2));
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.pass) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
