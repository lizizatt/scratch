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

test("merchant_ops.js / gear_ops.js / merchant.js stay within 176 CODE lines", () => {
  ["merchant_ops.js", "gear_ops.js", "merchant.js"].forEach((f) => {
    const n = lines(f);
    assert.ok(n <= 176, f + " has " + n + " lines");
  });
});

test("deploy UPLOADS has gear_ops not merchant_plan", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "deploy_mcp.js"), "utf8");
  assert.ok(src.indexOf("gear_ops.js") >= 0);
  assert.ok(src.indexOf("merchant_plan.js") < 0);
  const m = src.match(/const UPLOADS = \[([\s\S]*?)\];/);
  assert.ok(m);
  const files = m[1].match(/file:\s*"([^"]+)"/g) || [];
  assert.strictEqual(files.length, 7);
});

test("hold_item protects maxQty highest-level copies lists lower surplus", () => {
  const env = envOf({ esize: 40, map: "bank" });
  env.HOLD = [["ringsj", 2]];
  const a = { name: "ringsj", level: 2 }, b = { name: "ringsj", level: 1 }, c = { name: "ringsj", level: 0 };
  env.character.items[1] = a;
  env.character.items[2] = b;
  env.character.items[3] = c;
  assert.strictEqual(env.hold_item(a), true);
  assert.strictEqual(env.hold_item(b), true);
  assert.strictEqual(env.hold_item(c), false);
});

test("list_sale and bank_sellable use hold_item not held_set map", async () => {
  const env = envOf({ esize: 40, map: "bank" });
  env.HOLD = [["helmet", 1]];
  const keep = { name: "helmet", level: 2 }, junk = { name: "helmet", level: 0 };
  env.character.items[1] = keep;
  env.character.items[2] = junk;
  env.character.items[3] = { name: "coat", q: 1 };
  await env.list_sale();
  assert.ok(!env.log.traded.some((t) => t.i === 1));
  assert.ok(env.log.traded.some((t) => t.i === 2));
  assert.strictEqual(typeof env.held_set, "undefined");
});

test("list_sale skips explicit vitring HOLD quota", async () => {
  const env = envOf();
  env.HOLD = [["armorring", 1], ["vitring", 9]];
  env.character.items[1] = { name: "helmet", q: 1 };
  env.character.items[2] = { name: "vitring", q: 1 };
  await env.list_sale();
  assert.ok(env.log.traded.some((t) => t.i === 1));
  assert.ok(!env.log.traded.some((t) => t.i === 2));
});

test("combine_step prefers ringsj over vitring when both triples exist", async () => {
  const env = envOf({ gold: 400000, esize: 30 });
  env.GOLD_FLOAT = 0;
  env.COMBINE_MAX = 5;
  env.HOLD = [];
  const items = env.character.items;
  items[1] = { name: "cscroll0", q: 4 };
  for (let i = 0; i < 3; i++) items[2 + i] = { name: "vitring", q: 1 };
  for (let i = 0; i < 3; i++) items[5 + i] = { name: "ringsj", q: 1 };
  const r = await env.combine_step();
  assert.strictEqual(r, "ok");
  assert.strictEqual(env.log.compound[0].name, "ringsj");
});

test("park_bag strips equipped gear before banking", async () => {
  const env = envOf({ esize: 40, map: "bank" });
  env.HOLD = [];
  env.character.slots.helmet = { name: "helmet", q: 1 };
  env.character.slots.chest = { name: "coat", q: 1 };
  env.character.slots.trade1 = { name: "shoes", q: 1, price: 100 };
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character._bank = env.character.bank;
  env.pulled = true;
  assert.ok(await env.park_bag());
  assert.ok(!env.character.slots.helmet);
  assert.ok(!env.character.slots.chest);
  assert.ok(env.character.slots.trade1 && env.character.slots.trade1.name === "shoes");
  assert.ok(env.log.unequipped.includes("helmet"));
  assert.ok(env.log.unequipped.includes("chest"));
  assert.ok(env.log.stored.some((s) => s.item === "helmet"));
  assert.ok(env.log.stored.some((s) => s.item === "coat"));
});

