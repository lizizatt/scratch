"use strict";

/**
 * Below-gate gear parks while NPC-vendoring junk; trade-slot tests kept for sim API.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { scrollFor, upgradeReady } = require("../src/gear");
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

async function seedRiskAds(p, slots) {
  const ctypes = { Jazwyn: "warrior", Sarene: "mage", Zarook: "priest" };
  const armor = {
    Jazwyn: { helmet: "mwhelmet", chest: "mwarmor", pants: "mwpants", shoes: "mwboots", gloves: "mwgloves" },
    Sarene: { helmet: "mmhat", chest: "mmarmor", pants: "mmpants", shoes: "mmshoes", gloves: "mmgloves" },
    Zarook: { helmet: "mphat", chest: "mparmor", pants: "mppants", shoes: "mpshoes", gloves: "mpgloves" },
  };
  const senders = {};
  for (const name of Object.keys(ctypes)) {
    const sender =
      (p.bots[name] && p.bots[name].api) ||
      p.world.spawn({ name, ctype: ctypes[name], map: "main", real_x: 0, real_y: 0 });
    senders[name] = sender;
    const safeSlots = {};
    for (const slot of Object.keys(armor[name])) safeSlots[slot] = { name: armor[name][slot], level: 0 };
    Object.assign(safeSlots, (slots && slots[name]) || {});
    Object.assign(sender.character.slots, safeSlots);
    await sender.send_cm("Puppygirl", {
      gear_ad: 1,
      inventory_ad: 1,
      v: 2,
      revision: 1,
      name,
      ctype: ctypes[name],
      slots: safeSlots,
      bag: [],
      esize: 42,
    });
  }
  const stop = p.bots.Puppygirl.ctrl.store.hunterUpgradeStop || {};
  for (const who of Object.keys(armor)) {
    for (const name of Object.values(armor[who])) stop[name] = 0;
  }
  p.bots.Puppygirl.ctrl.store.hunterUpgradeStop = stop;
  return senders;
}

test("unit: risky liquidation uses item-grade scrolls without weakening ordinary upgrades", () => {
  const p = bootParty({ pack: "armadillo", pots: 10, members: ["Puppygirl"] });
  const G = p.bots.Puppygirl.api.G;
  assert.strictEqual(scrollFor({ name: "fireblade", level: 0 }, G), "scroll1");
  assert.strictEqual(scrollFor({ name: "sshield", level: 3 }, G), "scroll0");
  assert.strictEqual(scrollFor({ name: "sshield", level: 4 }, G), "scroll1");
  assert.strictEqual(G.items.scroll1.g, 40000);
  assert.strictEqual(G.items.scroll2.g, 1600000);
  assert.ok(upgradeReady({ name: "fireblade", level: 4 }, G), "configured surplus may take a low-chance risk");
  assert.ok(!upgradeReady({ name: "gloves", level: 3 }, G), "ordinary gear keeps the conservative gate");
});

test("adversary: a surviving risky upgrade lists only after reaching +5", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 10000000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  api._now = () => 0;
  for (let i = 0; i < c.items.length; i++) c.items[i] = null;
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "firestaff", level: 4 };
  c.items[4] = { name: "scroll1", q: 2 };
  c.esize = c.items.filter((x) => !x).length;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c._bank = { gold: 0, items0: new Array(42).fill(null) };
  await seedRiskAds(p);
  const scrolls = [];
  api.upgrade = async (itemI, scrollI, offering, calculate) => {
    const it = c.items[itemI];
    const scroll = c.items[scrollI];
    if (calculate) return { chance: 0.6, level: it.level || 0 };
    scrolls.push(scroll.name);
    if ((scroll.q || 1) <= 1) {
      c.items[scrollI] = null;
      c.esize++;
    } else {
      scroll.q--;
    }
    it.level = (it.level || 0) + 1;
    return { success: true, level: it.level, chance: 0.6 };
  };

  for (let i = 0; i < 240; i++) {
    await p.tickAll();
    if (Object.values(c.slots).some((x) => x && x.name === "firestaff" && x.price)) break;
  }

  const msgs = api.log.game.map((g) => g.m);
  const listed = Object.values(c.slots).find((x) => x && x.name === "firestaff" && x.price);
  assert.deepStrictEqual(scrolls, ["scroll1"], "fiery equipment uses its grade-one scroll");
  assert.ok(msgs.some((m) => m === "gear:upgrade firestaff@4->5"));
  assert.ok(!msgs.some((m) => /^stall:list firestaff@[0-4]\b/.test(m)), "unfinished stock is withheld");
  assert.ok(listed && listed.level === 5, "the +5 survivor is listed");
  assert.ok(listed.price >= 7257600, "the survivor is repriced for its +5 level");
});

test("adversary: legacy low-level fiery listings are reclaimed for upgrading", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  api._now = () => 0;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c.stand = true;
  c.slots.trade1 = { name: "firebow", level: 0, price: 213600 };
  c._bank = { gold: 0, items0: new Array(42).fill(null) };
  await seedRiskAds(p);

  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "stall:risk_reclaim firebow@0")) break;
  }

  assert.ok(api.log.game.some((g) => g.m === "stall:risk_reclaim firebow@0"));
  assert.ok(!c.slots.trade1, "the obsolete listing leaves the trade slot");
  assert.ok(c.items.some((x) => x && x.name === "firebow" && (x.level || 0) === 0));
});

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

test("adversary: risk failures collapse surplus while a useful fighter upgrade is protected", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  api._now = () => 0;
  const jazwynSlots = {
    mainhand: { name: "fireblade", level: 1 },
    helmet: { name: "mwhelmet", level: 0 },
    chest: { name: "mwarmor", level: 0 },
    pants: { name: "mwpants", level: 0 },
    shoes: { name: "mwboots", level: 0 },
    gloves: { name: "mwgloves", level: 0 },
    offhand: { name: "sshield", level: 5 },
  };
  for (let i = 0; i < c.items.length; i++) c.items[i] = null;
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "fireblade", level: 0 };
  c.items[4] = { name: "sshield", level: 2 };
  c.items[5] = { name: "firestaff", level: 2 };
  c.esize = c.items.filter((x) => !x).length;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c._bank = { gold: 0, items0: [{ name: "sshield", level: 2 }].concat(new Array(41).fill(null)) };
  const senders = await seedRiskAds(p, { Jazwyn: jazwynSlots });
  const j = senders.Jazwyn.character;

  for (let i = 0; i < 480; i++) {
    await p.tickAll();
    const destroyed = api.log.game.filter((g) => /^gear:risk_destroyed /.test(g.m));
    if (destroyed.some((g) => /firestaff@2/.test(g.m)) && destroyed.some((g) => /sshield@2/.test(g.m))) break;
  }

  const destroyed = api.log.game.map((g) => g.m).filter((m) => /^gear:risk_destroyed /.test(m));
  assert.ok(
    destroyed.some((m) => /firestaff@2/.test(m)),
    "surplus fiery stock is deliberately risked; logs=" +
      api.log.game.map((g) => g.m).filter((m) => /^gear:/.test(m)).join(" | ")
  );
  assert.ok(
    api.log.game.some((g) => /^gear:(risk|progress)_destroyed sshield@2/.test(g.m)),
    "a spare shield is deliberately risked while the equipped shield stays protected"
  );
  assert.ok(!destroyed.some((m) => /fireblade/.test(m)), "a newly useful fighter upgrade is not destroyed");
  assert.ok(
    c.items.some((x) => x && x.name === "fireblade" && (x.level || 0) === 2),
    "the newly useful fighter upgrade remains reserved"
  );
  assert.strictEqual(j.slots.mainhand.name, "fireblade");
  assert.strictEqual(j.slots.offhand.name, "sshield");
  assert.strictEqual(j.slots.offhand.level, 5, "the equipped shield is never exposed to the risk");
});

test("adversary: a worn duplicate becomes a rolling upgrade challenger", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Jazwyn", "Puppygirl"],
  });
  const api = p.bots.Puppygirl.api;
  const merchant = api.character;
  const fighter = p.bots.Jazwyn.api.character;
  fighter.map = "main";
  fighter.real_x = fighter.x = 40;
  fighter.real_y = fighter.y = -20;
  p.bots.Jazwyn.ctrl.state.setIntent({ hold: 1 });
  fighter.slots.helmet = { name: "helmet1", level: 5 };
  fighter.slots.chest = { name: "coat1", level: 5 };
  fighter.slots.pants = { name: "pants1", level: 5 };
  fighter.slots.shoes = { name: "shoes1", level: 5 };
  fighter.slots.gloves = { name: "mwgloves", level: 1 };
  fighter.items[5] = { name: "mwgloves", level: 1 };
  fighter.esize = fighter.items.filter((x) => !x).length;
  for (let i = 0; i < merchant.items.length; i++) merchant.items[i] = null;
  merchant.items[0] = { name: "stand0" };
  merchant.items[1] = { name: "hpot1", q: 200 };
  merchant.items[2] = { name: "mpot1", q: 200 };
  merchant.esize = merchant.items.filter((x) => !x).length;
  merchant._bank = { gold: 0, items0: new Array(42).fill(null) };
  p.bots.Puppygirl.ctrl.store.hunterUpgradeStop = { mwgloves: 1 };

  let attempts = 0;
  api.upgrade = async (itemI, scrollI, offering, preview) => {
    const item = merchant.items[itemI];
    if (preview) return { chance: 0.05, level: item.level || 0 };
    attempts++;
    const scroll = merchant.items[scrollI];
    if (scroll && (scroll.q || 1) > 1) scroll.q--;
    else if (scroll) {
      merchant.items[scrollI] = null;
      merchant.esize++;
    }
    if (attempts === 1) {
      item.level = (item.level || 0) + 1;
      return { success: true, level: item.level, chance: 0.05 };
    }
    merchant.items[itemI] = null;
    merchant.esize++;
    return { failed: true, reason: "destroyed", chance: 0.05 };
  };

  for (let i = 0; i < 6000; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => g.m === "gear:progress_destroyed mwgloves@1")) break;
  }

  const logs = api.log.game.map((g) => g.m);
  const fighterLogs = p.bots.Jazwyn.api.log.game.map((g) => g.m);
  assert.ok(logs.some((m) => /^gear:progress_pickup Jazwyn n=1$/.test(m)));
  assert.ok(logs.some((m) => m === "gear:progress mwgloves@1->2"));
  assert.ok(
    fighterLogs.some((m) => m === "gear:progress_return mwgloves@1") ||
      logs.filter((m) => /^gear:progress_pickup Jazwyn n=1$/.test(m)).length >= 2,
    "the displaced copy must return directly or through the retry pickup; " +
      fighterLogs.filter((m) => /progress|gear:|dlv:/.test(m)).join(" | ")
  );
  assert.ok(
    logs.some((m) => m === "gear:progress_destroyed mwgloves@1"),
    logs.filter((m) => /progress|gear_got|hunter_ready|dlv:send_gear/.test(m)).join(" | ")
  );
  assert.strictEqual(attempts, 2, "one low-chance attempt per challenger");
  assert.strictEqual(fighter.slots.gloves.name, "mwgloves");
  assert.strictEqual(fighter.slots.gloves.level, 2);
  assert.strictEqual(
    merchant.items
      .concat(...Object.values(merchant._bank).filter(Array.isArray))
      .filter((it) => it && it.name === "mwgloves").length,
    0,
    "the failed displaced challenger is removed while the equipped winner survives"
  );
});

test("adversary: rolling progression remembers the game cap without retrying", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Jazwyn", "Puppygirl"],
  });
  const api = p.bots.Puppygirl.api;
  const merchant = api.character;
  const fighter = p.bots.Jazwyn.api.character;
  fighter.slots.cape = { name: "cape", level: 5 };
  for (let i = 0; i < merchant.items.length; i++) merchant.items[i] = null;
  merchant.items[0] = { name: "stand0" };
  merchant.items[1] = { name: "hpot1", q: 200 };
  merchant.items[2] = { name: "mpot1", q: 200 };
  merchant.items[3] = { name: "cape", level: 5 };
  merchant.esize = merchant.items.filter((x) => !x).length;
  merchant._bank = { gold: 0, items0: new Array(42).fill(null) };
  let previews = 0;
  let attempts = 0;
  api.upgrade = async (itemI, scrollI, offering, preview) => {
    const item = merchant.items[itemI];
    if (preview) {
      if (item && item.name === "cape") previews++;
      return { chance: 0, level: (item && item.level) || 0 };
    }
    if (item && item.name === "cape") attempts++;
    return { failed: true, reason: "max_level" };
  };

  for (let i = 0; i < 500; i++) await p.tickAll();

  assert.strictEqual(p.bots.Puppygirl.ctrl.store.progressionUpgradeStop.cape, 5);
  assert.strictEqual(previews, 1);
  assert.strictEqual(attempts, 0);
  assert.ok(api.log.game.some((g) => g.m === "gear:progress_cap cape@5"));
  assert.strictEqual(fighter.slots.cape.level, 5);
});

test("adversary: refreshed progression reservation prevents bank bounce", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Jazwyn", "Puppygirl"],
  });
  const ctrl = p.bots.Puppygirl.ctrl;
  const api = p.bots.Puppygirl.api;
  const merchant = api.character;
  const fighter = p.bots.Jazwyn.api.character;
  fighter.slots.cape = { name: "cape", level: 2 };
  for (let i = 0; i < merchant.items.length; i++) merchant.items[i] = { name: "tracker" };
  merchant.items[0] = { name: "stand0" };
  merchant.items[1] = { name: "hpot1", q: 200 };
  merchant.items[2] = { name: "mpot1", q: 200 };
  merchant.items[41] = { name: "cape", level: 2 };
  merchant.esize = 0;
  merchant.map = "main";
  merchant.real_x = merchant.x = 40;
  merchant.real_y = merchant.y = -20;
  merchant._bank = {
    gold: 0,
    items0: new Array(42).fill(null),
  };

  await p.bots.Jazwyn.api.send_cm("Puppygirl", {
    gear_ad: 1,
    inventory_ad: 1,
    v: 2,
    revision: 1,
    name: "Jazwyn",
    ctype: "warrior",
    slots: { cape: { name: "cape", level: 2 } },
    bag: [],
    esize: 42,
  });
  api.upgrade = async (itemI, scrollI, offering, preview) =>
    preview ? { chance: 0.05, level: merchant.items[itemI].level || 0 } : { failed: true, reason: "busy" };

  await ctrl.tick();

  const logs = api.log.game.map((g) => g.m);
  assert.ok(
    !logs.some((m) => m === "bank:store cape@2"),
    "the progression candidate must not be banked during capacity cleanup"
  );
  assert.ok(
    merchant.items.some((it) => it && it.name === "cape" && (it.level || 0) === 2)
  );
});

test("adversary: merchant sells bagged vendor armor without touching fighter equipment", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Jazwyn", "Puppygirl"] });
  const j = p.bots.Jazwyn.api.character;
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  const armor = [
    ["pants", "pants", 6, 2],
    ["gloves", "gloves", 6, 3],
    ["helmet", "helmet", 6, 4],
    ["shoes", "shoes", 6, 5],
    ["coat", "chest", 7, 6],
  ];
  for (const [name, slot, level] of armor) j.slots[slot] = { name, level };
  for (let i = 0; i < c.items.length; i++) c.items[i] = null;
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  armor.forEach(([name, , , sellLevel], i) => {
    c.items[i + 3] = { name, level: sellLevel };
  });
  c.esize = c.items.filter((x) => !x).length;
  c.map = j.map = "main";
  c.real_x = c.x = j.real_x = j.x = 40;
  c.real_y = c.y = j.real_y = j.y = -20;
  c._bank = { gold: 0, items0: new Array(42).fill(null) };
  for (let i = 0; i < 480; i++) {
    await p.tickAll();
    if (armor.every(([name]) => api.log.game.some((g) => g.m === "vendor:sell " + name + " x1"))) break;
  }

  const listed = Object.values(c.slots).filter((x) => x && x.price);
  for (const [name, slot, level, sellLevel] of armor) {
    assert.ok(api.log.game.some((g) => g.m === "vendor:sell " + name + " x1"), name + " sold");
    assert.ok(!listed.some((x) => x.name === name && x.level === sellLevel), name + " not listed");
    assert.deepStrictEqual(j.slots[slot], { name, level }, name + " remains equipped");
  }
});

test("adversary: stall delivers the strongest upgrade before listing displaced gear", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Jazwyn", "Puppygirl"] });
  const j = p.bots.Jazwyn.api.character;
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  j.slots.mainhand = { name: "fireblade", level: 1 };
  j.slots.helmet = { name: "mwhelmet", level: 0 };
  j.slots.chest = { name: "mwarmor", level: 0 };
  j.slots.pants = { name: "mwpants", level: 0 };
  j.slots.shoes = { name: "mwboots", level: 0 };
  j.slots.gloves = { name: "mwgloves", level: 0 };
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
  c._bank = { gold: 0, items0: [{ name: "fireblade", level: 5 }].concat(new Array(41).fill(null)) };

  for (let i = 0; i < 240; i++) {
    await p.tickAll();
    if (
      j.slots.mainhand &&
      j.slots.mainhand.name === "fireblade" &&
      j.slots.mainhand.level === 5 &&
      Object.values(c.slots).some((x) => x && x.name === "fireblade" && x.price)
    ) {
      break;
    }
  }

  const listed = Object.values(c.slots).find((x) => x && x.name === "fireblade" && x.price);
  assert.ok(listed, "a surplus blade must be listed");
  assert.strictEqual(listed.level, 5, "only a completed +5 copy is listed");
  assert.strictEqual(j.slots.mainhand.level, 5, "strongest copy reaches the fighter first");
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
  c.items[3] = { name: "dagger", level: 5 };
  c.esize = c.items.filter((x) => !x).length;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c.stand = true;
  for (let i = 1; i <= 16; i++) {
    c.slots["trade" + i] = { name: "candycanesword", level: 0, price: 1200 };
  }
  c._bank = { gold: 0, items0: new Array(42).fill(null) };

  for (let i = 0; i < 160; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => /^stall:rotate candycanesword@0 -> dagger@5/.test(g.m))) break;
  }

  const listed = Object.values(c.slots).filter((x) => x && x.price);
  assert.ok(listed.some((x) => x.name === "dagger" && x.level === 5), "lists higher-value dagger");
  assert.strictEqual(
    listed.filter((x) => x.name === "candycanesword").length,
    15,
    "replaces one low-value listing"
  );
});

test("adversary: saturated stall pulls a higher-value bank replacement", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = null;
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.esize = c.items.filter((x) => !x).length;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c.stand = true;
  for (let i = 1; i <= 16; i++) {
    c.slots["trade" + i] = { name: "candycanesword", level: 0, price: 1200 };
  }
  c._bank = {
    gold: 0,
    items0: [{ name: "dagger", level: 5 }].concat(new Array(41).fill(null)),
  };

  for (let i = 0; i < 240; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => /^stall:rotate candycanesword@0 -> dagger@5/.test(g.m))) break;
  }

  const listed = Object.values(c.slots).filter((x) => x && x.price);
  assert.ok(
    listed.some((x) => x.name === "dagger" && x.level === 5),
    "retrieves and lists higher-value bank gear"
  );
  assert.strictEqual(listed.filter((x) => x.name === "candycanesword").length, 15);
});

test("adversary: unrestored server trade slot is quarantined between retries", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 500000, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = null;
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "candycanesword", level: 0 };
  c.esize = c.items.filter((x) => !x).length;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c.stand = true;
  for (let i = 1; i <= 15; i++) {
    c.slots["trade" + i] = { name: "pants", level: 5, price: 299600 };
  }
  c.slots.trade16 = null;
  c._bank = { gold: 0, items0: new Array(42).fill(null) };

  let attempts = 0;
  api.trade = async () => {
    attempts++;
    return { failed: true, reason: "cant_equip" };
  };

  for (let i = 0; i < 160; i++) await p.tickAll();

  const resyncs = api.log.game.filter((g) => g.m === "stall:slot_resync trade16");
  assert.ok(attempts >= 1, "server-occupied slot is probed");
  for (let i = 1; i < resyncs.length; i++) {
    assert.ok(
      resyncs[i].t - resyncs[i - 1].t >= 180000,
      "server-occupied slot retries must respect the quarantine"
    );
  }
  assert.ok(
    !api.log.game.some((g) => /^stall:list_fail candycanesword/.test(g.m)),
    "known slot restore race is not reported as an item failure"
  );
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
