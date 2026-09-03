"use strict";

const assert = require("assert");
const core = require("../al_core");

const Gmon = {
  goo: { attack: 5 }, bee: { attack: 16 }, crab: { attack: 24 }, snake: { attack: 24 },
  armadillo: { attack: 20 }, arcticbee: { attack: 64 }, porcupine: { attack: 16 },
  croc: { attack: 48 }, bat: { attack: 50 }, tortoise: { attack: 36 }, spider: { attack: 80 },
  scorpion: { attack: 100 }, boar: { attack: 240 }, bigbird: { attack: 480 },
  gscorpion: { attack: 120 }, wolf: { attack: 480 }, dryad: { attack: 400 },
  mole: { attack: 480 },
  target: { attack: 0, unlist: true },
  target_a500: { attack: 0, unlist: true }
};
const Gitems = {
  hpot0: { g: 20 }, hpot1: { g: 100 }, mpot0: { g: 20 }, mpot1: { g: 100 },
  helmet: { g: 1200, type: "helmet", upgrade: true },
  coat: { g: 2400, type: "chest", upgrade: true },
  blade: { g: 2400, type: "weapon", wtype: "short_sword", upgrade: true },
  staff: { g: 2400, type: "weapon", wtype: "staff", upgrade: true },
  wand: { g: 2400, type: "weapon", wtype: "wand", upgrade: true },
  bow: { g: 2400, type: "weapon", wtype: "bow", upgrade: true },
  scroll0: { g: 1000 }, gem0: { type: "gem" }, tracker: {}, stand0: {},
  cscroll0: {}
};

