#!/usr/bin/env node
"use strict";
/**
 * Watch fighters reach armadillo pack and estimate gold/hour.
 * Usage: node live_farm_gph_watch.js [minutes]
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const MINUTES = Math.max(1, Number(process.argv[2] || 8));
const PACK = { map: "main", x: 526, y: 1846 };
const NEAR = 500;
const NAMES = ["Jazwyn", "Sarene", "Zarook"];

function call(n, a) {
  const r = spawnSync("node", ["live_mcp.js", "call", n, JSON.stringify(a || {})], {
    encoding: "utf8",
    cwd: ROOT,
  });
  if (!r.stdout || !r.stdout.trim()) throw new Error((r.stderr || "empty") + " for " + n);
  return JSON.parse(r.stdout);
}

function obs(name) {
  const r = call("mainframe_get_character", { character: name });
  const rt = r.runtime || {};
  const o = rt.observation || {};
  const p = r.profile || {};
  const x = o.x != null ? o.x : p.x;
  const y = o.y != null ? o.y : p.y;
  const map = o.map || p.map;
  const gold = o.gold != null ? o.gold : p.gold;
  const d =
    map === PACK.map && x != null && y != null
      ? Math.hypot(x - PACK.x, y - PACK.y)
      : 1e9;
  return {
    name,
    map,
    x: x != null ? Math.round(x) : null,
    y: y != null ? Math.round(y) : null,
    gold: gold != null ? gold : null,
    d: Math.round(d),
    near: d <= NEAR,
    message: rt.message || rt.status_message || null,
    code_running: rt.code_running,
    game_connected: !!rt.game_connected,
  };
}

function sleep(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    spawnSync(process.execPath, ["-e", ""], { timeout: Math.min(1000, ms) });
  }
}

(async () => {
  const t0 = Date.now();
  const start = {};
  for (const n of NAMES) start[n] = obs(n);
  console.log("START", JSON.stringify(start, null, 2));

  const samples = [];
  const deadline = t0 + MINUTES * 60 * 1000;
  let allNearSince = null;

  while (Date.now() < deadline) {
    sleep(15000);
    const snap = {};
    let allNear = true;
    for (const n of NAMES) {
      snap[n] = obs(n);
      if (!snap[n].near) allNear = false;
    }
    const elapsedMin = (Date.now() - t0) / 60000;
    const gph = {};
    for (const n of NAMES) {
      const g0 = start[n].gold;
      const g1 = snap[n].gold;
      gph[n] =
        g0 != null && g1 != null && elapsedMin > 0.05
          ? Math.round(((g1 - g0) / elapsedMin) * 60)
          : null;
    }
    if (allNear && !allNearSince) allNearSince = Date.now();
    const row = {
      t: new Date().toISOString(),
      elapsedMin: Math.round(elapsedMin * 100) / 100,
      allNear,
      gph,
      chars: snap,
    };
    samples.push(row);
    console.log(
      JSON.stringify({
        t: row.t,
        elapsedMin: row.elapsedMin,
        allNear,
        positions: NAMES.map((n) => n + "@" + snap[n].x + "," + snap[n].y + " d=" + snap[n].d),
        gph,
        msg: NAMES.map((n) => n + ":" + (snap[n].message || "-")),
      })
    );
  }

  const end = {};
  for (const n of NAMES) end[n] = obs(n);
  const elapsedMin = (Date.now() - t0) / 60000;
  const summary = {
    ok: false,
    minutes: elapsedMin,
    allNearAtEnd: NAMES.every((n) => end[n].near),
    allNearSince: allNearSince ? new Date(allNearSince).toISOString() : null,
    goldDelta: {},
    goldPerHour: {},
    start,
    end,
    samples,
  };
  for (const n of NAMES) {
    const dlt = (end[n].gold || 0) - (start[n].gold || 0);
    summary.goldDelta[n] = dlt;
    summary.goldPerHour[n] = elapsedMin > 0 ? Math.round((dlt / elapsedMin) * 60) : null;
  }
  // Pass: all three near pack at end AND party combined gph > 0 (or each positive)
  const partyGph = NAMES.reduce((a, n) => a + (summary.goldPerHour[n] || 0), 0);
  summary.partyGoldPerHour = partyGph;
  summary.ok = summary.allNearAtEnd && partyGph > 0;
  const out = path.join(ROOT, "_live_farm_gph_watch.json");
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log("SUMMARY", JSON.stringify({
    ok: summary.ok,
    allNearAtEnd: summary.allNearAtEnd,
    goldDelta: summary.goldDelta,
    goldPerHour: summary.goldPerHour,
    partyGoldPerHour: summary.partyGoldPerHour,
    out,
  }, null, 2));
  process.exit(summary.ok ? 0 : 2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
