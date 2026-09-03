"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadScript } = require("./al_env");

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function stocked(extra) {
  const items = new Array(42).fill(null);
  items[0] = { name: "hpot0", q: 200 };
  items[1] = { name: "mpot0", q: 200 };
  items[2] = { name: "hpot1", q: 200 };
  items[3] = { name: "mpot1", q: 200 };
  return Object.assign({ items, esize: 40, gold: 8000, map: "main", hp: 400, max_hp: 400 }, extra);
}

function lines(file) {
  return fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\s+$/, "").split(/\r?\n/).length;
}

test("warrior.js / priest.js / mage.js / merchant.js stay within 176 CODE lines", () => {
  ["warrior.js", "priest.js", "mage.js", "merchant.js", "merchant_plan.js", "merchant_ponty.js", "merchant_ops.js", "merchant_craft.js", "merchant_combine.js"].forEach((f) => {
    const n = lines(f);
    assert.ok(n <= 176, f + " has " + n + " lines");
  });
});

test("warrior charges when out of range", () => {
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", real_x: 0, real_y: 0, range: 20, level: 20, max_hp: 800
  });
  env.parent.entities.c1 = { id: "c1", type: "monster", mtype: "snake", dead: false, attack: 24, real_x: 80, real_y: 0, target: "Jazwyn" };
  env.combat("snake");
  assert.ok(env.log.skills.indexOf("charge") >= 0);
  assert.ok(env.log.skills.indexOf("cleave") < 0);
});

test("warrior taunts a mob hitting the mage, but skips cleave without 720 MP", () => {
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", real_x: 0, real_y: 0, range: 40, level: 20, max_hp: 800, mp: 80, max_mp: 80
  });
  env.parent.entities.c1 = { id: "c1", type: "monster", mtype: "snake", dead: false, attack: 24, real_x: 10, real_y: 0, target: "Sarene" };
  env.combat("snake");
  assert.ok(env.log.skills.indexOf("taunt") >= 0);
  assert.ok(env.log.skills.indexOf("cleave") < 0);
  assert.strictEqual(env.log.attacked.length, 1);
});

test("warrior does not fire taunt or cleave when short on MP", () => {
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", real_x: 0, real_y: 0, range: 40, level: 52, max_hp: 800, mp: 20, max_mp: 80
  });
  env.parent.entities.c1 = { id: "c1", type: "monster", mtype: "snake", dead: false, attack: 24, real_x: 10, real_y: 0, target: "Sarene" };
  env.combat("snake");
  assert.ok(env.log.skills.indexOf("taunt") < 0);
  assert.ok(env.log.skills.indexOf("cleave") < 0);
  assert.strictEqual(env.log.attacked.length, 1);
});

test("warrior cleaves only at 52+ with enough MP", () => {
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", real_x: 0, real_y: 0, range: 40, level: 52, max_hp: 800, mp: 720, max_mp: 720
  });
  env.parent.entities.c1 = { id: "c1", type: "monster", mtype: "snake", dead: false, attack: 24, real_x: 10, real_y: 0, target: "Jazwyn" };
  env.combat("snake");
  assert.ok(env.log.skills.indexOf("cleave") >= 0);
});

test("warrior asks for a summon when leaving for the pack", async () => {
  const env = loadScript("warrior.js", stocked({ name: "Jazwyn", ctype: "warrior", level: 1 }));
  await env.go_farm("goo");
  assert.ok(env.log.said.some((s) => /summon/i.test(s)));
  assert.ok(env.log.moved.some((d) => d && d.to === "goo"));
});

test("warrior accepts a party magiport", () => {
  const env = loadScript("warrior.js", { name: "Jazwyn", ctype: "warrior" });
  env.on_magiport("Sarene");
  env.on_magiport("Bandit");
  assert.deepStrictEqual(env.log.magiport, ["Sarene"]);
});

test("priest does not curse when short on MP", () => {
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", real_x: 90, real_y: 0, range: 200, mp: 80, max_mp: 80
  });
  env.parent.entities.goo1 = { id: "goo1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 8, real_y: 0 };
  env.parent.entities.Jazwyn = { name: "Jazwyn", type: "character", ctype: "warrior", target: "goo1", real_x: 0, real_y: 0, rip: false };
  env.combat();
  assert.ok(env.log.skills.indexOf("curse") < 0);
  assert.strictEqual(env.log.attacked[0].mtype, "goo");
});

test("priest curses in melee and does not stack on the warrior", () => {
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", real_x: 90, real_y: 0, range: 200, mp: 400, max_mp: 400
  });
  env.parent.entities.goo1 = { id: "goo1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 8, real_y: 0 };
  env.parent.entities.Jazwyn = { name: "Jazwyn", type: "character", ctype: "warrior", target: "goo1", real_x: 20, real_y: 0, rip: false };
  env.combat();
  assert.ok(env.log.skills.indexOf("curse") >= 0);
  assert.strictEqual(env.log.attacked[0].mtype, "goo");
});

test("priest revives a dead ally when holding essenceoflife", () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "essenceoflife", q: 1 };
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", real_x: 0, real_y: 0, range: 120, mp: 500, max_mp: 500, items
  });
  env.parent.entities.Sarene = {
    name: "Sarene", type: "character", rip: true, real_x: 10, real_y: 0, hp: 0, max_hp: 320
  };
  assert.strictEqual(env.priest_tick(), true);
  assert.ok(env.log.skills.indexOf("revive") >= 0);
});

