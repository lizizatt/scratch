"use strict";

/**
 * Adversarial: solo merchant bank-linger (live 2026-09-09).
 * openStall used stale _bank indices, retrieve missed, left character on bank.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function bankLingerScore(samples) {
  // Fraction of samples on bank with no stall/progress — used to verify the verifier.
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
  // Hint says wshoes at items0[0]; live bank after mount will put it at [10] instead.
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
      // Diverge live bank from _bank snapshot (Mainframe remount reshuffle / race).
      api.character.bank = {
        gold: 1000,
        items0: (() => {
          const a = new Array(42).fill(null);
          a[10] = { name: "wshoes", level: 0 };
          return a;
        })(),
        items1: new Array(42).fill(null),
      };
      // Keep stale _bank pointing at index 0 (empty on live).
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
    msgs.some((m) => /^stall:open/.test(m) || /^stall:pull/.test(m)),
    "expected stall progress, logs=" + msgs.filter((m) => /stall:|bank:/.test(m)).join(" | ")
  );
  assert.ok(api.character.map === "main", "must leave bank after stall pull, map=" + api.character.map);
  assert.ok(linger < 0.5, "verifier: late samples must not be mostly bank-linger, linger=" + linger.toFixed(2));
  assert.ok(api.character.stand || msgs.some((m) => /^stall:open/.test(m)), "stand should open");
});

test("adversary: false _bank junk hint must exit bank (no silent linger)", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.map = "main";
  api.character.bank = null;
  // _bank claims wshoes exists; live bank has none.
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
  bag[0] = { name: "hpot0", q: 50 };
  bag[1] = { name: "stand0" };
  api.character.esize = bag.filter((x) => !x).length;

  const realMove = api.smart_move.bind(api);
  api.smart_move = async (dest) => {
    const r = await realMove(dest);
    if (api.character.map === "bank") {
      api.character.bank = { gold: 0, items0: new Array(42).fill(null), items1: new Array(42).fill(null) };
    }
    return r;
  };

  for (let n = 0; n < 50; n++) await p.tickAll();

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => m === "stall:no_junk_live"), "expected stale-hint detection");
  assert.strictEqual(api.character.map, "main", "must not remain on bank after empty live scan");
});

test("adversary: live-blind main (no _bank) must prime then stall vault junk", async () => {
  // Mainframe never keeps character.bank on main; V2 must snapshot after a visit.
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.gold = 500000;
  api.character.map = "main";
  api.character.x = 56;
  api.character.y = -122;
  api.character.bank = null;
  api.character._bank = null; // live boot condition
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "hpot0", q: 200 };
  bag[1] = { name: "mpot0", q: 200 };
  bag[2] = { name: "stand0" };
  bag[3] = { name: "scroll0", q: 20 };
  api.character.esize = bag.filter((x) => !x).length;

  const realMove = api.smart_move.bind(api);
  api.smart_move = async (dest) => {
    const r = await realMove(dest);
    if (api.character.map === "bank") {
      // Account vault contents (only visible while mounted).
      api.character.bank = {
        gold: 1000,
        items0: (() => {
          const a = new Array(42).fill(null);
          a[3] = { name: "wshoes", level: 0 };
          a[4] = { name: "rednose", level: 0 };
          return a;
        })(),
        items1: new Array(42).fill(null),
      };
    }
    return r;
  };

  for (let n = 0; n < 100; n++) await p.tickAll();

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => m === "bank:prime" || /^bank:prime_ok/.test(m)), "expected bank prime");
  assert.ok(msgs.some((m) => /^stall:open/.test(m)), "expected stall after prime, logs=" + msgs.filter((m) => /bank:|stall:/.test(m)).join(" | "));
  assert.strictEqual(api.character.map, "main");
  assert.ok(api.character._bank, "_bank snapshot must exist after prime");
});

test("adversary: after stall open, must not re-bank listed sell junk / linger", async () => {
  // Live 2026-09-09: wrong trade(i,price) left item in bag → park re-banked → bank linger.
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.gold = 500000;
  api.character.map = "main";
  api.character.x = 56;
  api.character.y = -122;
  api.character.bank = null;
  api.character._bank = {
    gold: 1000,
    items0: (() => {
      const a = new Array(42).fill(null);
      a[2] = { name: "dexamulet", level: 0 };
      a[3] = { name: "wshoes", level: 0 };
      return a;
    })(),
    items1: new Array(42).fill(null),
  };
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "hpot0", q: 200 };
  bag[1] = { name: "mpot0", q: 200 };
  bag[2] = { name: "stand0" };
  bag[3] = { name: "scroll0", q: 20 };
  api.character.esize = bag.filter((x) => !x).length;

  const realMove = api.smart_move.bind(api);
  api.smart_move = async (dest) => {
    const r = await realMove(dest);
    if (api.character.map === "bank") {
      api.character.bank = JSON.parse(JSON.stringify(api.character._bank));
    } else {
      api.character.bank = null;
    }
    return r;
  };

  const samples = [];
  for (let n = 0; n < 120; n++) {
    await p.tickAll();
    samples.push({ map: api.character.map });
  }

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => /^stall:open/.test(m)), "stall must open with 4-arg trade");
  assert.ok(msgs.some((m) => /^stall:list /.test(m)), "must list into trade slot");
  assert.ok(
    !msgs.some((m) => /^bank:store dexamulet/.test(m)),
    "must not re-bank stall listing, logs=" + msgs.filter((m) => /bank:store|stall:/.test(m)).join(" | ")
  );
  const late = samples.slice(-40);
  assert.ok(bankLingerScore(late) < 0.5, "must not linger on bank after stall");
  assert.strictEqual(api.character.map, "main");
  assert.ok(api.character.stand, "stand must stay open");
  assert.ok(api.character.slots.trade1 || api.character.slots.trade2, "trade slot filled");
});

test("adversary: must not close stand by priming after stall open", async () => {
  // Live 2026-09-09 02:40: stall:open then bank:prime (ensureAtBank closes stand).
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.gold = 500000;
  api.character.map = "main";
  api.character.x = 40;
  api.character.y = -20;
  api.character.bank = null;
  api.character._bank = null;
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "hpot0", q: 100 };
  bag[1] = { name: "stand0" };
  bag[2] = { name: "dexamulet", level: 0 };
  bag[3] = { name: "scroll0", q: 10 };
  api.character.esize = bag.filter((x) => !x).length;

  const realMove = api.smart_move.bind(api);
  api.smart_move = async (dest) => {
    const r = await realMove(dest);
    if (api.character.map === "bank") {
      api.character.bank = {
        gold: 0,
        items0: (() => {
          const a = new Array(42).fill(null);
          a[0] = { name: "wshoes", level: 0 };
          return a;
        })(),
        items1: new Array(42).fill(null),
      };
    } else {
      api.character.bank = null;
    }
    return r;
  };

  for (let n = 0; n < 80; n++) await p.tickAll();

  const msgs = api.log.game.map((g) => g.m);
  const iPrime = msgs.findIndex((m) => m === "bank:prime" || /^bank:prime_ok/.test(m));
  const iOpen = msgs.findIndex((m) => /^stall:open/.test(m));
  assert.ok(iOpen >= 0, "stall must open");
  if (iPrime >= 0) assert.ok(iPrime < iOpen, "prime must precede stall open");
  assert.ok(api.character.stand, "stand must remain open after prime+stall");
  assert.ok(api.character.slots.trade1 || api.character.slots.trade2, "listing must remain");
});

test("adversary: 2-arg trade(i,price) must not silently pass (official is 4-arg)", async () => {
  const p = bootParty({ pack: "armadillo", pots: 50, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.stand = true;
  api.character.items[5] = { name: "wshoes", level: 0 };
  const r = api.trade(5, 100);
  assert.ok(r && r.failed && r.reason === "bad_args", "2-arg trade must fail");
  assert.ok(api.character.items[5], "item stays in bag on bad trade");
});

test("verifier: stall progress alone is not enough if late linger on bank", () => {
  const lines = ["bank:prime", "stall:open junk=10", "bank:store dexamulet@0"];
  const stallOk = lines.some((m) => /stall:|bank:prime/.test(m));
  const late = [];
  for (let i = 0; i < 20; i++) late.push({ map: "bank" });
  const linger = bankLingerScore(late);
  const pass = linger < 0.5 && stallOk && late[late.length - 1].map === "main";
  assert.ok(stallOk);
  assert.ok(linger > 0.9);
  assert.ok(!pass, "must fail when last samples are bank-linger despite early stall logs");
});

module.exports = { tests, bankLingerScore };

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
