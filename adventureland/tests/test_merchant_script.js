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

function merchant(extra) {
  const items = new Array(42).fill(null);
  items[0] = { name: "stand0", q: 1 };
  return loadScript("merchant.js", Object.assign({
    name: "puppygirl", ctype: "merchant", gold: 100000, map: "main", items, esize: 40,
    _server: ["US", "II"]
  }, extra || {}));
}

test("merchant.js stays within 176 CODE lines", () => {
  const n = lines("merchant.js");
  assert.ok(n <= 176, "merchant.js has " + n + " lines");
});

test("idle merchant opens stand and lists loot with trade slot arity", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "stand0", q: 1 };
  items[1] = { name: "helmet", q: 1 };
  items[2] = { name: "hpot0", q: 10 };
  const env = merchant({ items, gold: 50000 });
  await env.logistics();
  assert.ok(env.log.merchant.some((m) => m.open != null));
  assert.ok(env.log.traded.some((t) => t.i === 1 && t.slot === 1 && t.gold > 0));
  assert.ok(!env.log.traded.some((t) => t.i === 2));
});

test("merchant does not buy stand0", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "stand0", q: 1 };
  const env = merchant({ items });
  await env.logistics();
  assert.ok(!env.log.bought.some((b) => b.name === "stand0"));
  assert.ok(!env.log.moved.some((d) => d && d.to === "goo"));
});

test("merchant skips locked loot and stand0 when listing", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "stand0", q: 1 };
  items[1] = { name: "helmet", q: 1, l: "l" };
  items[2] = { name: "coat", q: 1 };
  const env = merchant({ items });
  await env.logistics();
  assert.ok(!env.log.traded.some((t) => t.i === 0 || t.i === 1));
  assert.ok(env.log.traded.some((t) => t.i === 2 && t.slot === 1 && t.q === 1));
});

test("merchant lists at most 16 trade slots", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "stand0", q: 1 };
  for (let i = 1; i <= 20; i++) items[i] = { name: "helmet", q: 1 };
  const env = merchant({ items });
  await env.logistics();
  assert.strictEqual(env.log.traded.length, 16);
  assert.strictEqual(env.log.traded[15].slot, 16);
});

test("merchant does not re-list into occupied trade slots", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "stand0", q: 1 };
  items[1] = { name: "helmet", q: 1 };
  items[2] = { name: "coat", q: 1 };
  const env = merchant({ items, gold: 50000, pulled: true, real_x: 40, real_y: -20 });
  env.pulled = true;
  await env.logistics();
  assert.strictEqual(env.log.traded.length, 2);
  env.log.traded = [];
  env.log.tradeFail = [];
  // leftover inventory item while slots already used
  env.character.items[3] = { name: "pants", q: 1 };
  await env.list_sale();
  assert.ok(!env.log.tradeFail || env.log.tradeFail.length === 0);
  assert.ok(env.log.traded.some((t) => t.i === 3 && t.slot === 3));
  env.log.traded = [];
  await env.list_sale();
  assert.deepStrictEqual(env.log.traded, []);
  assert.ok(!env.log.tradeFail || env.log.tradeFail.length === 0);
});

test("boot snaps bank and restocks sale without dumping the bag", async () => {
  const bag = new Array(42).fill(null);
  for (let i = 0; i < 42; i++) bag[i] = { name: "helmet", q: 1 };
  const env = merchant({
    esize: 40,
    bank: { gold: 0, items0: bag, items1: [{ name: "coat", q: 1 }] }
  });
  await env.logistics();
  assert.ok(env.log.moved.some((d) => d && d.to === "bank"));
  assert.ok(env.log.moved.some((d) => d && d.map === "main" && d.x === 40 && d.y === -20));
  assert.ok(env.character.esize >= 20, "leave craft space, esize=" + env.character.esize);
  assert.ok(env.cnt("helmet", 0, "bag") < 10, "must not dump bank into bag");
  assert.ok(env.log.merchant.some((m) => m.close));
  assert.ok(env.log.merchant.some((m) => m.open != null));
  assert.ok(env.log.traded.some((t) => t.gold > 0));
});

test("cycle throttles repeats within CYCLE_MS", async () => {
  const bag = new Array(42).fill(null);
  bag[0] = { name: "armorring", q: 1 };
  const env = merchant({ esize: 40, bank: { gold: 0, items0: bag } });
  await env.logistics();
  const banks = env.log.moved.filter((d) => d && d.to === "bank").length;
  assert.ok(banks >= 1);
  assert.ok(env.cycle_at > 0);
  assert.strictEqual(env.character.bank, null);
  env.log.moved = [];
  await env.logistics();
  assert.ok(!env.log.moved.some((d) => d && d.to === "bank"));
});

test("bank_retrieve refused outside the bank map", () => {
  const env = merchant({ map: "main", bank: { gold: 0, items0: [{ name: "helmet", q: 1 }] } });
  env.bank_retrieve("items0", 0);
  assert.deepStrictEqual(env.log.retrieved, []);
  assert.ok(env.log.bankFail.some((f) => f.reason === "not_bank"));
});