test("priest partyheals in an emergency", () => {
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", real_x: 0, real_y: 0, range: 120, hp: 300, max_hp: 320, mp: 400, max_mp: 400
  });
  env.parent.entities.Sarene = { name: "Sarene", type: "character", hp: 40, max_hp: 320, rip: false, real_x: 10, real_y: 0 };
  env.priest_tick();
  assert.ok(env.log.skills.indexOf("partyheal") >= 0);
});

test("priest does not partyheal when short on MP", () => {
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", real_x: 0, real_y: 0, range: 120, hp: 300, max_hp: 320, mp: 80, max_mp: 80
  });
  env.parent.entities.Sarene = { name: "Sarene", type: "character", hp: 40, max_hp: 320, rip: false, real_x: 10, real_y: 0 };
  env.priest_tick();
  assert.ok(env.log.skills.indexOf("partyheal") < 0);
});

test("priest asks for a summon when traveling", async () => {
  const env = loadScript("priest.js", stocked({ name: "Zarook", ctype: "priest", level: 5 }));
  await env.go_farm("goo");
  assert.ok(env.log.said.some((s) => /summon/i.test(s)));
});

test("mage attacks lead target without bursting", () => {
  const env = loadScript("mage.js", {
    name: "Sarene", ctype: "mage", real_x: 90, real_y: 0, range: 200, mp: 200, max_mp: 200, level: 1
  });
  env.parent.entities.goo1 = { id: "goo1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 8, real_y: 0 };
  env.parent.entities.Jazwyn = { name: "Jazwyn", type: "character", ctype: "warrior", target: "goo1", real_x: 0, real_y: 0, rip: false };
  env.combat();
  assert.ok(env.log.skills.indexOf("burst") < 0);
  assert.strictEqual(env.log.attacked[0].mtype, "goo");
});

test("mage explains when short on magiport MP", () => {
  const env = loadScript("mage.js", {
    name: "Sarene", ctype: "mage", real_x: 0, real_y: 0, range: 200, level: 1, max_hp: 400, mp: 200, max_mp: 200
  });
  env.parent.entities.goo1 = { id: "goo1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 20, real_y: 0 };
  env.farm = "goo";
  env.emitChat("Jazwyn", "I need a summon!");
  assert.ok(env.log.skills.indexOf("magiport") < 0);
  assert.ok(env.log.said.some((s) => /900 MP/i.test(s)));
});

test("mage magiports a summon request only while at the farm pack", () => {
  const env = loadScript("mage.js", {
    name: "Sarene", ctype: "mage", real_x: 0, real_y: 0, range: 200, level: 1, max_hp: 400, mp: 900, max_mp: 900
  });
  env.parent.entities.goo1 = { id: "goo1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 20, real_y: 0 };
  env.farm = "goo";
  env.emitChat("Jazwyn", "I need a summon!");
  assert.ok(env.log.skills.indexOf("magiport") >= 0);
  assert.ok(env.log.said.some((s) => /hang on/i.test(s)));
});

test("mage explains when summon asked but she is not at the pack", () => {
  const env = loadScript("mage.js", {
    name: "Sarene", ctype: "mage", real_x: 0, real_y: 0, level: 40, max_hp: 2000, mp: 900, max_mp: 900
  });
  env.farm = "bat";
  env.emitChat("Jazwyn", "I need a summon!");
  assert.ok(env.log.skills.indexOf("magiport") < 0);
  assert.ok(env.log.said.some((s) => /not at pack/i.test(s)));
});

test("mage does not ask for a summon when she walks herself", async () => {
  const env = loadScript("mage.js", stocked({ name: "Sarene", ctype: "mage", level: 1 }));
  await env.go_farm("goo");
  assert.ok(!env.log.said.some((s) => /summon/i.test(s)));
});

test("summon chat does not start a potion rally", () => {
  const env = loadScript("priest.js", { name: "Zarook", ctype: "priest" });
  env.emitChat("Jazwyn", "I need a summon!");
  assert.strictEqual(env.rally, false);
});

const CLASSES = [
  { file: "warrior.js", name: "Jazwyn", ctype: "warrior" },
  { file: "priest.js", name: "Zarook", ctype: "priest" },
  { file: "mage.js", name: "Sarene", ctype: "mage" }
];

function eachClass(title, fn) {
  CLASSES.forEach((spec) => {
    test(spec.file + ": " + title, () => fn(spec));
  });
}

function loadClass(spec, extra) {
  return loadScript(spec.file, Object.assign({ name: spec.name, ctype: spec.ctype }, extra || {}));
}

function mixedParty() {
  return {
    Sarene: { name: "Sarene", level: 40, max_hp: 2000, hp: 2000, map: "cave", x: 10, y: 10 },
    Jazwyn: { name: "Jazwyn", level: 22, max_hp: 800, hp: 800, map: "main", x: 0, y: 0 },
    Zarook: { name: "Zarook", level: 8, max_hp: 320, hp: 320, map: "main", x: 0, y: 0 }
  };
}

function lowestOther(name) {
  const p = mixedParty();
  if (name === "Zarook") {
    p.Zarook.level = 40; p.Zarook.max_hp = 2000; p.Zarook.hp = 2000;
    p.Jazwyn.level = 8; p.Jazwyn.max_hp = 320; p.Jazwyn.hp = 320;
  }
  return p;
}

function loadDedicatedParty() {
  return {
    Jazwyn: loadScript("warrior.js", { name: "Jazwyn", ctype: "warrior" }),
    Sarene: loadScript("mage.js", { name: "Sarene", ctype: "mage" }),
    Zarook: loadScript("priest.js", { name: "Zarook", ctype: "priest" })
  };
}

function sendToAll(envs, from, msg) {
  Object.keys(envs).forEach((n) => envs[n].emitChat(from, msg));
}

function wentTo(env, dest) {
  return env.log.moved.some((d) => d && d.to === dest);
}

function noGlobal(env) {
  assert.deepStrictEqual(env.log.global, []);
}

function replied(env) {
  assert.ok(env.log.said.length >= 1, env.character.name + " stayed silent");
}

function fight(env, spec, mtype) {
  if (spec.ctype === "warrior") env.combat(mtype);
  else env.combat();
}

eachClass("loads grind helpers", (spec) => {
  const env = loadClass(spec);
  assert.strictEqual(typeof env.combat, "function");
  assert.strictEqual(typeof env.farmable, "function");
  assert.strictEqual(typeof env.desired, "function");
});

eachClass("desired() matches ladder at lvl 1 and 40 when alone", (spec) => {
  const env = loadClass(spec, { level: 1, max_hp: 320 });
  assert.strictEqual(env.desired(), "goo");
  env.character.level = 40;
  env.character.max_hp = 2000;
  assert.strictEqual(env.desired(), "bat");
});

eachClass("party Let's kill overrides the ladder", (spec) => {
  const env = loadClass(spec, { level: 1, max_hp: 320 });
  const other = spec.name === "Jazwyn" ? "Sarene" : "Jazwyn";
  env.emitChat(other, "Let's kill SpIdEr!");
  assert.strictEqual(env.farm_ovr, "spider");
  assert.strictEqual(env.desired(), "spider");
  env.emitChat(other, "Back to the grind");
  assert.strictEqual(env.farm_ovr, null);
  assert.strictEqual(env.desired(), "goo");
});

test("Jazwyn forwards puppygirl hunt/grind into party chat", () => {
  const env = loadScript("warrior.js", { name: "Jazwyn", ctype: "warrior", level: 40, max_hp: 2000 });
  env.emitCm("puppygirl", { hunt: "boar" });
  assert.ok(env.log.said.some((s) => /Let's kill boar!/i.test(s)));
  assert.strictEqual(env.farm_ovr, "boar");
  env.emitCm("puppygirl", { grind: 1 });
  assert.ok(env.log.said.some((s) => /Back to the grind/i.test(s)));
  assert.strictEqual(env.farm_ovr, null);
});

eachClass("desired() uses lowest party member", (spec) => {
  const env = loadClass(spec, { level: 40, max_hp: 2000 });
  env.parent.party = lowestOther(spec.name);
  assert.strictEqual(env.desired(), "bee");
});

eachClass("farmable() false for target*, true for goo", (spec) => {
  const env = loadClass(spec);
  assert.strictEqual(env.farmable({ mtype: "target", dead: false }), false);
  assert.strictEqual(env.farmable({ mtype: "target_a500", dead: false }), false);
  assert.strictEqual(env.farmable({ mtype: "goo", dead: false }), true);
});

eachClass("pot() gated at 30", (spec) => {
  const env = loadClass(spec, { level: 12 });
  assert.strictEqual(env.pot("hp"), "hpot0");
  env.character.level = 30;
  assert.strictEqual(env.pot("hp"), "hpot1");
});

eachClass("needs_pots false when broke", (spec) => {
  const env = loadClass(spec, { gold: 0, items: [{ name: "hpot0", q: 2 }, ...new Array(41).fill(null)] });
  assert.strictEqual(env.needs_pots(), false);
});

eachClass("is_keep keeps pots, banks other loot", (spec) => {
  const env = loadClass(spec);
  assert.strictEqual(env.is_keep({ name: "hpot0", q: 40 }), true);
  assert.strictEqual(env.is_keep({ name: "helmet", level: 0 }), false);
});

eachClass("use_pots does not fire at 80% hp / 50% mp", (spec) => {
  const env = loadClass(spec, { hp: 256, max_hp: 320, mp: 40, max_mp: 80 });
  env.use_pots();
  assert.strictEqual(env.log.skills.length, 0);
});

eachClass("use_pots fires under 50% hp", (spec) => {
  const env = loadClass(spec, { hp: 100, max_hp: 320, mp: 40, max_mp: 80 });
  env.use_pots();
  assert.deepStrictEqual(env.log.skills, ["use_hp"]);
});

eachClass("use_pots fires under 50% mp", (spec) => {
  const env = loadClass(spec, { hp: 300, max_hp: 320, mp: 32, max_mp: 80 });
  env.use_pots();
  assert.deepStrictEqual(env.log.skills, ["use_mp"]);
});

eachClass("ding says Ding! on level up in party, never global", (spec) => {
  const env = loadClass(spec, { level: 2 });
  env.last_lv = 1;
  env.character.level = 2;
  env.ding();
  assert.ok(env.log.said.some((s) => s.indexOf("Ding!") >= 0));
  noGlobal(env);
});

eachClass("chat stays on partym, not game chat", (spec) => {
  const env = loadClass(spec);
  assert.strictEqual(typeof env.hear, "function");
  env.emitChat(spec.name === "Jazwyn" ? "Sarene" : "Jazwyn", "Ding!");
  replied(env);
  noGlobal(env);
});

eachClass("on_party_invite accepts party, not strangers", (spec) => {
  const env = loadClass(spec);
  env.on_party_invite("Zarook");
  env.on_party_invite("Jazwyn");
  env.on_party_invite("Bandit");
  assert.deepStrictEqual(env.log.accepted, ["Zarook", "Jazwyn"]);
});

eachClass("on_magiport accepts party, not strangers", (spec) => {
  const env = loadClass(spec);
  const from = spec.name === "Sarene" ? "Zarook" : "Sarene";
  env.on_magiport(from);
  env.on_magiport("Bandit");
  assert.deepStrictEqual(env.log.magiport, [from]);
});

eachClass("chat Ok! does not set rally", (spec) => {
  const env = loadClass(spec);
  env.emitChat("Zarook", "Ok!");
  assert.strictEqual(env.rally, false);
});

eachClass("chat stranger upgrade is ignored", (spec) => {
  const env = loadClass(spec);
  env.emitChat("Random", "I need a gear upgrade!");
  assert.strictEqual(env.rally, false);
  assert.deepStrictEqual(env.log.said, []);
});

eachClass("potions chat rallies to potions NPC", async (spec) => {
  const env = loadClass(spec, stocked({ level: 12 }));
  env.emitChat("Zarook", "I need some potions!");
  if (spec.name === "Zarook") {
    assert.strictEqual(env.rally, false);
    return;
  }
  assert.strictEqual(env.rally, "potions");
  replied(env);
  noGlobal(env);
  await env.logistics();
  assert.ok(wentTo(env, "bank"));
  assert.ok(wentTo(env, "potions"));
  assert.strictEqual(env.rally, false);
});

eachClass("upgrade chat rallies to upgrade NPC", async (spec) => {
  const env = loadClass(spec, stocked({ level: 12 }));
  env.emitChat("Jazwyn", "I need a gear upgrade!");
  if (spec.name === "Jazwyn") {
    assert.strictEqual(env.rally, false);
    return;
  }
  assert.strictEqual(env.rally, "upgrade");
  replied(env);
  noGlobal(env);
  await env.logistics();
  assert.ok(wentTo(env, "upgrade"));
  assert.ok(!wentTo(env, "potions"));
  assert.strictEqual(env.rally, false);
});

eachClass("post-death level 1 blip does not send the party to goo", (spec) => {
  const env = loadClass(spec, { level: 40, max_hp: 2000 });
  env.parent.party = {
    Sarene: { name: "Sarene", level: 40, max_hp: 2000, hp: 2000, map: "main", x: 0, y: 0 },
    Jazwyn: { name: "Jazwyn", level: spec.name === "Zarook" ? 22 : 40, max_hp: spec.name === "Zarook" ? 800 : 2000, hp: 800, map: "main", x: 0, y: 0 },
    Zarook: { name: "Zarook", level: spec.name === "Zarook" ? 40 : 22, max_hp: spec.name === "Zarook" ? 2000 : 800, hp: 800, map: "main", x: 0, y: 0 }
  };
  assert.strictEqual(env.desired(), "armadillo");
  env.parent.party = {
    Sarene: { name: "Sarene", level: 1, max_hp: 50, hp: 50, map: "main", x: 0, y: 0 },
    Jazwyn: { name: "Jazwyn", level: 1, max_hp: 40, hp: 40, map: "main", x: 0, y: 0 },
    Zarook: { name: "Zarook", level: 1, max_hp: 40, hp: 40, map: "main", x: 0, y: 0 }
  };
  env.character.max_hp = 80;
  assert.strictEqual(env.desired(), "armadillo");
});

eachClass("max_hp dip after death does not collapse a solo 40 to goo", (spec) => {
  const env = loadClass(spec, { level: 40, max_hp: 2000 });
  assert.strictEqual(env.desired(), "bat");
  env.character.max_hp = 80;
  assert.strictEqual(env.desired(), "bat");
});

test("dedicated scripts travel to the lowest member's pack, not bats", async () => {
  const party = mixedParty();
  const jazwyn = loadScript("warrior.js", stocked({ name: "Jazwyn", ctype: "warrior", level: 40, max_hp: 2000, hp: 2000 }));
  const sarene = loadScript("mage.js", stocked({ name: "Sarene", ctype: "mage", level: 22, max_hp: 800, hp: 800 }));
  const zarook = loadScript("priest.js", stocked({ name: "Zarook", ctype: "priest", level: 8, max_hp: 320, hp: 320 }));
  jazwyn.parent.party = party;
  sarene.parent.party = party;
  zarook.parent.party = party;
  await jazwyn.logistics();
  await sarene.logistics();
  await zarook.logistics();
  assert.ok(wentTo(jazwyn, "bee"), "leader should travel to bee");
  assert.ok(wentTo(sarene, "bee"), "mage should travel to bee");
  assert.ok(wentTo(zarook, "bee"), "priest should travel to bee");
  assert.ok(!wentTo(jazwyn, "bat"));
  assert.ok(!wentTo(sarene, "snake"));
});

test("warrior.js skips dummy even as nearest on main", () => {
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", map: "main", real_x: 0, real_y: 0, range: 200, level: 1, max_hp: 320
  });
  env.parent.entities.dummy1 = { id: "dummy1", type: "monster", mtype: "target", dead: false, attack: 0, real_x: 4, real_y: 0 };
  env.combat("goo");
  assert.strictEqual(env.log.attacked.length, 0);
});

test("mage.js invite_party is not on the mage script", () => {
  const env = loadScript("mage.js", { name: "Sarene", ctype: "mage" });
  assert.strictEqual(typeof env.invite_party, "undefined");
});

test("warrior.js invite_party from leader invites missing members", () => {
  const env = loadScript("warrior.js", { name: "Jazwyn", ctype: "warrior" });
  env.parent.party = { Jazwyn: { map: "main", x: 0, y: 0 } };
  env.invite_party();
  assert.ok(env.log.invited.indexOf("Sarene") >= 0);
  assert.ok(env.log.invited.indexOf("Zarook") >= 0);
  assert.ok(env.log.invited.indexOf("puppygirl") < 0);
  assert.ok(env.log.invited.indexOf("Jazwyn") < 0);
});

test("potion restock banks loot and does not sell it", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "hpot0", q: 5 };
  items[1] = { name: "mpot0", q: 5 };
  items[2] = { name: "helmet", q: 1 };
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", items, gold: 50000, esize: 39, map: "main", level: 12
  });
  await env.restock("potions");
  assert.ok(wentTo(env, "bank"));
  assert.ok(wentTo(env, "potions"));
  assert.ok(env.log.stored.some((s) => s.item === "helmet"));
  assert.ok(!env.log.stored.some((s) => s.item === "hpot0"));
  assert.deepStrictEqual(env.log.sold, []);
  assert.ok(env.log.bought.some((b) => b.name === "hpot0"));
});

