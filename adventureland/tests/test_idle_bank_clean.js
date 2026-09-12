"use strict";

/**
 * Idle merchant should compound bank triples + NPC-vendor whitelist junk (bank clean).
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function countNameLevel(bags, name, level) {
  let n = 0;
  for (const bag of bags) {
    if (!Array.isArray(bag)) continue;
    for (const it of bag) {
      if (it && it.name === name && (it.level || 0) === level) n++;
    }
  }
  return n;
}

test("adversary: idle merchant compounds bank ringsj triple", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const mApi = p.bots.Puppygirl.api;
  const m = mApi.character;
  m.gold = 500000;
  for (let i = 0; i < m.items.length; i++) {
    const it = m.items[i];
    if (it && (it.name === "stand0" || /^hpot|^mpot|^scroll/.test(it.name))) continue;
    if (it) {
      m.items[i] = null;
      m.esize = (m.esize || 0) + 1;
    }
  }
  m._bank = {
    gold: 0,
    items0: [
      { name: "ringsj", level: 0 },
      { name: "ringsj", level: 0 },
      { name: "ringsj", level: 0 },
      { name: "frogt" },
      null,
      null,
    ],
  };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;

  let compounded = false;
  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => /^bank:compound ringsj@0/.test(g.m))) {
      compounded = true;
      break;
    }
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(compounded, "must compound, logs=" + msgs.filter((x) => /^bank:/.test(x)).join(" | "));
  const bags = [m.items];
  if (m.bank) {
    for (const k of Object.keys(m.bank)) if (k !== "gold" && Array.isArray(m.bank[k])) bags.push(m.bank[k]);
  }
  if (m._bank) {
    for (const k of Object.keys(m._bank)) if (k !== "gold" && Array.isArray(m._bank[k])) bags.push(m._bank[k]);
  }
  assert.ok(countNameLevel(bags, "ringsj", 1) >= 1, "should have ringsj@1 after compound");
  assert.ok(countNameLevel(bags, "ringsj", 0) <= 0, "no leftover @0 triple");
});

test("adversary: full merchant sacrifices one excess input to unlock local compounding", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const mApi = p.bots.Puppygirl.api;
  const m = mApi.character;
  m.gold = 500000;
  for (let i = 0; i < m.items.length; i++) m.items[i] = { name: "cake", q: 1 };
  for (let i = 0; i < 3; i++) m.items[i] = { name: "hpbelt", level: 0 };
  for (let i = 3; i < 7; i++) m.items[i] = { name: "wbook0", level: 0 };
  m.esize = 0;
  m._bank = { gold: 0, items0: new Array(42).fill({ name: "cake", q: 1 }) };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;

  for (let i = 0; i < 250; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "bank:compound hpbelt@0")) break;
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(msgs.some((x) => x === "bank:compound_sacrifice wbook0@0"), "sells a remainder, not a triple");
  assert.ok(msgs.some((x) => x === "bank:compound hpbelt@0"), "local triple compounds after buying a scroll");
  assert.strictEqual(countNameLevel([m.items], "wbook0", 0), 3, "preserves a complete wbook triple");
  assert.ok((m.esize || 0) >= 2, "compound creates durable recovery capacity");
});

test("adversary: bank compound work is withdrawn and scrolled as one bounded batch", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const m = api.character;
  for (let i = 0; i < m.items.length; i++) {
    if (m.items[i] && ["stand0", "hpot1", "mpot1"].indexOf(m.items[i].name) >= 0) continue;
    if (m.items[i]) {
      m.items[i] = null;
      m.esize++;
    }
  }
  m._bank = { gold: 0, items0: new Array(42).fill(null) };
  for (let i = 0; i < 9; i++) m._bank.items0[i] = { name: "ringsj", level: 0 };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;

  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "bank:compound ringsj@0")) break;
  }

  assert.strictEqual(api.log.retrieved.filter((x) => x.name === "ringsj").length, 9);
  const scroll = m.items.find((x) => x && x.name === "cscroll0");
  assert.ok(scroll && scroll.q === 2, "buys all three batch scrolls before the first compound");
  assert.ok((m.esize || 0) >= 4, "batch withdrawal preserves logistics reserve");
});

test("adversary: bank upgrade work is withdrawn and scrolled as one bounded batch", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const m = api.character;
  for (let i = 0; i < m.items.length; i++) {
    if (m.items[i] && ["stand0", "hpot1", "mpot1"].indexOf(m.items[i].name) >= 0) continue;
    if (m.items[i]) {
      m.items[i] = null;
      m.esize++;
    }
  }
  m._bank = { gold: 0, items0: new Array(42).fill(null) };
  for (let i = 0; i < 3; i++) m._bank.items0[i] = { name: "gloves", level: 0 };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;

  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => /^gear:upgrade gloves@0/.test(g.m))) break;
  }

  assert.strictEqual(api.log.retrieved.filter((x) => x.name === "gloves").length, 3);
  const scroll = m.items.find((x) => x && x.name === "scroll0");
  assert.ok(scroll && scroll.q >= 2, "buys the upgrade batch scrolls together");
  assert.ok((m.esize || 0) >= 4, "batch withdrawal preserves logistics reserve");
});

test("adversary: idle merchant NPC-vendors bank whitelist junk", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const mApi = p.bots.Puppygirl.api;
  const m = mApi.character;
  m.gold = 500000;
  for (let i = 0; i < m.items.length; i++) {
    const it = m.items[i];
    if (it && it.name === "stand0") continue;
    if (it && /^hpot|^mpot/.test(it.name)) continue;
    if (it) {
      m.items[i] = null;
      m.esize = (m.esize || 0) + 1;
    }
  }
  if (!m.items.some((it) => it && it.name === "stand0")) {
    const slot = m.items.findIndex((x) => !x);
    m.items[slot] = { name: "stand0" };
    m.esize = Math.max(0, (m.esize || 1) - 1);
  }
  m._bank = {
    gold: 0,
    items0: [{ name: "frogt" }, { name: "leatherboots", level: 0 }, null],
  };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;

  for (let i = 0; i < 250; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => /^vendor:sell /.test(g.m) || /^vendor:pull /.test(g.m))) break;
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((x) => /^vendor:sell /.test(x) || /^vendor:pull /.test(x)),
    "must pull/vendor bank junk, logs=" + msgs.filter((x) => /^vendor:|^bank:/.test(x)).join(" | ")
  );
});

module.exports = { tests };
