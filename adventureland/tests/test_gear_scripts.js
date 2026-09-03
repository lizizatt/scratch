"use strict";

const assert = require("assert");
const { loadScript } = require("./al_env");

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const SPECS = [
  { file: "warrior_upgrade.js", name: "Jazwyn", ctype: "warrior", weapon: "blade", badWeapon: "staff" },
  { file: "mage_upgrade.js", name: "Sarene", ctype: "mage", weapon: "staff", badWeapon: "blade" },
  { file: "priest_upgrade.js", name: "Zarook", ctype: "priest", weapon: "staff", badWeapon: "blade" }
];

SPECS.forEach((spec) => {
  test(spec.file + " loads", () => {
    const env = loadScript(spec.file, { name: spec.name, ctype: spec.ctype, gold: 50000 });
    assert.strictEqual(typeof env.is_gear, "function");
    assert.strictEqual(typeof env.find_upgrade, "function");
    assert.strictEqual(typeof env.tick, "function");
  });

  test(spec.file + ": is_gear accepts class weapon/armor, rejects other weapon/pots", () => {
    const env = loadScript(spec.file, { name: spec.name, ctype: spec.ctype });
    assert.strictEqual(env.is_gear({ name: spec.weapon, level: 0 }), true);
    assert.strictEqual(env.is_gear({ name: "helmet", level: 0 }), true);
    assert.strictEqual(env.is_gear({ name: spec.badWeapon, level: 0 }), false);
    assert.strictEqual(env.is_gear({ name: "bow", level: 0 }), false);
    assert.strictEqual(env.is_gear({ name: "hpot0", q: 20 }), false);
  });

  test(spec.file + ": find_upgrade picks lowest below MAX_LEVEL", () => {
    const env = loadScript(spec.file, { name: spec.name });
    env.character.items = [
      { name: "helmet", level: 4 },
      { name: spec.weapon, level: 1 },
      { name: "bow", level: 0 }
    ];
    assert.strictEqual(env.find_upgrade(), 1);
  });

  test(spec.file + ": find_upgrade none when all at cap", () => {
    const env = loadScript(spec.file, { name: spec.name });
    env.character.items = [{ name: spec.weapon, level: 5 }, { name: "helmet", level: 5 }];
    assert.strictEqual(env.find_upgrade(), -1);
  });

  test(spec.file + ": locked items are not gear", () => {
    const env = loadScript(spec.file, { name: spec.name });
    assert.strictEqual(env.is_gear({ name: spec.weapon, level: 0, l: true }), false);
  });

  test(spec.file + ": tick refuses to run when gold below MIN_GOLD", async () => {
    const env = loadScript(spec.file, { name: spec.name, ctype: spec.ctype, gold: 100 });
    await env.tick();
    assert.strictEqual(env.lastMessage, "Need gold");
  });

  test(spec.file + ": tick upgrades lowest class piece", async () => {
    const items = new Array(42).fill(null);
    items[0] = { name: spec.weapon, level: 0 };
    items[1] = { name: "scroll0", q: 20 };
    const env = loadScript(spec.file, {
      name: spec.name, ctype: spec.ctype, gold: 80000, map: "main", items
    });
    await env.tick();
    assert.ok(env.log.upgraded.length >= 1);
    assert.strictEqual(env.character.items[0].level, 1);
  });

  test(spec.file + ": has_piece true if weapon equipped", () => {
    const env = loadScript(spec.file, { name: spec.name });
    env.character.slots.mainhand = { name: spec.weapon, level: 2 };
    assert.strictEqual(env.has_piece("mainhand", spec.weapon), true);
  });

  test(spec.file + ": stops after gear is done (no strip/wear loop)", async () => {
    const items = new Array(42).fill(null);
    items[0] = { name: spec.weapon, level: 5 };
    items[1] = { name: "helmet", level: 5 };
    items[2] = { name: "coat", level: 5 };
    items[3] = { name: "pants", level: 5 };
    items[4] = { name: "shoes", level: 5 };
    items[5] = { name: "gloves", level: 5 };
    const env = loadScript(spec.file, {
      name: spec.name, ctype: spec.ctype, gold: 80000, map: "main", items
    });
    await env.tick();
    assert.strictEqual(env.done, true);
    assert.strictEqual(env.lastMessage, "Gear done");
    const unequips = env.log.unequipped.length;
    const equips = env.log.equipped.length;
    await env.tick();
    await env.tick();
    assert.strictEqual(env.log.unequipped.length, unequips);
    assert.strictEqual(env.log.equipped.length, equips);
  });

  test(spec.file + ": buys each basic at most once per run", async () => {
    const env = loadScript(spec.file, {
      name: spec.name, ctype: spec.ctype, gold: 200000, map: "main",
      items: new Array(42).fill(null)
    });
    await env.tick();
    await env.tick();
    const bought = env.log.bought.filter((b) => b && b.name === spec.weapon);
    assert.ok(bought.length <= 1, "rebought " + spec.weapon + " x" + bought.length);
  });

  test(spec.file + ": refuses wrong class", async () => {
    const wrong = spec.ctype === "warrior" ? "mage" : "warrior";
    const env = loadScript(spec.file, { name: spec.name, ctype: wrong, gold: 80000 });
    await env.tick();
    assert.strictEqual(env.lastMessage, "Wrong class");
    assert.strictEqual(env.done, true);
  });

  test(spec.file + ": ensure_scroll buys SCROLL_BUY when missing", async () => {
    const items = new Array(42).fill(null);
    items[0] = { name: spec.weapon, level: 0 };
    const env = loadScript(spec.file, {
      name: spec.name, ctype: spec.ctype, gold: 200000, map: "main", items
    });
    const sn = await env.ensure_scroll("scroll0");
    assert.ok(sn >= 0);
    assert.ok(env.log.bought.some((b) => b.name === "scroll0" && b.q === 10));
  });

  test(spec.file + ": ensure_scroll refuses when gold below SCROLL_BUY reserve", async () => {
    const items = new Array(42).fill(null);
    items[0] = { name: spec.weapon, level: 0 };
    const env = loadScript(spec.file, {
      name: spec.name, ctype: spec.ctype, gold: 8000 + 1000, map: "main", items
    });
    const sn = await env.ensure_scroll("scroll0");
    assert.strictEqual(sn, -1);
    assert.deepStrictEqual(env.log.bought, []);
  });

  test(spec.file + ": tick says No scrolls when ensure_scroll fails", async () => {
    const items = new Array(42).fill(null);
    items[0] = { name: spec.weapon, level: 0 };
    const env = loadScript(spec.file, {
      name: spec.name, ctype: spec.ctype, gold: 9000, map: "main", items
    });
    await env.tick();
    assert.strictEqual(env.lastMessage, "No scrolls");
    assert.deepStrictEqual(env.log.upgraded, []);
  });
});

test("warrior treats blade as short_sword gear", () => {
  const env = loadScript("warrior_upgrade.js", { name: "Jazwyn", ctype: "warrior" });
  assert.strictEqual(env.is_gear({ name: "blade", level: 0 }), true);
});

test("mage accepts wand as mainhand gear", () => {
  const env = loadScript("mage_upgrade.js", { name: "Sarene", ctype: "mage" });
  assert.strictEqual(env.is_gear({ name: "wand", level: 0 }), true);
});

test("priest accepts wand as mainhand gear", () => {
  const env = loadScript("priest_upgrade.js", { name: "Zarook", ctype: "priest" });
  assert.strictEqual(env.is_gear({ name: "wand", level: 0 }), true);
});

module.exports = { tests };
