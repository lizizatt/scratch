"use strict";

/**
 * Earring/cape GEAR_TARGETS + Ponty browse for empty accessory slots.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { planGifts, candidateSlots, isSellJunk, isGearTargetName } = require("../src/gear");
const { GEAR_TARGETS, VENDOR_NPC, PONTY_WANT } = require("../src/constants");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("constants: earring/cape targets; str/vit/int earrings not vendored", () => {
  assert.strictEqual(GEAR_TARGETS.Jazwyn.earring1, "strearring");
  assert.strictEqual(GEAR_TARGETS.Zarook.earring1, "vitearring");
  assert.strictEqual(GEAR_TARGETS.Sarene.cape, "cape");
  assert.strictEqual(GEAR_TARGETS.Jazwyn.cape, "cape");
  assert.ok(VENDOR_NPC.indexOf("strearring") < 0);
  assert.ok(VENDOR_NPC.indexOf("vitearring") < 0);
  assert.ok(VENDOR_NPC.indexOf("intearring") < 0);
  assert.ok(VENDOR_NPC.indexOf("dexearring") >= 0);
  assert.ok(isGearTargetName("strearring"));
  assert.ok(isGearTargetName("cape"));
  assert.ok(!isSellJunk({ name: "strearring" }, {}));
  assert.ok(PONTY_WANT.some((w) => w[0] === "cape" && w[1] >= 3));
});

test("unit: earring candidateSlots + planGifts strearring to Jazwyn", () => {
  const G = {
    items: {
      strearring: { type: "earring", str: 3 },
      vitearring: { type: "earring", vit: 3 },
      cape: { type: "cape", armor: 10, resistance: 8, stat: 4 },
    },
  };
  assert.deepStrictEqual(candidateSlots({ name: "strearring" }, G), ["earring1", "earring2"]);
  assert.deepStrictEqual(candidateSlots({ name: "cape" }, G), ["cape"]);
  const gifts = planGifts(
    [
      { name: "strearring", level: 0, pack: "bag", i: 0 },
      { name: "cape", level: 0, pack: "bag", i: 1 },
    ],
    {
      Jazwyn: {
        ctype: "warrior",
        esize: 5,
        slots: { earring1: null, earring2: null, cape: null },
      },
    },
    G
  );
  assert.ok(gifts.some((g) => g.who === "Jazwyn" && g.slot === "earring1" && g.it.name === "strearring"));
  assert.ok(gifts.some((g) => g.who === "Jazwyn" && g.slot === "cape" && g.it.name === "cape"));
});

test("adversary: reclaim trade strearring then plan gift to Jazwyn", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 100,
    gold: 500000,
    members: ["Jazwyn", "Puppygirl"],
  });
  const mApi = p.bots.Puppygirl.api;
  const jApi = p.bots.Jazwyn.api;
  const m = mApi.character;
  m.gold = 800000;
  for (let i = 0; i < m.items.length; i++) {
    const it = m.items[i];
    if (it && (it.name === "stand0" || /^hpot|^mpot|^scroll/.test(it.name))) continue;
    if (it) {
      m.items[i] = null;
      m.esize = (m.esize || 0) + 1;
    }
  }
  m.stand = true;
  m.slots.trade7 = { name: "strearring", level: 0, price: 38000 };
  m._bank = { gold: 0, items0: new Array(42).fill(null) };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  // Empty earring ads
  jApi.character.slots.earring1 = null;
  jApi.character.slots.earring2 = null;
  // Force a gear_ad so merchant sees empty slots
  mApi.ctrl; // boot exists
  // Inject ad via merchant store — call gear ad path by ticking fighters near merchant
  jApi.character.map = "main";
  jApi.character.real_x = jApi.character.x = 45;
  jApi.character.real_y = jApi.character.y = -20;

  let reclaimed = false;
  let planned = false;
  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => /vendor:reclaim strearring|gear:plan strearring/.test(g.m))) {
      reclaimed = mApi.log.game.some((g) => /reclaim strearring|plan strearring/.test(g.m));
    }
    if (mApi.log.game.some((g) => /^gear:plan strearring/.test(g.m))) {
      planned = true;
      break;
    }
    if (m.items.some((x) => x && x.name === "strearring") && !m.slots.trade7) {
      reclaimed = true;
    }
  }
  assert.ok(reclaimed || planned, "must reclaim or plan strearring");
  assert.ok(!m.slots.trade7 || m.slots.trade7.name !== "strearring", "strearring off trade");
});

test("adversary: ponty buys cape under fair cap when needed", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 100,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const mApi = p.bots.Puppygirl.api;
  const m = mApi.character;
  m.gold = 500000;
  for (let i = 0; i < m.items.length; i++) {
    const it = m.items[i];
    if (it && (it.name === "stand0" || /^hpot|^mpot|^scroll/.test(it.name))) continue;
    if (it) {
      m.items[i] = null;
      m.esize = (m.esize || 0) + 1;
    }
  }
  m._bank = { gold: 0, items0: new Array(42).fill(null) };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;
  p.world.ponty = [{ name: "cape", rid: "c1", price: 22000, level: 0 }];

  let bought = false;
  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => /^ponty:buy cape/.test(g.m))) {
      bought = true;
      break;
    }
  }
  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(bought, "must ponty buy cape, logs=" + msgs.filter((x) => /^ponty:/.test(x)).join(" | "));
  assert.ok(m.items.some((x) => x && x.name === "cape"), "cape in bag");
});

module.exports = { tests };
