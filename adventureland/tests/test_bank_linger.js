"use strict";

/**
 * Adversarial: solo merchant must not linger on bank while vendoring junk.
 * (Formerly stall-linger; now NPC vendor reclaim/pull.)
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function bankLingerScore(samples) {
  let bank = 0;
  for (const s of samples) if (s.map === "bank") bank++;
  return samples.length ? bank / samples.length : 0;
}

test("adversary: stale _bank sell index must not trap merchant on bank", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.gold = 500000;
  api.character.map = "main";
  api.character.x = 0;
  api.character.y = 0;
  api.character.bank = null;
  api.character._bank = {
    gold: 1000,
    items0: (() => {
      const a = new Array(42).fill(null);
      a[0] = { name: "wshoes", level: 0 };
      return a;
    })(),
    items1: new Array(42).fill(null),
  };
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "hpot0", q: 100 };
  bag[1] = { name: "mpot0", q: 100 };
  bag[2] = { name: "stand0" };
  bag[3] = { name: "scroll0", q: 10 };
  bag[4] = { name: "ascale", q: 1 };
  bag[5] = { name: "anniversarygift", q: 1 };
  api.character.esize = bag.filter((x) => !x).length;

  const realMove = api.smart_move.bind(api);
  api.smart_move = async (dest) => {
    const r = await realMove(dest);
    if (api.character.map === "bank") {
      api.character.bank = {
        gold: 1000,
        items0: (() => {
          const a = new Array(42).fill(null);
          a[10] = { name: "wshoes", level: 0 };
          return a;
        })(),
        items1: new Array(42).fill(null),
      };
    }
    return r;
  };

  const samples = [];
  for (let n = 0; n < 80; n++) {
    await p.tickAll();
    samples.push({ map: api.character.map, t: p.world.clock.now() });
  }

  const msgs = api.log.game.map((g) => g.m);
  const linger = bankLingerScore(samples.slice(-40));
  assert.ok(
    msgs.some((m) => /^vendor:sell /.test(m) || /^vendor:pull /.test(m)),
    "expected vendor progress, logs=" + msgs.filter((m) => /vendor:|bank:/.test(m)).join(" | ")
  );
  assert.ok(api.character.map === "main", "must leave bank after vendor pull, map=" + api.character.map);
  assert.ok(linger < 0.5, "verifier: late samples must not be mostly bank-linger, linger=" + linger.toFixed(2));
});

test("adversary: false _bank junk hint must exit bank (no silent linger)", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.map = "main";
  api.character.bank = null;
  api.character._bank = {
    gold: 0,
    items0: (() => {
      const a = new Array(42).fill(null);
      a[0] = { name: "wshoes", level: 0 };
      return a;
    })(),
  };
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "stand0" };
  bag[1] = { name: "hpot0", q: 50 };
  bag[2] = { name: "mpot0", q: 50 };
  api.character.esize = bag.filter((x) => !x).length;

  const realMove = api.smart_move.bind(api);
  api.smart_move = async (dest) => {
    const r = await realMove(dest);
    if (api.character.map === "bank") {
      api.character.bank = { gold: 0, items0: new Array(42).fill(null) };
    }
    return r;
  };

  for (let n = 0; n < 60; n++) await p.tickAll();
  const msgs = api.log.game.map((g) => g.m);
  assert.ok(api.character.map === "main", "must exit bank when live has no junk");
  assert.ok(
    msgs.some((m) => m === "vendor:no_junk_live" || m === "vendor:retrieve_fail"),
    "expected no_junk_live, logs=" + msgs.filter((m) => /vendor:|stall:|bank:/.test(m)).join(" | ")
  );
});

test("adversary: live-blind main (no _bank) must prime then vendor vault junk", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.gold = 500000;
  api.character.map = "main";
  api.character.real_x = api.character.x = 40;
  api.character.real_y = api.character.y = -20;
  api.character.bank = null;
  api.character._bank = null;
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "stand0" };
  bag[1] = { name: "hpot0", q: 80 };
  bag[2] = { name: "mpot0", q: 80 };
  api.character.esize = bag.filter((x) => !x).length;

  const realMove = api.smart_move.bind(api);
  api.smart_move = async (dest) => {
    const r = await realMove(dest);
    if (api.character.map === "bank") {
      // Remount always shows vault junk (sim place() may pre-create empty bank).
      api.character.bank = {
        gold: 0,
        items0: (() => {
          const a = new Array(42).fill(null);
          a[0] = { name: "frogt" };
          a[1] = { name: "frogt" };
          return a;
        })(),
        items1: new Array(42).fill(null),
      };
    }
    return r;
  };

  for (let n = 0; n < 100; n++) await p.tickAll();
  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => /^bank:prime/.test(m)), "must prime bank hint");
  assert.ok(
    msgs.some((m) => /^vendor:sell /.test(m) || /^vendor:pull /.test(m)),
    "expected vendor after prime, logs=" + msgs.filter((m) => /bank:|vendor:/.test(m)).join(" | ")
  );
});

test("adversary: after vendor sell, must not re-bank listed sell junk / linger", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.gold = 500000;
  api.character.map = "main";
  api.character.real_x = api.character.x = 40;
  api.character.real_y = api.character.y = -20;
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "stand0" };
  bag[1] = { name: "frogt" };
  bag[2] = { name: "hpot0", q: 50 };
  bag[3] = { name: "mpot0", q: 50 };
  api.character.esize = bag.filter((x) => !x).length;
  api.character._bank = { gold: 0, items0: new Array(42).fill(null), items1: new Array(42).fill(null) };
  api.character.bank = api.character._bank;

  for (let n = 0; n < 80; n++) await p.tickAll();
  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => /^vendor:sell frogt/.test(m)), "must NPC-vendor frogt");
  assert.ok(!msgs.some((m) => /^bank:store frogt/.test(m)), "must not re-bank frogt after vendor path");
  assert.ok(api.character.map === "main", "stay on main");
});

test("adversary: must not close stand by priming after vendor reclaim", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.gold = 500000;
  api.character.map = "main";
  api.character.real_x = api.character.x = 40;
  api.character.real_y = api.character.y = -20;
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "stand0" };
  bag[1] = { name: "hpot0", q: 50 };
  bag[2] = { name: "mpot0", q: 50 };
  api.character.esize = bag.filter((x) => !x).length;
  api.character.stand = true;
  api.character.slots.trade1 = { name: "wcap", level: 0, price: 6400 };
  api.character._bank = { gold: 0, items0: new Array(42).fill(null) };

  for (let n = 0; n < 80; n++) await p.tickAll();
  const msgs = api.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((m) => /^vendor:reclaim wcap/.test(m) || /^vendor:sell wcap/.test(m)),
    "must reclaim/sell stall listing, logs=" + msgs.filter((m) => /vendor:|bank:/.test(m)).join(" | ")
  );
});

test("adversary: 2-arg trade(i,price) must not silently pass (official is 4-arg)", async () => {
  const p = bootParty({ pack: "armadillo", pots: 10, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.stand = true;
  api.character.items[5] = { name: "frogt", level: 0 };
  const r = await api.trade(5, 100);
  assert.ok(r && r.failed && r.reason === "bad_args", "2-arg trade must fail bad_args, got " + JSON.stringify(r));
});

test("verifier: stall progress alone is not enough if late linger on bank", () => {
  const lines = ["bank:prime", "vendor:sell frogt x1", "bank:store dexamulet@0"];
  const stallOk = lines.some((m) => /vendor:|stall:|bank:prime/.test(m));
  assert.ok(stallOk);
  const samples = [];
  for (let i = 0; i < 40; i++) samples.push({ map: i < 30 ? "bank" : "main" });
  assert.ok(bankLingerScore(samples) > 0.5);
});

module.exports = { tests };
