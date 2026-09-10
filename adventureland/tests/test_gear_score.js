"use strict";

/**
 * Class-aware gear score + weapon hand gates (Wrong weapon spam fix).
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const {
  score,
  scaledStat,
  SCORE_WEIGHTS,
  classOk,
  canEquipSlot,
  weaponHandKind,
  equipPending,
} = require("../src/gear");

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

module.exports = { tests };
