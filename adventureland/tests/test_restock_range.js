"use strict";

/**
 * Live burn-in 2026-09-09 ~+930s: Zarook town_fallback → Puppygirl buy pots →
 * dlv:send_fail (distance) → empty_send while fighter still pathing / out of range.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { SEND_ITEM_RANGE } = require("../sim/world");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function dist(a, b) {
  return Math.hypot((a.real_x || a.x || 0) - (b.real_x || b.x || 0), (a.real_y || a.y || 0) - (b.real_y || b.y || 0));
}

function clearPots(items) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it && /^hpot|^mpot/.test(it.name)) items[i] = null;
  }
}

test("adversary: restock distance miss after approach must reapproach (no empty_send)", async () => {
  // Merchant walks to meet; fighter yanks out of SEND_RANGE once (live pathing race).
  // Old code: send_fail → empty_send → wait next tick. Fixed: reapproach in-tick, send pots.
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const zApi = p.bots.Zarook.api;
  const mApi = p.bots.Puppygirl.api;
  const z = zApi.character;
  const m = mApi.character;
  z.gold = 500000;
  m.gold = 500000;
  clearPots(z.items);
  z.esize = z.items.filter((x) => !x).length;
  const meet = { map: "main", x: 56, y: -122 };
  z.map = meet.map;
  z.real_x = z.x = meet.x;
  z.real_y = z.y = meet.y;
  m.map = meet.map;
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;

  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_range_miss",
    kind: "dlv_pots",
    who: "Zarook",
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ],
    farm: "armadillo",
    map: meet.map,
    x: meet.x,
    y: meet.y,
  });

  let yanked = false;
  let armed = false;
  const realMove = mApi.smart_move.bind(mApi);
  mApi.smart_move = async (dest) => {
    const r = await realMove(dest);
    // Arm after potion vendor trip; yank once on the field meet approach.
    if (!armed && mApi.log.game.some((g) => /^dlv:buy mpot1/.test(g.m))) armed = true;
    if (
      armed &&
      !yanked &&
      !(r && r.failed) &&
      m.map === z.map &&
      dist(m, z) <= 200
    ) {
      yanked = true;
      // West of plaza — walkable, in vision, outside SEND_RANGE.
      z.real_x = z.x = m.real_x - (SEND_ITEM_RANGE + 100);
      z.real_y = z.y = m.real_y;
    }
    return r;
  };

  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "dlv:done id=p_range_miss")) break;
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(yanked, "inject must yank fighter once");
  assert.ok(
    msgs.some((x) => x === "dlv:done id=p_range_miss"),
    "must dlv:done, logs=" + msgs.filter((x) => /^dlv:/.test(x)).join(" | ")
  );
  assert.ok(
    msgs.some((x) => /^dlv:send hpot1 id=p_range_miss/.test(x)),
    "must send pots"
  );
  // In-tick reapproach should avoid the empty_send loop from the live burn-in.
  assert.ok(!msgs.some((x) => x === "dlv:empty_send"), "must not empty_send after distance miss");
  assert.ok(
    msgs.some((x) => /^dlv:approach/.test(x) || /^dlv:send_fail /.test(x)),
    "expected approach or one send_fail before recover"
  );
  assert.ok(z.items.some((it) => it && it.name === "hpot1"), "Zarook received pots");
});

test("adversary: stand open blocks send_item — must close before restock send", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const z = p.bots.Zarook.api.character;
  const m = p.bots.Puppygirl.api.character;
  const mApi = p.bots.Puppygirl.api;
  z.gold = 500000;
  m.gold = 500000;
  clearPots(z.items);
  z.esize = z.items.filter((x) => !x).length;
  for (const c of [z, m]) {
    c.map = "main";
    c.real_x = c.x = 56;
    c.real_y = c.y = -122;
  }
  m.stand = true;
  m.slots.trade1 = { name: "rednose", level: 0, price: 100 };

  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_stand_block",
    kind: "dlv_pots",
    who: "Zarook",
    items: [
      { name: "hpot1", q: 20 },
      { name: "mpot1", q: 20 },
    ],
    map: "main",
    x: 56,
    y: -122,
  });

  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "dlv:done id=p_stand_block")) break;
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(msgs.some((x) => x === "dlv:done id=p_stand_block"), "must complete delivery");
  assert.ok(msgs.some((x) => /^dlv:send hpot1/.test(x)), "must send pots");
  assert.ok(!m.stand, "stand must be closed for send");
  assert.ok(z.items.some((it) => it && it.name === "hpot1"));
});

module.exports = { tests };

if (require.main === module) {
  (async () => {
    for (const t of tests) {
      await t.fn();
      console.log("ok", t.name);
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