test("upgrade rally skips the bank dump", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "helmet", q: 1 };
  const env = loadScript("mage.js", stocked({ name: "Sarene", ctype: "mage", items, level: 12 }));
  env.emitChat("Jazwyn", "I need a gear upgrade!");
  await env.logistics();
  assert.ok(wentTo(env, "upgrade"));
  assert.ok(!wentTo(env, "bank"));
  assert.deepStrictEqual(env.log.stored, []);
});

test("offload sends gold only when merchant is in range", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "hpot0", q: 40 };
  items[1] = { name: "helmet", q: 1 };
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", items, gold: 5000, real_x: 0, real_y: 0, map: "main"
  });
  env.parent.entities.puppygirl = {
    name: "puppygirl", type: "character", rip: false, real_x: 10, real_y: 0, map: "main"
  };
  await env.offload();
  assert.ok(env.log.gold.some((g) => g.name === "puppygirl" && g.amount === 4000));
  assert.strictEqual(env.character.gold, 1000);
  assert.deepStrictEqual(env.log.sent, []);
  assert.ok(env.character.items[1] && env.character.items[1].name === "helmet");
});

test("merchant hold CM restocks, announces states, and waits until resume", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "hpot0", q: 5 };
  items[1] = { name: "mpot0", q: 5 };
  items[2] = { name: "helmet", q: 1 };
  const env = loadScript("warrior.js", stocked({
    name: "Jazwyn", ctype: "warrior", items, gold: 50000, esize: 39, level: 12
  }));
  env.emitCm("puppygirl", { hold: 1 });
  assert.strictEqual(env.hold, true);
  assert.ok(env.log.said.some((s) => s === "Hold: restocking"));
  assert.deepStrictEqual(env.log.server[0], ["US", "II"]);
  assert.strictEqual(env.parent.server_identifier, "II");
  assert.strictEqual(env.localStorage.getItem("hold_Jazwyn"), "1");
  env.parent.entities.puppygirl = {
    name: "puppygirl", type: "character", rip: false, real_x: 120, real_y: -80, map: "main"
  };
  await env.logistics();
  assert.ok(wentTo(env, "bank"));
  assert.ok(wentTo(env, "potions"));
  assert.ok(env.log.said.some((s) => s === "Hold: banking"));
  assert.ok(env.log.said.some((s) => s === "Hold: buying pots"));
  assert.ok(env.log.said.some((s) => s === "Hold: ready"));
  assert.strictEqual(env.hold_done, true);
  env.log.moved = [];
  env.log.said = [];
  await env.logistics();
  assert.ok(!wentTo(env, "bank"));
  assert.ok(!wentTo(env, "potions"));
  assert.strictEqual(env.lastMessage, "Hold");
  env.character.real_x = 120; env.character.real_y = -80; env.character.x = 120; env.character.y = -80;
  env.character.gold = 5000;
  env.last_gold = new Date(0);
  await env.offload();
  assert.ok(env.log.gold.some((g) => g.name === "puppygirl" && g.amount === 4000));
  env.emitCm("stranger", { hold: 1 });
  assert.strictEqual(env.hold, true);
  env.emitCm("puppygirl", { hold: 0 });
  assert.strictEqual(env.hold, false);
  assert.ok(env.log.said.some((s) => s === "Resuming"));
  assert.deepStrictEqual(env.log.server[env.log.server.length - 1], ["US", "III"]);
  assert.strictEqual(env.localStorage.getItem("hold_Jazwyn"), "0");
});

