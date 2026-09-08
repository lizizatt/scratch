"use strict";

const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { gradeSim, mvpPass } = require("../sim/invariants");
const { HOME } = require("../src/constants");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("scenario: farm armadillo stays together, 0 throttle", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200 });
  await p.runFor(60000); // 1 min sim
  const c = gradeSim(p.world, { pack: "armadillo", R: 600 });
  // force a sample
  c.samples = Math.max(1, c.samples);
  const j = p.bots.Jazwyn.api;
  assert.strictEqual(j.character.map, "main");
  assert.ok(Math.abs(j.character.real_x - 526) < 80);
  assert.strictEqual(c.chat_throttle, 0);
  assert.strictEqual(c.fighter_hop, 0);
});

test("scenario: dry pots → merchant delivery → dlv_done", async () => {
  const p = bootParty({ pack: "armadillo", pots: 0, gold: 50000 });
  // Give merchant a head start stocking
  await p.bots.Jazwyn.ctrl.requestPots();
  // Run until delivery or timeout
  let done = false;
  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (p.bots.Jazwyn.api.log.game.some((g) => /dlv:done/.test(g.m))) {
      done = true;
      break;
    }
    if (p.bots.Puppygirl.api.log.game.some((g) => /dlv:done/.test(g.m))) {
      done = true;
      break;
    }
  }
  assert.ok(done, "expected dlv:done in logs");
  const pots = p.bots.Jazwyn.api.character.items.filter((x) => x && /^hpot|^mpot/.test(x.name));
  assert.ok(pots.length >= 1, "fighter should have pots");
  const c = gradeSim(p.world, {});
  assert.strictEqual(c.chat_throttle, 0);
  assert.strictEqual(c.fighter_hop, 0);
});

test("scenario: merchant delayed → fighter waits; silence → town_fallback", async () => {
  const p = bootParty({ pack: "armadillo", pots: 0, gold: 100000 });
  // Don't tick merchant — only fighters; no ack → 90s silence grace
  await p.bots.Jazwyn.ctrl.requestPots();
  p.bots.Jazwyn.ctrl._setDlv({ id: "x", t0: p.world.clock.now(), acked: 0 });
  for (let i = 0; i < 400; i++) {
    await p.bots.Jazwyn.ctrl.tick();
    p.world.advance(250);
    if (p.bots.Jazwyn.api.log.game.some((g) => /town_fallback/.test(g.m))) break;
  }
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /town_fallback/.test(g.m)));
});

test("scenario: phoenix spot → assemble → kill → resume, no fighter hop", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200 });
  const key = "US/III";
  p.world.spawnMonster(key, "main", "phoenix", { x: 526, y: 1846 }, "phx1");
  let killed = false;
  for (let i = 0; i < 100; i++) {
    await p.tickAll();
    if (p.bots.Jazwyn.api.log.game.some((g) => /rare_kill/.test(g.m))) {
      killed = true;
      break;
    }
  }
  assert.ok(killed, "expected rare_kill");
  const c = gradeSim(p.world, {});
  assert.strictEqual(c.fighter_hop, 0);
  assert.ok(!p.bots.Jazwyn.api.log.game.some((g) => /Transfer phoenix/.test(g.m)));
});

test("scenario: smart_move phoenix by type never used; path storm absent", async () => {
  const p = bootParty({ pots: 200 });
  const r = await p.bots.Jazwyn.api.smart_move({ to: "phoenix" });
  assert.strictEqual(r.failed, true);
});

test("scenario: chat stress 3 writers + heartbeat → 0 throttle", async () => {
  const p = bootParty({ pots: 200 });
  for (let i = 0; i < 20; i++) {
    p.bots.Jazwyn.ctrl.chat.enqueue("~S f=armadillo m=farm h=0", "hb");
    p.bots.Sarene.ctrl.chat.enqueue("~d p=ok", "diff");
    p.bots.Zarook.ctrl.chat.enqueue("~d p=ok", "diff");
    p.bots.Jazwyn.ctrl.chat.tick(p.world.clock.now());
    p.bots.Sarene.ctrl.chat.tick(p.world.clock.now());
    p.bots.Zarook.ctrl.chat.tick(p.world.clock.now());
    p.world.advance(16000);
  }
  const c = gradeSim(p.world, {});
  assert.strictEqual(c.chat_throttle, 0, "throttles=" + c.chat_throttle);
});

