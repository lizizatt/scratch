"use strict";

/**
 * Earring/cape GEAR_TARGETS + Ponty browse for empty accessory slots.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { planGifts, candidateSlots, isSellJunk, isGearTargetName } = require("../src/gear");
const { GEAR_TARGETS, VENDOR_NPC, PONTY_WANT } = require("../src/constants");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("constants: earring/cape targets; str/vit/int earrings not vendored", () => {
  assert.strictEqual(GEAR_TARGETS.Jazwyn.earring1, "strearring");
  assert.strictEqual(GEAR_TARGETS.Zarook.earring1, "vitearring");
  assert.strictEqual(GEAR_TARGETS.Sarene.cape, "cape");
  assert.strictEqual(GEAR_TARGETS.Jazwyn.cape, "cape");
  assert.ok(VENDOR_NPC.indexOf("strearring") < 0);
  assert.ok(VENDOR_NPC.indexOf("vitearring") < 0);
  assert.ok(VENDOR_NPC.indexOf("intearring") < 0);
  assert.ok(VENDOR_NPC.indexOf("dexearring") >= 0);
  assert.ok(isGearTargetName("strearring"));
  assert.ok(isGearTargetName("cape"));
  assert.ok(!isSellJunk({ name: "strearring" }, {}));
  assert.ok(PONTY_WANT.some((w) => w[0] === "cape" && w[1] >= 3));
});

test("unit: earring candidateSlots + planGifts strearring to Jazwyn", () => {
  const G = {
    items: {
      strearring: { type: "earring", str: 3 },
      vitearring: { type: "earring", vit: 3 },
      cape: { type: "cape", armor: 10, resistance: 8, stat: 4 },
    },
  };
  assert.deepStrictEqual(candidateSlots({ name: "strearring" }, G), ["earring1", "earring2"]);
  assert.deepStrictEqual(candidateSlots({ name: "cape" }, G), ["cape"]);
  const gifts = planGifts(
    [
      { name: "strearring", level: 0, pack: "bag", i: 0 },
      { name: "cape", level: 0, pack: "bag", i: 1 },
    ],
    {
      Jazwyn: {
        ctype: "warrior",
        esize: 5,
        slots: { earring1: null, earring2: null, cape: null },
      },
    },
    G
  );
  assert.ok(gifts.some((g) => g.who === "Jazwyn" && g.slot === "earring1" && g.it.name === "strearring"));
  assert.ok(gifts.some((g) => g.who === "Jazwyn" && g.slot === "cape" && g.it.name === "cape"));
});

test("adversary: reclaim trade strearring then plan gift to Jazwyn", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 100,
    gold: 500000,
    members: ["Jazwyn", "Puppygirl"],
  });
  const mApi = p.bots.Puppygirl.api;
  const jApi = p.bots.Jazwyn.api;
  const m = mApi.character;
  m.gold = 800000;
  for (let i = 0; i < m.items.length; i++) {
    const it = m.items[i];
    if (it && (it.name === "stand0" || /^hpot|^mpot|^scroll/.test(it.name))) continue;
    if (it) {
      m.items[i] = null;
      m.esize = (m.esize || 0) + 1;
    }
  }
  m.stand = true;
  m.slots.trade7 = { name: "strearring", level: 0, price: 38000 };
  m._bank = { gold: 0, items0: new Array(42).fill(null) };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  // Empty earring ads
  jApi.character.slots.earring1 = null;
  jApi.character.slots.earring2 = null;
  // Force a gear_ad so merchant sees empty slots
  mApi.ctrl; // boot exists
  // Inject ad via merchant store — call gear ad path by ticking fighters near merchant
  jApi.character.map = "main";
  jApi.character.real_x = jApi.character.x = 45;
  jApi.character.real_y = jApi.character.y = -20;

  let reclaimed = false;
  let planned = false;
  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => /vendor:reclaim strearring|gear:plan strearring/.test(g.m))) {
      reclaimed = mApi.log.game.some((g) => /reclaim strearring|plan strearring/.test(g.m));
    }
    if (mApi.log.game.some((g) => /^gear:plan strearring/.test(g.m))) {
      planned = true;
      break;
    }
    if (m.items.some((x) => x && x.name === "strearring") && !m.slots.trade7) {
      reclaimed = true;
    }
  }
  assert.ok(reclaimed || planned, "must reclaim or plan strearring");
  assert.ok(!m.slots.trade7 || m.slots.trade7.name !== "strearring", "strearring off trade");
});

test("adversary: ponty buys cape under fair cap when needed", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 100,
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
  m._bank = { gold: 0, items0: new Array(42).fill(null) };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;
  p.world.ponty = [{ name: "cape", rid: "c1", price: 22000, level: 0 }];

  let bought = false;
  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => /^ponty:buy cape/.test(g.m))) {
      bought = true;
      break;
    }
  }
  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(bought, "must ponty buy cape, logs=" + msgs.filter((x) => /^ponty:/.test(x)).join(" | "));
  assert.ok(m.items.some((x) => x && x.name === "cape"), "cape in bag");
});

test("adversary: merchant waits three minutes between completed Ponty sweeps", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 100,
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
  m._bank = { gold: 0, items0: new Array(42).fill(null) };
  m.map = "main";
  m.real_x = m.x = 106;
  m.real_y = m.y = -47;
  m.stand = false;
  p.world.ponty = [];

  const polls = [];
  const realGetSecondhands = mApi.get_secondhands.bind(mApi);
  mApi.get_secondhands = async () => {
    polls.push(mApi._now());
    return realGetSecondhands();
  };

  for (let i = 0; i < 200; i++) await p.tickAll();

  assert.strictEqual(polls.length, 1, "completed sweep must suppress repeated polls");
  assert.strictEqual(m.stand, true, "idle merchant should hold the stall open");
  p.world.advance(180000);
  for (let i = 0; i < 20 && polls.length < 2; i++) await p.tickAll();
  assert.strictEqual(polls.length, 2, "must poll again after the cooldown");
  assert.ok(polls[1] - polls[0] >= 180000, "Ponty polls too close: " + polls.join(","));
});

test("adversary: idle stall keeps 32 pixels clear of other stalls", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 100,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const mApi = p.bots.Puppygirl.api;
  const m = mApi.character;
  const rivalApi = p.world.spawn({
    name: "RivalMerchant",
    ctype: "merchant",
    map: "main",
    real_x: 40,
    real_y: -20,
    x: 40,
    y: -20,
    stand: true,
  });
  const rival = rivalApi.character;
  m._bank = { gold: 0, items0: new Array(42).fill(null) };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;
  p.world.ponty = [];

  for (let i = 0; i < 200 && !m.stand; i++) await p.tickAll();

  assert.strictEqual(m.stand, true, "merchant should open after finding clear ground");
  assert.ok(
    Math.hypot(m.real_x - rival.real_x, m.real_y - rival.real_y) >= 32,
    "merchant opened too close to an existing stall"
  );
  mApi.log.moved.length = 0;
  const openX = m.real_x;
  const openY = m.real_y;
  const free = m.items.findIndex((it) => !it);
  m.items[free] = { name: "candycanesword", level: 1 };
  m.esize--;
  for (let i = 0; i < 80; i++) await p.tickAll();
  assert.ok(
    !mApi.log.moved.some((dest) => dest && dest.x === 40 && dest.y === -20),
    "listing work must not revisit the crowded plaza origin"
  );
  assert.strictEqual(m.real_x, openX, "listing work should retain the clear stall position");
  assert.strictEqual(m.real_y, openY, "listing work should retain the clear stall position");

  rival.real_x = rival.x = m.real_x + 8;
  rival.real_y = rival.y = m.real_y;
  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (m.stand && Math.hypot(m.real_x - rival.real_x, m.real_y - rival.real_y) >= 32) break;
  }

  assert.strictEqual(m.stand, true, "merchant should reopen after a rival crowds her");
  assert.ok(
    Math.hypot(m.real_x - rival.real_x, m.real_y - rival.real_y) >= 32,
    "merchant did not relocate after another stall moved nearby"
  );
  assert.ok(
    mApi.log.game.some((g) => g.m === "stall:space_relocate"),
    "crowding relocation should be visible in logs"
  );
});

test("adversary: idle stall keeps 32 pixels clear of Ponty and every map NPC", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 100,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const mApi = p.bots.Puppygirl.api;
  const m = mApi.character;
  const npcs = [
    { id: "secondhands", position: [40, -20] },
    { id: "favors", position: [0, -60] },
    { id: "pvp", positions: [[0, -20], [80, -60]] },
  ];
  mApi.G.maps.main.npcs = npcs;
  mApi.G.maps.main.seasonal_npcs = [{ id: "event_npc", position: [80, -20] }];
  m._bank = { gold: 0, items0: new Array(42).fill(null) };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;
  p.world.ponty = [];

  for (let i = 0; i < 200 && !m.stand; i++) await p.tickAll();

  assert.strictEqual(m.stand, true, "merchant should find a location clear of map NPCs");
  const positions = npcs
    .flatMap((npc) => (npc.position ? [npc.position] : npc.positions || []))
    .concat([[80, -20]]);
  for (const position of positions) {
    assert.ok(
      Math.hypot(m.real_x - position[0], m.real_y - position[1]) >= 32,
      "merchant opened too close to NPC at " + position.join(",")
    );
  }
});

module.exports = { tests };