test("park_bag strips rings even when bag is clogged with HOLD BOM", async () => {
  const env = envOf({ esize: 0, map: "bank" });
  env.HOLD = [["armorring", 1], ["vitring", 9]];
  env.character.items = new Array(42).fill(null).map(() => ({ name: "vitring", q: 1 }));
  env.character.slots.ring1 = { name: "vitring", q: 1 };
  env.character.slots.ring2 = { name: "armorring", q: 1 };
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character._bank = env.character.bank;
  env.pulled = true;
  await env.park_bag();
  assert.ok(!env.character.slots.ring1, "ring1 still equipped");
  assert.ok(!env.character.slots.ring2, "ring2 still equipped");
  assert.ok(env.log.unequipped.includes("ring1"));
  assert.ok(env.log.unequipped.includes("ring2"));
});

test("park_bag returns false when parkables remain", async () => {
  const env = envOf({ esize: 0, map: "bank" });
  env.HOLD = [];
  env.character.items = new Array(42).fill(null).map(() => ({ name: "helmet", q: 1 }));
  env.character.bank = { gold: 0, items0: new Array(42).fill({ name: "shoes", q: 1 }) };
  env.character._bank = env.character.bank;
  env.pulled = true;
  assert.strictEqual(await env.park_bag(), false);
  assert.ok(env.character.items.some((it) => it && it.name === "helmet"));
});

test("sale_price never below SALE_MULT * vendor g", () => {
  const env = envOf();
  env.SALE_MULT = 0.95;
  env.item_value = () => 1;
  assert.ok(env.sale_price({ name: "helmet", q: 1 }) >= Math.floor(1200 * 0.95));
  assert.strictEqual(env.sale_price({ name: "helmet", q: 1 }), 1140);
  assert.strictEqual(env.sale_price({ name: "coat", q: 1 }), Math.floor(2400 * 0.95));
  assert.ok(env.sale_price({ name: "shoes", q: 1 }) >= Math.floor(800 * 0.95));
});

test("list_sale never lists below SALE_MULT * vendor g", async () => {
  const env = envOf({ esize: 38 });
  env.HOLD = [];
  env.SALE_MULT = 0.95;
  env.item_value = () => 1;
  env.character.items[1] = { name: "helmet", q: 1 };
  env.character.items[2] = { name: "coat", q: 1 };
  env.character.items[3] = { name: "shoes", q: 1 };
  await env.list_sale();
  assert.ok(env.log.traded.length >= 3);
  for (const t of env.log.traded) {
    const name = env.character.slots["trade" + t.slot].name;
    const vendor = env.G.items[name].g;
    assert.ok(t.gold >= Math.floor(vendor * 0.95), name + " listed at " + t.gold);
  }
});

test("restock_sale prices at or above SALE_MULT * vendor g", async () => {
  const env = envOf({ gold: 100000, esize: 40, map: "bank" });
  env.HOLD = [];
  env.SALE_MULT = 0.95;
  env.item_value = () => 1;
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "coat", q: 1 };
  env.character.bank.items0[1] = { name: "helmet", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  await env.restock_sale();
  for (let s = 1; s <= 16; s++) {
    const it = env.character.slots["trade" + s];
    if (!it) continue;
    const vendor = env.G.items[it.name].g;
    assert.ok(it.price >= Math.floor(vendor * 0.95), it.name + " trade price " + it.price);
  }
});

test("list_sale lists event valuables like gem0 and prefers them over junk", async () => {
  const env = envOf({ esize: 40 });
  env.HOLD = [];
  env.COMBINE_MAX = 5;
  env.character.items[1] = { name: "helmet", q: 1 };
  env.character.items[2] = { name: "gem0", q: 1 };
  env.character.items[3] = { name: "cryptkey", q: 1 };
  await env.list_sale();
  assert.ok(env.log.traded.some((t) => t.i === 2), "gem0 (e:1) must list");
  assert.ok(env.log.traded.some((t) => t.i === 3), "cryptkey must list");
  assert.ok(env.log.traded[0].i === 2 || env.character.slots.trade1.name === "gem0");
  assert.ok(env.character.slots.trade1.price >= Math.floor(240000 * 0.95));
});

