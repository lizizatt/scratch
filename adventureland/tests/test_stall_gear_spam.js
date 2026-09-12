"use strict";

/**
 * Below-gate gear parks while NPC-vendoring junk; trade-slot tests kept for sim API.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { upgradeChance } = require("../src/gear");
const { MIN_UPGRADE_CHANCE } = require("../src/constants");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function advance(p, n) {
  return (async () => {
    for (let i = 0; i < n; i++) await p.tickAll();
  })();
}

test("adversary: below-gate gear must park while vendor sells — no upgrade_skip spam", async () => {
  assert.ok(upgradeChance({ level: 3 }) < MIN_UPGRADE_CHANCE);
  assert.ok(Math.abs(upgradeChance({ level: 3 }) - 0.76) < 0.001);

  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "stand0" };
  bag[1] = { name: "frogt", level: 0 };
  bag[2] = { name: "gloves", level: 3 };
  api.character.esize = bag.filter((x) => !x).length;
  api.character.gold = 500000;
  api.character.map = "main";
  api.character.real_x = api.character.x = 40;
  api.character.real_y = api.character.y = -20;
  api.character.bank = api.character._bank = {
    gold: 0,
    items0: new Array(42).fill(null),
    items1: new Array(42).fill(null),
  };

  await advance(p, 60);

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((m) => /^vendor:sell frogt/.test(m)),
    "must vendor frogt, got: " + msgs.filter((m) => /vendor:|bank:|gear:/.test(m)).join(" | ")
  );
  assert.ok(
    !api.character.items.some((x) => x && x.name === "gloves" && (x.level || 0) === 3),
    "below-gate gloves must be parked"
  );

  const t0 = p.world.clock.now();
  while (p.world.clock.now() - t0 < 240000) {
    await p.tickAll();
    p.world.clock.advance(15000);
  }

  const skips = api.log.game.filter((g) => /^gear:upgrade_skip/.test(g.m));
  assert.ok(
    skips.length <= 1,
    "upgrade_skip must not re-spam, got " + skips.length + ": " + skips.map((g) => g.m).join(",")
  );
});

test("adversary: reclaim ghost trade junk then NPC-vendor", async () => {
  const p = bootParty({ pack: "armadillo", pots: 50, gold: 100000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const bag = api.character.items;
  for (let i = 0; i < bag.length; i++) bag[i] = null;
  bag[0] = { name: "stand0" };
  bag[1] = { name: "hpot0", q: 20 };
  bag[2] = { name: "mpot0", q: 20 };
  api.character.esize = bag.filter((x) => !x).length;
  api.character.map = "main";
  api.character.real_x = api.character.x = 40;
  api.character.real_y = api.character.y = -20;
  api.character.stand = true;
  api.character.slots.trade1 = { name: "wcap", level: 0, price: 6400 };
  api.character.slots.trade2 = { name: "frogt", q: 1, price: 120 };
  api.character._bank = { gold: 0, items0: new Array(42).fill(null) };

  await advance(p, 80);

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((m) => /^vendor:reclaim /.test(m) || /^vendor:sell /.test(m)),
    "must reclaim/sell trade junk, logs=" + msgs.filter((m) => /vendor:/.test(m)).join(" | ")
  );
  assert.ok(!api.character.slots.trade1 || api.character.slots.trade1.name !== "wcap", "wcap reclaimed");
});

test("adversary: queued delivery must not flash-vendor before dlv:active", async () => {
  const p = bootParty({ pack: "armadillo", pots: 40, gold: 200000, members: ["Jazwyn", "Puppygirl"] });
  const mCtrl = p.bots.Puppygirl.ctrl;
  const mApi = p.bots.Puppygirl.api;
  mCtrl.enqueue({
    id: "flash_q",
    kind: "dlv_pots",
    who: "Jazwyn",
    items: [
      { name: "hpot1", q: 5 },
      { name: "mpot1", q: 5 },
    ],
  });
  let firstActive = null;
  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    firstActive = mApi.log.game.find((g) => /^dlv:active dlv_pots/.test(g.m));
    if (firstActive) break;
  }
  assert.ok(firstActive, "expected dlv:active");
  const flash = mApi.log.game.find((g) => g.t < firstActive.t && /^vendor:sell /.test(g.m));
  assert.ok(!flash, "vendor must not run before queued delivery starts");
});

test("adversary: occupied trade slot arg returns slot_occuppied (sim matches live spelling)", async () => {
  const p = bootParty({ pack: "armadillo", pots: 10, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  api.character.stand = true;
  api.character.slots.trade1 = { name: "rednose", price: 10, q: 1 };
  api.character.items[5] = { name: "frogt", level: 0 };
  const r = await api.trade(5, 1, 100, 1);
  assert.ok(r && r.failed && r.reason === "slot_occuppied", "expected slot_occuppied, got " + JSON.stringify(r));
});

test("adversary: stall lists only surplus fiery blades and spiked shields", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Jazwyn", "Puppygirl"] });
  const j = p.bots.Jazwyn.api.character;
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  j.slots.mainhand = { name: "fireblade", level: 1 };
  j.slots.offhand = { name: "sshield", level: 5 };
  for (let i = 0; i < c.items.length; i++) c.items[i] = null;
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "fireblade", level: 0 };
  c.items[4] = { name: "sshield", level: 2 };
  c.esize = c.items.filter((x) => !x).length;
  c.map = j.map = "main";
  c.real_x = c.x = j.real_x = j.x = 40;
  c.real_y = c.y = j.real_y = j.y = -20;
  c._bank = { gold: 0, items0: [{ name: "sshield", level: 2 }].concat(new Array(41).fill(null)) };

  for (let i = 0; i < 240; i++) {
    await p.tickAll();
    const listed = Object.values(c.slots).filter((x) => x && x.price);
    if (listed.some((x) => x.name === "fireblade") && listed.some((x) => x.name === "sshield")) break;
  }

  const listed = Object.values(c.slots).filter((x) => x && x.price);
  assert.strictEqual(listed.filter((x) => x.name === "fireblade").length, 1, "sell one spare blade");
  assert.strictEqual(listed.filter((x) => x.name === "sshield").length, 1, "keep two of three shields");
  assert.ok(listed.find((x) => x.name === "fireblade").price >= 115200);
  assert.ok(listed.find((x) => x.name === "sshield").price >= 200000);
  assert.strictEqual(j.slots.mainhand.name, "fireblade");
  assert.strictEqual(j.slots.offhand.name, "sshield");
});

test("adversary: stall sells the weakest surplus copy and ignores locked gear", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Jazwyn", "Puppygirl"] });
  const j = p.bots.Jazwyn.api.character;
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  j.slots.mainhand = { name: "fireblade", level: 1 };
  for (let i = 0; i < c.items.length; i++) c.items[i] = null;
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "fireblade", level: 5 };
  c.items[4] = { name: "fireblade", level: 4, l: "locked" };
  c.esize = c.items.filter((x) => !x).length;
  c.map = j.map = "main";
  c.real_x = c.x = j.real_x = j.x = 40;
  c.real_y = c.y = j.real_y = j.y = -20;
  c._bank = { gold: 0, items0: [{ name: "fireblade", level: 0 }].concat(new Array(41).fill(null)) };

  for (let i = 0; i < 240; i++) {
    await p.tickAll();
    if (Object.values(c.slots).some((x) => x && x.name === "fireblade" && x.price)) break;
  }

  const listed = Object.values(c.slots).find((x) => x && x.name === "fireblade" && x.price);
  assert.ok(listed, "a surplus blade must be listed");
  assert.strictEqual(listed.level || 0, 0, "weakest copy listed first");
  const held = c.items.concat(j.items, Object.values(c.slots), Object.values(j.slots)).filter(Boolean);
  assert.ok(held.some((x) => x.name === "fireblade" && x.level === 5 && !x.price), "strongest copy retained");
  assert.ok(held.some((x) => x.name === "fireblade" && x.l && !x.price), "locked copy retained");
});

test("adversary: full bag lists an eligible bag copy before a weaker bank copy", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = { name: "cake" };
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "dagger", level: 5 };
  c.esize = 0;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c._bank = { gold: 0, items0: [{ name: "dagger", level: 0 }].concat(new Array(41).fill({ name: "cake" })) };

  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    if (Object.values(c.slots).some((x) => x && x.name === "dagger" && x.price)) break;
  }

  const listed = Object.values(c.slots).find((x) => x && x.name === "dagger" && x.price);
  assert.ok(listed, "full bag must still list from bag");
  assert.strictEqual(listed.level, 5);
});

test("adversary: saturated stall rotates its cheapest listing for higher-value stock", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = null;
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "dagger", level: 1 };
  c.esize = c.items.filter((x) => !x).length;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c.stand = true;
  for (let i = 1; i <= 16; i++) {
    c.slots["trade" + i] = { name: "helmet1", level: 0, price: 38400 };
  }
  c._bank = { gold: 0, items0: new Array(42).fill(null) };

  for (let i = 0; i < 160; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => /^stall:rotate helmet1@0 -> dagger@1/.test(g.m))) break;
  }

  const listed = Object.values(c.slots).filter((x) => x && x.price);
  assert.ok(listed.some((x) => x.name === "dagger" && x.level === 1), "lists higher-value dagger");
  assert.strictEqual(listed.filter((x) => x.name === "helmet1").length, 15, "replaces one low-value listing");
});

test("adversary: active delivery liquidates junk to create take-back capacity", async () => {
  const p = bootParty({ pack: "armadillo", pots: 400, gold: 500000, members: ["Sarene", "Puppygirl"] });
  const ctrl = p.bots.Puppygirl.ctrl;
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = { name: "cake" };
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 400 };
  c.items[2] = { name: "mpot1", q: 400 };
  c.items[3] = { name: "wattire", level: 0 };
  c.items[4] = null;
  c.items[5] = null;
  c.esize = 2;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c._bank = { gold: 0, items0: new Array(42).fill({ name: "cake" }) };
  ctrl.store.active = {
    id: "space_recovery",
    kind: "dlv_pots",
    who: "Sarene",
    bought: 1,
    t0: p.world.clock.now(),
    items: [{ name: "hpot1", q: 200 }, { name: "mpot1", q: 200 }],
  };

  for (let i = 0; i < 100; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => /^vendor:sell wattire/.test(g.m))) break;
  }

  assert.ok(api.log.game.some((g) => /^vendor:sell wattire/.test(g.m)), "active delivery frees a slot");
  assert.ok(c.esize >= 3, "take-back capacity restored");
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