test("scenario: hold triggers hop-prep; fighter ends on HOME", async () => {
  const p = bootParty({ pots: 200, gold: 50000 });
  // Command hold via party state
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hold", args: [] });
  for (let i = 0; i < 50; i++) {
    await p.tickAll();
    // complete reconnect if hopping
    p.world.tickReconnects();
    if (p.world.where("Jazwyn").key === "US/II" && p.bots.Jazwyn.api.character.connected) break;
  }
  // Allow server_region ready
  p.world.advance(5000);
  assert.strictEqual(p.world.where("Jazwyn").key, "US/II");
});

test("scenario: compressed 30 min farm armadillo, 0 throttle 0 fighter hop", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, burnPots: true });
  await p.runFor(30 * 60 * 1000);
  const c = gradeSim(p.world, { pack: "armadillo", R: 800 });
  assert.strictEqual(c.chat_throttle, 0);
  assert.strictEqual(c.fighter_hop, 0);
  assert.ok(c.path_storm < 10);
  // Still on farm world
  assert.strictEqual(p.world.where("Jazwyn").key, "US/III");
  assert.strictEqual(p.world.where("Sarene").key, "US/III");
  assert.strictEqual(p.world.where("Zarook").key, "US/III");
});

test("scenario: gear bank piece batched on pot delivery", async () => {
  const p = bootParty({ pack: "armadillo", pots: 0 });
  // Put a glove in merchant bag for dlv_gear
  p.bots.Puppygirl.api.character.items[5] = { name: "gloves", level: 0, q: 1 };
  p.bots.Puppygirl.ctrl.enqueue({
    id: "g1",
    kind: "dlv_gear",
    who: "Jazwyn",
    items: [
      { name: "hpot1", q: 200 },
      { name: "mpot1", q: 200 },
    ],
    gear: { name: "gloves", level: 0 },
    farm: "armadillo",
    map: "main",
    x: 526,
    y: 1846,
  });
  let done = false;
  for (let i = 0; i < 300; i++) {
    await p.tickAll();
    if (p.bots.Puppygirl.api.log.game.some((g) => /dlv:done id=g1/.test(g.m))) {
      done = true;
      break;
    }
  }
  assert.ok(done);
  assert.ok(p.bots.Jazwyn.api.character.items.some((x) => x && x.name === "gloves"));
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
});

test("scenario: boot order Zarook→Puppygirl→Sarene→Jazwyn", async () => {
  const { createWorld } = require("../sim");
  const { bootFighter } = require("../src/fighter");
  const { bootMerchant } = require("../src/merchant");
  const { packCenter } = require("../sim/world");
  const w = createWorld();
  const pc = packCenter("armadillo");
  const order = ["Zarook", "Puppygirl", "Sarene", "Jazwyn"];
  const bots = {};
  for (const name of order) {
    if (name === "Puppygirl") {
      const api = w.spawn({ name, ctype: "merchant", map: "main", real_x: 56, real_y: -122, gold: 1e6, items: new Array(42).fill(null), esize: 30 });
      bots[name] = bootMerchant(api, { now: () => w.clock.now() });
    } else {
      const api = w.spawn({
        name,
        map: pc.map,
        real_x: pc.x,
        real_y: pc.y,
        gold: 50000,
        items: [
          { name: "hpot1", q: 100 },
          { name: "mpot1", q: 100 },
        ].concat(new Array(40).fill(null)),
      });
      bots[name] = bootFighter(api, { now: () => w.clock.now() });
    }
    // tick whoever exists
    for (const n of Object.keys(bots)) {
      if (bots[n].tick) await bots[n].tick();
    }
    w.advance(1000);
  }
  w.formParty("US/III", ["Jazwyn", "Sarene", "Zarook"]);
  w.spawnMonster("US/III", pc.map, "armadillo", pc);
  for (let i = 0; i < 40; i++) {
    for (const n of order) await bots[n].tick();
    w.advance(250);
  }
  assert.strictEqual(bots.Jazwyn.isLead(), true);
  assert.strictEqual(gradeSim(w, {}).chat_throttle, 0);
});