test("list_sale and bank_sellable skip compoundables below COMBINE_MAX", async () => {
  const env = envOf({ esize: 40, map: "bank" });
  env.HOLD = [];
  env.COMBINE_MAX = 5;
  env.character.items[1] = { name: "vitring", level: 2, q: 1 };
  env.character.items[2] = { name: "helmet", q: 1 };
  await env.list_sale();
  assert.ok(!env.log.traded.some((t) => t.i === 1));
  assert.ok(env.log.traded.some((t) => t.i === 2));
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "vitring", level: 1, q: 1 };
  env.character.bank.items0[1] = { name: "coat", q: 1 };
  env.character.bank.items0[2] = { name: "vitring", level: 5, q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  assert.strictEqual(env.bank_sellable().name, "vitring");
  assert.strictEqual(env.bank_sellable().level, 5);
  env.character.bank.items0[2] = null;
  assert.strictEqual(env.bank_sellable().name, "coat");
});

test("bank_sellable ranks by item_value not only catalog g", () => {
  const env = envOf({ map: "bank" });
  env.HOLD = [];
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "coat", q: 1 };
  env.character.bank.items0[1] = { name: "gem0", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  assert.strictEqual(env.bank_sellable().name, "gem0");
});

test("list_sale prices at SALE_MULT * item_value", async () => {
  const env = envOf({ esize: 41 });
  env.HOLD = [];
  env.SALE_MULT = 0.95;
  env.character.items[1] = { name: "helmet", q: 1 };
  await env.list_sale();
  assert.strictEqual(env.log.traded[0].gold, Math.floor(1200 * 0.95));
  assert.strictEqual(env.character.slots.trade1.price, 1140);
});

test("list_sale fills scarce slots expensive-first", async () => {
  const env = envOf({ esize: 39 });
  env.HOLD = [];
  env.character.items[1] = { name: "shoes", q: 1 };
  env.character.items[2] = { name: "coat", q: 1 };
  env.character.items[3] = { name: "pants", q: 1 };
  for (let s = 3; s <= 16; s++) env.character.slots["trade" + s] = { name: "blade", q: 1, price: 1 };
  await env.list_sale();
  assert.deepStrictEqual(env.log.traded.map((t) => t.i), [2, 3]);
  assert.strictEqual(env.character.slots.trade1.name, "coat");
  assert.strictEqual(env.character.slots.trade2.name, "pants");
  assert.ok(env.character.items[1] && env.character.items[1].name === "shoes");
});

test("restock_sale skips a stuck bank slot and keeps filling", async () => {
  const env = envOf({ gold: 100000, esize: 40, map: "bank" });
  env.HOLD = [];
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "coat", q: 1 };
  env.character.bank.items0[1] = { name: "pants", q: 1 };
  env.character.bank.items0[2] = { name: "helmet", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  const realRetrieve = env.bank_retrieve.bind(env);
  let blocked = true;
  env.bank_retrieve = async (pack, i) => {
    if (blocked && pack === "items0" && i === 0) {
      env.log.bankFail.push({ pack, i, reason: "stuck" });
      return;
    }
    return realRetrieve(pack, i);
  };
  await env.restock_sale();
  blocked = false;
  assert.ok(!env.character.slots.trade1 || env.character.slots.trade1.name !== "coat");
  assert.ok(env.character.slots.trade1 && env.character.slots.trade1.name === "pants");
  assert.ok(env.character.slots.trade2 && env.character.slots.trade2.name === "helmet");
  assert.ok(env.character.bank.items0[0] && env.character.bank.items0[0].name === "coat");
});

test("stock_store empties stand then restocks bank loot expensive-first skipping HOLD", async () => {
  const env = envOf({ gold: 100000, esize: 40, map: "bank" });
  env.HOLD = [["armorring", 1], ["vitring", 9]];
  env.character.slots.trade1 = { name: "shoes", q: 1, price: 100 };
  env.character.slots.trade2 = { name: "gloves", q: 1, price: 100 };
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "armorring", q: 1 };
  env.character.bank.items0[1] = { name: "helmet", q: 1 };
  env.character.bank.items0[2] = { name: "coat", q: 1 };
  env.character.bank.items0[3] = { name: "pants", q: 1 };
  env.character.bank.items0[4] = { name: "vitring", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  await env.stock_store();
  assert.ok(env.log.unequipped.includes("trade1"));
  assert.ok(env.log.unequipped.includes("trade2"));
  assert.strictEqual(env.character.slots.trade1 && env.character.slots.trade1.name, "coat");
  assert.strictEqual(env.character.slots.trade2 && env.character.slots.trade2.name, "pants");
  assert.strictEqual(env.character.slots.trade3 && env.character.slots.trade3.name, "helmet");
  assert.ok(!Object.keys(env.character.slots).some((k) => k.indexOf("trade") === 0 && env.character.slots[k] && (env.character.slots[k].name === "armorring" || env.character.slots[k].name === "vitring")));
  assert.ok((env.character._bank.items0 || []).some((it) => it && it.name === "armorring"));
});

