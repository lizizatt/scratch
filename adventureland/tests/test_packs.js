"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const packs = require("../src/packs");
const world = require("../sim/world");
const knobs = require("../sim/knobs");
const { RECONNECT_MS, SERVER_REGION_DELAY_MS, WALK_PX_PER_S } = require("../sim/character");

const tests = [
  {
    name: "packs: sim world re-exports src/packs (single source)",
    fn() {
      assert.strictEqual(world.FARM_XY, packs.FARM_XY);
      assert.strictEqual(world.packCenter, packs.packCenter);
      assert.deepStrictEqual(packs.packCenter("bee"), { map: "main", x: 546, y: 1059 });
      assert.strictEqual(packs.packCenter("nope"), null);
    },
  },
  {
    name: "knobs: vision/reconnect match sim/knobs + data fixtures",
    fn() {
      assert.strictEqual(world.VISION_PX, knobs.VISION_PX);
      assert.strictEqual(RECONNECT_MS, knobs.RECONNECT_MS);
      assert.strictEqual(SERVER_REGION_DELAY_MS, knobs.SERVER_REGION_DELAY_MS);
      assert.strictEqual(WALK_PX_PER_S, knobs.WALK_PX_PER_S);
      const vision = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "vision.sim.json"), "utf8"));
      const reconnect = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "data", "reconnect.sim.json"), "utf8")
      );
      assert.strictEqual(vision.visionPx, knobs.VISION_PX);
      assert.strictEqual(reconnect.reconnectMs, knobs.RECONNECT_MS);
      assert.strictEqual(reconnect.serverRegionDelayMs, knobs.SERVER_REGION_DELAY_MS);
    },
  },
  {
    name: "path_bands: sim fixture present and bands coherent",
    fn() {
      const file = path.join(__dirname, "..", "data", "path_bands.sim.json");
      assert.ok(fs.existsSync(file), "run node tools/explore_routes.js");
      const doc = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.ok(doc.bands);
      assert.ok(doc.bands.potions_to_bee);
      assert.strictEqual(doc.bands.potions_to_bee.expectFail, false);
      assert.ok(doc.bands.potions_to_bee.simMs > 0);
      assert.ok(doc.bands.phoenix_by_type_fail.expectFail);
      assert.ok(doc.bands.potions_to_bank);
      for (const s of doc.samples || []) {
        assert.ok(s.ok, "sample not ok: " + s.id);
      }
    },
  },
];

module.exports = { tests };