test("hold hang leaves the bank toward plaza if merchant is not in vision", async () => {
  const env = loadScript("mage.js", stocked({ name: "Sarene", ctype: "mage", map: "bank", real_x: 0, real_y: -37 }));
  env.hold = true;
  env.hold_done = true;
  await env.hang_hold();
  assert.ok(wentTo(env, "potions"));
  assert.strictEqual(env.character.map, "main");
});

test("offload finds merchant case-insensitively and awaits send", async () => {
  const env = loadScript("warrior.js", stocked({
    name: "Jazwyn", ctype: "warrior", map: "main", real_x: 40, real_y: -20, gold: 5000
  }));
  env.parent.entities.Puppygirl = {
    name: "Puppygirl", type: "character", rip: false, real_x: 40, real_y: -20, map: "main"
  };
  env.last_gold = new Date(0);
  await env.offload();
  assert.ok(env.log.gold.some((g) => g.name === "Puppygirl" && g.amount === 4000));
});

test("offload is silent when merchant is not in vision", async () => {
  const env = loadScript("warrior.js", stocked({
    name: "Jazwyn", ctype: "warrior", map: "main", gold: 5000
  }));
  env.last_gold = new Date(0);
  await env.offload();
  assert.deepStrictEqual(env.log.gold, []);
  assert.ok(!(env.log.game || []).some((m) => /Gold skip/.test(m)));
});

