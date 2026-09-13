"use strict";

/**
 * Tracktrix stays on Jazwyn; Puppygirl idle exchanges gem0 / anniversarygift with Xyn.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { isKeep } = require("../src/gear");
const { KEEP_ALWAYS, EXCHANGE_ITEMS } = require("../src/constants");

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

test("constants: KEEP_ALWAYS includes tracker; EXCHANGE_ITEMS are Xyn targets", () => {
  assert.ok(KEEP_ALWAYS.indexOf("tracker") >= 0);
  assert.ok(KEEP_ALWAYS.indexOf("stand0") >= 0);
  assert.ok(KEEP_ALWAYS.indexOf("pickaxe") >= 0);
  assert.ok(KEEP_ALWAYS.indexOf("rod") >= 0);
  for (const name of ["anniversarygift", "gem0", "gift0", "armorbox", "weaponbox", "jewellerybox"]) {
    assert.ok(EXCHANGE_ITEMS.indexOf(name) >= 0, name);
  }
});

test("adversary: idle merchant exchanges stacked armor boxes one at a time", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = null;
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "armorbox", q: 4 };
  c.esize = c.items.filter((x) => !x).length;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c._bank = { gold: 0, items0: new Array(42).fill(null) };

  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "xyn:exchange armorbox")) break;
  }

  assert.ok(api.log.game.some((g) => g.m === "xyn:exchange armorbox"));
  const boxes = c.items.find((x) => x && x.name === "armorbox");
  assert.ok(boxes && boxes.q === 3, "one box consumed from stack");
});

test("adversary: stacked exchanges stop before consuming the logistics reserve", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = { name: "tracker" };
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "anniversarygift", q: 25 };
  c.items[4] = null;
  c.esize = 1;
  c._bank = { gold: 0, items0: new Array(42).fill({ name: "tracker" }) };

  for (let i = 0; i < 80; i++) await p.tickAll();

  assert.ok(!api.log.game.some((g) => g.m === "xyn:exchange anniversarygift"));
  assert.ok(api.log.game.some((g) => g.m === "xyn:capacity_hold anniversarygift"));
  assert.strictEqual(c.esize, 1, "exchange preserves one emergency bag slot");
});

test("adversary: bank pressure does not block gifts and emeralds with output space", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = { name: "tracker" };
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "anniversarygift", q: 66 };
  c.items[4] = { name: "gem0", q: 1 };
  for (let i = 5; i < 11; i++) c.items[i] = null;
  c.esize = 6;
  c._bank = { gold: 0, items0: new Array(42).fill({ name: "tracker" }) };

  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "xyn:exchange anniversarygift")) break;
  }

  const exchanges = api.log.game.filter((g) => /^xyn:exchange /.test(g.m)).map((g) => g.m);
  assert.strictEqual(exchanges[0], "xyn:exchange gem0", "slot-freeing emerald should go first");
  assert.ok(exchanges.includes("xyn:exchange anniversarygift"), "stacked gifts should drain despite full bank");
  const gifts = c.items.find((x) => x && x.name === "anniversarygift");
  assert.ok(gifts && gifts.q < 66, "at least one anniversary gift was consumed");
});

test("adversary: full bag exchanges emerald before sacrificing materials", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = { name: "tracker" };
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "anniversarygift", q: 66 };
  c.items[4] = { name: "gem0", q: 1 };
  c.items[5] = { name: "bwing", q: 57 };
  c.esize = 0;
  c._bank = { gold: 0, items0: new Array(42).fill({ name: "tracker" }) };

  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "xyn:exchange gem0")) break;
  }

  assert.ok(api.log.game.some((g) => g.m === "xyn:exchange gem0"), "emerald should exchange");
  assert.ok(
    !api.log.game.some((g) => g.m === "bank:material_sacrifice bwing"),
    "slot-freeing exchange should run before destructive cleanup"
  );
  assert.ok(!c.items.some((x) => x && x.name === "gem0"), "emerald was consumed");
});

test("adversary: Xyn inputs outrank vendor and compound backlog", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = null;
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "gem0", q: 1 };
  c.items[4] = { name: "frogt", q: 1 };
  c.items[5] = { name: "ringsj", level: 0 };
  c.items[6] = { name: "ringsj", level: 0 };
  c.items[7] = { name: "ringsj", level: 0 };
  c.items[8] = { name: "cscroll0", q: 1 };
  c.esize = c.items.filter((x) => !x).length;
  c._bank = { gold: 0, items0: new Array(42).fill(null) };

  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "xyn:exchange gem0")) break;
  }

  const economy = api.log.game
    .map((g) => g.m)
    .filter((m) => /^xyn:exchange |^vendor:sell |^bank:compound /.test(m));
  assert.strictEqual(
    economy[0],
    "xyn:exchange gem0",
    "Xyn input should be handled before other backlog: " + economy.join(" | ")
  );
});

test("adversary: full bag and full stand sacrifice a safe stack instead of looping on Xyn", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = { name: "tracker" };
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "anniversarygift", q: 25 };
  c.items[4] = { name: "cake", q: 1 };
  c.esize = 0;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c._bank = { gold: 0, items0: new Array(42).fill({ name: "tracker" }) };
  c.stand = true;
  for (let i = 1; i <= 16; i++) {
    c.slots["trade" + i] = { name: "helmet1", level: 0, price: 38400 };
  }

  for (let i = 0; i < 160; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "bank:material_sacrifice cake")) break;
  }

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((g) => g === "bank:material_sacrifice cake"),
    "full stand must not trap cleanup behind repeated Xyn holds"
  );
  assert.ok(c.esize >= 1, "emergency sale opens a working inventory slot");
  assert.ok(!c.stand, "recovery closes the saturated stand before moving");
});

test("adversary: full bag lists surplus but defers stacked exchange while vault is full", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = { name: "cake", q: 1 };
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "armorbox", q: 4 };
  c.items[4] = { name: "t2bow", level: 0 };
  c.esize = 0;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = 800;
  c._bank = { gold: 0, items0: new Array(42).fill({ name: "cake", q: 1 }) };
  c._bank.items0[0] = { name: "dagger", level: 0 };
  api._injectSmartFail("fail");

  for (let i = 0; i < 300; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "xyn:capacity_hold armorbox")) break;
  }

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => m === "xyn:capacity_hold armorbox"), "full stacked exchange is deferred");
  assert.ok(msgs.some((m) => /^stall:list t2bow@0/.test(m)), "bag item wins over earlier bank candidate");
  assert.ok(!msgs.some((m) => m === "xyn:exchange armorbox"), "one bag slot is not enough reserve");
});

test("adversary: Jazwyn keeps Tracktrix — does not toss to merchant", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 50,
    gold: 200000,
    members: ["Jazwyn", "Puppygirl"],
  });
  const jApi = p.bots.Jazwyn.api;
  const mApi = p.bots.Puppygirl.api;
  const j = jApi.character;
  const m = mApi.character;

  // Co-locate so toss is in range.
  j.map = m.map = "main";
  j.real_x = j.x = 40;
  j.real_y = j.y = -20;
  m.real_x = m.x = 45;
  m.real_y = m.y = -20;
  m.stand = false;

  putBag(j, { name: "tracker", q: 1 });
  putBag(j, { name: "frogt", q: 1 });

  assert.ok(isKeep(jApi, { name: "tracker" }, jApi.G, {}), "tracker is keep");

  let tossedFrogt = false;
  for (let n = 0; n < 80; n++) {
    await p.tickAll();
    const stillTracker = j.items.some((x) => x && x.name === "tracker");
    assert.ok(stillTracker, "Tracktrix must stay on Jazwyn after tick " + n);
    if (jApi.log.game.some((g) => g.m === "toss frogt@0")) tossedFrogt = true;
    if (tossedFrogt) break;
  }

  assert.ok(
    j.items.some((x) => x && x.name === "tracker"),
    "Tracktrix still on Jazwyn"
  );
  assert.ok(
    !m.items.some((x) => x && x.name === "tracker"),
    "merchant must not receive Tracktrix"
  );
});

test("adversary: idle merchant exchanges gem0 from bag with Xyn", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const mApi = p.bots.Puppygirl.api;
  const m = mApi.character;
  m.gold = 500000;
  // Clear non-essentials so idle goes to exchange (no upgrade/combine noise).
  for (let i = 0; i < m.items.length; i++) {
    const it = m.items[i];
    if (it && (it.name === "stand0" || /^hpot|^mpot|^scroll/.test(it.name))) continue;
    if (it) {
      m.items[i] = null;
      m.esize = (m.esize || 0) + 1;
    }
  }
  putBag(m, { name: "gem0", q: 1 });
  m._bank = { gold: 0, items0: [null, null, null] };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;

  let done = false;
  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "xyn:exchange gem0")) {
      done = true;
      break;
    }
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(done, "must exchange gem0, logs=" + msgs.filter((x) => /^xyn:|^exchange/.test(x)).join(" | "));
  assert.ok(!m.items.some((x) => x && x.name === "gem0"), "gem0 consumed");
  assert.ok(mApi.log.exchanged.some((e) => e.name === "gem0"), "sim log.exchanged");
  assert.ok(Math.abs(m.real_x - (-25)) < 50 && Math.abs(m.real_y - (-478)) < 50, "near Xyn");
});

test("adversary: idle merchant pulls anniversarygift from bank then exchanges", async () => {
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
    items0: [{ name: "anniversarygift", q: 1 }, null, null],
  };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;

  let done = false;
  for (let i = 0; i < 300; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "xyn:exchange anniversarygift")) {
      done = true;
      break;
    }
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(
    done,
    "must exchange anniversarygift, logs=" + msgs.filter((x) => /^xyn:|^bank_retrieve|^exchange/.test(x)).join(" | ")
  );
  assert.ok(!m.items.some((x) => x && x.name === "anniversarygift"), "gift consumed");
  const bank = m.bank || m._bank;
  const stillInBank =
    bank &&
    Object.keys(bank).some((p) => {
      if (p === "gold" || !Array.isArray(bank[p])) return false;
      return bank[p].some((x) => x && x.name === "anniversarygift");
    });
  assert.ok(!stillInBank, "gift not left in bank");
  assert.ok(mApi.log.exchanged.some((e) => e.name === "anniversarygift"));
});

module.exports = { tests };
