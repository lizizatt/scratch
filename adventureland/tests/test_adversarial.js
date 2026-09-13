"use strict";

const assert = require("assert");
const { createWorld } = require("../sim");
const { createChatQueue } = require("../src/chat_queue");
const { bootParty } = require("../src/boot_party");
const { bootFighter } = require("../src/fighter");
const { bootMerchant } = require("../src/merchant");
const { gradeLogs } = require("../sim/invariants");
const { GOLD_FLOAT_FIGHTER } = require("../src/constants");
const { packCenter } = require("../src/packs");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("default grind targets bats", async () => {
  const p = bootParty();
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.mtype, "bat");
  assert.strictEqual(p.bots.Jazwyn.api.character.map, packCenter("bat").map);
});

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

test("merchant: idle work stays on the current party server", async () => {
  const w = createWorld();
  const p = w.spawn(
    { name: "Puppygirl", map: "main", items: new Array(42).fill(null), esize: 42, gold: 1e6 },
    "US",
    "IV"
  );
  const ctrl = bootMerchant(p, { now: () => w.clock.now() });
  p._now = () => w.clock.now();

  await ctrl.tick();

  assert.strictEqual(w.where("Puppygirl").key, "US/IV");
  assert.ok(!p.log.server.some((s) => s[0] === "US" && s[1] === "III"));
});

test("merchant: delivery follows its originating server instead of hard-coded farm world", async () => {
  const w = createWorld();
  const p = w.spawn(
    { name: "Puppygirl", map: "main", items: new Array(42).fill(null), esize: 42, gold: 1e6 },
    "US",
    "IV"
  );
  const ctrl = bootMerchant(p, { now: () => w.clock.now() });
  p._now = () => w.clock.now();
  ctrl.enqueue({
    id: "world4",
    kind: "dlv_pots",
    who: "Jazwyn",
    items: [],
    farm: "snake",
    map: "main",
    x: -82,
    y: 1901,
    serverRegion: "US",
    serverIdentifier: "IV",
  });

  await ctrl.tick();

  assert.strictEqual(w.where("Puppygirl").key, "US/IV");
  assert.ok(!p.log.server.some((s) => s[0] === "US" && s[1] === "III"));
});

test("fighter: town_fallback low_gold keeps delivery, no cancel", async () => {
  const p = bootParty({ pack: "armadillo", pots: 0, gold: 100 }); // below float
  await p.bots.Jazwyn.ctrl.requestPots();
  p.bots.Jazwyn.ctrl._setDlv({ id: "pend1", t0: p.world.clock.now() - 500000, acked: 1 });
  for (let i = 0; i < 40; i++) {
    await p.bots.Jazwyn.ctrl.tick();
    p.world.advance(250);
    if (p.bots.Jazwyn.api.log.game.some((g) => /town_fallback/.test(g.m))) break;
  }
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /town_fallback/.test(g.m)));
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /low_gold/.test(g.m)));
  assert.ok(!p.bots.Jazwyn.api.log.cm.some((c) => c.message && c.message.job === "cancel_all"));
  assert.strictEqual(p.bots.Jazwyn.api.log.bought.length, 0);
});