test("mluck skipped below skill level 40", () => {
  const env = merchant({ level: 12, mp: 80, max_mp: 80, real_x: 0, real_y: 0 });
  env.parent.entities.Jazwyn = {
    name: "Jazwyn", type: "character", rip: false, real_x: 10, real_y: 0, map: "main"
  };
  env.mluck_near();
  assert.ok(env.log.skills.indexOf("mluck") < 0);
});

test("mluck casts at level 40 when in range", () => {
  const env = merchant({ level: 40, mp: 80, max_mp: 80, real_x: 0, real_y: 0 });
  env.parent.entities.Jazwyn = {
    name: "Jazwyn", type: "character", rip: false, real_x: 10, real_y: 0, map: "main"
  };
  env.mluck_near();
  assert.ok(env.log.skills.indexOf("mluck") >= 0);
});

test("hold() DMs every fighter with {hold:1}", async () => {
  const env = merchant();
  env.hold();
  const names = env.log.cm.map((c) => c.name).sort();
  assert.deepStrictEqual(names, ["Jazwyn", "Sarene", "Zarook"]);
  assert.ok(env.log.cm.every((c) => c.data && c.data.hold === 1));
  assert.ok(env.log.pm && env.log.pm.length === 3);
  assert.ok(env.log.pm.every((p) => p.message === "hold:1"));
  assert.strictEqual(env.lastMessage, "Hold");
});

test("resume() DMs every fighter with {hold:0}", async () => {
  const env = merchant();
  env.resume();
  assert.strictEqual(env.log.cm.length, 3);
  assert.ok(env.log.cm.every((c) => c.data && c.data.hold === 0));
  assert.ok(env.log.pm.every((p) => p.message === "hold:0"));
  assert.strictEqual(env.lastMessage, "Stand");
});

test("merchant hops to Americas II when elsewhere", async () => {
  const env = merchant({ _server: ["US", "III"] });
  await env.logistics();
  assert.deepStrictEqual(env.log.server, [["US", "II"]]);
  assert.ok(!env.log.merchant.some((m) => m.open != null));
});

test("send_gold fails out of range (AL 400 dist)", () => {
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", gold: 5000, real_x: 0, real_y: 0, map: "main"
  });
  env.parent.entities.puppygirl = {
    name: "puppygirl", type: "character", rip: false, real_x: 500, real_y: 0, map: "main"
  };
  env.send_gold("puppygirl", 4000);
  assert.deepStrictEqual(env.log.gold, []);
  assert.ok(env.log.sendFail.some((f) => f.kind === "gold" && f.reason === "distance"));
  assert.strictEqual(env.character.gold, 5000);
  env.offload();
  assert.deepStrictEqual(env.log.gold, []);
});

test("send_gold fails when merchant is on another map", () => {
  const env = loadScript("mage.js", {
    name: "Sarene", ctype: "mage", gold: 5000, real_x: 0, real_y: 0, map: "main"
  });
  env.parent.entities.puppygirl = {
    name: "puppygirl", type: "character", rip: false, real_x: 10, real_y: 0, map: "cave"
  };
  env.offload();
  assert.deepStrictEqual(env.log.gold, []);
  assert.ok(env.log.sendFail.some((f) => f.reason === "map"));
});

test("send_item fails when receiver has no space", () => {
  const env = loadScript("priest.js", {
    name: "Zarook", ctype: "priest", real_x: 0, real_y: 0
  });
  env.character.items[0] = { name: "helmet", q: 1 };
  env.parent.entities.puppygirl = {
    name: "puppygirl", type: "character", rip: false, real_x: 10, real_y: 0, esize: 0
  };
  env.send_item("puppygirl", 0, 1);
  assert.deepStrictEqual(env.log.sent, []);
  assert.ok(env.log.sendFail.some((f) => f.reason === "no_space"));
});

test("bank_store refused outside the bank map", () => {
  const env = loadScript("warrior.js", { name: "Jazwyn", ctype: "warrior", map: "main" });
  env.character.items[1] = { name: "helmet", q: 1 };
  env.bank_store(1);
  assert.deepStrictEqual(env.log.stored, []);
  assert.ok(env.log.bankFail.some((f) => f.reason === "not_bank"));
  env.bank_dump();
  assert.deepStrictEqual(env.log.stored, []);
});

test("send_gold fails when merchant is not in vision", () => {
  const env = loadScript("warrior.js", { name: "Jazwyn", ctype: "warrior", gold: 5000, map: "main" });
  env.offload();
  assert.deepStrictEqual(env.log.gold, []);
  env.send_gold("puppygirl", 4000);
  assert.ok(env.log.sendFail.some((f) => f.reason === "no_target"));
  assert.strictEqual(env.character.gold, 5000);
});

module.exports = { tests };
