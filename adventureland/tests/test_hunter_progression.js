"use strict";

const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { GEAR_TARGETS, HUNTER_PLAN, KEEP_ALWAYS } = require("../src/constants");
const { makeInventorySnapshot } = require("../src/gear_coordination");
const FULL_SET_COST = 159;

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

async function advertise(p) {
  for (const who of ["Jazwyn", "Sarene", "Zarook"]) {
    const api = p.bots[who].api;
    await api.send_cm(
      "Puppygirl",
      Object.assign(
        { gear_ad: 1, name: who, farm: "bat" },
        makeInventorySnapshot(api, 1, {})
      )
    );
  }
}

function seedBagTokens(p, quantity) {
  const c = p.bots.Puppygirl.api.character;
  c.items[0] = { name: "monstertoken", q: quantity };
  c.esize = c.items.filter((x) => !x).length;
}

test("Hunter manifest covers and protects every combat-set armor slot", () => {
  const expected = {
    Jazwyn: { helmet: "mwhelmet", chest: "mwarmor", pants: "mwpants", shoes: "mwboots", gloves: "mwgloves" },
    Sarene: { helmet: "mmhat", chest: "mmarmor", pants: "mmpants", shoes: "mmshoes", gloves: "mmgloves" },
    Zarook: { helmet: "mphat", chest: "mparmor", pants: "mppants", shoes: "mpshoes", gloves: "mpgloves" },
  };
  assert.strictEqual(HUNTER_PLAN.length, 15);
  assert.strictEqual(HUNTER_PLAN.reduce((sum, step) => sum + step.cost, 0), FULL_SET_COST);
  for (const who of Object.keys(expected)) {
    for (const slot of Object.keys(expected[who])) {
      const name = expected[who][slot];
      assert.strictEqual(GEAR_TARGETS[who][slot], name);
      assert.ok(HUNTER_PLAN.some((step) => step.who === who && step.slot === slot && step.name === name));
      assert.ok(KEEP_ALWAYS.includes(name), name + " is protected");
    }
  }
});

test("Hunter plan verifies all 159 tokens before buying and queues exact class deliveries", async () => {
  const p = bootParty({
    pack: "bat",
    bankSeed: [{ name: "monstertoken", q: 80 }],
  });

  test("Hunter plan consolidates split token stacks before the first purchase", async () => {
    const p = bootParty({
      pack: "bat",
      bankSeed: [{ name: "monstertoken", q: 80 }],
    });
    seedBagTokens(p, 79);
    await advertise(p);

    const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.spent, FULL_SET_COST);
    assert.strictEqual(p.bots.Puppygirl.api.log.exchanged.length, HUNTER_PLAN.length);
    assert.strictEqual(p.bots.Puppygirl.ctrl.store.q.length, HUNTER_PLAN.length);
  });

  test("Hunter operator request waits for existing logistics instead of being lost", async () => {
    const p = bootParty({ pack: "bat" });
    seedBagTokens(p, FULL_SET_COST);
    await advertise(p);
    p.bots.Puppygirl.ctrl.enqueue({
      id: "existing",
      kind: "meet_home",
      who: "party",
    });

    const requested = await p.bots.Puppygirl.ctrl.startHunterPlan();
    assert.deepStrictEqual(requested, { success: true, requested: true });
    assert.strictEqual(p.bots.Puppygirl.ctrl.store.hunterRequested, 1);
    p.bots.Puppygirl.ctrl.store.q = [];
    await p.bots.Puppygirl.ctrl.tick();
    assert.strictEqual(p.bots.Puppygirl.ctrl.store.hunterRequested, null);
    assert.strictEqual(p.bots.Puppygirl.ctrl.store.q.length, HUNTER_PLAN.length);
  });
  seedBagTokens(p, 79);
  await advertise(p);

  const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.deepStrictEqual(result, { success: true, queued: HUNTER_PLAN.length, spent: FULL_SET_COST, tokens: 0 });
  assert.strictEqual(p.bots.Puppygirl.ctrl.store.q.length, HUNTER_PLAN.length);
  assert.deepStrictEqual(
    p.bots.Puppygirl.ctrl.store.q.map((x) => [x.gear.name, x.who, x.gear.slot]),
    HUNTER_PLAN.map((x) => [x.name, x.who, x.slot])
  );
  assert.strictEqual(
    p.bots.Puppygirl.api.log.exchanged.filter((x) => x.token === "monstertoken").length,
    HUNTER_PLAN.length
  );
});

test("Hunter plan is all-or-nothing when the verified token balance is short", async () => {
  const p = bootParty({ pack: "bat" });
  seedBagTokens(p, FULL_SET_COST - 1);
  await advertise(p);

  const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.strictEqual(result.failed, true);
  assert.strictEqual(result.reason, "tokens");
  assert.strictEqual(result.have, FULL_SET_COST - 1);
  assert.strictEqual(result.need, FULL_SET_COST);
  assert.strictEqual(p.bots.Puppygirl.api.log.exchanged.length, 0);
  assert.strictEqual(p.bots.Puppygirl.ctrl.store.q.length, 0);
});

