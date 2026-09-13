"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { bootParty } = require("../src/boot_party");
const {
  ROTATION,
  warriorRotation,
  mageRotation,
  priestPreCombat,
  priestRotation,
} = require("../src/combat_rotations");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function readyParty() {
  const p = bootParty({ pack: "armadillo", pots: 200, level: 61, combat: false });
  const stats = {
    Jazwyn: { hp: 6000, mp: 1200 },
    Sarene: { hp: 4000, mp: 2800 },
    Zarook: { hp: 4500, mp: 2400 },
  };
  for (const [name, stat] of Object.entries(stats)) {
    const c = p.bots[name].api.character;
    c.level = name === "Zarook" ? 60 : 61;
    c.max_hp = c.hp = stat.hp;
    c.max_mp = c.mp = stat.mp;
  }
  return p;
}

function nearest(p, who) {
  return p.bots[who].api.get_nearest_monster({ type: "armadillo" });
}

function skillCount(api, name) {
  return api.log.skills.filter((entry) => entry === name || entry.startsWith(name + ":")).length;
}

test("combat source excludes temperamental Mana Burst variants", () => {
  const root = path.join(__dirname, "..", "src");
  const source = [
    fs.readFileSync(path.join(root, "combat_rotations.js"), "utf8"),
    fs.readFileSync(path.join(root, "slots", "mage.js"), "utf8"),
  ].join("\n");
  assert.ok(!/\b(?:burst|cburst)\b/.test(source), "mage rotation must contain no Mana Burst path");
});

test("warrior prioritizes Hardshell under critical pressure", () => {
  const p = readyParty();
  const api = p.bots.Jazwyn.api;
  api.character.hp = api.character.max_hp * 0.4;
  api.character.mp = 800;
  assert.strictEqual(warriorRotation(api, "armadillo", { leadName: "Jazwyn", isLead: true }), "hardshell");
  assert.strictEqual(skillCount(api, "hardshell"), 1);
  assert.ok(api.character.mp >= ROTATION.warriorReserve);
});

test("warrior taunts a monster off either caster", () => {
  const p = readyParty();
  const api = p.bots.Jazwyn.api;
  const monster = nearest(p, "Jazwyn");
  monster.target = "Sarene";
  assert.strictEqual(warriorRotation(api, "armadillo", { leadName: "Jazwyn", isLead: true }), "taunt");
  assert.strictEqual(monster.target, "Jazwyn");
});

test("mage protects the pressured tank before energizing", () => {
  const p = readyParty();
  const api = p.bots.Sarene.api;
  const tank = p.bots.Jazwyn.api.character;
  tank.hp = tank.max_hp * 0.45;
  assert.strictEqual(mageRotation(api, "armadillo", { leadName: "Jazwyn", isLead: false }), "reflection");
  assert.strictEqual(skillCount(api, "reflection"), 1);
  assert.ok(tank.s.reflection);
});

test("mage energizes a depleted priest before the tank speed proc", () => {
  const p = readyParty();
  const api = p.bots.Sarene.api;
  const priest = p.bots.Zarook.api.character;
  const before = priest.mp = priest.max_mp * 0.2;
  assert.strictEqual(mageRotation(api, "armadillo", { leadName: "Jazwyn", isLead: false }), "energize_priest");
  assert.ok(priest.mp > before);
  assert.strictEqual(skillCount(api, "energize"), 1);
});

test("mage never casts utility skills on dead party members", () => {
  const p = readyParty();
  const api = p.bots.Sarene.api;
  const tank = p.bots.Jazwyn.api.character;
  const priest = p.bots.Zarook.api.character;
  tank.rip = true;
  tank.hp = 0;
  priest.rip = true;
  priest.hp = 0;
  priest.mp = 0;
  const action = mageRotation(api, "armadillo", { leadName: "Jazwyn", isLead: false });
  assert.notStrictEqual(action, "reflection");
  assert.notStrictEqual(action, "energize_priest");
  assert.strictEqual(skillCount(api, "reflection"), 0);
  assert.strictEqual(skillCount(api, "energize"), 0);
});

