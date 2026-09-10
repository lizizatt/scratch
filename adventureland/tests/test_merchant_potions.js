"use strict";

const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { POTION_TARGET } = require("../src/constants");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function qty(items, name) {
  return (items || []).reduce(
    (n, it) => n + (it && it.name === name ? (it.q == null ? 1 : it.q) : 0),
    0
  );
}

test("adversary: Puppygirl buys and uses HP/MP potions", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  c.hp = Math.floor(c.max_hp * 0.4);
  c.mp = Math.floor(c.max_mp * 0.4);

  for (let i = 0; i < 100; i++) await p.tickAll();

  const logs = api.log.game.map((g) => g.m);
  assert.ok(logs.some((m) => /^selfpot:buy hpot1 /.test(m)), "must buy own HP potions");
  assert.ok(logs.some((m) => /^selfpot:buy mpot1 /.test(m)), "must buy own MP potions");
  assert.ok(logs.some((m) => /^heal:hp /.test(m)), "must use an HP potion");
  assert.ok(logs.some((m) => /^heal:mp /.test(m)), "must use an MP potion");
  assert.ok(c.hp > c.max_hp * 0.4, "HP must increase");
  assert.ok(c.mp > c.max_mp * 0.4, "MP must increase");
});

test("adversary: full bag refills existing merchant potion stacks", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  c.items = new Array(42).fill(null).map(() => ({ name: "tracker" }));
  c.items[0] = { name: "hpot1", q: 1 };
  c.items[1] = { name: "mpot1", q: 1 };
  c.esize = 0;
  c.map = "main";
  c.real_x = c.x = 56;
  c.real_y = c.y = -122;

  await p.tickAll();

  const logs = api.log.game.map((g) => g.m);
  assert.strictEqual(qty(c.items, "hpot1"), POTION_TARGET);
  assert.strictEqual(qty(c.items, "mpot1"), POTION_TARGET);
  assert.ok(!logs.some((m) => m === "selfpot:no_space"), "existing stacks need no free slot");
});

test("adversary: potion delivery preserves Puppygirl's personal reserve", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 500000,
    members: ["Jazwyn", "Puppygirl"],
  });
  await p.bots.Jazwyn.ctrl.requestPots();

  let done = false;
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    if (p.bots.Puppygirl.api.log.game.some((g) => /^dlv:done /.test(g.m))) {
      done = true;
      break;
    }
  }

  const merchantItems = p.bots.Puppygirl.api.character.items;
  const fighterItems = p.bots.Jazwyn.api.character.items;
  assert.ok(done, "delivery must complete");
  assert.ok(qty(fighterItems, "hpot1") >= POTION_TARGET, "fighter receives HP potions");
  assert.ok(qty(fighterItems, "mpot1") >= POTION_TARGET, "fighter receives MP potions");
  assert.ok(qty(merchantItems, "hpot1") >= POTION_TARGET, "merchant keeps HP reserve");
  assert.ok(qty(merchantItems, "mpot1") >= POTION_TARGET, "merchant keeps MP reserve");
});

module.exports = { tests };
