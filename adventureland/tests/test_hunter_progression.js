"use strict";

const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { HUNTER_PLAN } = require("../src/constants");
const { makeInventorySnapshot } = require("../src/gear_coordination");

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

test("Hunter plan verifies all 60 tokens before buying and queues exact class deliveries", async () => {
  const p = bootParty({
    pack: "bat",
    bankSeed: [{ name: "monstertoken", q: 23 }],
  });

  test("Hunter plan consolidates split token stacks before the first purchase", async () => {
    const p = bootParty({
      pack: "bat",
      bankSeed: [{ name: "monstertoken", q: 30 }],
    });
    seedBagTokens(p, 30);
    await advertise(p);

    const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.spent, 60);
    assert.strictEqual(p.bots.Puppygirl.api.log.exchanged.length, 7);
    assert.strictEqual(p.bots.Puppygirl.ctrl.store.q.length, 7);
  });

  test("Hunter operator request waits for existing logistics instead of being lost", async () => {
    const p = bootParty({ pack: "bat" });
    seedBagTokens(p, 60);
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
    assert.strictEqual(p.bots.Puppygirl.ctrl.store.q.length, 7);
  });
  seedBagTokens(p, 41);
  await advertise(p);

  const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.deepStrictEqual(result, { success: true, queued: 7, spent: 60, tokens: 4 });
  assert.strictEqual(p.bots.Puppygirl.ctrl.store.q.length, 7);
  assert.deepStrictEqual(
    p.bots.Puppygirl.ctrl.store.q.map((x) => [x.gear.name, x.who, x.gear.slot]),
    HUNTER_PLAN.map((x) => [x.name, x.who, x.slot])
  );
  assert.strictEqual(
    p.bots.Puppygirl.api.log.exchanged.filter((x) => x.token === "monstertoken").length,
    7
  );
});

test("Hunter plan is all-or-nothing when the verified token balance is short", async () => {
  const p = bootParty({ pack: "bat" });
  seedBagTokens(p, 59);
  await advertise(p);

  const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.strictEqual(result.failed, true);
  assert.strictEqual(result.reason, "tokens");
  assert.strictEqual(result.have, 59);
  assert.strictEqual(result.need, 60);
  assert.strictEqual(p.bots.Puppygirl.api.log.exchanged.length, 0);
  assert.strictEqual(p.bots.Puppygirl.ctrl.store.q.length, 0);
});

test("Hunter plan reuses an already-owned target piece instead of buying a duplicate", async () => {
  const p = bootParty({
    pack: "bat",
    bankSeed: [{ name: "monstertoken", q: 19 }],
  });
  seedBagTokens(p, 34);
  p.bots.Sarene.api.character.slots.helmet = { name: "mmhat", level: 0 };
  await advertise(p);

  const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.spent, 53);
  assert.strictEqual(result.queued, 6);
  assert.ok(!p.bots.Puppygirl.api.log.exchanged.some((x) => x.name === "mmhat"));
  assert.ok(!p.bots.Puppygirl.ctrl.store.q.some((x) => x.gear.name === "mmhat"));
});

test("Hunter plan refuses a stale recipient advertisement before spending", async () => {
  const p = bootParty({ pack: "bat" });
  seedBagTokens(p, 60);
  await advertise(p);
  p.world.advance(61000);

  const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.strictEqual(result.failed, true);
  assert.strictEqual(result.reason, "stale_ad");
  assert.strictEqual(p.bots.Puppygirl.api.log.exchanged.length, 0);
});

test("Hunter plan refuses a live catalog mismatch before spending", async () => {
  const p = bootParty({ pack: "bat" });
  seedBagTokens(p, 60);
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
  seedBagTokens(p, 60);
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
  assert.strictEqual(second.spent, 34);
  assert.strictEqual(api.log.exchanged.length, 7);
  assert.strictEqual(new Set(api.log.exchanged.map((x) => x.name)).size, 7);
});

test("Hunter deliveries equip all seven pieces on their intended classes", async () => {
  const p = bootParty({
    pack: "bat",
    pots: 200,
    gold: 500000,
    bankSeed: [{ name: "monstertoken", q: 23 }],
  });
  seedBagTokens(p, 41);
  await advertise(p);
  const result = await p.bots.Puppygirl.ctrl.startHunterPlan();
  assert.strictEqual(result.success, true);

  for (let i = 0; i < 2000; i++) {
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
  assert.strictEqual(p.bots.Puppygirl.ctrl.store.q.length, 0);
  assert.strictEqual(p.bots.Puppygirl.ctrl.store.active, null);
  assert.ok(
    p.bots.Puppygirl.api.log.game.filter((x) => /^dlv:send_gear/.test(x.m)).length === 7
  );
  for (const who of ["Jazwyn", "Sarene", "Zarook"]) {
    assert.ok(!p.bots[who].api.log.game.some((x) => x.m === "Wrong weapon"));
  }
});

module.exports = { tests };