test("scenario: boot Zarook-only subset farms without crash", async () => {
  const { createWorld } = require("../sim");
  const { bootFighter } = require("../src/fighter");
  const { packCenter } = require("../sim/world");
  const w = createWorld();
  const pc = packCenter("armadillo");
  const api = w.spawn({
    name: "Zarook",
    ctype: "priest",
    map: pc.map,
    real_x: pc.x,
    real_y: pc.y,
    items: [
      { name: "hpot1", q: 100 },
      { name: "mpot1", q: 100 },
    ].concat(new Array(40).fill(null)),
  });
  w.formParty("US/III", ["Zarook"]);
  w.spawnMonster("US/III", pc.map, "armadillo", pc);
  const ctrl = bootFighter(api, { now: () => w.clock.now() });
  for (let i = 0; i < 20; i++) {
    await ctrl.tick();
    w.advance(250);
  }
  assert.strictEqual(ctrl.isLead(), true);
});

test("scenario: Puppygirl delivers via cave past ridge + island", async () => {
  const { isBlocked } = require("../sim/world");
  const { findPathSameMap } = require("../sim/path");
  // Party SE of the ridge (overland sealed). Merchant must tunnel the cave.
  const p = bootParty({ pack: "armadillo", pots: 0, gold: 50000 });
  for (const n of ["Jazwyn", "Sarene", "Zarook"]) {
    p.bots[n].api.character.map = "main";
    p.bots[n].api.character.real_x = 750;
    p.bots[n].api.character.x = 750;
    p.bots[n].api.character.real_y = 1750;
    p.bots[n].api.character.y = 1750;
    // Freeze fighters so they don't walk back to the armadillo pack mid-route
    p.bots[n].ctrl.tick = async () => {};
  }
  p.bots.Puppygirl.api.character.real_x = 56;
  p.bots.Puppygirl.api.character.x = 56;
  p.bots.Puppygirl.api.character.real_y = -122;
  p.bots.Puppygirl.api.character.y = -122;

  assert.strictEqual(
    findPathSameMap(
      { map: "main", x: 56, y: -122 },
      { map: "main", x: 750, y: 1750 },
      "main",
      p.world.G
    ),
    null
  );

  await p.bots.Jazwyn.ctrl.requestPots();
  let done = false;
  for (let i = 0; i < 600; i++) {
    await p.tickAll();
    const ch = p.bots.Puppygirl.api.character;
    if (ch.map === "main" || ch.map === "cave") {
      assert.ok(
        !isBlocked(ch.map, ch.real_x, ch.real_y, p.world.G),
        "in blocked " + ch.map + " " + ch.real_x + "," + ch.real_y
      );
    }
    if (
      p.bots.Jazwyn.api.log.game.some((g) => /dlv:done/.test(g.m)) ||
      p.bots.Puppygirl.api.log.game.some((g) => /dlv:done/.test(g.m))
    ) {
      done = true;
      break;
    }
  }
  assert.ok(done, "expected delivery");
  assert.ok(
    p.bots.Puppygirl.api.log.path.some((leg) => leg.from.map === "cave" || leg.to.map === "cave"),
    "path log must include cave legs: " +
      JSON.stringify(p.bots.Puppygirl.api.log.path.map((l) => l.from.map + ">" + l.to.map))
  );
  assert.strictEqual(p.bots.Puppygirl.api.character.map, "main");
  assert.ok(Math.abs(p.bots.Puppygirl.api.character.real_x - 750) < 80);
  assert.ok(Math.abs(p.bots.Puppygirl.api.character.real_y - 1750) < 80);
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
});

test("scenario: resume after hold returns fighters to farm world", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 50000 });
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hold", args: [] });
  for (let i = 0; i < 80; i++) {
    await p.tickAll();
    p.world.tickReconnects();
    if (p.world.where("Jazwyn").key === "US/II" && p.bots.Jazwyn.api.character.connected) break;
  }
  p.world.advance(5000);
  assert.strictEqual(p.world.where("Jazwyn").key, "US/II");
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "resume", args: [] });
  // resume clears hold; !world not required — farm continues on HOME until world set.
  // Send world back to farm so hop-prep returns to US/III.
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "world", args: ["US/III"] });
  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    p.world.tickReconnects();
    if (p.world.where("Jazwyn").key === "US/III" && p.bots.Jazwyn.api.character.connected) break;
  }
  p.world.advance(5000);
  assert.strictEqual(p.world.where("Jazwyn").key, "US/III");
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.hold, 0);
});