test("Hunter plan reuses an already-owned target piece instead of buying a duplicate", async () => {
  const p = bootParty({
    pack: "bat",
    bankSeed: [{ name: "monstertoken", q: 70 }],
  });
  seedBagTokens(p, 82);
  p.bots.Sarene.api.character.slots.helmet = { name: "mmhat", level: 0 };
  await advertise(p);

  const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.spent, FULL_SET_COST - 7);
  assert.strictEqual(result.queued, HUNTER_PLAN.length - 1);
  assert.ok(!p.bots.Puppygirl.api.log.exchanged.some((x) => x.name === "mmhat"));
  assert.ok(!p.bots.Puppygirl.ctrl.store.q.some((x) => x.gear.name === "mmhat"));
});

test("Hunter plan refuses a stale recipient advertisement before spending", async () => {
  const p = bootParty({ pack: "bat" });
  seedBagTokens(p, FULL_SET_COST);
  await advertise(p);
  p.world.advance(61000);

  const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.strictEqual(result.failed, true);
  assert.strictEqual(result.reason, "stale_ad");
  assert.strictEqual(p.bots.Puppygirl.api.log.exchanged.length, 0);
});

test("Hunter plan refuses a live catalog mismatch before spending", async () => {
  const p = bootParty({ pack: "bat" });
  seedBagTokens(p, FULL_SET_COST);
  await advertise(p);
  p.world.G.tokens.monstertoken.mmhat = 99;

  const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.strictEqual(result.failed, true);
  assert.strictEqual(result.reason, "catalog");
  assert.strictEqual(result.item, "mmhat");
  assert.strictEqual(p.bots.Puppygirl.api.log.exchanged.length, 0);
});

test("Hunter plan resumes after an interrupted purchase without duplicates", async () => {
  const p = bootParty({ pack: "bat" });
  seedBagTokens(p, FULL_SET_COST);
  await advertise(p);
  const api = p.bots.Puppygirl.api;
  const exchangeBuy = api.exchange_buy.bind(api);
  let calls = 0;
  api.exchange_buy = async (token, name) => {
    calls++;
    if (calls === 4) return { failed: true, reason: "injected" };
    return exchangeBuy(token, name);
  };

  const first = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.strictEqual(first.failed, true);
  assert.strictEqual(api.log.exchanged.length, 3);
  api.exchange_buy = exchangeBuy;
  const second = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.strictEqual(second.success, true);
  assert.strictEqual(second.spent, FULL_SET_COST - 26);
  assert.strictEqual(api.log.exchanged.length, HUNTER_PLAN.length);
  assert.strictEqual(new Set(api.log.exchanged.map((x) => x.name)).size, HUNTER_PLAN.length);
});

test("Hunter deliveries equip all fifteen pieces on their intended classes", async () => {
  const p = bootParty({
    pack: "bat",
    pots: 200,
    gold: 500000,
    bankSeed: [{ name: "monstertoken", q: 80 }],
  });
  seedBagTokens(p, 79);
  await advertise(p);
  const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.strictEqual(result.success, true);

  for (let i = 0; i < 6000; i++) {
    await p.tickAll();
    if (!p.bots.Puppygirl.ctrl.store.active && !p.bots.Puppygirl.ctrl.store.q.length) break;
  }
  assert.strictEqual(p.bots.Sarene.api.character.slots.helmet.name, "mmhat");
  assert.strictEqual(p.bots.Sarene.api.character.slots.gloves.name, "mmgloves");
  assert.strictEqual(p.bots.Sarene.api.character.slots.pants.name, "mmpants");
  assert.strictEqual(p.bots.Zarook.api.character.slots.helmet.name, "mphat");
  assert.strictEqual(p.bots.Zarook.api.character.slots.gloves.name, "mpgloves");
  assert.strictEqual(p.bots.Zarook.api.character.slots.pants.name, "mppants");
  assert.strictEqual(p.bots.Jazwyn.api.character.slots.gloves.name, "mwgloves");
  assert.strictEqual(p.bots.Jazwyn.api.character.slots.helmet.name, "mwhelmet");
  assert.strictEqual(p.bots.Jazwyn.api.character.slots.chest.name, "mwarmor");
  assert.strictEqual(p.bots.Jazwyn.api.character.slots.pants.name, "mwpants");
  assert.strictEqual(p.bots.Jazwyn.api.character.slots.shoes.name, "mwboots");
  assert.strictEqual(p.bots.Sarene.api.character.slots.chest.name, "mmarmor");
  assert.strictEqual(p.bots.Sarene.api.character.slots.shoes.name, "mmshoes");
  assert.strictEqual(p.bots.Zarook.api.character.slots.chest.name, "mparmor");
  assert.strictEqual(p.bots.Zarook.api.character.slots.shoes.name, "mpshoes");
  assert.strictEqual(p.bots.Puppygirl.ctrl.store.q.length, 0);
  assert.strictEqual(p.bots.Puppygirl.ctrl.store.active, null);
  assert.ok(
    p.bots.Puppygirl.api.log.game.filter((x) => /^dlv:send_gear/.test(x.m)).length === HUNTER_PLAN.length
  );
  for (const who of ["Jazwyn", "Sarene", "Zarook"]) {
    assert.ok(!p.bots[who].api.log.game.some((x) => x.m === "Wrong weapon"));
  }
});

