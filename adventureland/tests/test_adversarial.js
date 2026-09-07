"use strict";

const assert = require("assert");
const { createWorld } = require("../sim");
const { createChatQueue } = require("../src/chat_queue");
const { bootParty } = require("../src/boot_party");
const { bootFighter } = require("../src/fighter");
const { bootMerchant } = require("../src/merchant");
const { gradeLogs } = require("../sim/invariants");
const { GOLD_FLOAT_FIGHTER } = require("../src/constants");
const { packCenter } = require("../sim/world");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("chat_queue: reject does not storm-retry within gap", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn" });
  w.comms.humanSay("Jazwyn", "!hold");
  const q = createChatQueue(j, { gapMs: 16000 });
  j._now = () => w.clock.now();
  let attempts = 0;
  const orig = j.party_say.bind(j);
  j.party_say = (m) => {
    attempts++;
    return orig(m);
  };
  q.markHuman();
  for (let i = 0; i < 20; i++) {
    q.enqueue("~S f=x", "hb");
    q.tick(w.clock.now());
    w.advance(500);
  }
  assert.ok(attempts <= 1, "attempts=" + attempts);
  if (attempts === 1) {
    assert.ok(j.log.game.some((g) => /chat_drop|can't chat/i.test(g.m)));
  }
  // After gap, exactly one success
  w.advance(20000);
  q.enqueue("~S f=x", "hb");
  q.tick(w.clock.now());
  assert.ok(j.log.said.indexOf("~S f=x") >= 0);
});

test("chat_queue: humanSay then code → at most one attempt until gap", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn" });
  const q = createChatQueue(j);
  j._now = () => w.clock.now();
  q.markHuman();
  let okCount = 0;
  for (let i = 0; i < 10; i++) {
    q.enqueue("~d p=ok", "diff");
    const r = q.tick(w.clock.now());
    if (r && r.sent) okCount++;
    w.advance(1000);
  }
  assert.strictEqual(okCount, 0);
  w.advance(10000);
  q.enqueue("~d p=ok", "diff");
  const r = q.tick(w.clock.now());
  assert.ok(r && r.sent);
});

test("merchant: meet_home with server_region unset keeps active", async () => {
  const w = createWorld();
  const p = w.spawn({ name: "Puppygirl", map: "main", items: new Array(42).fill(null), esize: 20, gold: 1e6 }, "US", "III");
  const ctrl = bootMerchant(p, { now: () => w.clock.now() });
  p._now = () => w.clock.now();
  ctrl.enqueue({ id: "mh1", kind: "meet_home", who: "party", t0: w.clock.now() });
  // Force active
  ctrl.store.active = ctrl.store.q.shift();
  p.change_server("US", "II");
  // During reconnect + region delay, tick must not clear active
  await ctrl.tick();
  assert.ok(ctrl.store.active && ctrl.store.active.kind === "meet_home");
  w.advance(1000);
  await ctrl.tick();
  assert.ok(ctrl.store.active && ctrl.store.active.kind === "meet_home");
});

test("fighter: town_fallback sends cancel_all and refuses buy below GOLD_FLOAT", async () => {
  const p = bootParty({ pack: "armadillo", pots: 0, gold: 100 }); // below float
  await p.bots.Jazwyn.ctrl.requestPots();
  p.bots.Jazwyn.ctrl._setDlv({ id: "pend1", t0: p.world.clock.now() - 100000, acked: 1 });
  for (let i = 0; i < 20; i++) {
    await p.bots.Jazwyn.ctrl.tick();
    p.world.advance(250);
    if (p.bots.Jazwyn.api.log.game.some((g) => /town_fallback/.test(g.m))) break;
  }
  assert.ok(p.bots.Jazwyn.api.log.cm.some((c) => c.message && c.message.job === "cancel_all"));
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /low_gold/.test(g.m)));
  assert.strictEqual(p.bots.Jazwyn.api.log.bought.length, 0);
});

test("fighter: !hunt phoenix never smart_move to phoenix type", async () => {
  const p = bootParty({ pots: 200 });
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hunt", args: ["phoenix"] });
  for (let i = 0; i < 30; i++) {
    await p.tickAll();
  }
  const paths = p.bots.Jazwyn.api.log.moved || [];
  assert.ok(!paths.some((d) => d && d.to === "phoenix"), JSON.stringify(paths.slice(-5)));
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /skip_rare_type|farm:skip/.test(g.m)));
});

test("succession: Sarene leads when Jazwyn not in party", async () => {
  const w = createWorld();
  const pc = packCenter("armadillo");
  const s = w.spawn({
    name: "Sarene",
    map: pc.map,
    real_x: pc.x,
    real_y: pc.y,
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ].concat(new Array(40).fill(null)),
  });
  const z = w.spawn({
    name: "Zarook",
    map: pc.map,
    real_x: pc.x + 10,
    real_y: pc.y,
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ].concat(new Array(40).fill(null)),
  });
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
  assert.strictEqual(cz.isLead(), false);
});

test("invariants: HOP lines count as fighter_hop", async () => {
  const c = gradeLogs(["LOG Jazwyn HOP US/II", "Sarene:go_s:US/II"]);
  assert.ok(c.fighter_hop >= 2, "hops=" + c.fighter_hop);
});

test("hold: hop-prep emits cancel_all before server change", async () => {
  const p = bootParty({ pots: 200, gold: 50000 });
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hold", args: [] });
  for (let i = 0; i < 40; i++) {
    await p.tickAll();
    p.world.tickReconnects();
    if (p.world.where("Jazwyn").key === "US/II") break;
  }
  assert.ok(p.bots.Jazwyn.api.log.cm.some((c) => c.message && c.message.job === "cancel_all"));
  assert.ok(p.bots.Jazwyn.api.log.server.some((s) => s[0] === "US" && s[1] === "II"));
});

test("delivery: status flowing prevents town_fallback", async () => {
  const p = bootParty({ pots: 0, gold: 50000 });
  await p.bots.Jazwyn.ctrl.requestPots();
  const id = p.bots.Jazwyn.ctrl.dlvPending && p.bots.Jazwyn.ctrl.dlvPending.id;
  assert.ok(id);
  for (let i = 0; i < 500; i++) {
    // inject status every 30s without completing delivery
    if (i % 120 === 0) {
      p.bots.Jazwyn.ctrl._setDlv({ id, t0: p.world.clock.now() - 5000, acked: 1 });
      // simulate status bump
      await p.bots.Jazwyn.api.send_cm; // no-op keep lint calm
      p.bots.Jazwyn.ctrl._setDlv({ id, t0: p.world.clock.now() - 5000, acked: 1 });
    }
    await p.bots.Jazwyn.ctrl.tick();
    p.world.advance(250);
  }
  assert.ok(!p.bots.Jazwyn.api.log.game.some((g) => /town_fallback/.test(g.m)));
});

module.exports = { tests };
