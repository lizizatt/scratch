"use strict";

/**
 * Live burn-in 2026-09-09: stall:trade_fail slot_occuppied on boot;
 * gear:upgrade_skip chance=0.76 every ~60s while stand open (gloves@3 stuck in bag).
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { upgradeChance } = require("../src/gear");
const { MIN_UPGRADE_CHANCE } = require("../src/constants");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function advance(p, n) {
  return (async () => {
    for (let i = 0; i < n; i++) await p.tickAll();
  })();
}

test("adversary: below-gate gear must park before stall — no upgrade_skip spam with stand open", async () => {
  // chance@3 = 0.76 < MIN 0.9 — the burn-in spam line
  assert.ok(upgradeChance({ level: 3 }) < MIN_UPGRADE_CHANCE);
  assert.ok(Math.abs(upgradeChance({ level: 3 }) - 0.76) < 0.001);

  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "stand0" };
  bag[1] = { name: "frogt", level: 0 }; // sell junk → stall
  bag[2] = { name: "gloves", level: 3 }; // below-gate → must park before stall
  api.character.esize = bag.filter((x) => !x).length;
  api.character.gold = 500000;
  api.character.map = "main";
  api.character.real_x = api.character.x = 40;
  api.character.real_y = api.character.y = -20;
  api.character.bank = api.character._bank = {
    gold: 0,
    items0: new Array(42).fill(null),
    items1: new Array(42).fill(null),
  };

  await advance(p, 40);

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => /^stall:open/.test(m)), "stall should open, got: " + msgs.filter((m) => /stall:|bank:|gear:/.test(m)).join(" | "));
  assert.ok(api.character.stand || msgs.some((m) => /^stall:open/.test(m)), "stand open");

  // gloves@3 must not remain in bag after stall (park-before-stall)
  assert.ok(
    !api.character.items.some((x) => x && x.name === "gloves" && (x.level || 0) === 3),
    "below-gate gloves must be parked before stall locks parkToBank"
  );

  const t0 = p.world.clock.now();
  // Simulate ~4 minutes of idle with stand up (old bug: skip every 60s)
  while (p.world.clock.now() - t0 < 240000) {
    await p.tickAll();
    p.world.clock.advance(15000);
  }

  const skips = api.log.game.filter((g) => /^gear:upgrade_skip/.test(g.m));
  assert.ok(
    skips.length <= 1,
    "upgrade_skip must not re-spam while stall open, got " + skips.length + ": " + skips.map((g) => g.m).join(",")
  );
});

test("adversary: trade into occupied slot retries next free slot (slot_occuppied)", async () => {
  const p = bootParty({ pack: "armadillo", pots: 50, gold: 100000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "stand0" };
  bag[1] = { name: "frogt", level: 0 };
  api.character.esize = bag.filter((x) => !x).length;
  api.character.map = "main";
  api.character.real_x = api.character.x = 40;
  api.character.real_y = api.character.y = -20;
  // Ghost listing: looks empty until stand opens (live race / prior session restore)
  api.character._tradeGhost = {
    trade1: { name: "elixirluck", price: 1000, q: 1 },
  };
  api.character.slots = {};

  await advance(p, 50);

  const msgs = api.log.game.map((g) => g.m);
  const fails = msgs.filter((m) => /^stall:trade_fail/.test(m));
  assert.ok(msgs.some((m) => /^stall:open/.test(m)), "stall must open despite ghost trade1, logs=" + msgs.filter((m) => /stall:/.test(m)).join(" | "));
  assert.ok(api.character.slots.trade1 && api.character.slots.trade1.name === "elixirluck", "ghost restored on open");
  assert.ok(
    api.character.slots.trade2 || Object.keys(api.character.slots).some((k) => /^trade\d+$/.test(k) && api.character.slots[k] && api.character.slots[k].name === "frogt"),
    "frogt listed on a free trade slot"
  );
  // May log one fail if first pick raced; must not soft-fail the stall
  assert.ok(fails.length <= 2, "should not spam trade_fail, got " + fails.length);
  assert.ok(!bag[1] || bag[1].name !== "frogt", "frogt left bag into trade slot");
});

test("adversary: trade_fail slot_occuppied retries next attempt in-call", async () => {
  const p = bootParty({ pack: "armadillo", pots: 50, gold: 100000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "stand0" };
  bag[1] = { name: "frogt", level: 0 };
  api.character.esize = bag.filter((x) => !x).length;
  api.character.map = "main";
  api.character.real_x = api.character.x = 40;
  api.character.real_y = api.character.y = -20;
  api.character.slots = {};
  let calls = 0;
  const realTrade = api.trade.bind(api);
  api.trade = async function (i, slot, price, q) {
    calls++;
    if (calls === 1) return { failed: true, reason: "slot_occuppied" };
    return realTrade(i, slot, price, q);
  };

  await advance(p, 50);

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => m === "stall:trade_fail slot_occuppied"), "expected one occupied fail");
  assert.ok(msgs.some((m) => /^stall:open/.test(m)), "stall recovers via retry");
  assert.ok(calls >= 2, "must retry trade after slot_occuppied");
});

test("adversary: occupied trade slot arg returns slot_occuppied (sim matches live spelling)", async () => {
  const p = bootParty({ pack: "armadillo", pots: 10, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.stand = true;
  api.character.slots.trade1 = { name: "rednose", price: 10, q: 1 };
  api.character.items[5] = { name: "frogt", level: 0 };
  const r = await api.trade(5, 1, 100, 1);
  assert.ok(r && r.failed && r.reason === "slot_occuppied", "expected slot_occuppied, got " + JSON.stringify(r));
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
