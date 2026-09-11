"use strict";

const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { bootFighter } = require("../src/fighter");
const {
  inventoryDigest,
  makeInventorySnapshot,
  resolveObservedItem,
  planPeerGearTransfers,
} = require("../src/gear_coordination");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("inventory advertisement includes empty slots and exact bag identities", async () => {
  const p = bootParty({ pack: "bat" });
  const api = p.bots.Jazwyn.api;
  api.character.slots.earring1 = { name: "intearring", level: 2 };
  api.character.items[7] = { name: "strearring", level: 1 };
  api.character.esize = api.character.items.filter((x) => !x).length;

  const snap = makeInventorySnapshot(api, 9, {});
  assert.strictEqual(snap.revision, 9);
  assert.strictEqual(snap.slots.earring1.name, "intearring");
  assert.strictEqual(snap.slots.earring2, null);
  const bag = snap.bag.find((x) => x.where === "bag:7");
  assert.ok(bag && bag.uid && bag.fingerprint);
  assert.strictEqual(resolveObservedItem(api, bag).index, 7);

  api.character.items[7] = { name: "vitearring", level: 1 };
  assert.strictEqual(resolveObservedItem(api, bag), null);
  assert.notStrictEqual(inventoryDigest(api), JSON.stringify({}));
});

test("merchant rejects a fighter spoofing another fighter's inventory", async () => {
  const p = bootParty({ pack: "bat" });
  p.world.advance(20000);
  await p.tickAll();
  const before = p.bots.Puppygirl.ctrl.gearAds.Jazwyn;
  assert.ok(before && before.who === "Jazwyn");

  await p.bots.Sarene.api.send_cm("Puppygirl", {
    gear_ad: 1,
    inventory_ad: 1,
    v: 2,
    name: "Jazwyn",
    who: "Jazwyn",
    revision: 9999,
    slots: {},
    bag: [],
  });

  assert.strictEqual(p.bots.Puppygirl.ctrl.gearAds.Jazwyn, before);
});

test("fighter ignores gear control from another fighter", async () => {
  const p = bootParty({ pack: "bat" });
  const j = p.bots.Jazwyn.api.character;
  j.items[5] = { name: "strearring", level: 0 };
  j.esize = j.items.filter((x) => !x).length;

  await p.bots.Sarene.api.send_cm("Jazwyn", {
    gear_offer: 1,
    id: "spoof",
    name: "strearring",
    level: 0,
    slot: "earring1",
  });
  await Promise.resolve();

  assert.ok(!j.slots.earring1 || j.slots.earring1.name !== "strearring");
});

test("party planner finds the cross-equipped earring exchange", async () => {
  const p = bootParty({ pack: "bat" });
  const setup = {
    Jazwyn: [
      { name: "intearring", level: 2 },
      { name: "intearring", level: 2 },
    ],
    Sarene: [
      { name: "intearring", level: 0 },
      { name: "vitearring", level: 0 },
    ],
    Zarook: [null, null],
  };
  const ads = {};
  for (const who of ["Jazwyn", "Sarene", "Zarook"]) {
    const api = p.bots[who].api;
    api.character.slots.earring1 = setup[who][0];
    api.character.slots.earring2 = setup[who][1];
    if (who === "Zarook") api.character.items[7] = { name: "strearring", level: 0 };
    ads[who] = makeInventorySnapshot(api, 1, {});
  }

  const plan = planPeerGearTransfers(ads, p.world.G);
  assert.ok(plan && plan.legs.length >= 2);
  assert.ok(
    plan.legs.some((x) => x.from === "Zarook" && x.to === "Jazwyn" && x.item.name === "strearring")
  );
  assert.ok(
    plan.legs.some((x) => x.from === "Jazwyn" && x.item.name === "intearring"),
    "Jazwyn should release an intelligence earring as part of the improving assignment"
  );
});