test("fighter: town_fallback with gold cancels pending and buys", async () => {
  const p = bootParty({ pack: "armadillo", pots: 0, gold: 100000 });
  await p.bots.Jazwyn.ctrl.requestPots();
  p.bots.Jazwyn.ctrl._setDlv({ id: "pend2", t0: p.world.clock.now() - 100000, acked: 0 });
  for (let i = 0; i < 40; i++) {
    await p.bots.Jazwyn.ctrl.tick();
    p.world.advance(250);
    if (p.bots.Jazwyn.api.log.game.some((g) => /town_fallback/.test(g.m))) break;
  }
  assert.ok(p.bots.Jazwyn.api.log.cm.some((c) => c.message && c.message.job === "cancel_all"));
  assert.ok(p.bots.Jazwyn.api.log.bought.length >= 1);
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

test("fighter: golden bat sighting enters rare coordination", async () => {
  const p = bootParty({ pots: 200 });
  const j = p.bots.Jazwyn.api.character;
  p.world.spawnMonster(
    "US/III",
    j.map,
    "goldenbat",
    { x: j.real_x, y: j.real_y },
    "goldenbat_spot"
  );

  for (let i = 0; i < 8; i++) await p.tickAll();

  assert.ok(
    p.bots.Jazwyn.api.log.game.some((g) => g.m === "rare_spot goldenbat"),
    "golden bat must be logged as a rare sighting"
  );
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.mode, "rare");
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.rare.mtype, "goldenbat");
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
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    if (p.world.where("Jazwyn").key === "US/II" && p.bots.Jazwyn.api.character.connected) break;
  }
  assert.ok(p.bots.Jazwyn.api.character.connected);
  const cancel = p.bots.Jazwyn.api.log.cm.find((c) => c.message && c.message.job === "cancel_all");
  const meet = p.bots.Jazwyn.api.log.cm.find((c) => c.message && c.message.job === "meet_home");
  const hop = p.bots.Jazwyn.api.log.server.find((s) => s[0] === "US" && s[1] === "II");
  assert.ok(cancel, "cancel_all");
  assert.ok(meet, "meet_home");
  assert.ok(hop, "hop HOME");
  assert.ok(cancel.i < hop.i, "cancel_all before change_server (i " + cancel.i + " vs " + hop.i + ")");
  assert.ok(meet.i < hop.i, "meet_home before change_server");
});

test("delivery: status flowing prevents town_fallback", async () => {
  const p = bootParty({ pots: 0, gold: 50000 });
  await p.bots.Jazwyn.ctrl.requestPots();
  const id = p.bots.Jazwyn.ctrl.dlvPending && p.bots.Jazwyn.ctrl.dlvPending.id;
  assert.ok(id);
  // Real ack + status CMs (not _setDlv refreshing lastStatusAt)
  await p.bots.Puppygirl.api.send_cm("Jazwyn", { dlv_ack: 1, id, ok: 1 });
  await p.bots.Jazwyn.ctrl.tick();
  assert.strictEqual(p.bots.Jazwyn.ctrl.dlvPending.acked, 1);
  // > PENDING_MS (480s) with status every ~30s must not town_fallback
  for (let i = 0; i < 2200; i++) {
    if (i % 120 === 0) {
      await p.bots.Puppygirl.api.send_cm("Jazwyn", { status: 1, id, phase: "enroute" });
    }
    await p.bots.Jazwyn.ctrl.tick();
    p.world.advance(250);
  }
  assert.ok(!p.bots.Jazwyn.api.log.game.some((g) => /town_fallback/.test(g.m)));
  assert.ok(p.bots.Jazwyn.ctrl.dlvPending && p.bots.Jazwyn.ctrl.dlvPending.id === id);
});

test("hop: heap wipe clears handlers; storage restores hold; party re-invite", async () => {
  const p = bootParty({ pots: 200, gold: 50000 });
  // Production path only: lead applyCmd → party !hold echo → followers apply locally
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hold", args: [] });
  const ctrlBefore = p.bots.Jazwyn.ctrl;
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    if (
      ["Jazwyn", "Sarene", "Zarook"].every(
        (n) => p.world.where(n).key === "US/II" && p.bots[n].api.character.connected
      )
    )
      break;
  }
  assert.ok(p.bots.Jazwyn.api.character.connected, "Jazwyn should finish reconnect");
  assert.ok(p.bots.Sarene.api.character.connected, "Sarene should finish reconnect");
  assert.ok(p.bots.Zarook.api.character.connected, "Zarook should finish reconnect");
  assert.strictEqual(p.world.where("Sarene").key, "US/II");
  assert.strictEqual(p.bots.Sarene.ctrl.state.S.intent.hold, 1, "follower hold via !hold hear, not test cheat");
  p.world.advance(5000);
  assert.notStrictEqual(p.bots.Jazwyn.ctrl, ctrlBefore, "controller must reboot on reload");
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.hold, 1, "hold must survive via storage");
  const party = p.bots.Jazwyn.api.get_party() || {};
  assert.ok(party.Jazwyn && party.Sarene && party.Zarook, "party re-invite after hop: " + Object.keys(party));
});

