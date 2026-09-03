"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadScript } = require("./al_env");

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function lines(file) {
  return fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\s+$/, "").split(/\r?\n/).length;
}

function envOf(extra) {
  const items = new Array(42).fill(null);
  items[0] = { name: "stand0", q: 1 };
  return loadScript("merchant.js", Object.assign({
    name: "puppygirl", ctype: "merchant", gold: 400000, map: "main", items, esize: 40,
    real_x: 40, real_y: -20, _server: ["US", "II"], pulled: true
  }, extra || {}));
}

test("merchant_plan.js / merchant_ops.js stay within 176 CODE lines", () => {
  ["merchant_plan.js", "merchant_ops.js", "merchant_combine.js", "merchant.js"].forEach((f) => {
    const n = lines(f);
    assert.ok(n <= 176, f + " has " + n + " lines");
  });
});

test("plan_item armorring expands vitring+2, lotus, fang, and scrolls", () => {
  const env = envOf();
  const p = env.plan_item("armorring", 0);
  assert.ok(!p.failed);
  assert.strictEqual(p.tree.via, "craft");
  const bom = {};
  p.bom.forEach((b) => { bom[b.name + "@" + b.level] = b.qty; });
  assert.strictEqual(bom["snakefang@0"], 1);
  assert.strictEqual(bom["lotusf@0"], 1);
  assert.strictEqual(bom["vitring@0"], 9);
  assert.strictEqual(bom["cscroll0@0"], 4);
  assert.ok(p.ops.some((o) => o.op === "craft" && o.name === "armorring" && o.npc === "mcollector"));
  assert.ok(p.ops.filter((o) => o.op === "compound" && o.name === "vitring" && o.to === 1).length >= 1);
  assert.ok(p.ops.some((o) => o.op === "compound" && o.name === "vitring" && o.to === 2));
});

test("plan_item vitring+2 is 9 rings and 4 compound scrolls", () => {
  const env = envOf();
  const p = env.plan_item("vitring", 2);
  assert.strictEqual(p.tree.via, "compound");
  const rings = p.bom.find((b) => b.name === "vitring");
  const scrolls = p.bom.find((b) => b.name === "cscroll0");
  assert.strictEqual(rings.qty, 9);
  assert.strictEqual(scrolls.qty, 4);
});

test("plan_item detects craft cycles", () => {
  const env = envOf();
  env.G.craft.loopa = { items: [[1, "loopb"]], cost: 0 };
  env.G.craft.loopb = { items: [[1, "loopa"]], cost: 0 };
  const p = env.plan_item("loopa", 0);
  assert.strictEqual(p.failed, true);
  assert.strictEqual(p.reason, "cycle");
});

test("pick_ponty rejects listings above vendor g * 1.25", () => {
  const env = envOf();
  const cap = env.G.items.snakefang.g * 1.25;
  const pick = env.pick_ponty([
    { name: "snakefang", rid: "hi", price: cap + 1 },
    { name: "snakefang", rid: "ok", price: cap }
  ], "snakefang", 0);
  assert.strictEqual(pick.rid, "ok");
  assert.strictEqual(env.pick_ponty([{ name: "snakefang", rid: "x", price: cap + 1 }], "snakefang", 0), null);
});

test("pick_ponty prefers the cheapest in-cap listing", () => {
  const env = envOf();
  const pick = env.pick_ponty([
    { name: "lotusf", rid: "b", price: 11000 },
    { name: "lotusf", rid: "a", price: 9000 },
    { name: "snakefang", rid: "z", price: 100 }
  ], "lotusf", 0);
  assert.strictEqual(pick.rid, "a");
  assert.strictEqual(pick.price, 9000);
});

test("offload-style Ponty buy respects 100k gold float", async () => {
  const env = envOf({ gold: 100500 });
  env.GOLD_FLOAT = 100000;
  env.ponty = [{ name: "snakefang", rid: "f1", price: 1200, level: 0 }];
  const r = await env.buy_leaf("snakefang", 0);
  assert.strictEqual(r, "fail");
  assert.deepStrictEqual(env.log.secondhand, []);
  assert.strictEqual(env.character.gold, 100500);
});

test("buy_leaf spends above the float when Ponty is in cap", async () => {
  const env = envOf({ gold: 102000 });
  env.GOLD_FLOAT = 100000;
  env.ponty = [{ name: "snakefang", rid: "f1", price: 1200, level: 0 }];
  const r = await env.buy_leaf("snakefang", 0);
  assert.strictEqual(r, "bought");
  assert.strictEqual(env.character.gold, 100800);
  assert.ok(env.character.items.some((it) => it && it.name === "snakefang"));
  assert.ok(env.log.moved.some((d) => d && d.to === "secondhands"));
  assert.ok(env.log.merchant.some((m) => m.close));
});