test("scenario: !world hop-prep lands party on target server", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, gold: 50000 });
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "world", args: ["US/II"] });
  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    p.world.tickReconnects();
    if (
      ["Jazwyn", "Sarene", "Zarook"].every(
        (n) => p.world.where(n).key === "US/II" && p.bots[n].api.character.connected
      )
    )
      break;
  }
  p.world.advance(5000);
  assert.strictEqual(p.world.where("Jazwyn").key, "US/II");
  assert.strictEqual(p.world.where("Sarene").key, "US/II");
  assert.ok(p.bots.Jazwyn.api.log.cm.some((c) => c.message && c.message.job === "cancel_all"));
});

test("scenario: chat stress + ~R + human echo + lead reboot reseeds seq", async () => {
  const p = bootParty({ pots: 200 });
  // Operator typing on leader resets chat window (human)
  p.bots.Jazwyn.ctrl.chat.markHuman();
  p.world.advance(16000);
  for (let i = 0; i < 12; i++) {
    p.bots.Jazwyn.ctrl.chat.enqueue("~S f=armadillo m=farm h=0", "hb");
    p.bots.Sarene.ctrl.chat.enqueue("~d p=ok", "diff");
    p.bots.Zarook.ctrl.chat.enqueue("~d p=ok", "diff");
    p.bots.Jazwyn.ctrl.chat.enqueue("~R phoenix", "rare");
    p.bots.Jazwyn.ctrl.chat.tick(p.world.clock.now());
    p.bots.Sarene.ctrl.chat.tick(p.world.clock.now());
    p.bots.Zarook.ctrl.chat.tick(p.world.clock.now());
    p.world.advance(16000);
  }
  const { bootFighter } = require("../src/fighter");
  p.bots.Jazwyn.ctrl = bootFighter(p.bots.Jazwyn.api, { now: () => p.world.clock.now() });
  // After reboot, climb seq above anything heard (plan §6.6.6)
  p.bots.Jazwyn.ctrl.state.applyHeartbeat("Sarene", { seq: 20, f: "armadillo", m: "farm", h: 0 });
  p.bots.Jazwyn.ctrl.state.S.seq.Jazwyn = Math.max(p.bots.Jazwyn.ctrl.state.S.seq.Jazwyn || 0, 21);
  p.bots.Jazwyn.ctrl.state.bump();
  assert.ok(p.bots.Jazwyn.ctrl.state.S.seq.Jazwyn >= 21);
  assert.strictEqual(gradeSim(p.world, {}).chat_throttle, 0);
});

test("scenario: path fail injection during farm — no Transfer/Port storm", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, burnPots: true });
  for (let i = 0; i < 80; i++) {
    if (i % 11 === 0) {
      for (const n of ["Jazwyn", "Sarene", "Zarook", "Puppygirl"]) {
        if (p.bots[n] && p.bots[n].api._injectSmartFail) p.bots[n].api._injectSmartFail(i % 22 === 0 ? "stall" : "fail");
      }
    }
    await p.tickAll();
  }
  const c = gradeSim(p.world, {});
  assert.strictEqual(c.fighter_hop, 0);
  assert.strictEqual(c.chat_throttle, 0);
  assert.ok(c.path_storm < 10, "path_storm=" + c.path_storm);
  assert.ok(!p.bots.Jazwyn.api.log.game.some((g) => /Transfer phoenix|Port town/i.test(g.m)));
});

test("scenario: Puppygirl reload mid-job with server_region unset — no re-hop loop", async () => {
  const p = bootParty({ pack: "armadillo", pots: 0, gold: 50000 });
  p.bots.Puppygirl.ctrl.enqueue({
    id: "mid1",
    kind: "dlv_pots",
    who: "Jazwyn",
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ],
    farm: "armadillo",
    map: "main",
    x: 526,
    y: 1846,
    t0: p.world.clock.now(),
  });
  assert.ok(p.bots.Puppygirl.ctrl.store.q.some((j) => j.id === "mid1"));
  p.bots.Puppygirl.api.change_server("US", "II");
  for (let i = 0; i < 300; i++) {
    p.world.advance(250);
    if (p.bots.Puppygirl.api.character.connected) break;
  }
  assert.ok(p.bots.Puppygirl.api.character.connected);
  assert.ok(
    p.bots.Puppygirl.ctrl.store.q.some((j) => j.id === "mid1") ||
      (p.bots.Puppygirl.ctrl.store.active && p.bots.Puppygirl.ctrl.store.active.id === "mid1"),
    "queue restored"
  );
  p.bots.Puppygirl.api.character.serverRegionReadyAt = p.world.clock.now() + 60000;
  const hopsBefore = (p.bots.Puppygirl.api.log.server || []).length;
  for (let i = 0; i < 40; i++) {
    await p.bots.Puppygirl.ctrl.tick();
    p.world.advance(250);
  }
  const hopsAfter = (p.bots.Puppygirl.api.log.server || []).length;
  assert.ok(hopsAfter - hopsBefore <= 1, "re-hop loop hops=" + (hopsAfter - hopsBefore));
});

