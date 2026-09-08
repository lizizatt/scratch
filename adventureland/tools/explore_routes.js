"use strict";

/**
 * Sim-side route explorer — measures smart_move duration/fail per route class.
 * Writes data/path_bands.sim.json for parity tests and live calibration targets.
 *
 *   node tools/explore_routes.js
 *
 * Live Mainframe explorers (vision radius, true fail rates) come later; this
 * establishes the fixture format and sim baseline bands (V2_PLAN §6.3 / §12.3).
 */

const fs = require("fs");
const path = require("path");
const { createWorld } = require("../sim");
const { NPC, FARM_XY } = require("../sim/world");

const OUT = path.join(__dirname, "..", "data", "path_bands.sim.json");

const ROUTES = [
  { id: "town_to_potions", from: { map: "main", x: 0, y: 0 }, to: { to: "potions" } },
  { id: "potions_to_goo", from: { map: "main", x: NPC.potions.x, y: NPC.potions.y }, to: { to: "goo" } },
  { id: "potions_to_bee", from: { map: "main", x: NPC.potions.x, y: NPC.potions.y }, to: { to: "bee" } },
  {
    id: "potions_to_armadillo_via_cave",
    from: { map: "main", x: NPC.potions.x, y: NPC.potions.y },
    to: { map: "main", x: FARM_XY.armadillo.x, y: FARM_XY.armadillo.y },
  },
  {
    id: "potions_to_se_party_via_cave",
    from: { map: "main", x: NPC.potions.x, y: NPC.potions.y },
    to: { map: "main", x: 750, y: 1750 },
  },
  { id: "island_detour", from: { map: "main", x: 56, y: -122 }, to: { map: "main", x: 500, y: 200 } },
  { id: "phoenix_by_type_fail", from: { map: "main", x: 0, y: 0 }, to: { to: "phoenix" }, expectFail: true },
];

async function timeRoute(route) {
  const w = createWorld();
  const api = w.spawn({
    name: "Explorer",
    ctype: "merchant",
    map: route.from.map,
    real_x: route.from.x,
    real_y: route.from.y,
    x: route.from.x,
    y: route.from.y,
  });
  const t0 = w.clock.now();
  let result;
  try {
    result = await api.smart_move(route.to);
  } catch (e) {
    result = { failed: true, reason: String(e && e.reason ? e.reason : e) };
  }
  w.drainOwedTime();
  const ms = w.clock.now() - t0;
  const failed = !!(result && result.failed);
  return {
    id: route.id,
    ms,
    failed,
    reason: result && result.reason,
    waypoints: (result && result.waypoints && result.waypoints.length) || 0,
    maps: [...new Set(((result && result.waypoints) || []).map((p) => p.map))],
    pathLegs: (api.log.path || []).length,
    expectFail: !!route.expectFail,
    ok: route.expectFail ? failed : !failed,
  };
}

async function main() {
  const samples = [];
  for (const route of ROUTES) {
    const s = await timeRoute(route);
    samples.push(s);
    console.log(
      (s.ok ? "ok  " : "BAD ") +
        s.id +
        "  ms=" +
        s.ms +
        " legs=" +
        s.pathLegs +
        " maps=" +
        (s.maps.join(",") || "-") +
        (s.failed ? " fail=" + s.reason : "")
    );
  }

  const bands = {};
  for (const s of samples) {
    // Loose sim bands: [0.5x, 2x] around measured ms; fails stay fail
    if (s.expectFail) {
      bands[s.id] = { expectFail: true, simMs: s.ms };
    } else {
      bands[s.id] = {
        expectFail: false,
        simMs: s.ms,
        minMs: Math.floor(s.ms * 0.5),
        maxMs: Math.ceil(s.ms * 2 + 1000),
        maps: s.maps,
      };
    }
  }

  const doc = {
    generatedAt: new Date().toISOString(),
    source: "sim",
    note: "Baseline from tools/explore_routes.js. Replace/widen with live explorer samples before Mainframe gate.",
    samples,
    bands,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2));
  console.log("\nWrote", OUT);
  if (samples.some((s) => !s.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
