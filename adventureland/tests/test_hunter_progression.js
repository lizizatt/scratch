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

module.exports = { tests };
