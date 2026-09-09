"use strict";

/**
 * Idle merchant should compound bank triples + sell whitelist junk (bank clean).
 * Previously only upgrade/stall ran — combine lived in one-shot code/bank_clean.js.
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
  // Empty bag of gear so idle goes to bank clean (no upgrade noise).
  for (let i = 0; i < m.items.length; i++) {
    const it = m.items[i];
    if (it && (it.name === "stand0" || /^hpot|^mpot|^scroll/.test(it.name))) continue;
    if (it) {
      m.items[i] = null;
      m.esize = (m.esize || 0) + 1;
    }
  }
  // Seed bank with compoundable triple + sell junk.
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
  // Start on main plaza so idleEcon primes then visits bank.
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
  // Three @0 → one @1 (sim always succeeds).
  assert.ok(countNameLevel(bags, "ringsj", 1) >= 1, "should have ringsj@1 after compound");
  assert.ok(countNameLevel(bags, "ringsj", 0) <= 0, "no leftover @0 triple");
});

test("adversary: idle merchant stalls/sells bank whitelist junk", async () => {
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
  // Ensure stand0 in bag for openStall.
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
    if (mApi.log.game.some((g) => /^stall:open/.test(g.m) || /^stall:pull/.test(g.m))) break;
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((x) => /^stall:open/.test(x) || /^stall:pull/.test(x) || /^stall:trade/.test(x)),
    "must pull/list bank junk, logs=" + msgs.filter((x) => /^stall:|^bank:/.test(x)).join(" | ")
  );
});

module.exports = { tests };