test("clock: smart_move owes time; tickAll is sole advancer", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200 });
  // Stay south of the ridge (same-map direct leg) so travel is owed, not scrub-sliced
  const j = p.bots.Jazwyn.api;
  const t0 = p.world.clock.now();
  await j.smart_move({
    map: "main",
    x: j.character.real_x + 40,
    y: j.character.real_y + 40,
  });
  assert.strictEqual(p.world.clock.now(), t0, "smart_move must not advance clock directly");
  assert.ok(p.world.getOwedMs() > 0, "owed=" + p.world.getOwedMs());
  await p.tickAll();
  assert.ok(p.world.clock.now() > t0);
  assert.strictEqual(p.world.getOwedMs(), 0);
});

test("clock: sleep advances immediately (waitParty must not hang)", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn" });
  const t0 = w.clock.now();
  await j.sleep(500);
  assert.strictEqual(w.clock.now(), t0 + 500);
  assert.strictEqual(w.getOwedMs(), 0);
});

test("world intent survives go_s:wait until server_region ready", async () => {
  const p = bootParty({ pots: 200, gold: 50000 });
  p.bots.Jazwyn.api.character.serverRegionReadyAt = p.world.clock.now() + 100000;
  p.bots.Jazwyn.ctrl.state.S.intent.world = ["US", "II"];
  p.bots.Jazwyn.ctrl.persist();
  await p.bots.Jazwyn.ctrl.tick();
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /go_s:wait/.test(g.m)));
  assert.deepStrictEqual(p.bots.Jazwyn.ctrl.state.S.intent.world, ["US", "II"]);
});

test("rare_gone: spotter loses phoenix → resume farm", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200 });
  const mon = p.world.spawnMonster("US/III", "main", "phoenix", { x: 526, y: 1846 }, "phx_gone");
  for (let i = 0; i < 8; i++) await p.tickAll();
  assert.ok(
    p.bots.Jazwyn.ctrl.state.S.mode === "rare" || p.bots.Jazwyn.api.log.game.some((g) => /rare_spot/.test(g.m)),
    "expected rare spot"
  );
  // Stretch assemble window so rare_gone wins over rare_timeout
  p.bots.Jazwyn.api.storage.setItem(
    "v2state_Jazwyn",
    JSON.stringify({
      intent: p.bots.Jazwyn.ctrl.state.S.intent,
      mode: "rare",
      lead: "Jazwyn",
      seq: p.bots.Jazwyn.ctrl.state.S.seq,
      rare: p.bots.Jazwyn.ctrl.state.S.rare || { mtype: "phoenix", by: "Jazwyn", t: 0 },
      dlv: null,
      assembleUntil: p.world.clock.now() + 300000,
      rareGoneAt: 0,
      lastStatusAt: 0,
      lastHb: 0,
    })
  );
  p.bots.Jazwyn.ctrl = bootFighter(p.bots.Jazwyn.api, { now: () => p.world.clock.now() });
  mon.dead = true;
  mon.hp = 0;
  let gone = false;
  for (let i = 0; i < 100; i++) {
    await p.bots.Jazwyn.ctrl.tick();
    p.world.drainOwedTime();
    p.world.advance(500);
    if (p.bots.Jazwyn.api.log.game.some((g) => /rare_gone/.test(g.m))) {
      gone = true;
      break;
    }
  }
  assert.ok(gone, "expected rare_gone");
  assert.notStrictEqual(p.bots.Jazwyn.ctrl.state.S.mode, "rare");
});

