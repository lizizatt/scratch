"use strict";

const assert = require("assert");
const { createMotion } = require("../src/motion");
const { createWorld } = require("../sim/server");
const { packCenter } = require("../src/packs");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("fighter cross-map travel enters desert before using a deep coordinate", async () => {
  const world = createWorld();
  const api = world.spawn({ name: "Jazwyn", map: "main", real_x: 0, real_y: 0, x: 0, y: 0 });
  const originalSmartMove = api.smart_move;
  const calls = [];
  api.smart_move = async (dest) => {
    calls.push(Object.assign({}, dest));
    if (api.character.map === "main" && dest.map === "desertland" && dest.x != null) {
      return { failed: true, reason: "deep_cross_map" };
    }
    return originalSmartMove(dest);
  };
  const motion = createMotion(api, { leadName: () => "Jazwyn" });
  const destination = packCenter("gscorpion");
  const result = await motion.goTo(destination);

  assert.ok(result && result.success);
  assert.deepStrictEqual(calls[0], { map: "desertland" });
  assert.deepStrictEqual(calls[1], destination);
  assert.strictEqual(api.character.map, "desertland");
  assert.strictEqual(api.character.real_x, destination.x);
  assert.strictEqual(api.character.real_y, destination.y);
});

test("formation uses routed movement instead of crossing a wall directly", async () => {
  const calls = [];
  const api = {
    character: { name: "Sarene", map: "desertland", real_x: 391, real_y: -1200 },
    get_player: () => ({ name: "Jazwyn", map: "desertland", real_x: 391, real_y: -1300, angle: 0 }),
    get_party: () => ({}),
    can_move_to: () => false,
    move: () => {
      throw new Error("direct move must not be used for a blocked formation slot");
    },
    smart_move: async (dest) => {
      calls.push(dest);
      return { success: true };
    },
    stop: () => {},
    game_log: () => {},
  };
  const motion = createMotion(api, { leadName: () => "Jazwyn" });
  assert.strictEqual(await motion.followFormation({ dx: 0, dy: 40 }), true);
  assert.deepStrictEqual(calls, [{ map: "desertland", x: 391, y: -1260 }]);
});

module.exports = { tests };