function dummy(over) {
  return Object.assign({ id: "d1", type: "monster", mtype: "target", dead: false, attack: 0, real_x: 10, real_y: 10 }, over);
}
function goo(over) {
  return Object.assign({ id: "g1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 20, real_y: 20 }, over);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("ladder: level 1 is goo", () => {
  assert.strictEqual(core.desired(1, 320, Gmon), "goo");
});
test("ladder: 8 bee, 12 crab, 16 snake", () => {
  assert.strictEqual(core.desired(8, 400, Gmon), "bee");
  assert.strictEqual(core.desired(12, 500, Gmon), "crab");
  assert.strictEqual(core.desired(16, 600, Gmon), "snake");
});
test("ladder: mid packs through bats", () => {
  assert.strictEqual(core.desired(20, 800, Gmon), "armadillo");
  assert.strictEqual(core.desired(24, 1000, Gmon), "arcticbee");
  assert.strictEqual(core.desired(28, 1200, Gmon), "porcupine");
  assert.strictEqual(core.desired(32, 1400, Gmon), "croc");
  assert.strictEqual(core.desired(34, 1600, Gmon), "tortoise");
  assert.strictEqual(core.desired(36, 1800, Gmon), "bat");
  assert.strictEqual(core.desired(40, 2000, Gmon), "bat");
});
test("ladder: late packs through dryad", () => {
  assert.strictEqual(core.desired(42, 2800, Gmon), "spider");
  assert.strictEqual(core.desired(48, 3200, Gmon), "scorpion");
  assert.strictEqual(core.desired(54, 4000, Gmon), "boar");
  assert.strictEqual(core.desired(60, 5000, Gmon), "bigbird");
  assert.strictEqual(core.desired(66, 6000, Gmon), "gscorpion");
  assert.strictEqual(core.desired(72, 7000, Gmon), "wolf");
  assert.strictEqual(core.desired(78, 8000, Gmon), "dryad");
});
test("ladder: caps at 90 even if level 99", () => {
  assert.strictEqual(core.desired(99, 12000, Gmon), "dryad");
});
test("ladder: falls back when pack attack exceeds hp ratio", () => {
  // arcticbee att 64, cap at max_hp 100 is 28, so fall back
  const pick = core.desired(24, 100, Gmon);
  assert.notStrictEqual(pick, "arcticbee");
  assert.ok(["goo", "bee", "crab", "snake", "armadillo"].indexOf(pick) >= 0);
});
test("ladder: goo if everything is too hot", () => {
  const hot = {};
  core.LADDER.forEach((row) => { hot[row[1]] = { attack: 999 }; });
  assert.strictEqual(core.desired(90, 10, hot), "goo");
});

test("party farm: isolated uses own level", () => {
  assert.strictEqual(core.partyFarmTarget({ level: 40, max_hp: 2000 }, [], Gmon), "bat");
  assert.strictEqual(core.partyFarmTarget({ level: 1, max_hp: 320 }, [], Gmon), "goo");
});
test("party farm: everyone uses the lowest member's ladder pick", () => {
  const self = { level: 40, max_hp: 2000 };
  const party = [
    { name: "Sarene", level: 40, max_hp: 2000 },
    { name: "Jazwyn", level: 22, max_hp: 800 },
    { name: "Zarook", level: 8, max_hp: 320 }
  ];
  assert.strictEqual(core.partyFarmTarget(self, party, Gmon), "bee");
  assert.strictEqual(core.partyFarmTarget({ level: 8, max_hp: 320 }, party, Gmon), "bee");
  assert.strictEqual(core.partyFarmTarget({ level: 22, max_hp: 800 }, party, Gmon), "bee");
});
test("party farm: Jazwyn lowest at 22 -> armadillo for all", () => {
  const party = [
    { name: "Sarene", level: 50, max_hp: 2500 },
    { name: "Jazwyn", level: 22, max_hp: 800 }
  ];
  assert.strictEqual(core.partyFarmTarget({ level: 50, max_hp: 2500 }, party, Gmon), "armadillo");
});
test("party farm: lowest member's hp gates the pack, not the leader's", () => {
  const party = [{ name: "Zarook", level: 24, max_hp: 100 }];
  const pick = core.partyFarmTarget({ level: 40, max_hp: 2000 }, party, Gmon);
  assert.notStrictEqual(pick, "arcticbee");
  assert.notStrictEqual(pick, "bat");
});
test("party farm: death blip to level 1 does not collapse to goo", () => {
  const peaks = {};
  const self = { name: "Sarene", level: 40, max_hp: 2000 };
  assert.strictEqual(core.partyFarmTarget(self, [{ name: "Jazwyn", level: 22, max_hp: 800 }], Gmon, null, peaks), "armadillo");
  assert.strictEqual(core.partyFarmTarget(self, [{ name: "Jazwyn", level: 1, max_hp: 50 }], Gmon, null, peaks), "armadillo");
});
test("party farm: rip member is ignored until we have a peak", () => {
  assert.strictEqual(core.partyFarmTarget(
    { name: "Sarene", level: 40, max_hp: 2000 },
    [{ name: "Zarook", level: 8, max_hp: 320, rip: true }],
    Gmon
  ), "bat");
});
test("party farm: peak hp survives a post-death max_hp dip", () => {
  const peaks = {};
  const self = { name: "Sarene", level: 40, max_hp: 2000 };
  core.partyFarmTarget(self, [], Gmon, null, peaks);
  assert.strictEqual(core.partyFarmTarget({ name: "Sarene", level: 40, max_hp: 80 }, [], Gmon, null, peaks), "bat");
});
test("tank stands on the far side of the mob from allies", () => {
  const pos = core.tankAnchor({ real_x: 100, real_y: 0 }, [{ real_x: 0, real_y: 0 }, { real_x: 0, real_y: 0 }], 30);
  assert.ok(pos.x > 100);
  assert.ok(Math.abs(pos.y) < 1);
});
test("ranged tooClose to warrior, stepAway increases distance", () => {
  const mage = { real_x: 5, real_y: 0 };
  const tank = { real_x: 0, real_y: 0 };
  assert.strictEqual(core.tooClose(mage, tank, 70), true);
  const p = core.stepAway(mage, tank, 90);
  assert.ok(p.x >= 89);
});

test("pots: hpot0/mpot0 before 30, tier1 at 30", () => {
  assert.strictEqual(core.pot("hp", 1), "hpot0");
  assert.strictEqual(core.pot("mp", 29), "mpot0");
  assert.strictEqual(core.pot("hp", 30), "hpot1");
  assert.strictEqual(core.pot("mp", 60), "mpot1");
});
test("use pots only under 50% hp or 50% mp, hp first", () => {
  assert.strictEqual(core.usePotSkill(49, 100, 50, 100), "use_hp");
  assert.strictEqual(core.usePotSkill(50, 100, 49, 100), "use_mp");
  assert.strictEqual(core.usePotSkill(80, 100, 50, 100), null);
  assert.strictEqual(core.usePotSkill(40, 100, 5, 100), "use_hp");
});

test("needsPots: false when stocked", () => {
  assert.strictEqual(core.needsPots(500, 500, 10000, 1, Gitems), false);
});
test("needsPots: true when low and can afford full restock", () => {
  // 10 hp + 200 mp -> need 490 hpot0 + 300 mpot0 = 15800g
  assert.strictEqual(core.needsPots(10, 200, 20000, 1, Gitems), true);
});
test("needsPots: false when low but cannot afford full restock", () => {
  assert.strictEqual(core.needsPots(10, 200, 1000, 1, Gitems), false);
});
test("needsPots: false when low but broke", () => {
  assert.strictEqual(core.needsPots(10, 200, 0, 1, Gitems), false);
});
test("needsVendor: full inventory", () => {
  assert.strictEqual(core.needsVendor(0, 500, 500, 0, 1, [], Gitems), true);
});
test("needsVendor: low pots plus junk", () => {
  const inv = [{ name: "helmet", level: 0 }];
  assert.strictEqual(core.needsVendor(5, 10, 200, 0, 1, inv, Gitems, () => 0), true);
});
test("buyPotCounts: all-or-nothing full restock", () => {
  assert.deepStrictEqual(core.buyPotCounts(0, 0, 50, "hpot0", "mpot0", Gitems), { hp: 0, mp: 0 });
  assert.deepStrictEqual(core.buyPotCounts(0, 0, 20000, "hpot0", "mpot0", Gitems), { hp: 500, mp: 500 });
});
test("buyPotCounts: zero when broke", () => {
  const c = core.buyPotCounts(0, 0, 0, "hpot0", "mpot0", Gitems);
  assert.deepStrictEqual(c, { hp: 0, mp: 0 });
});
test("shouldCallPots debounce", () => {
  assert.strictEqual(core.shouldCallPots(true, 25000), true);
  assert.strictEqual(core.shouldCallPots(true, 1000), false);
  assert.strictEqual(core.shouldCallPots(false, 25000), false);
});

test("isKeep: potions, tracker, stand, locked, upgraded, gems", () => {
  assert.strictEqual(core.isKeep({ name: "hpot0", q: 5 }, Gitems, () => 0), true);
  assert.strictEqual(core.isKeep({ name: "tracker" }, Gitems, () => 0), true);
  assert.strictEqual(core.isKeep({ name: "stand0" }, Gitems, () => 0), true);
  assert.strictEqual(core.isKeep({ name: "helmet", l: true }, Gitems, () => 0), true);
  assert.strictEqual(core.isKeep({ name: "helmet", level: 3 }, Gitems, () => 0), true);
  assert.strictEqual(core.isKeep({ name: "gem0" }, Gitems, () => 0), true);
  assert.strictEqual(core.isKeep({ name: "helmet", level: 0 }, Gitems, () => 0), false);
});

test("farmable: rejects town training dummies", () => {
  assert.strictEqual(core.farmable(dummy(), Gmon), false);
  assert.strictEqual(core.farmable(dummy({ mtype: "target_a500" }), Gmon), false);
  assert.strictEqual(core.farmable(goo(), Gmon), true);
  assert.strictEqual(core.farmable(null, Gmon), false);
  assert.strictEqual(core.farmable(goo({ dead: true }), Gmon), false);
});

test("BUG: follower must not attack dummy when leader has no target", () => {
  const t = core.pickCombatTarget({
    isLead: false,
    mtype: null,
    leadTarget: null,
    targeted: dummy(),
    nearestUntargeted: dummy(),
    nearest: dummy(),
    monsters: Gmon
  });
  assert.strictEqual(t, null);
});
test("follower attacks only leader target if farmable", () => {
  const g = goo();
  const t = core.pickCombatTarget({
    isLead: false, mtype: null, leadTarget: g,
    targeted: dummy(), nearest: dummy(), monsters: Gmon
  });
  assert.strictEqual(t, g);
});
test("follower ignores leader dummy target", () => {
  const t = core.pickCombatTarget({
    isLead: false, mtype: null, leadTarget: dummy(),
    nearest: goo(), monsters: Gmon
  });
  assert.strictEqual(t, null);
});
test("leader on main prefers typed farm pack over dummy", () => {
  const g = goo();
  const t = core.pickCombatTarget({
    isLead: true, mtype: "goo", targeted: dummy(),
    nearestUntargeted: g, nearest: dummy(), monsters: Gmon
  });
  assert.strictEqual(t.mtype, "goo");
});
test("leader does not attack dummy even if it is nearest", () => {
  const t = core.pickCombatTarget({
    isLead: true, mtype: "goo", targeted: dummy(),
    nearestUntargeted: dummy(), nearest: dummy(), monsters: Gmon
  });
  assert.strictEqual(t, null);
});

test("priest: no heal when party is healthy", () => {
  const d = core.priestDecision(
    { ctype: "priest", rip: false },
    [{ name: "Sarene", hp: 300, max_hp: 320, rip: false }],
    () => true, true
  );
  assert.strictEqual(d.action, "none");
});
test("priest: heal lowest under 70%", () => {
  const low = { name: "Sarene", hp: 100, max_hp: 320, rip: false };
  const d = core.priestDecision(
    { ctype: "priest", rip: false },
    [low, { name: "Jazwyn", hp: 300, max_hp: 320, rip: false }],
    (m) => m.name === "Sarene", true
  );
  assert.strictEqual(d.action, "heal");
  assert.strictEqual(d.target.name, "Sarene");
});
test("priest: partyheal when two under 80%", () => {
  const d = core.priestDecision(
    { ctype: "priest", rip: false },
    [
      { name: "Sarene", hp: 200, max_hp: 320, rip: false },
      { name: "Jazwyn", hp: 200, max_hp: 320, rip: false }
    ],
    () => true, true
  );
  assert.strictEqual(d.action, "partyheal");
});
test("priest: walk in if heal is out of range", () => {
  const low = { name: "Sarene", hp: 100, max_hp: 320, rip: false };
  const d = core.priestDecision(
    { ctype: "priest", rip: false },
    [low],
    () => false, false
  );
  assert.strictEqual(d.action, "move");
});
test("priest: skipped for warrior", () => {
  const d = core.priestDecision({ ctype: "warrior", rip: false }, [], () => true, true);
  assert.strictEqual(d.action, "none");
});

test("chat: ding from other -> gratz, not self", () => {
  assert.deepStrictEqual(core.classifyChat("Jazwyn", "Ding!", "Sarene", core.PARTY), { gratz: true, rally: false, ok: false, summon: false });
  assert.deepStrictEqual(core.classifyChat("Sarene", "Ding!", "Sarene", core.PARTY), { gratz: false, rally: false, ok: false, summon: false });
});
test("chat: Gratz! does not retrigger ding", () => {
  const r = core.classifyChat("Zarook", "Gratz!", "Sarene", core.PARTY);
  assert.strictEqual(r.gratz, false);
  assert.strictEqual(r.ok, false);
});
test("chat: I need some potions! from party -> potions rally+ok", () => {
  const r = core.classifyChat("Jazwyn", "I need some potions!", "Sarene", core.PARTY);
  assert.strictEqual(r.rally, "potions");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.gratz, false);
});
test("chat: I need a gear upgrade! from party -> upgrade rally+ok", () => {
  const r = core.classifyChat("Zarook", "I need a gear upgrade!", "Sarene", core.PARTY);
  assert.strictEqual(r.rally, "upgrade");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.gratz, false);
});
test("chat: potions message does not start an upgrade rally", () => {
  const r = core.classifyChat("Jazwyn", "I need some potions!", "Sarene", core.PARTY);
  assert.notStrictEqual(r.rally, "upgrade");
});
test("chat: Ok! does not retrigger rally", () => {
  const r = core.classifyChat("Zarook", "Ok!", "Sarene", core.PARTY);
  assert.strictEqual(r.rally, false);
  assert.strictEqual(r.ok, false);
});
test("chat: stranger potions and upgrades ignored", () => {
  assert.strictEqual(core.classifyChat("Random", "I need some potions!", "Sarene", core.PARTY).rally, false);
  assert.strictEqual(core.classifyChat("Random", "I need a gear upgrade!", "Sarene", core.PARTY).rally, false);
});
test("chat: I need a summon! from party -> summon, not a town rally", () => {
  const r = core.classifyChat("Sarene", "I need a summon!", "Jazwyn", core.PARTY);
  assert.strictEqual(r.summon, true);
  assert.strictEqual(r.rally, false);
  assert.strictEqual(r.ok, false);
});
test("chat: stranger summon ignored", () => {
  assert.strictEqual(core.classifyChat("Random", "I need a summon!", "Jazwyn", core.PARTY).summon, false);
});
test("warrior skills: taunt off-tank, charge to gap, cleave in range", () => {
  const can = (s) => true;
  assert.deepStrictEqual(core.warriorSkillPlan({ target: "Sarene" }, "Jazwyn", false, can), ["taunt", "charge"]);
  assert.deepStrictEqual(core.warriorSkillPlan({ target: "Jazwyn" }, "Jazwyn", true, can), ["cleave"]);
  assert.deepStrictEqual(core.warriorSkillPlan({ target: "Jazwyn" }, "Jazwyn", false, can), ["charge"]);
});
test("peelTauntTarget picks a nearby mob hitting a party member", () => {
  const party = core.PARTY;
  const peel = core.peelTauntTarget([
    { id: "a", target: "Jazwyn", dist: 10 },
    { id: "b", target: "Zarook", dist: 50 },
    { id: "c", target: "Bandit", dist: 20 }
  ], "Jazwyn", party, 200);
  assert.strictEqual(peel.id, "b");
  assert.strictEqual(core.peelTauntTarget([{ id: "a", target: "Jazwyn", dist: 10 }], "Jazwyn", party, 200), null);
});
test("skillReady: can_use is not enough, MP and level must match G.skills", () => {
  const skills = {
    taunt: { mp: 40 },
    charge: { mp: 0 },
    cleave: { mp: 720, level: 52 },
    curse: { mp: 400 }
  };
  const yes = () => true;
  assert.strictEqual(core.skillReady("charge", 0, skills, yes, 1), true);
  assert.strictEqual(core.skillReady("taunt", 39, skills, yes, 1), false);
  assert.strictEqual(core.skillReady("taunt", 40, skills, yes, 1), true);
  assert.strictEqual(core.skillReady("cleave", 720, skills, yes, 20), false);
  assert.strictEqual(core.skillReady("cleave", 80, skills, yes, 52), false);
  assert.strictEqual(core.skillReady("cleave", 720, skills, yes, 52), true);
  assert.strictEqual(core.skillReady("curse", 80, skills, yes, 10), false);
  assert.strictEqual(core.skillReady("cleave", 720, skills, () => false, 52), false);
});
test("mage magiport only while at the pack, not traveling", () => {
  const can = () => true;
  assert.strictEqual(core.magePortOk(true, false, false, can), true);
  assert.strictEqual(core.magePortOk(false, false, false, can), false);
  assert.strictEqual(core.magePortOk(true, true, false, can), false);
  assert.strictEqual(core.magePortOk(true, false, true, can), false);
});
test("priest revive picks a dead ally if essence is ready", () => {
  const dead = { name: "Sarene", rip: true };
  assert.strictEqual(core.priestReviveTarget([dead], true, true), dead);
  assert.strictEqual(core.priestReviveTarget([dead], false, true), null);
  assert.strictEqual(core.priestReviveTarget([{ name: "Sarene", rip: false }], true, true), null);
});