test("empty_sale and restock open the stand before trade-slot moves", async () => {
  const env = envOf({ gold: 100000, esize: 40, map: "bank" });
  env.HOLD = [];
  env.character.slots.trade1 = { name: "shoes", q: 1, price: 100 };
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "coat", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  env.character.stand = false;
  assert.ok(await env.empty_sale());
  assert.ok(env.log.merchant.some((m) => m.open != null), "must open before unequip");
  assert.ok(!env.log.unequipFail || !env.log.unequipFail.some((f) => f.reason === "stand_closed"));
  env.character.stand = false;
  await env.restock_sale();
  assert.ok(env.log.merchant.some((m) => m.open != null));
  assert.ok(env.character.slots.trade1 && env.character.slots.trade1.name === "coat");
  assert.ok(!env.log.tradeFail || !env.log.tradeFail.some((f) => f.reason === "stand_closed"));
});

test("empty_sale parks mid-clear when bag is full so the stand empties", async () => {
  const env = envOf({ esize: 0, map: "bank" });
  env.HOLD = [];
  env.character.items = new Array(42).fill(null).map((_, i) => (i === 0 ? { name: "stand0", q: 1 } : { name: "helmet", q: 1 }));
  env.character.slots.trade1 = { name: "coat", q: 1, price: 3000 };
  env.character.slots.trade2 = { name: "shoes", q: 1, price: 100 };
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character._bank = env.character.bank;
  env.pulled = true;
  assert.ok(await env.empty_sale());
  assert.ok(!env.character.slots.trade1);
  assert.ok(!env.character.slots.trade2);
  assert.ok(env.log.unequipped.includes("trade1"));
  assert.ok(env.log.stored.some((s) => s.item === "helmet"));
});