test("out-of-range utility targets do not monopolize combat", () => {
  const p = readyParty();
  const mageApi = p.bots.Sarene.api;
  const tank = p.bots.Jazwyn.api.character;
  tank.hp = tank.max_hp * 0.4;
  tank.real_x = mageApi.character.real_x + 400;
  assert.notStrictEqual(
    mageRotation(mageApi, "armadillo", { leadName: "Jazwyn", isLead: false }),
    "reflection"
  );

  const priestApi = p.bots.Zarook.api;
  const monster = nearest(p, "Zarook");
  monster.max_hp = monster.hp = 3000;
  monster.real_x = priestApi.character.real_x + 300;
  assert.notStrictEqual(
    priestRotation(priestApi, "armadillo", { leadName: "Jazwyn", isLead: false }),
    "curse"
  );
});

test("sim no_target selection skips monsters claimed by another fighter", () => {
  const p = readyParty();
  const api = p.bots.Sarene.api;
  for (const monster of Object.values(api.parent.entities)) {
    if (monster && monster.type === "monster") monster.dead = true;
  }
  const here = api.character;
  const claimed = p.world.spawnMonster(
    "US/III",
    here.map,
    "armadillo",
    { x: here.real_x + 1, y: here.real_y },
    "claimed"
  );
  claimed.target = "Jazwyn";
  const free = p.world.spawnMonster(
    "US/III",
    here.map,
    "armadillo",
    { x: here.real_x + 5, y: here.real_y },
    "free"
  );
  assert.strictEqual(api.get_nearest_monster({ type: "armadillo", no_target: true }).id, free.id);
});

test("training dummies are never valid combat or persisted farm targets", async () => {
  const p = readyParty();
  const bot = p.bots.Jazwyn;
  const api = bot.api;
  for (const monster of Object.values(api.parent.entities)) {
    if (monster && monster.type === "monster") monster.dead = true;
  }
  const dummy = p.world.spawnMonster(
    "US/III",
    api.character.map,
    "target_a500",
    { x: api.character.real_x + 1, y: api.character.real_y },
    "dummy"
  );
  bot.ctrl.state.S.intent.mtype = "target_a500";
  api.change_target(dummy);

  assert.strictEqual(
    warriorRotation(api, "target_a500", { leadName: "Jazwyn", isLead: true }),
    "idle"
  );
  assert.strictEqual(api.character.target, null);
  await bot.ctrl.tick();
  assert.strictEqual(bot.ctrl.state.S.intent.mtype, "armadillo");
  assert.ok(
    api.log.game.some((entry) => /farm:reject_training_target target_a500/.test(entry.m))
  );
  assert.strictEqual(skillCount(api, "attack"), 0);
});

test("priest emergency single heal outranks Party Heal", () => {
  const p = readyParty();
  const api = p.bots.Zarook.api;
  const tank = p.bots.Jazwyn.api.character;
  const mage = p.bots.Sarene.api.character;
  tank.real_x = api.character.real_x;
  tank.real_y = api.character.real_y;
  tank.hp = tank.max_hp * 0.4;
  mage.hp = mage.max_hp * 0.6;
  p.world.advance(1000);
  assert.strictEqual(priestPreCombat(api), "heal_emergency");
  assert.strictEqual(skillCount(api, "partyheal"), 0);
  assert.strictEqual(skillCount(api, "heal"), 1);
});

test("priest fully heals a gravestone before reviving", () => {
  const p = readyParty();
  const api = p.bots.Zarook.api;
  const tank = p.bots.Jazwyn.api.character;
  tank.real_x = api.character.real_x;
  tank.real_y = api.character.real_y;
  tank.rip = true;
  tank.hp = tank.max_hp - 400;
  api.character.items[0] = { name: "essenceoflife", q: 1 };
  p.world.advance(1000);
  assert.strictEqual(priestPreCombat(api), "heal_gravestone");
  assert.strictEqual(tank.rip, true);
  assert.strictEqual(tank.hp, tank.max_hp);
  p.world.advance(1000);
  assert.strictEqual(priestPreCombat(api), "revive");
  assert.strictEqual(tank.rip, false);
});

