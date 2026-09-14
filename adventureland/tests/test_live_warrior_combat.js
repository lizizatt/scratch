"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { bootParty } = require("../src/boot_party");
const {
  ROTATION,
  runCombatAction,
  warriorRotation,
  mageRotation,
  priestPreCombat,
  priestRotation,
} = require("../src/combat_rotations");
const {
  createEncounterMovement,
  resolveCombatTarget,
} = require("../src/party_movement");

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

test("combat status messages only emit when the displayed action changes", () => {
  const p = readyParty();
  const api = p.bots.Jazwyn.api;
  let messages = 0;
  const originalSetMessage = api.set_message;
  api.set_message = (message) => {
    messages++;
    originalSetMessage(message);
  };
  warriorRotation(api, "armadillo", { leadName: "Jazwyn", isLead: true });
  warriorRotation(api, "armadillo", { leadName: "Jazwyn", isLead: true });
  assert.strictEqual(api.character._msg, "Hunt armadillo");
  assert.strictEqual(messages, 1);
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

test("combat skips a blocked monster and attacks a reachable alternative", () => {
  const p = readyParty();
  const api = p.bots.Jazwyn.api;
  for (const monster of Object.values(api.parent.entities)) {
    if (monster && monster.type === "monster") monster.dead = true;
  }
  const here = api.character;
  const blocked = p.world.spawnMonster(
    "US/III",
    here.map,
    "armadillo",
    { x: here.real_x + 80, y: here.real_y },
    "blocked"
  );
  const reachable = p.world.spawnMonster(
    "US/III",
    here.map,
    "armadillo",
    { x: here.real_x, y: here.real_y + 30 },
    "reachable"
  );
  const originalCanMoveTo = api.can_move_to;
  api.can_move_to = (x, y) => y !== here.real_y && originalCanMoveTo(x, y);

  const action = warriorRotation(api, "armadillo", { leadName: "Jazwyn", isLead: true });
  assert.ok(action === "attack" || action === "wait");
  assert.strictEqual(api.character.target, reachable.id);
  assert.notStrictEqual(api.character.target, blocked.id);
});

test("movement reports an unreachable target without combat issuing movement", () => {
  const p = readyParty();
  const api = p.bots.Jazwyn.api;
  const monster = nearest(p, "Jazwyn");
  for (const entity of Object.values(api.parent.entities)) {
    if (entity && entity.type === "monster" && entity !== monster) entity.dead = true;
  }
  api.change_target(monster);
  api.can_move_to = () => false;

  const movement = createEncounterMovement(api);
  const result = movement.tick({
    mtype: "armadillo",
    target: monster,
    leadName: "Jazwyn",
    isLead: true,
  });
  assert.strictEqual(result.directive.kind, "hold");
  assert.strictEqual(result.directive.reason, "approach_blocked");
  assert.strictEqual(api.log.moved.length, 0);
  assert.strictEqual(
    warriorRotation(api, "armadillo", {
      leadName: "Jazwyn",
      isLead: true,
      target: monster,
    }),
    "out_of_range"
  );
  assert.strictEqual(api.log.moved.length, 0, "rotation must not own movement");
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

test("rejected live combat actions are handled and rate-limited", async () => {
  let at = 1000;
  const logs = [];
  const api = {
    character: {},
    _now: () => at,
    game_log: (message) => logs.push(message),
  };

  runCombatAction(api, "attack", () => Promise.reject({ reason: "target_gone" }));
  await new Promise((resolve) => setImmediate(resolve));
  runCombatAction(api, "attack", () => Promise.reject({ reason: "target_gone" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(logs, ["combat_action_fail attack target_gone"]);

  at += 5000;
  runCombatAction(api, "attack", () => Promise.reject({ reason: "target_gone" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(logs.length, 2, "persistent failures remain visible at a bounded cadence");
});

test("browser transition without a character pauses every rotation safely", () => {
  const api = { character: undefined, smart: { moving: false } };
  assert.strictEqual(warriorRotation(api, "croc", { isLead: true }), "blocked");
  assert.strictEqual(mageRotation(api, "croc", { isLead: false }), "blocked");
  assert.strictEqual(priestPreCombat(api), false);
  assert.strictEqual(priestRotation(api, "croc", { isLead: false }), "blocked");
});

test("adversary: fighter closes on a low-health monster fleeing at nearly equal speed", () => {
  const fighter = {
    name: "Jazwyn",
    ctype: "warrior",
    level: 70,
    real_x: 0,
    real_y: 0,
    x: 0,
    y: 0,
    hp: 6000,
    max_hp: 6000,
    mp: 1000,
    max_mp: 1000,
    range: 5,
    s: {},
  };
  const rat = {
    id: "rat_flee",
    type: "monster",
    mtype: "rat",
    real_x: 12,
    real_y: 0,
    x: 12,
    y: 0,
    hp: 20,
    max_hp: 100,
    dead: false,
  };
  let attacks = 0;
  let moveDestination = null;
  let at = 1000;
  const api = {
    character: fighter,
    smart: { moving: false },
    G: { skills: {} },
    parent: {
      entities: { rat_flee: rat },
      distance: (a, b) => Math.hypot(a.real_x - b.real_x, a.real_y - b.real_y),
    },
    get_player: () => null,
    get_targeted_monster: () => null,
    get_monster: () => rat,
    is_in_range: (target) => api.parent.distance(fighter, target) <= fighter.range,
    can_attack: (target) => api.is_in_range(target),
    can_move_to: () => true,
    change_target: (target) => {
      fighter.target = target ? target.id : null;
    },
    move: (x, y) => {
      moveDestination = { x, y };
    },
    attack: () => {
      attacks++;
      rat.hp = 0;
      rat.dead = true;
    },
    set_message() {},
    game_log() {},
    is_on_cooldown: () => false,
    _now: () => at,
  };
  const movement = createEncounterMovement(api);

  for (let tick = 0; tick < 20 && !rat.dead; tick++) {
    at += 250;
    rat.real_x = rat.x += 4;
    if (moveDestination) {
      const dx = moveDestination.x - fighter.real_x;
      const dy = moveDestination.y - fighter.real_y;
      const distance = Math.hypot(dx, dy);
      const step = Math.min(5, distance);
      fighter.real_x = fighter.x += distance ? (dx / distance) * step : 0;
      fighter.real_y = fighter.y += distance ? (dy / distance) * step : 0;
    }
    const target = resolveCombatTarget(api, "rat", {
      leadName: "Jazwyn",
      isLead: true,
    });
    movement.tick({ mtype: "rat", target, leadName: "Jazwyn", isLead: true });
    warriorRotation(api, "rat", {
      leadName: "Jazwyn",
      isLead: true,
      target,
    });
  }

  assert.strictEqual(attacks, 1, "fighter must close attack range instead of taking shrinking half-steps");
});

test("30-minute continuous combat stays within the stocked potion budget", async () => {
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
    assert.ok(mp <= 80, name + " used too many MP potions: " + mp);
    assert.ok(hp <= 140, name + " used too many HP potions under sustained combat: " + hp);
  }
  const deliveries = p.bots.Puppygirl.api.log.game.filter((entry) => /dlv:active pots/.test(entry.m)).length;
  assert.ok(mpPots <= 150, "party MP potion use exceeded budget: " + mpPots);
  assert.ok(hpPots <= 140, "party HP potion use exceeded budget: " + hpPots);
  assert.strictEqual(deliveries, 0, "rotation should not require a potion delivery from a 200-pot start");
  assert.strictEqual(skillCount(p.bots.Sarene.api, "burst"), 0);
  assert.strictEqual(skillCount(p.bots.Sarene.api, "cburst"), 0);
});

module.exports = { tests };
