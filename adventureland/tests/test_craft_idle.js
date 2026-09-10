"use strict";

/**
 * Puppygirl idle craft: pickaxe + fishing rod (item id `rod`) at Leo.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { CRAFT_TARGETS, KEEP_ALWAYS } = require("../src/constants");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function putBag(c, it) {
  const i = c.items.findIndex((x) => !x);
  assert.ok(i >= 0, "need free bag slot");
  c.items[i] = it;
  c.esize = Math.max(0, (c.esize || 1) - 1);
  return i;
}

test("constants: CRAFT_TARGETS include beginning orb + tools; tools kept", () => {
  assert.deepStrictEqual(CRAFT_TARGETS, ["orbg", "rod", "pickaxe"]);
  assert.ok(KEEP_ALWAYS.indexOf("pickaxe") >= 0);
  assert.ok(KEEP_ALWAYS.indexOf("rod") >= 0);
});

test("sim: G.craft recipes match live beginning orb/pickaxe/rod", () => {
  const p = bootParty({ pack: "armadillo", pots: 10, members: ["Puppygirl"] });
  const craft = p.world.G.craft;
  assert.ok(craft.orbg && craft.pickaxe && craft.rod);
  assert.strictEqual(craft.orbg.quest, "mcollector");
  assert.deepStrictEqual(p.world.G.items.orbg.grades, [4, 6, 6, 7]);
  assert.deepStrictEqual(
    craft.orbg.items.map((x) => x[1]).sort(),
    ["ascale", "bfur", "cscale", "pleather"]
  );
  assert.deepStrictEqual(
    craft.pickaxe.items.map((x) => x[1]).sort(),
    ["blade", "spidersilk", "staff"]
  );
  assert.deepStrictEqual(
    craft.rod.items.map((x) => x[1]).sort(),
    ["spidersilk", "staff"]
  );
});

test("scenario: gathered materials become a compounded beginning orb", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c.stand = false;
  c.gold = 500000;
  c._bank = { gold: 0, items0: new Array(42).fill(null) };
  for (const name of ["ascale", "pleather", "cscale", "bfur"]) {
    putBag(c, { name, q: 3 });
  }

  let done = false;
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "bank:compound orbg@0")) {
      done = true;
      break;
    }
  }

  const logs = api.log.game.map((g) => g.m);
  assert.strictEqual(logs.filter((m) => m === "collector:ok orbg").length, 3);
  assert.ok(done, "expected orbg compound, logs=" + logs.filter((m) => /collector:|compound/.test(m)).join(" | "));
  assert.ok(c.items.some((x) => x && x.name === "orbg" && x.level === 1), "result is orbg +1");
});

test("adversary: idle merchant trades gathered materials for Orb of Beginnings", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c.stand = false;
  c.gold = 500000;
  c._bank = { gold: 0, items0: new Array(42).fill(null) };
  for (const name of ["ascale", "pleather", "cscale", "bfur"]) {
    putBag(c, { name, q: 1 });
  }

  let done = false;
  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "collector:ok orbg")) {
      done = true;
      break;
    }
  }

  assert.ok(done, "expected collector:ok orbg");
  assert.ok(c.items.some((x) => x && x.name === "orbg" && (x.level || 0) === 0));
  assert.ok(api.log.crafted.indexOf("orbg") >= 0, "sim records material trade");
  assert.ok(Math.abs(c.real_x - 81) < 50 && Math.abs(c.real_y - (-283)) < 50, "near Cole");
  for (const name of ["ascale", "pleather", "cscale", "bfur"]) {
    assert.ok(!c.items.some((x) => x && x.name === name), name + " consumed");
  }
});

test("adversary: idle crafts rod when silk in bag (buys staff)", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c.stand = false;
  c.gold = 500000;
  // Seed bank hint so idle doesn't stall priming; silk in bag.
  c._bank = { gold: 0, items0: new Array(42).fill(null) };
  putBag(c, { name: "spidersilk", q: 2 });

  let saw = false;
  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "craft:ok rod") || c.items.some((x) => x && x.name === "rod")) {
      saw = true;
      break;
    }
    if (api.log.game.some((g) => /^craft:fail/.test(g.m))) break;
  }
  assert.ok(saw, "expected craft:ok rod, logs=" + api.log.game.map((g) => g.m).filter((m) => /^craft:/.test(m)).join(" | "));
  assert.ok(c.items.some((x) => x && x.name === "rod"), "rod in bag");
  assert.ok(api.log.crafted && api.log.crafted.indexOf("rod") >= 0, "sim crafted log");
});

test("adversary: idle crafts pickaxe when silk present (buys staff+blade)", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c.stand = false;
  c.gold = 500000;
  c._bank = { gold: 0, items0: new Array(42).fill(null) };
  // Already have a rod so idle prefers pickaxe next.
  putBag(c, { name: "rod", q: 1 });
  putBag(c, { name: "spidersilk", q: 1 });

  let saw = false;
  for (let i = 0; i < 140; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "craft:ok pickaxe")) {
      saw = true;
      break;
    }
    if (c.items.some((x) => x && x.name === "pickaxe")) {
      saw = true;
      break;
    }
  }
  assert.ok(saw, "expected pickaxe craft, logs=" + api.log.game.map((g) => g.m).filter((m) => /^craft:/.test(m)).join(" | "));
  assert.ok(c.items.some((x) => x && x.name === "pickaxe"), "pickaxe in bag");
});

test("adversary: no craft without spidersilk", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c.stand = false;
  c.gold = 500000;
  c._bank = { gold: 0, items0: new Array(42).fill(null) };

  for (let i = 0; i < 40; i++) await p.tickAll();
  assert.ok(!api.log.game.some((g) => /^craft:ok/.test(g.m)), "must not craft without silk");
  assert.ok(!c.items.some((x) => x && (x.name === "rod" || x.name === "pickaxe")));
});

module.exports = { tests };
