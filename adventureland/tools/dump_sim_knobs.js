"use strict";

/**
 * Dump sim ASSUMED knobs into data/ for explorer parity docs.
 *   node tools/dump_sim_knobs.js
 */
const fs = require("fs");
const path = require("path");
const knobs = require("../sim/knobs");

const ROOT = path.join(__dirname, "..", "data");
fs.mkdirSync(ROOT, { recursive: true });

const vision = {
  generatedAt: new Date().toISOString(),
  source: knobs.source,
  visionPx: knobs.VISION_PX,
  sendItemRange: knobs.SEND_ITEM_RANGE,
  sendGoldRange: knobs.SEND_GOLD_RANGE,
  note: knobs.note,
};
const reconnect = {
  generatedAt: new Date().toISOString(),
  source: knobs.source,
  reconnectMs: knobs.RECONNECT_MS,
  serverRegionDelayMs: knobs.SERVER_REGION_DELAY_MS,
  walkPxPerS: knobs.WALK_PX_PER_S,
  crossMapBaseMs: knobs.CROSS_MAP_BASE_MS,
  townMs: knobs.TOWN_MS,
  note: knobs.note,
};

fs.writeFileSync(path.join(ROOT, "vision.sim.json"), JSON.stringify(vision, null, 2));
fs.writeFileSync(path.join(ROOT, "reconnect.sim.json"), JSON.stringify(reconnect, null, 2));
console.log("Wrote data/vision.sim.json and data/reconnect.sim.json");