test("rare_timeout: assemble window expires without kill", async () => {
  const p = bootParty({ pots: 200 });
  p.bots.Jazwyn.api.storage.setItem(
    "v2state_Jazwyn",
    JSON.stringify({
      intent: p.bots.Jazwyn.ctrl.state.S.intent,
      mode: "rare",
      lead: "Jazwyn",
      seq: p.bots.Jazwyn.ctrl.state.S.seq,
      rare: { mtype: "phoenix", by: "Sarene", t: 0 },
      dlv: null,
      assembleUntil: p.world.clock.now() + 1000,
      rareGoneAt: 0,
      lastStatusAt: 0,
      lastHb: 0,
    })
  );
  p.bots.Jazwyn.ctrl = bootFighter(p.bots.Jazwyn.api, { now: () => p.world.clock.now() });
  let timed = false;
  for (let i = 0; i < 40; i++) {
    await p.bots.Jazwyn.ctrl.tick();
    p.world.drainOwedTime();
    p.world.advance(2000);
    if (p.bots.Jazwyn.api.log.game.some((g) => /rare_timeout/.test(g.m))) {
      timed = true;
      break;
    }
  }
  assert.ok(timed, "expected rare_timeout");
});

test("bag-full: dry fighter sells junk then requests pots", async () => {
  const items = new Array(42).fill(null);
  for (let i = 0; i < 42; i++) items[i] = { name: "frogt", q: 1 };
  const p = bootParty({ pots: 0, gold: 50000, esize: 0, items });
  await p.bots.Jazwyn.ctrl.requestPots();
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /bag:sell/.test(g.m)), "should sell junk");
  assert.ok(p.bots.Jazwyn.ctrl.dlvPending || p.bots.Jazwyn.api.log.game.some((g) => /dlv:req/.test(g.m)));
  assert.ok((p.bots.Jazwyn.api.character.esize || 0) >= 1);
  assert.ok(Math.hypot(
    p.bots.Jazwyn.api.character.real_x - 56,
    p.bots.Jazwyn.api.character.real_y - (-122)
  ) < 50, "fighter visits the town vendor before selling");
});

test("bag-full: fighter vendors through +1 joy rings and HP accessories but preserves +2", async () => {
  const items = new Array(42).fill(null);
  for (let i = 0; i < 42; i++) items[i] = { name: "tracker" };
  items[0] = { name: "ringsj", level: 0 };
  items[1] = { name: "hpamulet", level: 0 };
  items[2] = { name: "hpbelt", level: 0 };
  items[3] = { name: "ringsj", level: 1 };
  items[4] = { name: "hpamulet", level: 1 };
  items[5] = { name: "hpbelt", level: 1 };
  items[6] = { name: "ringsj", level: 2 };
  items[7] = { name: "hpamulet", level: 2 };
  items[8] = { name: "hpbelt", level: 2 };
  items[9] = { name: "hpot1", q: 200 };
  items[10] = { name: "mpot1", q: 200 };
  const p = bootParty({ pots: 200, gold: 50000, esize: 0, items });
  const fighter = p.bots.Jazwyn;

  await fighter.ctrl.tick();

  const owns = (name, level) =>
    fighter.api.character.items.some(
      (it) => it && it.name === name && (it.level || 0) === level
    ) ||
    Object.keys(fighter.api.character.slots || {}).some((slot) => {
      const it = fighter.api.character.slots[slot];
      return it && it.name === name && (it.level || 0) === level;
    });
  for (const name of ["ringsj", "hpamulet", "hpbelt"]) {
    assert.ok(!fighter.api.character.items.some(
      (it) => it && it.name === name && (it.level || 0) === 0
    ), name + "@0 should not remain in the bag");
    assert.ok(!owns(name, 1), name + "@1 should be sold");
    assert.ok(owns(name, 2), name + "@2 should be preserved");
  }
  assert.ok((fighter.api.character.esize || 0) >= 6);
  assert.ok(fighter.api.log.game.some((g) => g.m === "bag:sell ringsj"));
});

test("bag-full: pot-only bag sells surplus hp pots when mp dry", async () => {
  const items = new Array(42).fill(null);
  for (let i = 0; i < 42; i++) items[i] = { name: "hpot1", q: 50 };
  const p = bootParty({ pots: 0, gold: 50000, esize: 0, items });
  await p.bots.Jazwyn.ctrl.requestPots();
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /bag:sell hpot1/.test(g.m)));
  assert.ok(p.bots.Jazwyn.ctrl.dlvPending);
  assert.ok((p.bots.Jazwyn.api.character.esize || 0) >= 1);
});