test("acquire short-circuits when the hold item is already in bank", async () => {
  const env = envOf({ map: "bank", gold: 400000 });
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "armorring", q: 1 };
  env.character._bank = env.character.bank;
  const r = await env.acquire("armorring", 1, "bank");
  assert.strictEqual(r, "have");
  assert.deepStrictEqual(env.log.secondhand, []);
});

test("acquire moves a bag ring into the bank", async () => {
  const env = envOf({ gold: 400000, esize: 39 });
  env.character.items[1] = { name: "armorring", q: 1 };
  const r = await env.acquire("armorring", 1, "bank");
  assert.strictEqual(r, "have");
  assert.ok(env.log.stored.some((s) => s.item === "armorring"));
  assert.ok(env.log.moved.some((d) => d && d.to === "bank"));
});

test("acquire buys a finished ring from Ponty before crafting", async () => {
  const env = envOf({ gold: 400000 });
  env.ponty = [{ name: "armorring", rid: "r1", price: 180000, level: 0 }];
  const r = await env.acquire("armorring", 1, "bank");
  assert.strictEqual(r, "have");
  assert.ok(env.log.secondhand.some((s) => s.name === "armorring"));
  assert.deepStrictEqual(env.log.crafted, []);
  assert.ok(env.log.stored.some((s) => s.item === "armorring"));
});

test("acquire compounds vitring and crafts armorring at Cole", async () => {
  const env = envOf({ gold: 400000, esize: 28 });
  const items = env.character.items;
  items[1] = { name: "snakefang", q: 1 };
  items[2] = { name: "lotusf", q: 1 };
  items[3] = { name: "cscroll0", q: 4 };
  for (let i = 0; i < 9; i++) items[4 + i] = { name: "vitring", q: 1 };
  env.GOLD_FLOAT = 0;
  env.ponty = [];
  const r = await env.acquire("armorring", 1, "bank");
  assert.strictEqual(r, "have");
  assert.ok(env.log.compound.length >= 4);
  assert.deepStrictEqual(env.log.crafted, ["armorring"]);
  assert.ok(env.log.moved.some((d) => d && d.to === "mcollector"));
  assert.ok(env.log.stored.some((s) => s.item === "armorring"));
});

test("run_econ sorts HOLD by vendor gold and stops on first fail", async () => {
  const env = envOf({ gold: 400000 });
  env.G.items.loopa = { g: 1 };
  env.G.craft.loopa = { items: [[1, "loopb"]], cost: 0 };
  env.G.craft.loopb = { items: [[1, "loopa"]], cost: 0 };
  env.HOLD = [["snakefang", 1], ["loopa", 1]];
  env.STOCK = [];
  env.ponty = [{ name: "snakefang", rid: "f1", price: 1200, level: 0 }];
  await env.run_econ();
  assert.deepStrictEqual(env.log.secondhand, []);
  assert.strictEqual(env.character.gold, 400000);
});

test("empty STOCK still restocks sale from expensive unheld bank loot", async () => {
  const env = envOf({ gold: 400000, esize: 20, map: "bank" });
  env.HOLD = [["armorring", 1]];
  env.STOCK = [];
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "armorring", q: 1 };
  env.character.bank.items0[1] = { name: "helmet", q: 1 };
  env.character.bank.items0[2] = { name: "coat", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  await env.restock_sale();
  assert.ok(env.log.traded.some((t) => env.character.slots["trade" + t.slot] && env.character.slots["trade" + t.slot].name === "coat"));
  assert.ok(env.character.bank.items0[0] && env.character.bank.items0[0].name === "armorring");
});

test("list_sale skips HOLD bill-of-material names", async () => {
  const env = envOf();
  env.character.items[1] = { name: "helmet", q: 1 };
  env.character.items[2] = { name: "vitring", q: 1 };
  env.list_sale();
  assert.ok(env.log.traded.some((t) => t.i === 1));
  assert.ok(!env.log.traded.some((t) => t.i === 2));
});