test("Hunter upgrades accept exactly 95 percent and persist the first lower-chance level", async () => {
  const p = bootParty({ members: ["Puppygirl"], gold: 500000, pots: 100 });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = null;
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 100 };
  c.items[2] = { name: "mpot1", q: 100 };
  c.items[3] = { name: "mmhat", level: 0 };
  c.items[4] = { name: "mmpants", level: 0 };
  c.items[5] = { name: "mmgloves", level: 2 };
  c.esize = c.items.filter((x) => !x).length;
  api.upgrade = async (itemIndex, scrollIndex, offeringIndex, preview) => {
    const item = c.items[itemIndex];
    if (preview) {
      return {
        chance:
          item &&
          ((item.name === "mmhat" && (item.level || 0) === 0) ||
            (item.name === "mmgloves" && (item.level || 0) === 2))
            ? 0.95
            : 0.949,
      };
    }
    item.level = (item.level || 0) + 1;
    const scroll = c.items[scrollIndex];
    if (scroll.q && scroll.q > 1) scroll.q--;
    else c.items[scrollIndex] = null;
    return { success: true, level: item.level };
  };

  for (let i = 0; i < 500; i++) {
    await p.tickAll();
    const stop = p.bots.Puppygirl.ctrl.store.hunterUpgradeStop || {};
    if (stop.mmhat === 1 && stop.mmpants === 0 && stop.mmgloves === 3) break;
  }

  const store = p.bots.Puppygirl.ctrl.store;
  assert.strictEqual(store.hunterUpgradeStop.mmhat, 1);
  assert.strictEqual(store.hunterUpgradeStop.mmpants, 0);
  assert.strictEqual(store.hunterUpgradeStop.mmgloves, 3);
  const logs = api.log.game.map((x) => x.m);
  assert.ok(logs.some((m) => m === "gear:upgrade mmhat@0->1"));
  assert.ok(!logs.some((m) => /^gear:upgrade mmpants/.test(m)));
  assert.ok(logs.some((m) => m === "gear:upgrade mmgloves@2->3"));
  assert.ok(logs.some((m) => m === "gear:hunter_ready mmhat@1 chance=0.949"));
  assert.ok(logs.some((m) => m === "gear:hunter_ready mmpants@0 chance=0.949"));
  assert.ok(api.log.bought.some((x) => x.name === "scroll1"), "Hunter gear must use high-grade scroll1");
});

test("Owned equipped and bagged Hunter pieces round-trip through Puppygirl and equip as a set", async () => {
  const p = bootParty({
    members: ["Puppygirl", "Sarene"],
    pack: "armadillo",
    gold: 500000,
    pots: 200,
  });
  const merchant = p.bots.Puppygirl.api;
  const mage = p.bots.Sarene.api.character;
  mage.slots.helmet = { name: "mmhat", level: 0 };
  mage.slots.pants = { name: "pants1", level: 3 };
  mage.slots.gloves = { name: "gloves1", level: 3 };
  mage.items[5] = { name: "mmpants", level: 0 };
  mage.items[6] = { name: "mmgloves", level: 0 };
  mage.esize = mage.items.filter((x) => !x).length;

  for (let i = 0; i < 6000; i++) {
    await p.tickAll();
    const slots = mage.slots;
    if (
      slots.helmet &&
      slots.helmet.name === "mmhat" &&
      slots.helmet.level === 1 &&
      slots.pants &&
      slots.pants.name === "mmpants" &&
      slots.pants.level === 1 &&
      slots.gloves &&
      slots.gloves.name === "mmgloves" &&
      slots.gloves.level === 1
    ) {
      break;
    }
  }

  const logs = merchant.log.game.map((x) => x.m);
  assert.ok(logs.some((m) => /^hunter:upgrade_pickup Sarene n=3$/.test(m)), logs.join(" | "));
  for (const name of ["mmhat", "mmpants", "mmgloves"]) {
    assert.ok(
      logs.some((m) => m === "gear:upgrade " + name + "@0->1"),
      name + " was not upgraded; " + logs.filter((m) => /hunter|gear:|dlv:/.test(m)).join(" | ")
    );
    assert.strictEqual(p.bots.Puppygirl.ctrl.store.hunterUpgradeStop[name], 1);
  }
  assert.strictEqual(mage.slots.helmet.name, "mmhat");
  assert.strictEqual(mage.slots.helmet.level, 1);
  assert.strictEqual(mage.slots.pants.name, "mmpants");
  assert.strictEqual(mage.slots.pants.level, 1);
  assert.strictEqual(mage.slots.gloves.name, "mmgloves");
  assert.strictEqual(mage.slots.gloves.level, 1);
});

module.exports = { tests };