test("Puppygirl coordinates a mutually improving live-shaped earring exchange", async () => {
  const p = bootParty({ pack: "bat", pots: 200, gold: 500000 });
  const setup = {
    Jazwyn: [
      { name: "intearring", level: 2 },
      { name: "intearring", level: 2 },
    ],
    Sarene: [
      { name: "intearring", level: 0 },
      { name: "vitearring", level: 0 },
    ],
    Zarook: [null, null],
  };
  for (const who of ["Jazwyn", "Sarene", "Zarook"]) {
    const c = p.bots[who].api.character;
    c.slots.earring1 = setup[who][0];
    c.slots.earring2 = setup[who][1];
    if (who === "Zarook") c.items[7] = { name: "strearring", level: 0 };
    c.esize = c.items.filter((x) => !x).length;
    const api = p.bots[who].api;
    const getPlayer = api.get_player.bind(api);
    api.get_player = (target) => {
      const player = getPlayer(target);
      if (!player) return player;
      const liveShape = Object.assign({}, player);
      delete liveShape.esize;
      return liveShape;
    };
  }
  const merchantCm = p.bots.Puppygirl.api.send_cm.bind(p.bots.Puppygirl.api);
  let churned = false;
  p.bots.Puppygirl.api.send_cm = async (to, message) => {
    if (!churned && message && message.gear_plan) {
      churned = true;
      const pot = p.bots[to].api.character.items.find((x) => x && x.name === "hpot1");
      if (pot && pot.q > 1) pot.q -= 1;
    }
    return merchantCm(to, message);
  };
  p.world.advance(20000);
  for (let i = 0; i < 160; i++) {
    await p.tickAll();
    const logs = p.bots.Puppygirl.api.log.game.map((x) => x.m);
    if (logs.some((x) => x.indexOf("gear_tx:done") === 0)) break;
  }

  const jaz = p.bots.Jazwyn.api.character;
  assert.ok(
    [jaz.slots.earring1, jaz.slots.earring2].some((x) => x && x.name === "strearring"),
    "Jazwyn should receive Zarook's strength earring"
  );
  const logs = p.bots.Puppygirl.api.log.game.map((x) => x.m);
  assert.ok(logs.some((x) => x.indexOf("gear_tx:plan") === 0));
  assert.ok(logs.some((x) => x.indexOf("gear_tx:done") === 0));
  assert.ok(churned, "test must mutate unrelated inventory between advertisement and prepare");
  assert.strictEqual(
    p.bots.Zarook.api.log.sent.filter((x) => x.name === "Jazwyn" && x.item === "strearring").length,
    1,
    "retries must not duplicate the physical transfer"
  );
});

test("prepared receiver preserves its incoming bag slot", async () => {
  const p = bootParty({ pack: "bat" });
  const jaz = p.bots.Jazwyn;
  const source = p.bots.Zarook.api;
  source.character.items[7] = { name: "strearring", level: 0 };
  const incoming = makeInventorySnapshot(source, 1, {}).bag.find((x) => x.where === "bag:7");
  for (let i = 0; i < jaz.api.character.items.length - 1; i++) {
    jaz.api.character.items[i] = { name: "hpot1", q: 1 };
  }
  jaz.api.character.esize = 1;
  let lootCalls = 0;
  jaz.api.loot = () => {
    lootCalls++;
    const index = jaz.api.character.items.findIndex((x) => !x);
    if (index >= 0) {
      jaz.api.character.items[index] = { name: "slime", q: 1 };
      jaz.api.character.esize--;
    }
  };

  await p.bots.Puppygirl.api.send_cm("Jazwyn", {
    gear_plan: 1,
    tx: "reserve-inbound",
    plan_revision: 1,
    expires_at: p.world.clock.now() + 120000,
    outgoing: [],
    incoming: [{ index: 0, from: "Zarook", to: "Jazwyn", toSlot: "earring1", item: incoming }],
  });
  assert.strictEqual(jaz.ctrl.gearTxn.phase, "prepared");

  await jaz.ctrl.tick();
  assert.strictEqual(lootCalls, 0);
  assert.strictEqual(jaz.api.character.esize, 1);
});