test("try_plan buys lotus not extra vitrings when +2 already exists", async () => {
  const env = envOf({ gold: 400000, esize: 38 });
  env.character.items[1] = { name: "vitring", level: 2, q: 1 };
  env.character.items[2] = { name: "snakefang", q: 1 };
  env.GOLD_FLOAT = 0;
  env.ponty = [{ name: "lotusf", rid: "l1", price: 12000, level: 0 }, { name: "vitring", rid: "v1", price: 24000, level: 0 }];
  const r = await env.try_plan("armorring", 0);
  assert.strictEqual(r, "bought");
  assert.ok(env.log.secondhand.some((s) => s.name === "lotusf"));
  assert.ok(!env.log.secondhand.some((s) => s.name === "vitring"));
});

test("Ponty gone listing tries the next rid", async () => {
  const env = envOf({ gold: 102000 });
  env.GOLD_FLOAT = 100000;
  env.ponty = [
    { name: "snakefang", rid: "gone", price: 1200, level: 0 },
    { name: "snakefang", rid: "ok", price: 1200, level: 0 }
  ];
  env.pontyGone = { gone: true };
  const r = await env.buy_leaf("snakefang", 0);
  assert.strictEqual(r, "bought");
  assert.ok(env.log.secondhand.some((s) => s.rid === "ok"));
});

test("pick_ponty rejects level mismatch", () => {
  const env = envOf();
  assert.strictEqual(env.pick_ponty([{ name: "vitring", rid: "p2", price: 24000, level: 2 }], "vitring", 0), null);
});

test("bank full store fails acquire instead of reporting moved", async () => {
  const env = envOf({ gold: 400000, map: "bank", esize: 39 });
  env.character.items[1] = { name: "armorring", q: 1 };
  env.character.bank = { gold: 0, items0: new Array(42).fill({ name: "helmet", q: 1 }) };
  env.character._bank = env.character.bank;
  const r = await env.acquire("armorring", 1, "bank");
  assert.strictEqual(r, "fail");
  assert.ok(env.log.bankFail.some((f) => f.reason === "bank_full"));
});

test("acquire STOCK dest lists from bank into sale", async () => {
  const env = envOf({ gold: 400000, esize: 20, map: "bank" });
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "helmet", q: 1 };
  env.character._bank = env.character.bank;
  const r = await env.acquire("helmet", 1, "sale");
  assert.strictEqual(r, "have");
  assert.ok(env.cnt("helmet", 0, "sale") >= 1);
});

test("acquire cycle recipe without Ponty fails", async () => {
  const env = envOf({ gold: 400000 });
  env.G.craft.loopa = { items: [[1, "loopb"]], cost: 0 };
  env.G.craft.loopb = { items: [[1, "loopa"]], cost: 0 };
  env.ponty = [];
  const r = await env.acquire("loopa", 1, "bank");
  assert.strictEqual(r, "fail");
});

test("boot snapshot still sees bank after leaving for potions", async () => {
  const bag = new Array(42).fill(null);
  for (let i = 0; i < 35; i++) bag[i] = { name: "helmet", q: 1 };
  bag[35] = { name: "armorring", q: 1 };
  const env = loadScript("merchant.js", {
    name: "puppygirl", ctype: "merchant", gold: 100000, map: "main", esize: 40,
    items: (() => { const it = new Array(42).fill(null); it[0] = { name: "stand0", q: 1 }; return it; })(),
    bank: { gold: 0, items0: bag },
    _server: ["US", "II"]
  });
  await env.logistics();
  assert.strictEqual(env.character.map, "main");
  assert.ok(env.log.moved.some((d) => d && d.map === "main" && d.x === 40 && d.y === -20));
  assert.strictEqual(env.cnt("armorring", 0, "bank"), 1);
});

test("run_econ will not spend the reserved gold float", async () => {
  const env = envOf({ gold: 100000 });
  env.GOLD_FLOAT = 100000;
  env.HOLD = [["armorring", 1]];
  env.STOCK = [];
  env.ponty = [{ name: "snakefang", rid: "f1", price: 1200, level: 0 }];
  await env.run_econ();
  assert.strictEqual(env.character.gold, 100000);
  assert.deepStrictEqual(env.log.secondhand, []);
  assert.deepStrictEqual(env.log.crafted, []);
});

test("buy_leaf uses the cheapest in-cap Ponty rid, not first listing", async () => {
  const env = envOf({ gold: 102000 });
  env.GOLD_FLOAT = 100000;
  env.ponty = [
    { name: "snakefang", rid: "hi", price: 1500, level: 0 },
    { name: "snakefang", rid: "lo", price: 1200, level: 0 }
  ];
  const r = await env.buy_leaf("snakefang", 0);
  assert.strictEqual(r, "bought");
  assert.deepStrictEqual(env.log.secondhand.map((s) => s.rid), ["lo"]);
});