test("hold survives server reload via localStorage", () => {
  const env = loadScript("mage.js", stocked({
    name: "Sarene", ctype: "mage", _storage: { hold_Sarene: "1" }, _server: ["US", "II"]
  }));
  assert.strictEqual(env.hold, true);
  assert.strictEqual(env.parent.server_identifier, "II");
});

test("merchant hold CM accepts stringified payload", () => {
  const env = loadScript("mage.js", stocked({ name: "Sarene", ctype: "mage" }));
  env.emitCm("puppygirl", JSON.stringify({ hold: 1 }));
  assert.strictEqual(env.hold, true);
  assert.ok(env.log.said.some((s) => s === "Hold: restocking"));
});

test("merchant hold PM restocks when whispered hold:1", async () => {
  const env = loadScript("priest.js", stocked({ name: "Zarook", ctype: "priest", gold: 50000, level: 12 }));
  env.emitPm("puppygirl", "hold:1");
  assert.strictEqual(env.hold, true);
  assert.ok(env.log.said.some((s) => s === "Hold: restocking"));
  await env.logistics();
  assert.ok(wentTo(env, "bank"));
  env.emitPm("puppygirl", "hold:0");
  assert.strictEqual(env.hold, false);
  assert.ok(env.log.said.some((s) => s === "Resuming"));
});

