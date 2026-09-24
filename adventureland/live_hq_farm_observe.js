#!/usr/bin/env node
"use strict";
/**
 * 15-min live soak: hunt_quest on, farm fallback, Puppygirl econ, gold/pots cashflow.
 * Assumes party already linked (run publish + relink first).
 *
 *   node live_hq_farm_observe.js
 *   OBSERVE_MIN=15 node live_hq_farm_observe.js
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = __dirname;
const MINUTES = Number(process.env.OBSERVE_MIN || 15);
const POLL_MS = Number(process.env.OBSERVE_POLL_MS || 20000);
const WATCH = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];
const ARM = { map: "main", x: 526, y: 1846 };
const LOG_RE =
  /mhunt:|soft_abandon|soft_resume|dlv:|Hunt |HQ |metrics |stall:|bank:|gear:|avoid:|rip:|ReferenceError|TypeError|You can't chat|mtick:|tick:/i;

const token = (() => {
  if (process.env.AL_MCP_TOKEN && process.env.AL_MCP_TOKEN.trim()) return process.env.AL_MCP_TOKEN.trim();
  return fs.readFileSync(path.join(ROOT, ".al_mcp_token"), "utf8").trim();
})();

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

function countPots(inv) {
  let hp = 0,
    mp = 0;
  for (const it of inv || []) {
    if (!it || !it.name) continue;
    const q = it.q == null ? 1 : it.q;
    if (/^hpot/.test(it.name)) hp += q;
    if (/^mpot/.test(it.name)) mp += q;
  }
  return { hp, mp };
}

function nearArm(map, x, y) {
  if (map !== ARM.map || x == null || y == null) return false;
  return Math.hypot(x - ARM.x, y - ARM.y) < 550;
}

function goldOf(obs) {
  if (!obs) return null;
  if (obs.gold != null) return obs.gold;
  if (obs.character && obs.character.gold != null) return obs.character.gold;
  return null;
}

async function main() {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "al-hq-farm-observe", version: "1" },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => {});

  const dash = await tool("mainframe_get_dashboard", {});
  const freeH = dash.free_time && dash.free_time.remaining_hours;
  console.log("Dashboard free_hours=%s shells=%s", freeH, dash.shells);

  // Wait for CODE to settle after relink, then enable Daisy hunt chain.
  console.log("Wait 25s for CODE boot...");
  await sleep(25000);
  try {
    const ev = await tool("mainframe_code_eval", {
      character: "Puppygirl",
      code: "try{hunt_quest();game_log('LIVE_HQ_ON')}catch(e){game_log('LIVE_HQ_FAIL '+((e&&e.message)||e))}",
    });
    console.log("hunt_quest enable:", JSON.stringify(ev).slice(0, 240));
  } catch (e) {
    console.log("hunt_quest enable fail:", e.message || e);
  }
  await sleep(3000);

  const t0 = Date.now();
  const samples = [];
  const interesting = [];
  const seenLog = new Set();
  const gold0 = {};
  const pots0 = {};
  let pupStuck = 0;
  let lastPup = null;

  console.log("Observe %sm (poll %ss)...", MINUTES, POLL_MS / 1000);
  while (Date.now() - t0 < MINUTES * 60000) {
    const snap = { t: Date.now(), elapsed_s: Math.round((Date.now() - t0) / 1000), chars: {} };
    for (const name of WATCH) {
      const ch = await tool("mainframe_get_character", { character: name });
      const rt = ch.runtime || {};
      const obs = rt.observation || {};
      const pots = countPots(obs.inventory || obs.items || []);
      const g = goldOf(obs);
      if (gold0[name] == null && g != null) gold0[name] = g;
      if (pots0[name] == null) pots0[name] = pots;
      const xy = {
        map: obs.map,
        x: obs.x != null ? obs.x : obs.real_x,
        y: obs.y != null ? obs.y : obs.real_y,
      };
      snap.chars[name] = {
        connected: !!rt.game_connected,
        phase: rt.phase,
        server: rt.server || [rt.server_region, rt.server_identifier].filter(Boolean).join(" "),
        message: rt.message || rt.status_message || obs.message || null,
        map: xy.map,
        x: xy.x,
        y: xy.y,
        near_arm: nearArm(xy.map, xy.x, xy.y),
        gold: g,
        pots,
        esize: obs.esize,
      };

      const logs = await tool("mainframe_get_logs", { character: name, limit: 50 });
      for (const row of logs.logs || []) {
        if (row.at && Date.parse(row.at) < t0 - 10000) continue;
        const line = (row.values || []).join(" ");
        if (!LOG_RE.test(line)) continue;
        const key = name + "|" + row.at + "|" + line.slice(0, 80);
        if (seenLog.has(key)) continue;
        seenLog.add(key);
        interesting.push({ name, at: row.at, line: line.slice(0, 160) });
      }
    }

    const pup = snap.chars.Puppygirl;
    if (pup && lastPup && pup.map === lastPup.map && Math.round(pup.x) === Math.round(lastPup.x) && Math.round(pup.y) === Math.round(lastPup.y)) {
      pupStuck++;
    } else {
      pupStuck = 0;
    }
    lastPup = pup && { map: pup.map, x: pup.x, y: pup.y };

    samples.push(snap);
    const j = snap.chars.Jazwyn;
    const s = snap.chars.Sarene;
    const z = snap.chars.Zarook;
    console.log(
      "[+%ss] J=%s/%s/%s S=%s Z=%s P=%s/%s goldJ=%s potsJ=%s/%s stuckP=%s logs+=%s",
      snap.elapsed_s,
      j && j.connected ? 1 : 0,
      j && j.message,
      j && j.near_arm ? "arm" : j && j.map,
      s && (s.near_arm ? "arm" : s.map),
      z && (z.near_arm ? "arm" : z.map),
      pup && pup.map,
      pup && pup.message,
      j && j.gold,
      j && j.pots.hp,
      j && j.pots.mp,
      pupStuck,
      interesting.length
    );
    await sleep(POLL_MS);
  }

  const last = samples[samples.length - 1] || { chars: {} };
  const goldDelta = {};
  const potsDelta = {};
  for (const n of WATCH) {
    const c = last.chars[n];
    if (!c) continue;
    goldDelta[n] = c.gold != null && gold0[n] != null ? c.gold - gold0[n] : null;
    potsDelta[n] = {
      hp: c.pots.hp - (pots0[n] ? pots0[n].hp : 0),
      mp: c.pots.mp - (pots0[n] ? pots0[n].mp : 0),
    };
  }

  const logText = interesting.map((x) => x.line).join("\n");
  const summary = {
    minutes: MINUTES,
    samples: samples.length,
    hunt_quest: {
      hq_on: /LIVE_HQ_ON|HQ on|hunt_quest on|mhunt:start/i.test(logText),
      mhunt_lines: interesting.filter((x) => /mhunt:/i.test(x.line)).length,
      soft_abandon: interesting.some((x) => /soft_abandon/i.test(x.line)),
      soft_resume: interesting.some((x) => /soft_resume/i.test(x.line)),
    },
    farm: {
      jazwyn_near_arm_polls: samples.filter((s) => s.chars.Jazwyn && s.chars.Jazwyn.near_arm).length,
      party_near_arm_polls: samples.filter(
        (s) =>
          s.chars.Jazwyn &&
          s.chars.Jazwyn.near_arm &&
          s.chars.Sarene &&
          s.chars.Sarene.near_arm &&
          s.chars.Zarook &&
          s.chars.Zarook.near_arm
      ).length,
    },
    puppy: {
      dlv_lines: interesting.filter((x) => /dlv:/i.test(x.line)).length,
      stall_or_bank: interesting.filter((x) => /stall:|bank:/i.test(x.line)).length,
      metrics: interesting.filter((x) => /metrics /i.test(x.line)).length,
      max_stuck_polls: pupStuck,
      code_errs: interesting.filter((x) => /ReferenceError|TypeError|mtick:/i.test(x.line)).length,
    },
    cashflow: { gold0, gold_last: Object.fromEntries(WATCH.map((n) => [n, last.chars[n] && last.chars[n].gold])), goldDelta, pots0, potsDelta },
    interesting_tail: interesting.slice(-40),
  };

  summary.pass = {
    connected: samples.every((s) => WATCH.every((n) => s.chars[n] && s.chars[n].connected)),
    hq_or_farm: summary.hunt_quest.mhunt_lines > 0 || summary.farm.jazwyn_near_arm_polls >= 3,
    farm_fallback: summary.farm.jazwyn_near_arm_polls >= 2,
    puppy_alive: summary.puppy.code_errs === 0,
    cashflow_signal:
      interesting.some((x) => /dlv:done|dlv:req|metrics /i.test(x.line)) ||
      Object.values(potsDelta).some((d) => d && (d.hp !== 0 || d.mp !== 0)) ||
      Object.values(goldDelta).some((d) => d != null && d !== 0),
  };
  summary.ok = Object.values(summary.pass).every(Boolean);

  const out = path.join(ROOT, "_live_hq_farm_observe.json");
  fs.writeFileSync(out, JSON.stringify({ summary, samples }, null, 2));
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("Wrote", out, "ok=", summary.ok);
  process.exit(summary.ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