test("stock_store refuses to restock until the stand is fully cleared", async () => {
  const env = envOf({ gold: 100000, esize: 0, map: "bank" });
  env.HOLD = [];
  env.character.items = new Array(42).fill(null).map((_, i) => (i === 0 ? { name: "stand0", q: 1 } : { name: "shoes", q: 1 }));
  for (let s = 1; s <= 16; s++) env.character.slots["trade" + s] = { name: "gloves", q: 1, price: 1 };
  env.character.bank = {
    gold: 0,
    items0: new Array(42).fill(null),
    items1: new Array(42).fill(null)
  };
  env.character.bank.items0[0] = { name: "gem0", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  const ok = await env.stock_store();
  assert.ok(ok);
  assert.ok(!Object.keys(env.character.slots).some((k) => k.indexOf("trade") === 0 && env.character.slots[k] && env.character.slots[k].name === "gloves"));
  assert.ok(env.character.slots.trade1 && env.character.slots.trade1.name === "gem0");
});

test("awaited unequip clears trade before restock (async bank ops)", async () => {
  const env = envOf({ gold: 100000, esize: 40, map: "bank" });
  env.HOLD = [];
  env.character.slots.trade1 = { name: "shoes", q: 1, price: 100 };
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  for (let i = 0; i < 5; i++) env.character.bank.items0[i] = { name: i === 0 ? "coat" : i === 1 ? "pants" : "helmet", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  await env.stock_store();
  const names = [];
  for (let s = 1; s <= 16; s++) if (env.character.slots["trade" + s]) names.push(env.character.slots["trade" + s].name);
  assert.ok(names.length >= 5, "listed=" + names.join(","));
  assert.strictEqual(names[0], "coat");
  assert.ok(names.includes("pants"));
  assert.ok(names.includes("helmet"));
});

test("boot snapshot still sees bank after cycle returns to plaza", async () => {
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
  assert.ok(env.character.esize >= 20, "boot must leave bag space, esize=" + env.character.esize);
  assert.ok(env.cnt("helmet", 0, "bag") < 20, "must not dump bank into bag");
  assert.strictEqual(env.cnt("armorring", 0, "bank"), 1);
});

test("run_econ will not spend the reserved gold float", async () => {
  const env = envOf({ gold: 100000, esize: 30 });
  env.GOLD_FLOAT = 100000;
  env.HOLD = [["armorring", 1], ["vitring", 9]];
  const items = env.character.items;
  for (let i = 0; i < 3; i++) items[1 + i] = { name: "vitring", q: 1 };
  await env.run_econ();
  assert.strictEqual(env.character.gold, 100000);
  assert.deepStrictEqual(env.log.bought, []);
  assert.deepStrictEqual(env.log.compound, []);
});

test("missing plan CODE leaves PLAN_OK false and skips econ", async () => {
  const env = envOf({ gold: 400000 });
  env.PLAN_OK = false;
  env.HOLD = [["armorring", 1]];
  await env.logistics();
  assert.strictEqual(env.lastMessage, "No plan");
  assert.deepStrictEqual(env.log.compound, []);
  assert.deepStrictEqual(env.log.bought, []);
});

test("run_combine pulls bank copies when bag only has a partial set", async () => {
  const env = envOf({ gold: 400000, esize: 38, map: "bank" });
  env.GOLD_FLOAT = 0;
  env.COMBINE_MAX = 5;
  env.HOLD = [];
  env.character.items[1] = { name: "cscroll0", q: 4 };
  env.character.items[2] = { name: "vitring", q: 1 };
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "vitring", q: 1 };
  env.character.bank.items0[1] = { name: "vitring", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  const r = await env.combine_step();
  assert.strictEqual(r, "ok");
  assert.ok(env.log.compound.length >= 1);
  assert.ok(env.log.retrieved.length >= 2);
});

test("restock_sale opens the stand once after banking pulls", async () => {
  const env = envOf({ gold: 100000, esize: 40, map: "bank" });
  env.HOLD = [];
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "coat", q: 1 };
  env.character.bank.items0[1] = { name: "helmet", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  env.character.stand = false;
  await env.restock_sale();
  const opens = (env.log.merchant || []).filter((m) => m.open != null).length;
  assert.ok(opens <= 2, "opens=" + opens);
  assert.ok(env.character.slots.trade1);
  assert.ok(!env.log.tradeFail || !env.log.tradeFail.some((f) => f.reason === "stand_closed"));
});

test("run_combine compounds duplicates toward COMBINE_MAX", async () => {
  const env = envOf({ gold: 400000, esize: 30 });
  env.GOLD_FLOAT = 0;
  env.COMBINE_MAX = 5;
  env.HOLD = [];
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
  const items = env.character.items;
  items[1] = { name: "cscroll0", q: 4 };
  items[2] = { name: "cscroll1", q: 2 };
  for (let i = 0; i < 3; i++) items[3 + i] = { name: "vitring", level: 2, q: 1 };
  for (let i = 0; i < 3; i++) items[6 + i] = { name: "vitring", q: 1 };
  const r = await env.combine_step();
  assert.strictEqual(r, "ok");
  assert.strictEqual(env.log.compound[0].from, 2);
});

test("run_combine skips when scroll purchase would break float", async () => {
  const env = envOf({ gold: 100000, esize: 30 });
  env.GOLD_FLOAT = 100000;
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

test("buy_scroll respects GOLD_FLOAT", async () => {
  const env = envOf({ gold: 100500 });
  env.GOLD_FLOAT = 100000;
  const r = await env.buy_scroll("cscroll0");
  assert.strictEqual(r, "fail");
  assert.deepStrictEqual(env.log.bought, []);
  assert.strictEqual(env.character.gold, 100500);
});

test("buy_scroll buys cscroll0 when gold allows", async () => {
  const env = envOf({ gold: 101000, esize: 40 });
  env.GOLD_FLOAT = 100000;
  const r = await env.buy_scroll("cscroll0");
  assert.strictEqual(r, "bought");
  assert.strictEqual(env.character.gold, 101000 - 800);
  assert.ok(env.character.items.some((it) => it && it.name === "cscroll0"));
  assert.ok(env.log.moved.some((d) => d && d.to === "upgrade"));
});

test("ensure_bag true when space", async () => {
  const env = envOf({ esize: 5, map: "bank" });
  assert.strictEqual(await env.ensure_bag(1), true);
  assert.strictEqual(await env.ensure_bag(5), true);
});

test("ensure_bag false when parkables cannot clear", async () => {
  const env = envOf({ esize: 0, map: "bank" });
  env.HOLD = [];
  env.character.items = new Array(42).fill(null).map(() => ({ name: "helmet", q: 1 }));
  env.character.bank = { gold: 0, items0: new Array(42).fill({ name: "shoes", q: 1 }) };
  env.character._bank = env.character.bank;
  env.pulled = true;
  assert.strictEqual(await env.ensure_bag(1), false);
});

test("ensure_bag false when bag is locked junk and bank is full", async () => {
  const env = envOf({ esize: 0, map: "bank" });
  env.HOLD = [];
  env.character.items = new Array(42).fill(null).map(() => ({ name: "helmet", q: 1, l: 1 }));
  env.character.bank = { gold: 0, items0: new Array(42).fill({ name: "shoes", q: 1 }) };
  env.character._bank = env.character.bank;
  env.pulled = true;
  assert.strictEqual(await env.ensure_bag(1), false);
});

test("5-minute cycle empties sale, banks, then restocks plaza", async () => {
  const env = envOf({ gold: 100000, esize: 40 });
  env.character.slots.trade1 = { name: "helmet", q: 1, price: 2000 };
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "armorring", q: 1 };
  env.character._bank = env.character.bank;
  env.HOLD = [["armorring", 1]];
  await env.logistics();
  assert.ok(env.log.unequipped.includes("trade1"));
  assert.ok(env.log.moved.some((d) => d && d.to === "bank"));
  assert.ok(env.log.moved.some((d) => d && d.map === "main" && d.x === 40));
  assert.ok(env.log.merchant.some((m) => m.open != null));
  assert.strictEqual(env.lastMessage, "Stand");
});

test("go_npc fails when smart_move reports failed", async () => {
  const env = envOf({ gold: 101000 });
  env.GOLD_FLOAT = 100000;
  env.moveFail = true;
  const r = await env.buy_scroll("cscroll0");
  assert.strictEqual(r, "fail");
  assert.deepStrictEqual(env.log.bought, []);
});

test("stale bank retrieve does not report moved", async () => {
  const env = envOf({ gold: 400000, map: "bank" });
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character._bank = env.character.bank;
  const r = await env.move_ent({ name: "armorring", level: 0, where: "bank", loc: ["items0", 0] }, "bag");
  assert.strictEqual(r, "fail");
});

test("compound path via run_combine walks to the upgrade NPC", async () => {
  const env = envOf({ gold: 400000, esize: 30 });
  env.GOLD_FLOAT = 0;
  env.COMBINE_MAX = 5;
  const items = env.character.items;
  items[1] = { name: "cscroll0", q: 4 };
  for (let i = 0; i < 3; i++) items[2 + i] = { name: "vitring", q: 1 };
  await env.run_combine();
  assert.ok(env.log.compound.length >= 1);
  assert.ok(env.log.moved.some((d) => d && d.to === "upgrade"));
});

test("boot PLAN_OK is true with ops/gear/combine helpers", () => {
  const env = envOf();
  assert.strictEqual(env.PLAN_OK, true);
  assert.strictEqual(typeof env.run_combine, "function");
  assert.strictEqual(typeof env.stock_store, "function");
  assert.strictEqual(typeof env.park_bag, "function");
  assert.strictEqual(typeof env.buy_scroll, "function");
  assert.strictEqual(typeof env.hold_item, "function");
  assert.strictEqual(typeof env.upgrade_one, "function");
  assert.strictEqual(typeof env.plan_item, "undefined");
  assert.strictEqual(typeof env.run_craft, "undefined");
  assert.strictEqual(typeof env.buy_leaf, "undefined");
});

test("happy cycle never crafts or buys non-whitelist Ponty", async () => {
  const env = envOf({ gold: 400000, esize: 40 });
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "coat", q: 1 };
  env.character._bank = env.character.bank;
  env.HOLD = [];
  env.ponty = [{ name: "snakefang", rid: "f1", price: 1200, level: 0 }];
  await env.logistics();
  assert.deepStrictEqual(env.log.crafted, []);
  assert.deepStrictEqual(env.log.secondhand, []);
});

test("run_cycle returns false when park_bag fails", async () => {
  const env = envOf({ gold: 100000, map: "bank" });
  env.park_bag = async () => false;
  assert.strictEqual(await env.run_cycle(), false);
  assert.ok((env.log.game || []).includes("park fail"));
});

test("stock_store returns false when empty_sale cannot clear", async () => {
  const env = envOf({ gold: 100000, esize: 40, map: "bank" });
  env.HOLD = [];
  env.character.slots.trade1 = { name: "shoes", q: 1, price: 100 };
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "coat", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  env.empty_sale = async () => false;
  const before = env.log.traded.length;
  assert.strictEqual(await env.stock_store(), false);
  assert.ok((env.log.game || []).includes("stock empty fail"));
  assert.strictEqual(env.log.traded.length, before);
});

test("ensure_stand no-op when already in the desired state", async () => {
  const env = envOf();
  env.character.stand = true;
  env.log.merchant.length = 0;
  await env.ensure_stand(true);
  assert.deepStrictEqual(env.log.merchant, []);
  env.character.stand = false;
  await env.ensure_stand(false);
  assert.deepStrictEqual(env.log.merchant, []);
  await env.ensure_stand(true);
  assert.ok(env.log.merchant.some((m) => m.open != null));
  env.log.merchant.length = 0;
  await env.ensure_stand(false);
  assert.ok(env.log.merchant.some((m) => m.close));
});

test("pull_combine from sale then compounds", async () => {
  const env = envOf({ gold: 400000, esize: 38, map: "bank" });
  env.GOLD_FLOAT = 0;
  env.COMBINE_MAX = 5;
  env.HOLD = [];
  env.character.items[1] = { name: "cscroll0", q: 4 };
  for (let s = 1; s <= 3; s++) env.character.slots["trade" + s] = { name: "vitring", q: 1, price: 1 };
  env.character.stand = false;
  const r = await env.combine_step();
  assert.strictEqual(r, "ok");
  assert.ok(env.log.unequipped.filter((s) => ("" + s).indexOf("trade") === 0).length >= 3);
  assert.ok(env.log.compound.length >= 1);
});

test("pull_combine fails when ensure_bag fails", async () => {
  const env = envOf({ gold: 400000, esize: 0, map: "bank" });
  env.HOLD = [];
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "vitring", q: 1 };
  env.character.bank.items0[1] = { name: "vitring", q: 1 };
  env.character.bank.items0[2] = { name: "vitring", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  env.ensure_bag = async () => false;
  assert.strictEqual(await env.pull_combine("vitring", 0), "fail");
  assert.deepStrictEqual(env.log.compound, []);
});

test("restock_sale does N retrieves then one list_sale", async () => {
  const env = envOf({ gold: 100000, esize: 40, map: "bank" });
  env.HOLD = [];
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  for (let i = 0; i < 3; i++) env.character.bank.items0[i] = { name: i === 0 ? "coat" : "helmet", q: 1 };
  env.character._bank = env.character.bank;
  env.pulled = true;
  let lists = 0;
  const realList = env.list_sale.bind(env);
  env.list_sale = async () => { lists++; return realList(); };
  await env.restock_sale();
  assert.ok(env.log.retrieved.length >= 3);
  assert.strictEqual(lists, 1);
  assert.ok(env.character.slots.trade1);
});

test("combine_step tries next candidate when scroll buy fails", async () => {
  const env = envOf({ gold: 100000, esize: 30 });
  env.GOLD_FLOAT = 100000;
  env.COMBINE_MAX = 5;
  env.HOLD = [];
  const items = env.character.items;
  for (let i = 0; i < 3; i++) items[1 + i] = { name: "vitring", level: 2, q: 1 };
  items[4] = { name: "cscroll0", q: 4 };
  for (let i = 0; i < 3; i++) items[5 + i] = { name: "vitring", q: 1 };
  const r = await env.combine_step();
  assert.strictEqual(r, "ok");
  assert.strictEqual(env.log.compound[0].from, 0);
  assert.deepStrictEqual(env.log.bought, []);
});

test("sleep decrements compound queue ms instead of wiping q", async () => {
  const env = envOf();
  env.character.q = { compound: { ms: 500 } };
  await env.sleep(200);
  assert.ok(env.character.q.compound);
  assert.strictEqual(env.character.q.compound.ms, 300);
  await env.sleep(400);
  assert.ok(!env.character.q.compound);
});

module.exports = { tests };