test("range cancellation recovers after fresh equal-revision advertisements", async () => {
  const p = bootParty({ pack: "bat" });
  for (const who of ["Jazwyn", "Sarene", "Zarook"]) {
    const c = p.bots[who].api.character;
    for (const slot of ["cape", "belt", "amulet", "earring1", "earring2", "ring1", "ring2", "orb"]) {
      c.slots[slot] = null;
    }
    c.items = c.items.map((it) => (it && /^hpot|^mpot/.test(it.name) ? it : null));
    c.real_x = 0;
    c.real_y = 0;
    c.esize = c.items.filter((x) => !x).length;
  }
  p.bots.Zarook.api.character.items[7] = { name: "strearring", level: 0 };
  p.bots.Zarook.api.character.esize = p.bots.Zarook.api.character.items.filter((x) => !x).length;

  p.world.advance(20000);
  for (const who of ["Jazwyn", "Sarene", "Zarook"]) {
    const api = p.bots[who].api;
    await api.send_cm(
      "Puppygirl",
      Object.assign({ gear_ad: 1, name: who }, makeInventorySnapshot(api, 1, {}))
    );
  }
  await p.bots.Puppygirl.ctrl.tick();
  const first = p.bots.Puppygirl.ctrl.store.gearTx;
  assert.ok(first && first.legs.length === 1);
  const baseline = {
    Jazwyn: p.bots.Puppygirl.ctrl.gearAds.Jazwyn.revision,
    Zarook: p.bots.Puppygirl.ctrl.gearAds.Zarook.revision,
  };

  p.bots.Zarook.api.character.real_x += 1000;
  for (let i = 0; i < 100 && p.bots.Puppygirl.ctrl.store.gearTx; i++) {
    p.world.advance(250);
    await p.bots.Puppygirl.ctrl.tick();
  }
  assert.strictEqual(p.bots.Puppygirl.ctrl.store.gearTx, null);
  assert.strictEqual(p.bots.Puppygirl.ctrl.gearAds.Jazwyn.revision, baseline.Jazwyn);
  assert.strictEqual(p.bots.Puppygirl.ctrl.gearAds.Zarook.revision, baseline.Zarook);

  p.bots.Zarook.api.character.real_x = p.bots.Jazwyn.api.character.real_x;
  p.bots.Zarook.api.character.real_y = p.bots.Jazwyn.api.character.real_y;
  for (const who of ["Jazwyn", "Zarook"]) {
    const api = p.bots[who].api;
    await api.send_cm(
      "Puppygirl",
      Object.assign(
        { gear_ad: 1, name: who },
        makeInventorySnapshot(api, baseline[who], {})
      )
    );
  }
  for (let i = 0; i < 180; i++) {
    p.world.advance(250);
    await p.bots.Puppygirl.ctrl.tick();
    if (
      p.bots.Jazwyn.api.character.slots.earring1 &&
      p.bots.Jazwyn.api.character.slots.earring1.name === "strearring"
    )
      break;
  }

  const logs = p.bots.Puppygirl.api.log.game.map((x) => x.m);
  assert.ok(p.bots.Puppygirl.ctrl.store.gearPlanRevision >= 2);
  assert.ok(logs.some((x) => x.indexOf("gear_tx:cancel") === 0 && x.indexOf("not_in_range") >= 0));
  assert.strictEqual(p.bots.Jazwyn.api.character.slots.earring1.name, "strearring");
});

