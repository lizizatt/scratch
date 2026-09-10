"use strict";

/**
 * Below-gate gear parks while NPC-vendoring junk; trade-slot tests kept for sim API.
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

test("adversary: below-gate gear must park while vendor sells — no upgrade_skip spam", async () => {
  assert.ok(upgradeChance({ level: 3 }) < MIN_UPGRADE_CHANCE);
  assert.ok(Math.abs(upgradeChance({ level: 3 }) - 0.76) < 0.001);

  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "stand0" };
  bag[1] = { name: "frogt", level: 0 };
  bag[2] = { name: "gloves", level: 3 };
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

  await advance(p, 60);

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((m) => /^vendor:sell frogt/.test(m)),
    "must vendor frogt, got: " + msgs.filter((m) => /vendor:|bank:|gear:/.test(m)).join(" | ")
  );
  assert.ok(
    !api.character.items.some((x) => x && x.name === "gloves" && (x.level || 0) === 3),
    "below-gate gloves must be parked"
  );

  const t0 = p.world.clock.now();
  while (p.world.clock.now() - t0 < 240000) {
    await p.tickAll();
    p.world.clock.advance(15000);
  }

  const skips = api.log.game.filter((g) => /^gear:upgrade_skip/.test(g.m));
  assert.ok(
    skips.length <= 1,
    "upgrade_skip must not re-spam, got " + skips.length + ": " + skips.map((g) => g.m).join(",")
  );
});

test("adversary: reclaim ghost trade junk then NPC-vendor", async () => {
  const p = bootParty({ pack: "armadillo", pots: 50, gold: 100000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "stand0" };
  bag[1] = { name: "hpot0", q: 20 };
  bag[2] = { name: "mpot0", q: 20 };
  api.character.esize = bag.filter((x) => !x).length;
  api.character.map = "main";
  api.character.real_x = api.character.x = 40;
  api.character.real_y = api.character.y = -20;
  api.character.stand = true;
  api.character.slots.trade1 = { name: "wcap", level: 0, price: 6400 };
  api.character.slots.trade2 = { name: "frogt", q: 1, price: 120 };
  api.character._bank = { gold: 0, items0: new Array(42).fill(null) };

  await advance(p, 80);

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((m) => /^vendor:reclaim /.test(m) || /^vendor:sell /.test(m)),
    "must reclaim/sell trade junk, logs=" + msgs.filter((m) => /vendor:/.test(m)).join(" | ")
  );
  assert.ok(!api.character.slots.trade1 || api.character.slots.trade1.name !== "wcap", "wcap reclaimed");
});

test("adversary: queued delivery must not flash-vendor before dlv:active", async () => {
  const p = bootParty({ pack: "armadillo", pots: 40, gold: 200000, members: ["Jazwyn", "Puppygirl"] });
  const mCtrl = p.bots.Puppygirl.ctrl;
  const mApi = p.bots.Puppygirl.api;
  mCtrl.enqueue({
    id: "flash_q",
    kind: "dlv_pots",
    who: "Jazwyn",
    items: [
      { name: "hpot1", q: 5 },
      { name: "mpot1", q: 5 },
    ],
  });
  let firstActive = null;
  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    firstActive = mApi.log.game.find((g) => /^dlv:active dlv_pots/.test(g.m));
    if (firstActive) break;
  }
  assert.ok(firstActive, "expected dlv:active");
  const flash = mApi.log.game.find((g) => g.t < firstActive.t && /^vendor:sell /.test(g.m));
  assert.ok(!flash, "vendor must not run before queued delivery starts");
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