test("acquire crafts armorring from Ponty ingredients only", async () => {
  const env = envOf({ gold: 500000, esize: 40 });
  env.GOLD_FLOAT = 0;
  env.ponty = [];
  for (let i = 0; i < 9; i++) env.ponty.push({ name: "vitring", rid: "v" + i, price: 24000, level: 0 });
  env.ponty.push({ name: "snakefang", rid: "f1", price: 1200, level: 0 });
  env.ponty.push({ name: "lotusf", rid: "l1", price: 12000, level: 0 });
  const r = await env.acquire("armorring", 1, "bank");
  assert.strictEqual(r, "have");
  assert.deepStrictEqual(env.log.crafted, ["armorring"]);
  assert.ok(env.log.compound.length >= 4);
});

test("try_plan compounds existing +1 rings instead of buying more +0", async () => {
  const env = envOf({ gold: 400000, esize: 30 });
  env.GOLD_FLOAT = 0;
  env.ponty = [{ name: "vitring", rid: "extra", price: 24000, level: 0 }];
  const items = env.character.items;
  items[1] = { name: "snakefang", q: 1 };
  items[2] = { name: "lotusf", q: 1 };
  items[3] = { name: "cscroll0", q: 4 };
  for (let i = 0; i < 3; i++) items[4 + i] = { name: "vitring", level: 1, q: 1 };
  const r = await env.try_plan("armorring", 0);
  assert.strictEqual(r, "crafted");
  assert.ok(env.log.compound.length >= 1);
  assert.ok(!env.log.secondhand.some((s) => s.name === "vitring"));
});

test("try_plan buys a Ponty vitring+2 instead of skipping leveled ings", async () => {
  const env = envOf({ gold: 400000, esize: 38 });
  env.GOLD_FLOAT = 0;
  env.character.items[1] = { name: "snakefang", q: 1 };
  env.character.items[2] = { name: "lotusf", q: 1 };
  env.ponty = [{ name: "vitring", rid: "p2", price: 24000, level: 2 }];
  const r = await env.try_plan("armorring", 0);
  assert.strictEqual(r, "bought");
  assert.ok(env.log.secondhand.some((s) => s.rid === "p2"));
});

test("go_npc fails when smart_move reports failed", async () => {
  const env = envOf();
  env.moveFail = true;
  const r = await env.buy_leaf("snakefang", 0);
  assert.strictEqual(r, "fail");
  assert.deepStrictEqual(env.log.secondhand, []);
});

test("stale bank retrieve does not report moved", async () => {
  const env = envOf({ gold: 400000, map: "bank" });
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character._bank = env.character.bank;
  const r = await env.move_ent({ name: "armorring", level: 0, where: "bank", loc: ["items0", 0] }, "bag");
  assert.strictEqual(r, "fail");
});

test("plan_item does not compound upgrade-only gear", () => {
  const env = envOf();
  const p = env.plan_item("helmet", 1);
  assert.strictEqual(p.tree.via, "ponty");
  assert.ok(p.ops.every((o) => o.op === "ponty"));
  assert.ok(!p.ops.some((o) => o.op === "compound"));
});

test("craft aborts when fee would break the gold float", async () => {
  const env = envOf({ gold: 100500, esize: 38 });
  env.GOLD_FLOAT = 100000;
  env.G.craft.armorring.cost = 1000;
  env.character.items[1] = { name: "snakefang", q: 1 };
  env.character.items[2] = { name: "lotusf", q: 1 };
  env.character.items[3] = { name: "vitring", level: 2, q: 1 };
  env.ponty = [];
  const r = await env.try_plan("armorring", 0);
  assert.strictEqual(r, "fail");
  assert.deepStrictEqual(env.log.crafted, []);
  assert.strictEqual(env.character.gold, 100500);
});

test("missing plan CODE leaves PLAN_OK false and skips econ", async () => {
  const env = envOf({ gold: 400000 });
  env.PLAN_OK = false;
  env.HOLD = [["snakefang", 1]];
  env.ponty = [{ name: "snakefang", rid: "f1", price: 1200, level: 0 }];
  await env.logistics();
  assert.strictEqual(env.lastMessage, "No plan");
  assert.deepStrictEqual(env.log.secondhand, []);
});

