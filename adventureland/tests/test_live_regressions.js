"use strict";

/**
 * Live regressions learned 2026-09 (bank store, solo merchant idle).
 * These must stay green — they encode Mainframe quirks the sim now models.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { upgradeChance } = require("../src/gear");
const { MIN_UPGRADE_CHANCE } = require("../src/constants");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("live: bare bank_store(i) invalid — pack store still parks (Mainframe)", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api._injectBankStoreBareInvalid(true);
  api.character.map = "bank";
  api.character.x = 0;
  api.character.y = -37;
  api.character.bank = api.character._bank = {
    gold: 1000,
    items0: new Array(42).fill(null),
    items1: new Array(42).fill(null),
  };
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "hpot1", q: 50 };
  bag[1] = { name: "stand0" };
  bag[2] = { name: "gloves", level: 7 };
  bag[3] = { name: "helmet", level: 7 };
  api.character.esize = bag.filter((x) => !x).length;

  // Bare call must fail under inject
  const bare = await api.bank_store(2);
  assert.ok(bare && bare.failed && bare.reason === "invalid", "bare store should be invalid");
  assert.ok(api.character.items[2], "item remains after bare fail");

  for (let n = 0; n < 40; n++) await p.tickAll();

  assert.ok(!api.character.items.some((it) => it && it.name === "gloves"), "gloves removed from bag");
  assert.ok(!api.character.items.some((it) => it && it.name === "helmet"), "helmet removed from bag");
  const bankItems = Object.values(api.character._bank)
    .filter(Array.isArray)
    .flat()
    .filter(Boolean);
  assert.ok(bankItems.some((it) => it.name === "gloves"), "gloves parked via pack store");
  assert.ok(bankItems.some((it) => it.name === "helmet"), "helmet parked via pack store");
  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => /^bank:store gloves/.test(m)));
  assert.ok(!msgs.some((m) => m === "bank:full"), "must not mislabel free vault as full");
});

test("live: bank:full only when no free pack slots", async () => {
  const p = bootParty({ pack: "armadillo", pots: 50, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.map = "bank";
  api.character.bank = api.character._bank = {
    gold: 0,
    items0: new Array(42).fill(null).map(() => ({ name: "gloves", level: 0 })),
    items1: new Array(42).fill(null).map(() => ({ name: "helmet", level: 0 })),
  };
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[2] = { name: "pants", level: 7 };
  api.character.esize = bag.filter((x) => !x).length;

  for (let n = 0; n < 20; n++) await p.tickAll();

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((m) => m === "bank:full" || /^bank:store_fail/.test(m)),
    "expected full/fail when packs packed, got: " + msgs.filter((m) => /bank:/.test(m)).join(",")
  );
});

test("live: solo merchant does not spam upgrade_skip on bank low-chance gear", async () => {
  // chance@4 = 1-0.32 = 0.68 < MIN 0.9 — the live spam the operator saw in bank
  assert.ok(upgradeChance({ level: 4 }) < MIN_UPGRADE_CHANCE);
  assert.ok(Math.abs(upgradeChance({ level: 4 }) - 0.68) < 0.001);

  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.gold = 500000;
  // Seed bank with below-gate upgradeable (as after prior parks / live dump)
  api.character.bank = api.character._bank = {
    gold: 1000,
    items0: new Array(42).fill(null),
    items1: new Array(42).fill(null),
  };
  api.character.bank.items0[0] = { name: "gloves", level: 4 };
  api.character.bank.items0[1] = { name: "shoes", level: 4 };
  // Start at bank like the live observation
  api.character.map = "bank";
  api.character.x = 0;
  api.character.y = -37;

  for (let n = 0; n < 80; n++) await p.tickAll();

  const skips = api.log.game.filter((g) => /^gear:upgrade_skip/.test(g.m));
  assert.ok(
    skips.length <= 1,
    "upgrade_skip must not spam every tick on bank low-chance gear, got " + skips.length
  );
  // Must not yank low-chance pieces into bag just to skip them
  assert.ok(
    !api.character.items.some((x) => x && x.name === "gloves" && (x.level || 0) === 4),
    "must not retrieve below-gate bank gloves into bag"
  );
});

test("live: bag below-gate piece skip is rate-limited then parked", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.gold = 500000;
  const bag = api.character.items;
  const slot = bag.findIndex((x) => !x);
  bag[slot] = { name: "gloves", level: 4 };
  api.character.esize = Math.max(0, (api.character.esize || 1) - 1);

  for (let n = 0; n < 60; n++) await p.tickAll();

  const skips = api.log.game.filter((g) => /^gear:upgrade_skip/.test(g.m));
  assert.ok(skips.length >= 1, "expected at least one upgrade_skip");
  assert.ok(skips.length <= 1, "skip log once-only, got " + skips.length);
  const banked =
    (api.character.bank || api.character._bank) &&
    (api.character.bank || api.character._bank).items0.some(
      (x) => x && x.name === "gloves" && (x.level || 0) === 4
    );
  assert.ok(banked || !api.character.items[slot], "below-gate gloves should leave bag (park)");
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