test("merchant hold CM ignores non-merchant senders", () => {
  const env = loadScript("mage.js", stocked({ name: "Sarene", ctype: "mage" }));
  env.emitCm("Jazwyn", { hold: 1 });
  assert.strictEqual(env.hold, false);
  assert.deepStrictEqual(env.log.said, []);
});

test("mage.js assists Jazwyn's target", () => {
  const env = loadScript("mage.js", {
    name: "Sarene", ctype: "mage", real_x: 90, real_y: 0, range: 200, level: 1, mp: 40, max_mp: 200
  });
  env.parent.entities.goo1 = { id: "goo1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 10, real_y: 0, target: "Jazwyn" };
  env.parent.entities.Jazwyn = { name: "Jazwyn", type: "character", ctype: "warrior", target: "goo1", real_x: 0, real_y: 0, rip: false };
  env.combat();
  assert.strictEqual(env.log.attacked[0].mtype, "goo");
});

test("mage.js stays Idle when Jazwyn has no target", () => {
  const env = loadScript("mage.js", {
    name: "Sarene", ctype: "mage", real_x: 90, real_y: 0, range: 200, level: 1
  });
  env.parent.entities.goo1 = { id: "goo1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 10, real_y: 0 };
  env.parent.entities.Jazwyn = { name: "Jazwyn", type: "character", ctype: "warrior", target: null, real_x: 0, real_y: 0, rip: false };
  env.combat();
  assert.strictEqual(env.lastMessage, "Idle");
  assert.strictEqual(env.log.attacked.length, 0);
});

test("warrior.js peel-taunts a second mob hitting Zarook", () => {
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", real_x: 0, real_y: 0, range: 40, level: 20, max_hp: 800, mp: 80, max_mp: 80
  });
  env.parent.entities.goo1 = { id: "goo1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 10, real_y: 0, target: "Jazwyn" };
  env.parent.entities.goo2 = { id: "goo2", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 15, real_y: 0, target: "Zarook" };
  env.parent.entities.Zarook = { name: "Zarook", type: "character", real_x: 30, real_y: 0, rip: false };
  env.parent.entities.Sarene = { name: "Sarene", type: "character", real_x: 40, real_y: 0, rip: false };
  env.combat("goo");
  assert.ok(env.log.skills.indexOf("taunt") >= 0);
  assert.strictEqual(env.log.skillArgs[0].target, "goo2");
});

test("warrior.js pulls the pack as lead", () => {
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", real_x: 0, real_y: 0, range: 40, level: 1, max_hp: 320, mp: 80, max_mp: 80
  });
  env.parent.entities.goo1 = { id: "goo1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 10, real_y: 0, target: null };
  env.parent.entities.Sarene = { name: "Sarene", type: "character", real_x: 40, real_y: 0, rip: false };
  env.combat("goo");
  assert.strictEqual(env.log.attacked[0].mtype, "goo");
});