test("stale observed item is rejected before preparation", async () => {
  const p = bootParty({ pack: "bat" });
  const j = p.bots.Jazwyn.api.character;
  j.slots.earring1 = { name: "intearring", level: 2 };
  p.world.advance(20000);
  await p.tickAll();
  const ref = p.bots.Puppygirl.ctrl.gearAds.Jazwyn.slots.earring1;
  j.slots.earring1 = { name: "strearring", level: 0 };

  await p.bots.Puppygirl.api.send_cm("Jazwyn", {
    gear_plan: 1,
    v: 2,
    tx: "stale-plan",
    plan_revision: 1,
    expires_at: p.world.clock.now() + 10000,
    outgoing: [{ index: 0, from: "Jazwyn", to: "Zarook", item: ref, toSlot: "earring1" }],
    incoming: [],
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.strictEqual(p.bots.Jazwyn.ctrl.gearTxn, null);
  assert.ok(
    p.bots.Jazwyn.api.log.cm.some(
      (x) => x.message && x.message.gear_tx_report && x.message.tx === "stale-plan" && x.message.error === "stale_item"
    )
  );
});

test("coordinator does not start a swap without participant capacity", async () => {
  const p = bootParty({ pack: "bat" });
  p.bots.Jazwyn.api.character.slots.earring1 = { name: "intearring", level: 2 };
  p.bots.Zarook.api.character.slots.earring1 = { name: "strearring", level: 0 };
  for (const who of ["Jazwyn", "Sarene", "Zarook"]) {
    const c = p.bots[who].api.character;
    for (let i = 0; i < c.items.length; i++) c.items[i] = { name: "hpot1", q: 1 };
    c.esize = 0;
  }
  p.world.advance(20000);
  for (let i = 0; i < 20; i++) await p.tickAll();
  assert.ok(!p.bots.Puppygirl.ctrl.store.gearTx);
});

test("prepared reservations survive a fighter controller reload", async () => {
  const p = bootParty({ pack: "bat" });
  const api = p.bots.Jazwyn.api;
  api.character.slots.earring1 = { name: "intearring", level: 2 };
  p.world.advance(20000);
  await p.tickAll();
  const ref = p.bots.Puppygirl.ctrl.gearAds.Jazwyn.slots.earring1;

  await p.bots.Puppygirl.api.send_cm("Jazwyn", {
    gear_plan: 1,
    v: 2,
    tx: "reload-plan",
    plan_revision: 1,
    expires_at: p.world.clock.now() + 10000,
    outgoing: [{ index: 0, from: "Jazwyn", to: "Zarook", item: ref, toSlot: "earring1" }],
    incoming: [],
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(p.bots.Jazwyn.ctrl.gearTxn && p.bots.Jazwyn.ctrl.gearTxn.phase === "prepared");

  const restored = bootFighter(api, { now: () => p.world.clock.now(), farm: "bat" });
  assert.ok(restored.gearTxn && restored.gearTxn.tx === "reload-plan");
  assert.strictEqual(restored.gearTxn.phase, "prepared");
});

test("duplicate plans during delayed preparation do not unequip twice", async () => {
  const p = bootParty({ pack: "bat" });
  const api = p.bots.Jazwyn.api;
  api.character.slots.earring1 = { name: "intearring", level: 2 };
  p.world.advance(20000);
  await p.tickAll();
  const ref = p.bots.Puppygirl.ctrl.gearAds.Jazwyn.slots.earring1;
  const originalUnequip = api.unequip.bind(api);
  let release;
  let calls = 0;
  api.unequip = (slot) => {
    calls++;
    return new Promise((resolve) => {
      release = () => originalUnequip(slot).then(resolve);
    });
  };
  const plan = {
    gear_plan: 1,
    v: 2,
    tx: "delayed-plan",
    plan_revision: 1,
    expires_at: p.world.clock.now() + 10000,
    outgoing: [{ index: 0, from: "Jazwyn", to: "Zarook", item: ref, toSlot: "earring1" }],
    incoming: [],
  };
  await p.bots.Puppygirl.api.send_cm("Jazwyn", plan);
  await p.bots.Puppygirl.api.send_cm("Jazwyn", plan);
  assert.strictEqual(calls, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(p.bots.Jazwyn.ctrl.gearTxn && p.bots.Jazwyn.ctrl.gearTxn.phase === "prepared");
});

test("cancel during delayed preparation cannot resurrect a reservation", async () => {
  const p = bootParty({ pack: "bat" });
  const api = p.bots.Jazwyn.api;
  api.character.slots.earring1 = { name: "intearring", level: 2 };
  p.world.advance(20000);
  await p.tickAll();
  const ref = p.bots.Puppygirl.ctrl.gearAds.Jazwyn.slots.earring1;
  const originalUnequip = api.unequip.bind(api);
  let release;
  api.unequip = (slot) =>
    new Promise((resolve) => {
      release = () => originalUnequip(slot).then(resolve);
    });
  await p.bots.Puppygirl.api.send_cm("Jazwyn", {
    gear_plan: 1,
    v: 2,
    tx: "cancel-race",
    plan_revision: 1,
    expires_at: p.world.clock.now() + 10000,
    outgoing: [{ index: 0, from: "Jazwyn", to: "Zarook", item: ref, toSlot: "earring1" }],
    incoming: [],
  });
  await p.bots.Puppygirl.api.send_cm("Jazwyn", { gear_cancel: 1, v: 2, tx: "cancel-race" });
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(p.bots.Jazwyn.ctrl.gearTxn, null);
  await p.bots.Jazwyn.ctrl.tick();
  assert.ok(
    [api.character.slots.earring1, api.character.slots.earring2].some(
      (x) => x && x.name === "intearring" && (x.level || 0) === 2
    )
  );
});

test("duplicate transfer commands cannot overlap send_item", async () => {
  const p = bootParty({ pack: "bat" });
  const zApi = p.bots.Zarook.api;
  zApi.character.slots.earring1 = { name: "strearring", level: 0 };
  p.world.advance(20000);
  await p.tickAll();
  const ref = p.bots.Puppygirl.ctrl.gearAds.Zarook.slots.earring1;
  await p.bots.Puppygirl.api.send_cm("Zarook", {
    gear_plan: 1,
    v: 2,
    tx: "send-race",
    plan_revision: 1,
    expires_at: p.world.clock.now() + 10000,
    outgoing: [{ index: 0, from: "Zarook", to: "Jazwyn", item: ref, toSlot: "earring1" }],
    incoming: [],
  });
  await Promise.resolve();
  const originalSend = zApi.send_item.bind(zApi);
  let release;
  let calls = 0;
  zApi.send_item = (to, index, q) => {
    calls++;
    return new Promise((resolve) => {
      release = () => originalSend(to, index, q).then(resolve);
    });
  };
  const command = { gear_transfer: 1, v: 2, tx: "send-race", index: 0 };
  await p.bots.Puppygirl.api.send_cm("Zarook", command);
  await p.bots.Puppygirl.api.send_cm("Zarook", command);
  assert.strictEqual(calls, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(
    zApi.log.sent.filter((x) => x.name === "Jazwyn" && x.item === "strearring").length,
    1
  );
});

test("expired prepared transaction releases and re-equips reserved gear", async () => {
  const p = bootParty({ pack: "bat" });
  const api = p.bots.Jazwyn.api;
  api.character.slots.earring1 = { name: "intearring", level: 2 };
  p.world.advance(20000);
  await p.tickAll();
  const ref = p.bots.Puppygirl.ctrl.gearAds.Jazwyn.slots.earring1;
  await p.bots.Puppygirl.api.send_cm("Jazwyn", {
    gear_plan: 1,
    v: 2,
    tx: "lost-finish",
    plan_revision: 1,
    expires_at: p.world.clock.now() + 1000,
    outgoing: [{ index: 0, from: "Jazwyn", to: "Zarook", item: ref, toSlot: "earring1" }],
    incoming: [],
  });
  await Promise.resolve();
  assert.ok(p.bots.Jazwyn.ctrl.gearTxn);
  p.world.advance(7000);
  await p.bots.Jazwyn.ctrl.tick();
  assert.strictEqual(p.bots.Jazwyn.ctrl.gearTxn, null);
  assert.ok(
    [api.character.slots.earring1, api.character.slots.earring2].some(
      (x) => x && x.name === "intearring" && (x.level || 0) === 2
    )
  );
});

module.exports = { tests };
