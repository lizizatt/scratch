"use strict";

/**
 * Live 2026-09-09: Jazwyn spammed `equip staff +3 -> mainhand` (wrong class);
 * Puppygirl died at pack with no merchant rip:respawn.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { equipPending, planGifts, classOk, isKeep } = require("../src/gear");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("adversary: warrior must not spam-equip staff from bag", async () => {
  const p = bootParty({ pack: "armadillo", pots: 50, members: ["Jazwyn"] });
  const api = p.bots.Jazwyn.api;
  const G = api.G;
  assert.ok(classOk({ name: "staff", level: 3 }, "mage", G));
  assert.ok(!classOk({ name: "staff", level: 3 }, "warrior", G));

  api.character.ctype = "warrior";
  api.character.slots.mainhand = { name: "blade", level: 0 };
  const bag = api.character.items;
  const slot = bag.findIndex((x) => !x);
  bag[slot] = { name: "staff", level: 3 };
  api.character.esize = Math.max(0, (api.character.esize || 1) - 1);

  // Without classOk, staff+3 scores above blade and would equip every tick.
  for (let n = 0; n < 30; n++) await p.tickAll();

  const equips = api.log.game.filter((g) => /^equip staff/.test(g.m));
  assert.strictEqual(equips.length, 0, "warrior must not equip staff, got " + equips.length);
  assert.ok(api.character.items[slot] && api.character.items[slot].name === "staff", "staff stays in bag");
  assert.ok(
    api.character.slots.mainhand && api.character.slots.mainhand.name === "blade",
    "mainhand stays blade"
  );
  // Wrong-class weapon is not "keep" — toss/park can clear it.
  assert.ok(!isKeep(api, { name: "staff", level: 3 }, G, {}), "staff is not keep on warrior");
  assert.ok(isKeep(api, { name: "tracker" }, G, {}), "Tracktrix is permanent keep");
  assert.ok(isKeep(api, { name: "stand0" }, G, {}), "stand0 is permanent keep");
});

test("adversary: planGifts must not gift staff to warrior", () => {
  const G = {
    items: {
      staff: { type: "weapon", wtype: "staff", attack: 40 },
      blade: { type: "weapon", wtype: "sword", attack: 10 },
      gloves: { type: "gloves", armor: 4 },
    },
  };
  const gifts = planGifts(
    [{ name: "staff", level: 3, pack: "items0", i: 0 }],
    {
      Jazwyn: {
        ctype: "warrior",
        esize: 5,
        slots: { mainhand: { name: "blade", level: 0 }, gloves: null },
      },
    },
    G
  );
  assert.ok(
    !gifts.some((g) => g.it && g.it.name === "staff"),
    "must not plan staff gift to warrior, got " + JSON.stringify(gifts)
  );
});

test("adversary: merchant rip:respawn when dead at pack", async () => {
  const p = bootParty({ pack: "armadillo", pots: 50, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.map = "main";
  api.character.real_x = api.character.x = 526;
  api.character.real_y = api.character.y = 1846;
  api.character.rip = true;
  api.character.hp = 0;

  await p.tickAll();

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => m === "rip:respawn"), "merchant must log rip:respawn");
  assert.ok(!api.character.rip, "merchant must clear rip");
  assert.ok(api.character.hp > 0, "merchant hp restored");
});

test("adversary: retreatPlaza towns out of winter_cave (no in-place rip loop)", async () => {
  // Live: dlv meet winter_cave → dlv:done → retreatPlaza no-op off main → rip:respawn spam.
  const p = bootParty({ pack: "armadillo", pots: 50, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.map = "winter_cave";
  api.character.real_x = api.character.x = 35;
  api.character.real_y = api.character.y = -71;
  api.character.rip = true;
  api.character.hp = 0;

  for (let i = 0; i < 8; i++) await p.tickAll();

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => m === "rip:respawn"), "must attempt respawn");
  assert.ok(msgs.some((m) => m === "dlv:retreat_town" || m === "dlv:retreat"), "must town/retreat off winter_cave");
  assert.strictEqual(api.character.map, "main", "must leave winter_cave");
  assert.ok(
    Math.hypot(api.character.real_x - 40, api.character.real_y - -20) < 80 ||
      Math.hypot(api.character.real_x, api.character.real_y) < 80,
    "near plaza/town after retreat"
  );
  const ripSpam = msgs.filter((m) => m === "rip:respawn").length;
  assert.ok(ripSpam <= 3, "must not rip-loop forever, saw " + ripSpam);
});

test("unit: equipPending skips wrong-class even if score wins", async () => {
  const G = {
    items: {
      staff: { type: "weapon", wtype: "staff", attack: 100 },
      blade: { type: "weapon", wtype: "short_sword", attack: 5 },
    },
  };
  const logs = [];
  const api = {
    character: {
      ctype: "warrior",
      slots: { mainhand: { name: "blade", level: 0 } },
      items: [{ name: "staff", level: 3 }, null],
    },
    G,
    equip(i, slot) {
      logs.push("equip " + api.character.items[i].name + " -> " + slot);
      return { failed: true, reason: "should_not_run" };
    },
    game_log(m) {
      logs.push(m);
    },
  };
  const n = await equipPending(api, G, {});
  assert.strictEqual(n, 0);
  assert.ok(!logs.some((m) => /staff/.test(m)));
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