test("boot snaps bank without dumping loot into the bag", async () => {
  const bag = new Array(42).fill(null);
  for (let i = 0; i < 35; i++) bag[i] = { name: "helmet", q: 1 };
  bag[35] = { name: "armorring", q: 1 };
  const env = loadScript("merchant.js", {
    name: "puppygirl", ctype: "merchant", gold: 100000, map: "main", esize: 40,
    items: (() => { const it = new Array(42).fill(null); it[0] = { name: "stand0", q: 1 }; return it; })(),
    bank: { gold: 0, items0: bag },
    _server: ["US", "II"]
  });
  await env.logistics();
  assert.ok(env.character.esize >= 20, "boot must leave craft space, esize=" + env.character.esize);
  assert.ok(env.cnt("helmet", 0, "bag") < 20, "must not dump bank into bag");
  assert.strictEqual(env.cnt("armorring", 0, "bank"), 1);
});

test("run_combine compounds duplicates toward COMBINE_MAX", async () => {
  const env = envOf({ gold: 400000, esize: 30 });
  env.GOLD_FLOAT = 0;
  env.COMBINE_MAX = 5;
  env.HOLD = [];
  env.STOCK = [];
  env.ponty = [];
  const items = env.character.items;
  items[1] = { name: "cscroll0", q: 20 };
  for (let i = 0; i < 9; i++) items[2 + i] = { name: "vitring", q: 1 };
  await env.run_combine();
  assert.ok(env.log.compound.length >= 4);
  assert.ok(env.cnt("vitring", 2) >= 1);
  assert.strictEqual(env.cnt("vitring", 0), 0);
});

test("run_combine prefers higher levels first", async () => {
  const env = envOf({ gold: 400000, esize: 30 });
  env.GOLD_FLOAT = 0;
  env.COMBINE_MAX = 5;
  env.ponty = [];
  const items = env.character.items;
  items[1] = { name: "cscroll0", q: 4 };
  items[2] = { name: "cscroll1", q: 2 };
  for (let i = 0; i < 3; i++) items[3 + i] = { name: "vitring", level: 2, q: 1 };
  for (let i = 0; i < 3; i++) items[6 + i] = { name: "vitring", q: 1 };
  const r = await env.combine_step();
  assert.strictEqual(r, "crafted");
  assert.strictEqual(env.log.compound[0].from, 2);
});

test("run_combine skips when scroll purchase would break float", async () => {
  const env = envOf({ gold: 100000, esize: 30 });
  env.GOLD_FLOAT = 100000;
  env.ponty = [];
  const items = env.character.items;
  for (let i = 0; i < 3; i++) items[1 + i] = { name: "vitring", q: 1 };
  await env.run_combine();
  assert.deepStrictEqual(env.log.compound, []);
  assert.strictEqual(env.character.gold, 100000);
});

test("run_combine ignores upgrade-only duplicates", async () => {
  const env = envOf({ gold: 400000, esize: 30 });
  env.GOLD_FLOAT = 0;
  const items = env.character.items;
  items[1] = { name: "scroll0", q: 5 };
  for (let i = 0; i < 3; i++) items[2 + i] = { name: "helmet", q: 1 };
  await env.run_combine();
  assert.deepStrictEqual(env.log.compound, []);
  assert.deepStrictEqual(env.log.upgraded, []);
});

test("run_combine does not compound at or above COMBINE_MAX", async () => {
  const env = envOf({ gold: 400000, esize: 30 });
  env.GOLD_FLOAT = 0;
  env.COMBINE_MAX = 5;
  const items = env.character.items;
  items[1] = { name: "cscroll1", q: 4 };
  for (let i = 0; i < 3; i++) items[2 + i] = { name: "vitring", level: 5, q: 1 };
  await env.run_combine();
  assert.deepStrictEqual(env.log.compound, []);
  assert.strictEqual(env.cnt("vitring", 5), 3);
});

test("compound path walks to the upgrade NPC", async () => {
  const env = envOf({ gold: 400000, esize: 28 });
  const items = env.character.items;
  items[1] = { name: "snakefang", q: 1 };
  items[2] = { name: "lotusf", q: 1 };
  items[3] = { name: "cscroll0", q: 4 };
  for (let i = 0; i < 9; i++) items[4 + i] = { name: "vitring", q: 1 };
  env.GOLD_FLOAT = 0;
  env.ponty = [];
  await env.acquire("armorring", 1, "bank");
  assert.ok(env.log.moved.some((d) => d && d.to === "upgrade"));
});

module.exports = { tests };