test("priest uses Party Heal for two meaningfully injured allies", () => {
  const p = readyParty();
  const api = p.bots.Zarook.api;
  p.bots.Jazwyn.api.character.hp *= 0.6;
  p.bots.Sarene.api.character.hp *= 0.6;
  assert.strictEqual(priestPreCombat(api), "partyheal");
  assert.strictEqual(skillCount(api, "partyheal"), 1);
});

test("priest emergency Absorb rescues a critically threatened mage", () => {
  const p = readyParty();
  const api = p.bots.Zarook.api;
  const mage = p.bots.Sarene.api.character;
  const monster = nearest(p, "Zarook");
  mage.hp = mage.max_hp * 0.3;
  monster.target = "Sarene";
  assert.strictEqual(priestRotation(api, "armadillo", { leadName: "Jazwyn", isLead: false }), "absorb");
  assert.strictEqual(monster.target, "Zarook");
});

test("priest Curse is durable-target-only and capped to 15-second cadence", () => {
  const p = readyParty();
  const api = p.bots.Zarook.api;
  const monster = nearest(p, "Zarook");
  monster.max_hp = monster.hp = 3000;
  assert.strictEqual(priestRotation(api, "armadillo", { leadName: "Jazwyn", isLead: false }), "curse");
  p.world.advance(6000);
  delete monster.s.cursed;
  priestRotation(api, "armadillo", { leadName: "Jazwyn", isLead: false });
  assert.strictEqual(skillCount(api, "curse"), 1);
});

test("30-minute rotation burn stays within potion and delivery budgets", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, level: 61 });
  const stats = {
    Jazwyn: { hp: 6000, mp: 1200 },
    Sarene: { hp: 4000, mp: 2800 },
    Zarook: { hp: 4500, mp: 2400 },
  };
  for (const [name, stat] of Object.entries(stats)) {
    const c = p.bots[name].api.character;
    c.level = name === "Zarook" ? 60 : 61;
    c.max_hp = c.hp = stat.hp;
    c.max_mp = c.mp = stat.mp;
  }
  for (const monster of Object.values(p.bots.Jazwyn.api.parent.entities)) {
    if (!monster || monster.type !== "monster") continue;
    monster.max_hp = monster.hp = 3000;
    monster.attack = 60;
  }

  const end = p.world.clock.now() + 30 * 60 * 1000;
  while (p.world.clock.now() < end) await p.tickAll();

  let mpPots = 0;
  let hpPots = 0;
  for (const name of ["Jazwyn", "Sarene", "Zarook"]) {
    const logs = p.bots[name].api.log.game.map((entry) => entry.m);
    const mp = logs.filter((line) => /^heal:mp /.test(line)).length;
    const hp = logs.filter((line) => /^heal:hp /.test(line)).length;
    mpPots += mp;
    hpPots += hp;
    assert.ok(mp <= 12, name + " used too many MP potions: " + mp);
    assert.ok(hp <= 140, name + " used too many HP potions under sustained combat: " + hp);
  }
  const deliveries = p.bots.Puppygirl.api.log.game.filter((entry) => /dlv:active pots/.test(entry.m)).length;
  assert.ok(mpPots <= 20, "party MP potion use exceeded budget: " + mpPots);
  assert.ok(hpPots <= 140, "party HP potion use exceeded budget: " + hpPots);
  assert.strictEqual(deliveries, 0, "rotation should not require a potion delivery from a 200-pot start");
  assert.strictEqual(skillCount(p.bots.Sarene.api, "burst"), 0);
  assert.strictEqual(skillCount(p.bots.Sarene.api, "cburst"), 0);
});

module.exports = { tests };