test("bootFighter twice does not stack handlers", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn" });
  bootFighter(j, { now: () => w.clock.now() });
  bootFighter(j, { now: () => w.clock.now() });
  const r = w.roster.get("Jazwyn");
  assert.strictEqual(r.partyHandlers.length, 1);
  assert.strictEqual(r.cmHandlers.length, 1);
});

test("merchant queue survives hop + onReload", async () => {
  const p = bootParty({ pots: 200 });
  p.bots.Puppygirl.ctrl.enqueue({
    id: "keep1",
    kind: "dlv_pots",
    who: "Jazwyn",
    items: [{ name: "hpot1", q: 10 }],
    farm: "armadillo",
    map: "main",
    x: 526,
    y: 1846,
    t0: p.world.clock.now(),
  });
  assert.ok(p.bots.Puppygirl.ctrl.store.q.some((j) => j.id === "keep1"));
  p.bots.Puppygirl.api.change_server("US", "II");
  for (let i = 0; i < 300; i++) {
    p.world.advance(250);
    if (p.bots.Puppygirl.api.character.connected) break;
  }
  assert.ok(p.bots.Puppygirl.api.character.connected);
  assert.ok(
    p.bots.Puppygirl.ctrl.store.q.some((j) => j.id === "keep1") ||
      (p.bots.Puppygirl.ctrl.store.active && p.bots.Puppygirl.ctrl.store.active.id === "keep1"),
    "queue must reload from storage"
  );
});

test("boot subset: Sarene+Zarook no Jazwyn — Sarene leads", async () => {
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
    real_x: pc.x + 20,
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
  for (let i = 0; i < 15; i++) {
    await cs.tick();
    await cz.tick();
    w.drainOwedTime();
    w.advance(250);
  }
  assert.strictEqual(cs.isLead(), true);
  assert.strictEqual(cz.isLead(), false);
});

test("merchant console hunt/grind/world fan-out reaches Sarene lead (no Jazwyn)", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 50,
    members: ["Sarene", "Zarook", "Puppygirl"],
  });
  for (let i = 0; i < 8; i++) {
    await p.tickAll();
  }
  assert.strictEqual(p.bots.Sarene.ctrl.isLead(), true);

  const mApi = p.bots.Puppygirl.api;
  const sent = [];
  const realSend = mApi.send_cm.bind(mApi);
  mApi.send_cm = async function (to, msg) {
    sent.push({ to, msg });
    return realSend(to, msg);
  };

  p.bots.Puppygirl.ctrl.hunt("bee");
  for (let i = 0; i < 5; i++) await p.tickAll();
  assert.ok(
    sent.some((s) => s.to === "Sarene" && s.msg && s.msg.hunt === "bee"),
    "hunt must CM Sarene, sent=" + JSON.stringify(sent)
  );
  assert.ok(
    sent.some((s) => s.to === "Zarook" && s.msg && s.msg.hunt === "bee"),
    "fan-out also hits Zarook"
  );
  assert.strictEqual(p.bots.Sarene.ctrl.state.S.intent.mtype, "bee");
  assert.strictEqual(p.bots.Sarene.ctrl.state.S.intent.kind, "hunt");

  sent.length = 0;
  mApi.setTimeout = (fn) => fn();
  p.bots.Puppygirl.ctrl.grind();
  p.bots.Puppygirl.ctrl.world("US III");
  for (let i = 0; i < 5; i++) await p.tickAll();

  assert.ok(
    sent.some((s) => s.to === "Sarene" && s.msg && s.msg.grind === 1),
    "grind must CM Sarene"
  );
  assert.ok(
    sent.filter((s) => s.to === "Sarene" && s.msg && s.msg.grind === 1).length >= 2,
    "grind must retry Sarene after a dropped first CM"
  );
  assert.strictEqual(p.bots.Sarene.ctrl.state.S.intent.kind, "farm");
  assert.strictEqual(
    p.bots.Sarene.ctrl.state.S.intent.mtype,
    "armadillo",
    "grind must clear the previous hunt target for the configured default"
  );
  assert.ok(
    sent.some((s) => s.to === "Sarene" && s.msg && Array.isArray(s.msg.world)),
    "world must CM Sarene"
  );
});

module.exports = { tests };