test("warrior.js steps to the far side of the mob from the backline", () => {
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", real_x: 90, real_y: 0, range: 40, level: 40, max_hp: 2000
  });
  const mob = { id: "croc1", type: "monster", mtype: "croc", dead: false, attack: 48, real_x: 100, real_y: 0 };
  env.parent.entities.croc1 = mob;
  env.parent.entities.Sarene = { name: "Sarene", type: "character", real_x: 0, real_y: 0, rip: false };
  env.parent.entities.Zarook = { name: "Zarook", type: "character", real_x: 0, real_y: 0, rip: false };
  env.combat("croc");
  assert.ok(env.log.moved.length >= 1);
  assert.ok(env.log.moved[0].x > 100, "tank should stand past the mob");
  assert.strictEqual(env.log.attacked.length, 0);
});

["priest.js", "mage.js"].forEach((file) => {
  const spec = CLASSES.find((c) => c.file === file);
  test(file + ": does not attack training dummy when leader has no target", () => {
    const env = loadClass(spec, { map: "main", real_x: 90, real_y: 0, range: 200, level: 1 });
    env.parent.entities.dummy1 = { id: "dummy1", type: "monster", mtype: "target", dead: false, attack: 0, real_x: 5, real_y: 5 };
    env.parent.entities.Jazwyn = {
      name: "Jazwyn", type: "character", ctype: "warrior", target: null, real_x: 0, real_y: 0, hp: 300, max_hp: 320
    };
    fight(env, spec, "goo");
    if (file === "mage.js") {
      assert.strictEqual(env.log.attacked.length, 0);
    } else {
      assert.strictEqual(env.log.attacked.length, 0);
      assert.ok(!env.character.target);
    }
  });

  test(file + ": attacks leader goo, not dummy beside it", () => {
    const env = loadClass(spec, { map: "main", real_x: 90, real_y: 0, range: 200, level: 1 });
    env.parent.entities.dummy1 = { id: "dummy1", type: "monster", mtype: "target", dead: false, attack: 0, real_x: 5, real_y: 5 };
    env.parent.entities.goo1 = { id: "goo1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 8, real_y: 0 };
    env.parent.entities.Jazwyn = {
      name: "Jazwyn", type: "character", ctype: "warrior", target: "goo1", real_x: 20, real_y: 0, hp: 300, max_hp: 320
    };
    fight(env, spec, "goo");
    assert.strictEqual(env.log.attacked.length, 1);
    assert.strictEqual(env.log.attacked[0].mtype, "goo");
  });

  test(file + ": steps off the warrior instead of stacking", () => {
    const env = loadClass(spec, { real_x: 5, real_y: 0, range: 200, level: 1, max_hp: 800 });
    env.parent.entities.goo1 = { id: "goo1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 80, real_y: 0 };
    env.parent.entities.Jazwyn = {
      name: "Jazwyn", type: "character", ctype: "warrior", target: "goo1", real_x: 0, real_y: 0, rip: false
    };
    fight(env, spec, "goo");
    assert.ok(env.log.moved.length >= 1);
    const pos = env.log.moved[0];
    assert.ok(Math.sqrt(pos.x * pos.x + pos.y * pos.y) >= 70);
    assert.strictEqual(env.log.attacked.length, 0);
  });
});

test("priest.js idle when lead has no target even if mage does", () => {
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", real_x: 90, real_y: 0, range: 200, mp: 80, max_mp: 80
  });
  env.parent.entities.goo1 = { id: "goo1", type: "monster", mtype: "goo", dead: false, attack: 5, real_x: 8, real_y: 0 };
  env.parent.entities.Jazwyn = { name: "Jazwyn", type: "character", ctype: "warrior", target: null, real_x: 40, real_y: 0, rip: false };
  env.parent.entities.Sarene = { name: "Sarene", type: "character", ctype: "mage", target: "goo1", real_x: 0, real_y: 0, rip: false };
  env.combat();
  assert.strictEqual(env.lastMessage, "Idle");
  assert.strictEqual(env.log.attacked.length, 0);
});

test("priest.js idle status when nobody has a target", () => {
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", real_x: 90, real_y: 0, range: 200
  });
  env.parent.entities.Jazwyn = { name: "Jazwyn", type: "character", ctype: "warrior", target: null, real_x: 40, real_y: 0, rip: false };
  env.parent.entities.Sarene = { name: "Sarene", type: "character", ctype: "mage", target: null, real_x: 0, real_y: 0, rip: false };
  env.combat();
  assert.strictEqual(env.lastMessage, "Idle");
  assert.strictEqual(env.log.attacked.length, 0);
});

