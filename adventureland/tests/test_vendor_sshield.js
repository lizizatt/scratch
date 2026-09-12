"use strict";

/**
 * NPC vendor junk (no stall) + spiked shield warrior-only + Jazwyn offhand target.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { classOk, planGifts, score, isSellJunk, eligibleUpgrade } = require("../src/gear");
const {
  VENDOR_NPC,
  VENDOR_NPC_LOW_LEVEL,
  VENDOR_NPC_MAX_LEVEL,
  GEAR_TARGETS,
  SCROLL0_ALLOW,
} = require("../src/constants");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("constants: VENDOR_NPC covers stuck stall junk; sshield is Jazwyn offhand target", () => {
  for (const n of ["wcap", "wshoes", "rednose", "dexamulet", "dexearring", "frogt", "beewings"]) {
    assert.ok(VENDOR_NPC.indexOf(n) >= 0, n);
  }
  assert.strictEqual(GEAR_TARGETS.Jazwyn.offhand, "sshield");
  assert.ok(SCROLL0_ALLOW.indexOf("sshield") >= 0, "upgrade spiked shield");
  assert.ok(SCROLL0_ALLOW.indexOf("wcap") < 0, "do not upgrade wcap");
});

test("unit: wearable duplicate junk is vendored through level one", () => {
  for (const n of ["wattire", "wgloves", "partyhat", "ringsj", "hpamulet", "hpbelt", "wbook0"]) {
    assert.ok(VENDOR_NPC_LOW_LEVEL.indexOf(n) >= 0, n);
    assert.strictEqual(VENDOR_NPC_MAX_LEVEL, 1);
    const G = { items: { [n]: { type: "ring", upgrade: true } } };
    if (n !== "wbook0") {
      assert.ok(isSellJunk({ name: n, level: 0 }, G));
      assert.ok(isSellJunk({ name: n, level: 1 }, G));
      assert.ok(!isSellJunk({ name: n, level: 2 }, G));
    }
  }
});

test("adversary: merchant vendors +0/+1 intelligence books but preserves +2", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 500000,
    members: ["Puppygirl"],
  });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  for (let i = 0; i < c.items.length; i++) c.items[i] = null;
  c.items[0] = { name: "stand0" };
  c.items[1] = { name: "hpot1", q: 200 };
  c.items[2] = { name: "mpot1", q: 200 };
  c.items[3] = { name: "wbook0", level: 0 };
  c.items[4] = { name: "wbook0", level: 1 };
  c.items[5] = { name: "wbook0", level: 2 };
  c.esize = c.items.filter((x) => !x).length;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;
  c._bank = { gold: 0, items0: new Array(42).fill(null) };

  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    if (api.log.game.filter((g) => g.m === "vendor:sell wbook0 x1").length >= 2) break;
  }

  const books = c.items.filter((x) => x && x.name === "wbook0");
  assert.deepStrictEqual(books.map((x) => x.level || 0), [2]);
});

test("unit: sshield classOk warrior only; scores above plain shield", () => {
  const G = {
    items: {
      sshield: { type: "shield", armor: 60, resistance: 20, dreturn: 3 },
      shield: { type: "shield", armor: 60, resistance: 20 },
      wbook0: { type: "source", int: 3 },
    },
  };
  assert.ok(classOk({ name: "sshield" }, "warrior", G));
  assert.ok(!classOk({ name: "sshield" }, "priest", G));
  assert.ok(!classOk({ name: "sshield" }, "mage", G));
  assert.ok(classOk({ name: "wbook0" }, "priest", G));
  assert.ok(!classOk({ name: "wbook0" }, "warrior", G));
  assert.ok(
    score({ name: "sshield", level: 0 }, G, "warrior") >
      score({ name: "shield", level: 0 }, G, "warrior"),
    "dreturn edge"
  );
});

test("unit: planGifts does not gift sshield to Zarook", () => {
  const G = {
    items: {
      sshield: { type: "shield", armor: 60, resistance: 20, dreturn: 3 },
      wbook0: { type: "source", int: 3 },
    },
  };
  const gifts = planGifts(
    [{ name: "sshield", level: 0, pack: "items0", i: 0 }],
    {
      Zarook: { ctype: "priest", esize: 5, slots: { offhand: null } },
      Jazwyn: { ctype: "warrior", esize: 5, slots: { offhand: null } },
    },
    G
  );
  assert.ok(
    !gifts.some((g) => g.who === "Zarook" && g.it && g.it.name === "sshield"),
    "no sshield to priest"
  );
  assert.ok(
    gifts.some((g) => g.who === "Jazwyn" && g.it && g.it.name === "sshield"),
    "sshield to warrior"
  );
});

test("adversary: idle merchant NPC-vendors frogt (no stall list)", async () => {
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
  m._bank = { gold: 0, items0: [{ name: "frogt" }, { name: "wcap", level: 0 }, null] };
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;
  // Simulate full stall of dead listings.
  m.slots.trade1 = { name: "wshoes", level: 0, price: 24200 };
  m.slots.trade2 = { name: "rednose", level: 0, price: 32000 };

  let sold = false;
  for (let i = 0; i < 300; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => /^vendor:sell /.test(g.m))) {
      sold = true;
      break;
    }
  }
  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(sold, "must vendor sell, logs=" + msgs.filter((x) => /^vendor:|^stall:|^bank:/.test(x)).join(" | "));
  assert.ok(!msgs.some((m) => /^stall:list /.test(m)), "must not stall-list junk");
  assert.ok(!m.slots.trade1 || !isSellJunk(m.slots.trade1, mApi.G), "trade junk reclaimed/sold");
});

test("adversary: Zarook strips spiked shield and does not re-equip", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 50,
    gold: 200000,
    members: ["Zarook", "Puppygirl"],
  });
  const zApi = p.bots.Zarook.api;
  const z = zApi.character;
  z.slots.offhand = { name: "sshield", level: 0 };
  // Leave a free bag slot for unequip.
  for (let i = 0; i < z.items.length; i++) {
    const it = z.items[i];
    if (it && /^hpot|^mpot/.test(it.name)) {
      z.items[i] = null;
      z.esize = (z.esize || 0) + 1;
      break;
    }
  }
  z.map = "main";
  z.real_x = z.x = 500;
  z.real_y = z.y = 1840;

  let stripped = false;
  for (let n = 0; n < 40; n++) {
    await p.tickAll();
    if (zApi.log.game.some((g) => g.m === "strip sshield from offhand")) {
      stripped = true;
      break;
    }
  }
  assert.ok(stripped, "priest must strip sshield");
  assert.ok(!z.slots.offhand || z.slots.offhand.name !== "sshield", "offhand cleared");
  // Should not re-equip from bag
  const bagI = z.items.findIndex((x) => x && x.name === "sshield");
  if (bagI >= 0) {
    for (let n = 0; n < 20; n++) await p.tickAll();
    assert.ok(!z.slots.offhand || z.slots.offhand.name !== "sshield", "must not re-equip sshield");
  }
});

test("unit: wcap not eligible for scroll0 upgrade", () => {
  const G = { items: { wcap: { upgrade: true, grades: [7, 9] }, sshield: { upgrade: true, grades: [4, 8] } } };
  assert.ok(!eligibleUpgrade({ name: "wcap", level: 0 }, G));
  assert.ok(eligibleUpgrade({ name: "sshield", level: 0 }, G));
});

module.exports = { tests };