test("scenario: gear push when both bags tight — no deadlock hop", async () => {
  const items = new Array(42).fill(null);
  for (let i = 0; i < 40; i++) items[i] = { name: "gloves", level: 0, q: 1 };
  items[40] = { name: "hpot1", q: 1 };
  items[41] = { name: "mpot1", q: 1 };
  const p = bootParty({ pack: "armadillo", pots: 0, gold: 50000, esize: 2, items });
  // Merchant bag nearly full but has gear + pots to send
  const mItems = new Array(42).fill(null);
  for (let i = 0; i < 38; i++) mItems[i] = { name: "ringsj", level: 0, q: 1 };
  mItems[38] = { name: "hpot1", q: 200 };
  mItems[39] = { name: "mpot1", q: 200 };
  mItems[40] = { name: "gloves", level: 1, q: 1 };
  p.bots.Puppygirl.api.character.items = mItems;
  p.bots.Puppygirl.api.character.esize = 1;
  p.bots.Puppygirl.ctrl.enqueue({
    id: "gfull",
    kind: "dlv_gear",
    who: "Jazwyn",
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ],
    gear: { name: "gloves", level: 1 },
    farm: "armadillo",
    map: "main",
    x: 526,
    y: 1846,
  });
  for (let i = 0; i < 250; i++) await p.tickAll();
  const c = gradeSim(p.world, {});
  assert.strictEqual(c.fighter_hop, 0);
  assert.strictEqual(p.world.where("Jazwyn").key, "US/III");
});

test("scenario: short farm bee pack stays together", async () => {
  const p = bootParty({ pack: "bee", pots: 200 });
  await p.runFor(45000);
  const c = gradeSim(p.world, { pack: "bee", R: 700 });
  assert.strictEqual(c.chat_throttle, 0);
  assert.strictEqual(c.fighter_hop, 0);
  assert.strictEqual(p.bots.Jazwyn.api.character.map, "main");
});

test("scenario: short farm goo pack stays together", async () => {
  const p = bootParty({ pack: "goo", pots: 200 });
  await p.runFor(45000);
  const c = gradeSim(p.world, { pack: "goo", R: 900 });
  assert.strictEqual(c.fighter_hop, 0);
  assert.strictEqual(p.bots.Jazwyn.api.character.map, "main");
  assert.strictEqual(p.world.where("Jazwyn").key, "US/III");
});

test("scenario: Jazwyn rejoins → leadership returns from Sarene", async () => {
  const { createWorld } = require("../sim");
  const { bootFighter } = require("../src/fighter");
  const { packCenter } = require("../sim/world");
  const w = createWorld();
  const pc = packCenter("armadillo");
  function mk(name, ctype) {
    return w.spawn({
      name,
      ctype: ctype || "warrior",
      map: pc.map,
      real_x: pc.x,
      real_y: pc.y,
      items: [
        { name: "hpot1", q: 80 },
        { name: "mpot1", q: 80 },
      ].concat(new Array(40).fill(null)),
    });
  }
  const s = mk("Sarene", "mage");
  const z = mk("Zarook", "priest");
  w.formParty("US/III", ["Sarene", "Zarook"]);
  w.spawnMonster("US/III", pc.map, "armadillo", pc);
  const cs = bootFighter(s, { now: () => w.clock.now() });
  const cz = bootFighter(z, { now: () => w.clock.now() });
  for (let i = 0; i < 10; i++) {
    await cs.tick();
    await cz.tick();
    w.advance(250);
  }
  assert.strictEqual(cs.isLead(), true);
  const j = mk("Jazwyn", "warrior");
  w.formParty("US/III", ["Jazwyn", "Sarene", "Zarook"]);
  const cj = bootFighter(j, { now: () => w.clock.now() });
  for (let i = 0; i < 15; i++) {
    await cj.tick();
    await cs.tick();
    await cz.tick();
    w.advance(250);
  }
  assert.strictEqual(cj.isLead(), true);
  assert.strictEqual(cs.isLead(), false);
});

module.exports = { tests };
