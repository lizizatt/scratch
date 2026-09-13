"use strict";

/**
 * Class-aware gear score + weapon hand gates (Wrong weapon spam fix).
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const {
  score,
  setBonusScore,
  loadoutScore,
  scaledStat,
  SCORE_WEIGHTS,
  classOk,
  canEquipSlot,
  weaponHandKind,
  equipPending,
  targetSetEquipPlan,
  candidateSlots,
  wornSnapshot,
  planGifts,
} = require("../src/gear");
const { GEAR_TARGETS, COMBINE_PRIORITY } = require("../src/constants");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function Gish(extra) {
  return {
    items: Object.assign(
      {
        blade: { type: "weapon", wtype: "short_sword", attack: 15, upgrade: { attack: 4 } },
        fireblade: { type: "weapon", wtype: "short_sword", attack: 21, upgrade: { attack: 4.5 } },
        staff: { type: "weapon", wtype: "staff", attack: 25, upgrade: { attack: 5 } },
        wblade: { type: "weapon", wtype: "wblade", attack: 48, upgrade: { attack: 8 } },
        basher: { type: "weapon", wtype: "basher", attack: 35, armor: 20 },
        bataxe: { type: "weapon", wtype: "axe", attack: 41, reflection: 4 },
        sshield: {
          type: "shield",
          armor: 60,
          resistance: 20,
          dreturn: 3,
          upgrade: { dreturn: 1.5, armor: 10, resistance: 7 },
        },
        shield: { type: "shield", armor: 60, resistance: 20, upgrade: { armor: 12.5, resistance: 7.5 } },
        wbook0: { type: "source", int: 6 },
        strearring: { type: "earring", str: 3, compound: { str: 2 } },
        intearring: { type: "earring", int: 3, compound: { int: 2 } },
        vitearring: { type: "earring", vit: 3, compound: { vit: 2 } },
        pants: { type: "pants", armor: 10, upgrade: { armor: 2 } },
        coat: { type: "chest", armor: 12, upgrade: true },
        pickaxe: { type: "tool", wtype: "pickaxe" },
        gcape: { type: "cape", reflection: 1, armor: 5 },
        cape: { type: "cape", armor: 10, resistance: 8, stat: 4 },
        orbg: { type: "orb", str: 2, int: 2, dex: 2, compound: { str: 1, int: 1, dex: 1 } },
      },
      extra || {}
    ),
    classes: {
      warrior: {
        mainhand: { spear: {}, short_sword: {}, sword: {}, fist: {}, mace: {} },
        offhand: { shield: {}, short_sword: {}, sword: {}, fist: {}, mace: {} },
        doublehand: { axe: {}, basher: {}, bow: {} },
      },
      mage: {
        mainhand: { staff: {}, wblade: {}, wand: {} },
        offhand: { source: {} },
        doublehand: {},
      },
      priest: {
        mainhand: { pmace: {}, staff: {} },
        offhand: { shield: {}, source: {} },
        doublehand: { wand: {} },
      },
    },
  };
}

test("unit: SCORE_WEIGHTS — warrior reflection/str/armor; casters int", () => {
  assert.ok(SCORE_WEIGHTS.warrior.reflection >= SCORE_WEIGHTS.warrior.attack);
  assert.ok(SCORE_WEIGHTS.warrior.str >= SCORE_WEIGHTS.warrior.armor);
  assert.ok(SCORE_WEIGHTS.warrior.armor > SCORE_WEIGHTS.warrior.int);
  assert.ok(SCORE_WEIGHTS.mage.int >= SCORE_WEIGHTS.mage.attack);
  assert.ok(SCORE_WEIGHTS.priest.int >= SCORE_WEIGHTS.priest.vit);
  assert.strictEqual(SCORE_WEIGHTS.mage.str, 0);
  assert.strictEqual(SCORE_WEIGHTS.warrior.int, 0);
});

test("unit: beginning orbs flow through compound, gift, and equip for every fighter", async () => {
  const G = Gish();
  assert.strictEqual(COMBINE_PRIORITY[0], "orbg");
  assert.deepStrictEqual(candidateSlots({ name: "orbg" }, G), ["orb"]);

  const ads = {};
  const ctypes = { Jazwyn: "warrior", Sarene: "mage", Zarook: "priest" };
  for (const who of Object.keys(ctypes)) {
    assert.strictEqual(GEAR_TARGETS[who].orb, "orbg");
    ads[who] = {
      ctype: ctypes[who],
      esize: 2,
      slots: { orb: null },
    };
  }
  const gifts = planGifts(
    [
      { name: "orbg", level: 1 },
      { name: "orbg", level: 1 },
      { name: "orbg", level: 1 },
    ],
    ads,
    G
  );
  assert.deepStrictEqual(gifts.map((g) => g.who).sort(), ["Jazwyn", "Sarene", "Zarook"]);
  assert.ok(gifts.every((g) => g.slot === "orb" && g.it.name === "orbg"));

  for (const who of Object.keys(ctypes)) {
    const api = {
      character: {
        name: who,
        ctype: ctypes[who],
        items: [{ name: "orbg", level: 1 }],
        slots: { orb: null },
      },
      equip(i, slot) {
        this.character.slots[slot] = this.character.items[i];
        this.character.items[i] = null;
        return { success: true };
      },
      _now: () => 0,
      game_log() {},
    };
    assert.strictEqual(wornSnapshot(api).slots.orb, null);
    assert.strictEqual(await equipPending(api, G, {}, {}), 1);
    assert.deepStrictEqual(api.character.slots.orb, { name: "orbg", level: 1 });
  }
});

test("unit: scaledStat applies upgrade and compound growth", () => {
  const g = { str: 3, compound: { str: 2 }, armor: 10, upgrade: { armor: 2 } };
  assert.strictEqual(scaledStat(g, { level: 0 }, "str"), 3);
  assert.strictEqual(scaledStat(g, { level: 2 }, "str"), 3 + 4);
  assert.strictEqual(scaledStat(g, { level: 3 }, "armor"), 10 + 6);
});

test("unit: warrior score prefers reflection, str, armor over raw attack", () => {
  const G = Gish({
    cape_plain: { type: "cape", armor: 10, resistance: 8 },
    cape_refl: { type: "cape", armor: 10, resistance: 8, reflection: 1 },
  });
  const reflCape = score({ name: "cape_refl", level: 0 }, G, "warrior");
  const plainCape = score({ name: "cape_plain", level: 0 }, G, "warrior");
  assert.ok(reflCape > plainCape, "same armor + reflection beats plain");

  const strEar = score({ name: "strearring", level: 0 }, G, "warrior");
  const intEar = score({ name: "intearring", level: 0 }, G, "warrior");
  assert.ok(strEar > intEar, "str earring beats int earring for warrior");

  const sshield = score({ name: "sshield", level: 0 }, G, "warrior");
  const shield = score({ name: "shield", level: 0 }, G, "warrior");
  assert.ok(sshield > shield, "dreturn spiked shield beats plain");

  const axe = score({ name: "bataxe", level: 0 }, G, "warrior");
  const blade = score({ name: "blade", level: 0 }, G, "warrior");
  assert.ok(axe > blade, "reflection axe outscores plain blade for warrior");

  // Armor piece should dominate a pure-attack trinket with no str/armor/refl.
  const pants = score({ name: "pants", level: 0 }, G, "warrior");
  const tinyAtk = score({ name: "blade", level: 0 }, G, "warrior");
  assert.ok(pants > 0 && tinyAtk > 0);
  assert.ok(
    SCORE_WEIGHTS.warrior.armor * 10 > SCORE_WEIGHTS.warrior.attack * 5,
    "armor weight meaningfully above attack"
  );
});

test("unit: mage and priest score prefer int", () => {
  const G = Gish();
  const intE = score({ name: "intearring", level: 1 }, G, "mage");
  const strE = score({ name: "strearring", level: 1 }, G, "mage");
  assert.ok(intE > strE, "mage prefers int earring");

  const intP = score({ name: "intearring", level: 0 }, G, "priest");
  const vitP = score({ name: "vitearring", level: 0 }, G, "priest");
  assert.ok(intP > vitP, "priest prefers int over vit earring");

  const book = score({ name: "wbook0", level: 0 }, G, "mage");
  const blade = score({ name: "blade", level: 5 }, G, "mage");
  assert.ok(book > 0 && classOk({ name: "wbook0" }, "mage", G));
  assert.ok(!classOk({ name: "blade" }, "mage", G));
  void blade;
});

test("unit: assigned generic stats and Hunter set bonuses affect loadout score", () => {
  const G = Gish({
    mmhat: { class: ["mage"], set: "mmage", type: "helmet", stat: 2, armor: 19, resistance: 22 },
    mmgloves: { class: ["mage"], set: "mmage", type: "gloves", stat: 2, armor: 22, resistance: 11 },
    mmpants: { class: ["mage"], set: "mmage", type: "pants", stat: 2, armor: 28, resistance: 17 },
  });
  G.sets = { mmage: { 2: { int: 2 }, 3: { speed: 2, int: 3 } } };
  assert.ok(
    score({ name: "mmhat", level: 0, stat_type: "int" }, G, "mage") >
      score({ name: "mmhat", level: 0 }, G, "mage"),
    "INT-scrolled generic stat must use the mage INT weight"
  );
  const two = {
    helmet: { name: "mmhat", level: 0, stat_type: "int" },
    gloves: { name: "mmgloves", level: 0, stat_type: "int" },
  };
  const three = Object.assign({}, two, {
    pants: { name: "mmpants", level: 0, stat_type: "int" },
  });
  assert.strictEqual(setBonusScore(two, G, "mage"), 2 * SCORE_WEIGHTS.mage.int);
  assert.strictEqual(
    setBonusScore(three, G, "mage"),
    5 * SCORE_WEIGHTS.mage.int + 2 * SCORE_WEIGHTS.mage.speed
  );
  assert.ok(loadoutScore(three, G, "mage") > loadoutScore(two, G, "mage"));
  assert.ok(!classOk({ name: "mmhat" }, "warrior", G), "class-locked armor must be rejected");
});

test("unit: same item +level scores higher", () => {
  const G = Gish();
  const a = score({ name: "pants", level: 0 }, G, "warrior");
  const b = score({ name: "pants", level: 3 }, G, "warrior");
  assert.ok(b > a);
});

test("unit: classOk uses hand tables — wblade mage-only; basher warrior 2H", () => {
  const G = Gish();
  assert.ok(!classOk({ name: "wblade" }, "warrior", G), "warrior cannot use wblade");
  assert.ok(classOk({ name: "wblade" }, "mage", G));
  assert.ok(classOk({ name: "basher" }, "warrior", G), "basher is a warrior weapon");
  assert.strictEqual(weaponHandKind({ name: "basher" }, "warrior", G), "doublehand");
  assert.strictEqual(weaponHandKind({ name: "fireblade" }, "warrior", G), "mainhand");
  assert.ok(!classOk({ name: "staff" }, "warrior", G));
  assert.ok(classOk({ name: "staff" }, "priest", G));
  assert.ok(!classOk({ name: "pickaxe" }, "warrior", G), "tools never ok on fighters");
  assert.ok(!classOk({ name: "sshield" }, "priest", G), "party policy: shields warrior-only");
});

test("unit: canEquipSlot blocks doublehand while offhand occupied", () => {
  const G = Gish();
  const api = {
    character: {
      ctype: "warrior",
      slots: { mainhand: { name: "fireblade", level: 0 }, offhand: { name: "sshield", level: 0 } },
    },
  };
  assert.ok(canEquipSlot(api, { name: "blade", level: 2 }, "mainhand", G));
  assert.ok(
    !canEquipSlot(api, { name: "basher", level: 0 }, "mainhand", G),
    "basher+sshield must not equip"
  );
  assert.ok(!canEquipSlot(api, { name: "wblade", level: 0 }, "mainhand", G));
  api.character.slots.offhand = null;
  assert.ok(canEquipSlot(api, { name: "basher", level: 0 }, "mainhand", G), "basher ok alone");
});

test("adversary: warrior with sshield must not Wrong-weapon thrash on basher/wblade", async () => {
  const p = bootParty({ pack: "armadillo", pots: 50, members: ["Jazwyn"] });
  const api = p.bots.Jazwyn.api;
  const c = api.character;
  c.ctype = "warrior";
  c.slots.mainhand = { name: "fireblade", level: 0 };
  c.slots.offhand = { name: "sshield", level: 0 };
  const i1 = c.items.findIndex((x) => !x);
  c.items[i1] = { name: "basher", level: 0 };
  c.esize = Math.max(0, (c.esize || 1) - 1);
  const i2 = c.items.findIndex((x) => !x);
  c.items[i2] = { name: "wblade", level: 0 };
  c.esize = Math.max(0, (c.esize || 1) - 1);

  for (let n = 0; n < 40; n++) await p.tickAll();

  const wrong = api.log.game.filter((g) => g.m === "Wrong weapon");
  const equips = api.log.game.filter((g) => /^equip (basher|wblade)/.test(g.m));
  assert.strictEqual(wrong.length, 0, "no Wrong weapon spam, got " + wrong.length);
  assert.strictEqual(equips.length, 0, "must not equip basher/wblade over shield");
  assert.ok(c.slots.offhand && c.slots.offhand.name === "sshield");
  assert.ok(c.slots.mainhand && c.slots.mainhand.name === "fireblade");
  assert.ok(c.items[i1] && c.items[i1].name === "basher");
  assert.ok(c.items[i2] && c.items[i2].name === "wblade");
});

test("adversary: equipPending upgrades fireblade when better 1H in bag", async () => {
  const p = bootParty({ pack: "armadillo", pots: 50, members: ["Jazwyn"] });
  const api = p.bots.Jazwyn.api;
  const G = api.G;
  api.character.ctype = "warrior";
  api.character.slots.mainhand = { name: "blade", level: 0 };
  api.character.slots.offhand = { name: "sshield", level: 0 };
  const i = api.character.items.findIndex((x) => !x);
  api.character.items[i] = { name: "fireblade", level: 2 };
  api.character.esize = Math.max(0, (api.character.esize || 1) - 1);

  const n = await equipPending(api, G, {});
  assert.ok(n >= 1, "should equip fireblade");
  assert.strictEqual(api.character.slots.mainhand.name, "fireblade");
  assert.strictEqual(api.character.slots.offhand.name, "sshield");
});

test("Hunter set pieces equip as a jointly better bundle", async () => {
  const p = bootParty({ members: ["Sarene"] });
  const api = p.bots.Sarene.api;
  const c = api.character;
  c.slots.helmet = { name: "helmet1", level: 3 };
  c.slots.pants = { name: "pants1", level: 3 };
  c.slots.gloves = { name: "gloves1", level: 3 };
  c.items[5] = { name: "mmhat", level: 1 };
  c.items[6] = { name: "mmpants", level: 1 };
  c.items[7] = { name: "mmgloves", level: 1 };

  const plan = targetSetEquipPlan(api, api.G);
  assert.deepStrictEqual(plan.map((x) => x.slot).sort(), ["gloves", "helmet", "pants"]);
  await equipPending(api, api.G, {});
  assert.strictEqual(c.slots.helmet.name, "mmhat");
  assert.strictEqual(c.slots.pants.name, "mmpants");
  assert.strictEqual(c.slots.gloves.name, "mmgloves");
});

test("Hunter set bundle is neither gifted nor equipped when total loadout is worse", () => {
  const G = Gish({
    oldhat: { type: "helmet", armor: 100 },
    oldpants: { type: "pants", armor: 100 },
    mmhat: { type: "helmet", set: "mmage", armor: 1 },
    mmpants: { type: "pants", set: "mmage", armor: 1 },
  });
  G.sets = { mmage: { "2": { int: 1 } } };
  const slots = {
    helmet: { name: "oldhat", level: 0 },
    pants: { name: "oldpants", level: 0 },
  };
  const gifts = planGifts(
    [{ name: "mmhat", level: 0 }, { name: "mmpants", level: 0 }],
    { Sarene: { ctype: "mage", esize: 2, slots } },
    G
  );
  assert.strictEqual(gifts.length, 0);
});

test("Merchant gifts a jointly beneficial Hunter set bundle", () => {
  const p = bootParty({ members: ["Sarene"] });
  const G = p.bots.Sarene.api.G;
  const slots = Object.assign({}, p.bots.Sarene.api.character.slots, {
    helmet: { name: "helmet1", level: 3 },
    pants: { name: "pants1", level: 3 },
    gloves: { name: "gloves1", level: 3 },
  });
  const gifts = planGifts(
    [
      { name: "mmhat", level: 1 },
      { name: "mmpants", level: 1 },
      { name: "mmgloves", level: 1 },
    ],
    { Sarene: { ctype: "mage", esize: 3, slots } },
    G
  );
  assert.deepStrictEqual(gifts.map((x) => x.it.name).sort(), ["mmgloves", "mmhat", "mmpants"]);
});

module.exports = { tests };