test("priest.js heals injured Sarene in range without partyheal", () => {
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", real_x: 0, real_y: 0, range: 120, hp: 300, max_hp: 320, mp: 80, max_mp: 80
  });
  env.lastMessage = "Off to";
  env.parent.entities.Sarene = {
    name: "Sarene", type: "character", hp: 160, max_hp: 320, rip: false, real_x: 10, real_y: 0
  };
  env.parent.entities.Jazwyn = {
    name: "Jazwyn", type: "character", hp: 300, max_hp: 320, rip: false, real_x: 10, real_y: 0
  };
  const acted = env.priest_tick();
  assert.strictEqual(acted, true);
  assert.deepStrictEqual(env.log.healed, ["Sarene"]);
  assert.ok(env.log.skills.indexOf("partyheal") < 0);
  assert.strictEqual(env.lastMessage, "Heal");
});

test("priest.js does not beeline to heal out of range", () => {
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", real_x: 0, real_y: 0, range: 40, hp: 300, max_hp: 320, mp: 80, max_mp: 80
  });
  env.parent.entities.Sarene = {
    name: "Sarene", type: "character", hp: 160, max_hp: 320, rip: false, real_x: 200, real_y: 0
  };
  assert.strictEqual(env.priest_tick(), false);
  assert.deepStrictEqual(env.log.healed, []);
  assert.strictEqual(env.log.moved.length, 0);
});

test("priest.js skips healing while smart_moving to destination", () => {
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", real_x: 0, real_y: 0, range: 120, hp: 300, max_hp: 320, mp: 80, max_mp: 80
  });
  env.smart.moving = true;
  env.parent.entities.Sarene = {
    name: "Sarene", type: "character", hp: 160, max_hp: 320, rip: false, real_x: 10, real_y: 0
  };
  assert.strictEqual(env.priest_tick(), false);
  assert.deepStrictEqual(env.log.healed, []);
});

test("priest.js yields when mp is too low to cast", () => {
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", real_x: 0, real_y: 0, range: 120, mp: 10, max_mp: 80
  });
  env.parent.entities.Sarene = {
    name: "Sarene", type: "character", hp: 160, max_hp: 320, rip: false, real_x: 10, real_y: 0
  };
  assert.strictEqual(env.priest_tick(), false);
  assert.deepStrictEqual(env.log.healed, []);
});

test("FLOW dedicated: Ding! -> others Gratz in party, speaker silent, Gratz does not echo", () => {
  const p = loadDedicatedParty();
  p.Sarene.last_lv = 1;
  p.Sarene.character.level = 2;
  p.Sarene.ding();
  assert.ok(p.Sarene.log.said.some((s) => /ding/i.test(s)));
  noGlobal(p.Sarene);
  sendToAll(p, "Sarene", p.Sarene.log.said[0]);
  assert.strictEqual(p.Sarene.log.said.length, 1);
  replied(p.Jazwyn);
  replied(p.Zarook);
  assert.ok(p.Jazwyn.log.said.every((s) => !/ding/i.test(s)));
  noGlobal(p.Jazwyn);
  noGlobal(p.Zarook);
  sendToAll(p, "Jazwyn", p.Jazwyn.log.said[0]);
  sendToAll(p, "Zarook", p.Zarook.log.said[0]);
  assert.strictEqual(p.Sarene.log.said.length, 1);
  assert.strictEqual(p.Jazwyn.log.said.length, 1);
  assert.strictEqual(p.Zarook.log.said.length, 1);
});

test("FLOW dedicated: I need some potions! -> others Ok in party and rally potions", () => {
  const p = loadDedicatedParty();
  sendToAll(p, "Zarook", "I need some potions!");
  assert.strictEqual(p.Zarook.rally, false);
  assert.deepStrictEqual(p.Zarook.log.said, []);
  assert.strictEqual(p.Sarene.rally, "potions");
  assert.strictEqual(p.Jazwyn.rally, "potions");
  replied(p.Sarene);
  replied(p.Jazwyn);
  noGlobal(p.Sarene);
  noGlobal(p.Jazwyn);
  sendToAll(p, "Sarene", p.Sarene.log.said[0]);
  sendToAll(p, "Jazwyn", p.Jazwyn.log.said[0]);
  assert.strictEqual(p.Zarook.rally, false);
  assert.deepStrictEqual(p.Zarook.log.said, []);
});

test("FLOW dedicated: I need a gear upgrade! -> others Ok in party and rally upgrade", () => {
  const p = loadDedicatedParty();
  sendToAll(p, "Jazwyn", "I need a gear upgrade!");
  assert.strictEqual(p.Jazwyn.rally, false);
  assert.deepStrictEqual(p.Jazwyn.log.said, []);
  assert.strictEqual(p.Sarene.rally, "upgrade");
  assert.strictEqual(p.Zarook.rally, "upgrade");
  replied(p.Sarene);
  replied(p.Zarook);
  noGlobal(p.Sarene);
  noGlobal(p.Zarook);
  sendToAll(p, "Sarene", p.Sarene.log.said[0]);
  sendToAll(p, "Zarook", p.Zarook.log.said[0]);
  assert.strictEqual(p.Jazwyn.rally, false);
});

module.exports = { tests };