test("follow: priest 80, others 180", () => {
  assert.strictEqual(core.followDistance("priest"), 80);
  assert.strictEqual(core.followDistance("warrior"), 180);
});
test("follow: different map always", () => {
  assert.strictEqual(core.shouldFollow({ map: "main", x: 0, y: 0 }, { map: "halloween", x: 0, y: 0 }, "mage"), true);
});
test("follow: priest stays close", () => {
  assert.strictEqual(core.shouldFollow({ map: "main", x: 0, y: 0 }, { map: "main", x: 100, y: 0 }, "priest"), true);
  assert.strictEqual(core.shouldFollow({ map: "main", x: 0, y: 0 }, { map: "main", x: 50, y: 0 }, "priest"), false);
});

test("warrior: blade/helmet are gear, staff/bow are not", () => {
  assert.strictEqual(core.isGear({ name: "blade", level: 0 }, Gitems), true);
  assert.strictEqual(core.isGear({ name: "helmet", level: 0 }, Gitems), true);
  assert.strictEqual(core.isGear({ name: "staff", level: 0 }, Gitems), false);
  assert.strictEqual(core.isGear({ name: "bow", level: 0 }, Gitems), false);
  assert.strictEqual(core.isGear({ name: "blade", l: true }, Gitems), false);
});
test("warrior: find lowest below max", () => {
  const inv = [
    { name: "helmet", level: 4 },
    { name: "blade", level: 1 },
    { name: "staff", level: 0 }
  ];
  assert.strictEqual(core.findUpgrade(inv, Gitems, 5), 1);
});
test("warrior: nothing to upgrade at cap", () => {
  const inv = [{ name: "blade", level: 5 }, { name: "helmet", level: 5 }];
  assert.strictEqual(core.findUpgrade(inv, Gitems, 5), -1);
});
test("warrior: scroll0 for low grade", () => {
  assert.strictEqual(core.scrollName({ name: "blade", level: 2 }, () => 0), "scroll0");
  assert.strictEqual(core.scrollName({ name: "blade", level: 7 }, () => 1), "scroll1");
});
test("warrior: do not buy scrolls if gold too low", () => {
  assert.strictEqual(core.canBuyScrolls(5000, "scroll0", Gitems), false);
  assert.strictEqual(core.canBuyScrolls(20000, "scroll0", Gitems), true);
});
test("warrior: hasPiece sees equipped weapon", () => {
  assert.strictEqual(core.hasPiece("mainhand", "blade", { mainhand: { name: "blade", level: 2 } }, [], Gitems), true);
  assert.strictEqual(core.hasPiece("mainhand", "blade", {}, [], Gitems), false);
});
test("generic gear: warrior blade, mage/priest staff, shared armor", () => {
  assert.strictEqual(core.isClassGear({ name: "blade", level: 0 }, "warrior", Gitems), true);
  assert.strictEqual(core.isClassGear({ name: "staff", level: 0 }, "warrior", Gitems), false);
  assert.strictEqual(core.isClassGear({ name: "staff", level: 0 }, "mage", Gitems), true);
  assert.strictEqual(core.isClassGear({ name: "staff", level: 0 }, "priest", Gitems), true);
  assert.strictEqual(core.isClassGear({ name: "wand", level: 0 }, "priest", Gitems), true);
  assert.strictEqual(core.isClassGear({ name: "blade", level: 0 }, "mage", Gitems), false);
  assert.strictEqual(core.isClassGear({ name: "helmet", level: 0 }, "mage", Gitems), true);
  assert.strictEqual(core.isClassGear({ name: "helmet", level: 0 }, "priest", Gitems), true);
});

test("party constants: Jazwyn leads and tanks", () => {
  assert.deepStrictEqual(core.PARTY, ["Jazwyn", "Sarene", "Zarook"]);
  assert.strictEqual(core.LEADER, "Jazwyn");
  assert.strictEqual(core.TANK, "Jazwyn");
});

module.exports = { tests };
