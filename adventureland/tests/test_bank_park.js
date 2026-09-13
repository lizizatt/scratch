"use strict";

const assert = require("assert");
const { bootParty } = require("../src/boot_party");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

/** Mirrors createAlApi bank_store pack-fallback (Mainframe bare call → invalid). */
async function smartStore(api, rawStore, i, pack, pack_num) {
  if (pack) return rawStore(i, pack, pack_num == null ? -1 : pack_num);
  const bank = api.character.bank;
  if (bank) {
    const packs = Object.keys(bank).filter((p) => p !== "gold" && Array.isArray(bank[p]));
    for (const p of packs) {
      if (!bank[p].some((x) => !x)) continue;
      const r = await rawStore(i, p, -1);
      if (!(r && r.failed)) return r;
    }
  }
  return rawStore(i);
}

test("bank_store pack fallback succeeds when bare call returns invalid", async () => {
  const p = bootParty({ pack: "armadillo", pots: 50 });
  const api = p.bots.Puppygirl.api;
  api.character.map = "bank";
  api.character.bank = {
    gold: 0,
    items0: new Array(42).fill(null),
    items1: new Array(42).fill(null),
  };
  api.character.items[5] = { name: "wshoes", level: 0 };
  api.character.esize = api.character.items.filter((x) => !x).length;

  const real = api.bank_store.bind(api);
  async function rawStore(i, pack, pack_num) {
    if (pack == null) return { failed: true, reason: "invalid" };
    return real(i, pack, pack_num);
  }

  const r = await smartStore(api, rawStore, 5);
  assert.ok(!(r && r.failed), "expected store success via explicit pack");
  assert.strictEqual(api.character.items[5], null);
  assert.ok(api.character.bank.items0.some((x) => x && x.name === "wshoes"));
});

test("merchant park stores parkables without logging bank:full when slots free", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.map = "bank";
  api.character.x = 0;
  api.character.y = -37;
  api.character.bank = api.character._bank = {
    gold: 1000,
    items0: new Array(42).fill(null),
    items1: new Array(42).fill(null),
  };
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "hpot1", q: 50 };
  bag[1] = { name: "stand0" };
  bag[2] = { name: "basher", level: 0 };
  bag[3] = { name: "blade", level: 0 };
  bag[4] = { name: "rattail", q: 17 };
  bag[5] = { name: "seashell", q: 83 };
  bag[6] = { name: "monstertoken", q: 61 };
  bag[7] = { name: "tracker" };
  bag[8] = { name: "scroll0", q: 11 };
  bag[9] = { name: "cscroll1", q: 8 };
  bag[10] = { name: "anniversarygift", q: 4 };
  api.character.esize = bag.filter((x) => !x).length;

  const real = api.bank_store.bind(api);
  api.bank_store = async (i, pack, pack_num) =>
    smartStore(
      api,
      async (ii, pp, pn) => {
        if (pp == null) return { failed: true, reason: "invalid" };
        return real(ii, pp, pn);
      },
      i,
      pack,
      pack_num
    );

  for (let n = 0; n < 30; n++) await p.tickAll();

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => m === "bank:store basher@0"), "basher should be parked");
  assert.ok(msgs.some((m) => m === "bank:store blade@0"), "blade should be parked");
  assert.ok(msgs.some((m) => m === "bank:store rattail@0"), "passive materials should be parked");
  assert.ok(msgs.some((m) => m === "bank:store seashell@0"), "event materials should be parked");
  assert.ok(msgs.some((m) => m === "bank:store monstertoken@0"), "reserve currency should be parked");
  for (const name of ["tracker", "scroll0", "cscroll1"]) {
    assert.ok(api.character.items.some((it) => it && it.name === name), name + " remains operational");
  }
  assert.ok(
    !msgs.some((m) => m === "bank:store anniversarygift@0"),
    "exchange inputs must be consumed or kept out of the bank"
  );
  const flat = JSON.stringify(api.log.game || []);
  assert.ok(!/\bbank:full\b/.test(flat), "must not claim bank:full when free slots exist");
});

module.exports = { tests };

if (require.main === module) {
  (async () => {
    for (const t of tests) {
      await t.fn();
      console.log("ok", t.name);
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
