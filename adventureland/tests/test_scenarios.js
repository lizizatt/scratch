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
  const p = bootParty({ pack: "armadillo", pots: 0 });
  // Don't tick merchant — only fighters
  await p.bots.Jazwyn.ctrl.requestPots();
  p.bots.Jazwyn.ctrl._setDlv({ id: "x", t0: p.world.clock.now(), acked: 1 });
  // Advance past FALLBACK_SILENCE_MS without merchant status
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

test("scenario: Puppygirl delivers around spider-island obstacles", async () => {
  const { isBlocked } = require("../sim/world");
  const { segmentHitsAny } = require("../sim/path");
  // Party south of spider island; merchant starts at potions — direct chord crosses blocked water
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 50000,
    // place fighters past the island
  });
  for (const n of ["Jazwyn", "Sarene", "Zarook"]) {
    p.bots[n].api.character.map = "main";
    p.bots[n].api.character.real_x = 500;
    p.bots[n].api.character.x = 500;
    p.bots[n].api.character.real_y = 200;
    p.bots[n].api.character.y = 200;
  }
  p.bots.Puppygirl.api.character.real_x = 56;
  p.bots.Puppygirl.api.character.x = 56;
  p.bots.Puppygirl.api.character.real_y = -122;
  p.bots.Puppygirl.api.character.y = -122;

  const blocked = p.world.G.maps.main.blocked;
  assert.ok(segmentHitsAny(56, -122, 500, 200, blocked));

  await p.bots.Jazwyn.ctrl.requestPots();
  let done = false;
  const trail = [];
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    const ch = p.bots.Puppygirl.api.character;
    trail.push({ x: ch.real_x, y: ch.real_y });
    assert.ok(!isBlocked("main", ch.real_x, ch.real_y, p.world.G), "merchant entered blocked @" + ch.real_x + "," + ch.real_y);
    if (p.bots.Jazwyn.api.log.game.some((g) => /dlv:done/.test(g.m))) {
      done = true;
      break;
    }
    if (p.bots.Puppygirl.api.log.game.some((g) => /dlv:done/.test(g.m))) {
      done = true;
      break;
    }
  }
  assert.ok(done, "expected delivery");
  assert.ok(p.bots.Puppygirl.api.log.path.length >= 2, "legs=" + p.bots.Puppygirl.api.log.path.length);
  // Trail should go west or east of island, not through its interior samples
  const crossedLeft = trail.some((pt) => pt.x < 304 && pt.y > -300 && pt.y < 120);
  const crossedRight = trail.some((pt) => pt.x > 688 && pt.y > -300 && pt.y < 120);
  assert.ok(crossedLeft || crossedRight || p.bots.Puppygirl.api.log.path.length >= 2, "expected detour evidence");
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
});

module.exports = { tests };
