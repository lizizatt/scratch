"use strict";

/**
 * Idle merchant should compound bank triples + NPC-vendor whitelist junk (bank clean).
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { cscrollFor } = require("../src/bank_clean_plan");

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

test("adversary: idle merchant compounds bank strearring triple", async () => {
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
      { name: "strearring", level: 0 },
      { name: "strearring", level: 0 },
      { name: "strearring", level: 0 },
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
    if (mApi.log.game.some((g) => /^bank:compound strearring@0/.test(g.m))) {
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
  assert.ok(countNameLevel(bags, "strearring", 1) >= 1, "should have strearring@1 after compound");
  assert.ok(countNameLevel(bags, "strearring", 0) <= 0, "no leftover @0 triple");
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
  for (let i = 0; i < m.items.length; i++) m.items[i] = { name: "tracker" };
  for (let i = 0; i < 7; i++) m.items[i] = { name: "strearring", level: 0 };
  m.esize = 0;
  m._bank = { gold: 0, items0: new Array(42).fill({ name: "tracker" }) };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;

  for (let i = 0; i < 250; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "bank:compound strearring@0")) break;
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(msgs.some((x) => x === "bank:compound_sacrifice strearring@0"), "sells a remainder, not a triple");
  assert.ok(msgs.some((x) => x === "bank:compound strearring@0"), "local triple compounds after buying a scroll");
  assert.strictEqual(countNameLevel([m.items], "strearring", 0), 3, "preserves a complete earring triple");
  assert.ok((m.esize || 0) >= 2, "compound creates durable recovery capacity");
});

test("adversary: full merchant prefers a local triple with its scroll already in bag", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const m = api.character;
  let readyLevel = 0;
  while (readyLevel < 5 && cscrollFor("strearring", readyLevel, api.G) !== "cscroll1") {
    readyLevel++;
  }
  assert.ok(readyLevel < 5, "fixture must expose a cscroll1 strearring level");
  for (let i = 0; i < m.items.length; i++) m.items[i] = { name: "tracker" };
  m.items[0] = { name: "strearring", level: 0 };
  m.items[1] = { name: "strearring", level: 0 };
  m.items[2] = { name: "strearring", level: 0 };
  m.items[3] = { name: "strearring", level: readyLevel };
  m.items[4] = { name: "strearring", level: readyLevel };
  m.items[5] = { name: "strearring", level: readyLevel };
  m.items[6] = { name: "cscroll1", q: 4 };
  m.esize = 0;
  m._bank = { gold: 0, items0: new Array(42).fill({ name: "tracker" }) };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;

  for (let i = 0; i < 300; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "bank:compound strearring@" + readyLevel)) break;
  }

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((g) => g === "bank:compound strearring@" + readyLevel),
    "logs=" + msgs.filter((g) => /^bank:/.test(g)).join(" | ")
  );
  assert.ok(!api.log.game.some((g) => g.m === "bank:compound_sacrifice strearring@0"));
  assert.ok((m.esize || 0) >= 2);
});

test("adversary: constrained merchant compacts a local triple before an inaccessible bank triple", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const m = api.character;
  for (let i = 0; i < m.items.length; i++) m.items[i] = { name: "tracker" };
  m.items[0] = { name: "strearring", level: 0 };
  m.items[1] = { name: "strearring", level: 0 };
  m.items[2] = { name: "strearring", level: 0 };
  m.items[3] = { name: "cscroll0", q: 1 };
  m.items[4] = { name: "hpot1", q: 200 };
  m.items[5] = { name: "mpot1", q: 200 };
  m.items[40] = null;
  m.items[41] = null;
  m.esize = 2;
  m._bank = {
    gold: 0,
    items0: new Array(42).fill({ name: "tracker" }),
  };
  m._bank.items0[0] = { name: "orbg", level: 0 };
  m._bank.items0[1] = { name: "orbg", level: 0 };
  m._bank.items0[2] = { name: "orbg", level: 0 };

  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "bank:compound strearring@0")) break;
  }

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((g) => g === "bank:compound strearring@0"));
  assert.ok(!msgs.some((g) => g === "bank:combine_pull_fail orbg@0"));
  assert.ok((m.esize || 0) >= 4, "local compaction restores the logistics reserve");
});

test("adversary: full merchant sells cosmetic clutter before breaking an exact triple", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const m = api.character;
  for (let i = 0; i < m.items.length; i++) m.items[i] = { name: "tracker" };
  m.items[0] = { name: "strearring", level: 0 };
  m.items[1] = { name: "strearring", level: 0 };
  m.items[2] = { name: "strearring", level: 0 };
  m.items[3] = { name: "confetti", q: 8 };
  m.esize = 0;
  m._bank = { gold: 0, items0: new Array(42).fill({ name: "tracker" }) };

  for (let i = 0; i < 300; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "bank:compound strearring@0")) break;
  }

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((g) => g === "bank:material_sacrifice confetti"),
    "logs=" + msgs.filter((g) => /^bank:/.test(g)).join(" | ")
  );
  assert.ok(msgs.some((g) => g === "bank:compound strearring@0"));
  assert.ok(!api.log.game.some((g) => /^bank:compound_sacrifice/.test(g.m)));
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
  for (let i = 0; i < 9; i++) m._bank.items0[i] = { name: "strearring", level: 0 };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;

  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "bank:compound strearring@0")) break;
  }

  assert.strictEqual(api.log.retrieved.filter((x) => x.name === "strearring").length, 9);
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

test("adversary: saturation pickup centralizes every unequipped compound input", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000 });
  const fighter = p.bots.Jazwyn.api.character;
  for (let i = 0; i < fighter.items.length; i++) {
    fighter.items[i] = { name: "tracker" };
  }
  fighter.items[0] = { name: "hpot1", q: 200 };
  fighter.items[1] = { name: "mpot1", q: 200 };
  for (let i = 2; i < 8; i++) fighter.items[i] = { name: "wbook0", level: 0 };
  fighter.esize = 0;

  for (let i = 0; i < 500; i++) {
    await p.tickAll();
    if ((fighter.esize || 0) > 0) break;
  }

  const remaining = fighter.items.filter((x) => x && x.name === "wbook0").length;
  assert.ok((fighter.esize || 0) > 0, "fighter gains room after saturation pickup");
  assert.strictEqual(remaining, 0, "fighter does not retain a permanent compound backlog");
  assert.ok(
    p.bots.Puppygirl.api.log.game.some((g) => g.m === "dlv:pickup Jazwyn"),
    "merchant explicitly schedules the saturation pickup"
  );
  assert.ok(
    p.bots.Jazwyn.api.log.game.some((g) => /^toss wbook0@0/.test(g.m)),
    "fighter transfers compound inputs only during saturation recovery"
  );
  assert.ok(
    !p.bots.Puppygirl.api.log.game.some((g) => g.m === "dlv:reroute"),
    "fighter holds its pickup location instead of forcing a moving-target chase"
  );
});

test("adversary: blocked full-bag compounding is rate limited", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const m = api.character;
  for (let i = 0; i < m.items.length; i++) m.items[i] = { name: "tracker" };
  m.items[0] = { name: "strearring", level: 0 };
  m.items[1] = { name: "strearring", level: 0 };
  m.items[2] = { name: "strearring", level: 0 };
  m.esize = 0;
  m._bank = { gold: 0, items0: new Array(42).fill({ name: "tracker" }) };

  for (let i = 0; i < 100; i++) await p.tickAll();

  const blocked = api.log.game.filter((g) => g.m === "bank:combine_no_space");
  assert.ok(blocked.length >= 1);
  for (let i = 1; i < blocked.length; i++) {
    assert.ok(
      blocked[i].t - blocked[i - 1].t >= 5000,
      "blocked state should not flood logs or CPU"
    );
  }
});

test("adversary: targeted pot cancellation does not cancel a coordinator pickup", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000 });
  const ctrl = p.bots.Puppygirl.ctrl;
  ctrl.store.active = {
    id: "pickup_Zarook_7",
    kind: "dlv_gear",
    who: "Zarook",
    items: [],
    t0: p.world.clock.now(),
  };

  await p.bots.Zarook.api.send_cm("Puppygirl", {
    job: "cancel_all",
    id: "pot_timeout_Zarook",
    who: "Zarook",
  });
  assert.ok(ctrl.store.active && ctrl.store.active.id === "pickup_Zarook_7");

  await p.bots.Zarook.api.send_cm("Puppygirl", {
    job: "cancel_all",
    who: "Zarook",
  });
  assert.strictEqual(ctrl.store.active, null, "untargeted hop cancellation still clears fighter jobs");
});

test("adversary: pickup hold preempts hunt routing and waits in town", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000 });
  const fighter = p.bots.Jazwyn;
  fighter.api.character.s.monsterhunt = { id: "goo", c: 3 };
  fighter.ctrl.setHuntQuest(true);
  fighter.api.character.map = "main";
  fighter.api.character.real_x = fighter.api.character.x = 900;
  fighter.api.character.real_y = fighter.api.character.y = -900;

  await p.bots.Puppygirl.api.send_cm("Jazwyn", {
    status: 1,
    id: "pickup_Jazwyn_hold",
    phase: "enroute",
    meet: 1,
  });
  await fighter.ctrl.tick();

  assert.strictEqual(fighter.api.character.map, "main");
  assert.ok(Math.hypot(fighter.api.character.real_x - 40, fighter.api.character.real_y + 20) <= 80);
  assert.ok(
    !fighter.api.log.game.some((g) => g.m === "mhunt:farm id=goo c=3"),
    "hunt routing must not run ahead of the pickup hold"
  );
});

test("adversary: idle merchant NPC-vendors bank whitelist junk", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Puppygirl"],
  });

  test("adversary: low-value stall drops are NPC-vendored before compounding", async () => {
    const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
    const api = p.bots.Puppygirl.api;
    const m = api.character;
    m._bank = {
      gold: 0,
      items0: [
        { name: "stinger", level: 0 },
        { name: "hpbelt", level: 0 },
        { name: "hpbelt", level: 0 },
        { name: "hpbelt", level: 0 },
        null,
      ],
    };

    for (let i = 0; i < 180; i++) {
      await p.tickAll();
      if (api.log.game.some((g) => g.m === "vendor:sell stinger x1")) break;
    }

    const msgs = api.log.game.map((g) => g.m);
    assert.ok(msgs.some((g) => g === "vendor:sell stinger x1"));
    const soldAt = api.log.game.find((g) => g.m === "vendor:sell stinger x1").t;
    const compound = api.log.game.find((g) => g.m === "bank:compound hpbelt@0");
    assert.ok(!compound || soldAt < compound.t, "junk liquidation must outrank compounding");
  });

  test("adversary: bank junk drains before a saturated-fighter pickup is scheduled", async () => {
    const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000 });
    const merchant = p.bots.Puppygirl.api;
    const fighter = p.bots.Jazwyn.api.character;
    for (let i = 0; i < fighter.items.length; i++) fighter.items[i] = { name: "tracker" };
    for (let i = 0; i < 6; i++) fighter.items[i] = { name: "wbook0", level: 0 };
    fighter.items[6] = { name: "hpot1", q: 200 };
    fighter.items[7] = { name: "mpot1", q: 200 };
    fighter.slots.offhand = { name: "wbook0", level: 5 };
    fighter.esize = 0;
    merchant.character._bank = {
      gold: 0,
      items0: [{ name: "stinger", level: 0 }, null, null],
    };

    for (let i = 0; i < 600; i++) {
      await p.tickAll();
      if (merchant.log.game.some((g) => g.m === "dlv:pickup Jazwyn")) break;
    }

    const vendor = merchant.log.game.find((g) => g.m === "vendor:sell stinger x1");
    const pickup = merchant.log.game.find((g) => g.m === "dlv:pickup Jazwyn");
    assert.ok(vendor, "bank junk must be liquidated");
    assert.ok(pickup, "pickup resumes after junk liquidation");
    assert.ok(vendor.t < pickup.t, "junk liquidation must precede saturation pickup");
  });

  test("adversary: trapped bank junk sacrifices one cheap material to bootstrap retrieval", async () => {
    const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
    const api = p.bots.Puppygirl.api;
    const m = api.character;
    for (let i = 0; i < m.items.length; i++) m.items[i] = { name: "tracker" };
    m.items[0] = { name: "hpot1", q: 200 };
    m.items[1] = { name: "mpot1", q: 200 };
    m.items[2] = { name: "bwing", q: 50 };
    m.esize = 0;
    m._bank = {
      gold: 0,
      items0: new Array(42).fill({ name: "tracker" }),
    };
    m._bank.items0[0] = { name: "stinger", level: 0 };

    for (let i = 0; i < 240; i++) {
      await p.tickAll();
      if (api.log.game.some((g) => g.m === "vendor:sell stinger x1")) break;
    }

    const msgs = api.log.game.map((g) => g.m);
    assert.ok(msgs.some((g) => g === "bank:material_sacrifice bwing"));
    assert.ok(msgs.some((g) => g === "vendor:sell stinger x1"));
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
