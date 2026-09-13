"use strict";

const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const {
  inventoryDigest,
  makeInventorySnapshot,
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

  const snap = makeInventorySnapshot(api, 9);
  assert.strictEqual(snap.revision, 9);
  assert.strictEqual(snap.slots.earring1.name, "intearring");
  assert.strictEqual(snap.slots.earring2, null);
  const bag = snap.bag.find((x) => x.where === "bag:7");
  assert.ok(bag && bag.uid && bag.fingerprint);
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

test("merchant never coordinates direct fighter gear transfers", async () => {
  const p = bootParty({ pack: "bat", pots: 200, gold: 500000 });
  p.bots.Jazwyn.api.character.slots.earring1 = { name: "intearring", level: 2 };
  p.bots.Jazwyn.api.character.slots.earring2 = { name: "intearring", level: 2 };
  p.bots.Sarene.api.character.slots.earring1 = { name: "intearring", level: 0 };
  p.bots.Sarene.api.character.slots.earring2 = { name: "vitearring", level: 0 };
  p.bots.Zarook.api.character.items[7] = { name: "strearring", level: 0 };
  p.world.advance(20000);

  for (let i = 0; i < 80; i++) await p.tickAll();

  const forbidden = [
    "gear_plan",
    "gear_transfer",
    "gear_check",
    "gear_finish",
    "gear_cancel",
  ];
  const messages = p.bots.Puppygirl.api.log.cm.map((entry) => entry.message || {});
  assert.ok(messages.every((message) => forbidden.every((key) => !message[key])));
  assert.ok(
    !p.bots.Puppygirl.api.log.game.some((entry) => /^gear_tx:/.test(entry.m)),
    "direct transaction journal must stay retired"
  );
});

module.exports = { tests };
