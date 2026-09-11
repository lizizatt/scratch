"use strict";

const assert = require("assert");
const { bootParty } = require("../src/boot_party");
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
    Zarook: [{ name: "strearring", level: 0 }, null],
  };
  const ads = {};
  for (const who of ["Jazwyn", "Sarene", "Zarook"]) {
    const api = p.bots[who].api;
    api.character.slots.earring1 = setup[who][0];
    api.character.slots.earring2 = setup[who][1];
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

module.exports = { tests };
