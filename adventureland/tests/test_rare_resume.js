"use strict";

/**
 * After rare (or similar interrupt), resume the prior farm/hunt intent —
 * never silently fall back to default armadillo.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { bootFighter } = require("../src/fighter");
const { packCenter } = require("../src/packs");
const { getHunt } = require("../src/monsterhunt");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function nearPack(api, mtype, r) {
  const pc = packCenter(mtype);
  if (!pc || api.character.map !== pc.map) return false;
  return Math.hypot((api.character.real_x || 0) - pc.x, (api.character.real_y || 0) - pc.y) < (r || 400);
}

async function waitRareKill(p, maxTicks) {
  for (let i = 0; i < (maxTicks || 120); i++) {
    await p.tickAll();
    if (p.bots.Jazwyn.api.log.game.some((g) => /rare_kill/.test(g.m))) return true;
  }
  return false;
}

test("adversary: rare_kill resumes !hunt bee — not default armadillo", async () => {
  // Start already on bee so rare interrupt is the variable under test.
  const p = bootParty({
    pack: "bee",
    pots: 300,
    gold: 200000,
    members: ["Jazwyn", "Sarene", "Zarook"],
    packCount: 5,
  });
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hunt", args: ["bee"] });
  for (let i = 0; i < 20; i++) await p.tickAll();
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.mtype, "bee");
  assert.ok(nearPack(p.bots.Jazwyn.api, "bee", 400), "precondition: on bee pack");

  const j = p.bots.Jazwyn.api.character;
  p.world.spawnMonster("US/III", j.map, "phoenix", { x: j.real_x, y: j.real_y }, "phx_bee");
  assert.ok(await waitRareKill(p), "expected rare_kill");

  const st = p.bots.Jazwyn.ctrl.state.S;
  assert.notStrictEqual(st.mode, "rare");
  assert.strictEqual(st.intent.mtype, "bee", "mtype must stay bee after rare, got " + st.intent.mtype);
  assert.strictEqual(st.intent.kind, "hunt", "kind must stay hunt after rare");
  assert.ok(
    p.bots.Jazwyn.api.log.game.some((g) => /^rare_resume hunt bee/.test(g.m)),
    "expected rare_resume hunt bee"
  );

  const killAt = p.bots.Jazwyn.api.log.game.find((g) => /rare_kill/.test(g.m)).t;
  for (let i = 0; i < 60; i++) await p.tickAll();
  const after = p.bots.Jazwyn.api.log.game.filter((g) => g.t >= killAt).map((g) => g.m);
  assert.ok(
    !after.some((m) => /Transfer armadillo/.test(m)),
    "must not Transfer armadillo after rare while hunting bee"
  );
  assert.ok(nearPack(p.bots.Jazwyn.api, "bee", 450), "should remain/resume on bee pack after rare");
});

test("adversary: rare_kill mid !hunt bee→armadillo route resumes bee via smart_move", async () => {
  // Cross-pack route: force mid-map position so engage-radius misses bee and smart_move is required.
  const p = bootParty({
    pack: "armadillo",
    pots: 300,
    members: ["Jazwyn", "Sarene", "Zarook"],
    packCount: 5,
  });
  p.world.spawnPack("US/III", "main", "bee", packCenter("bee"), 5);
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hunt", args: ["bee"] });
  await p.tickAll();

  // Route lead mid-map outside engage radius of both packs.
  const api = p.bots.Jazwyn.api;
  assert.ok((await api.smart_move({ map: "main", x: 200, y: 800 })).success, "plant mid-route");
  assert.ok(!nearPack(api, "bee", 280), "precondition: not yet on bee");
  assert.ok(!nearPack(api, "armadillo", 280), "precondition: left armadillo");

  p.world.spawnMonster("US/III", api.character.map, "phoenix", { x: api.character.real_x, y: api.character.real_y }, "phx_mid");
  assert.ok(await waitRareKill(p), "expected rare_kill mid-route");

  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.mtype, "bee");
  const killAt = p.bots.Jazwyn.api.log.game.find((g) => /rare_kill/.test(g.m)).t;
  for (let i = 0; i < 150; i++) {
    await p.tickAll();
    if (nearPack(p.bots.Jazwyn.api, "bee", 400)) break;
  }
  const after = p.bots.Jazwyn.api.log.game.filter((g) => g.t >= killAt).map((g) => g.m);
  assert.ok(
    after.some((m) => /Transfer bee/.test(m)) || (p.bots.Jazwyn.api.log.path || []).some((leg) => leg.to && Math.abs((leg.to.x || 0) - 546) < 80),
    "after rare must path to bee via smart_move/Transfer"
  );
  assert.ok(!after.some((m) => /Transfer armadillo/.test(m)));
  assert.ok(nearPack(p.bots.Jazwyn.api, "bee", 450), "must arrive bee pack after rare resume");
});

test("adversary: rare_gone resumes !hunt bee — not default armadillo", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, members: ["Jazwyn", "Sarene"] });
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hunt", args: ["bee"] });
  for (let i = 0; i < 40; i++) await p.tickAll();

  const mon = p.world.spawnMonster("US/III", "main", "phoenix", { x: 526, y: 1846 }, "phx_gone_bee");
  for (let i = 0; i < 10; i++) await p.tickAll();

  p.bots.Jazwyn.api.storage.setItem(
    "v2state_Jazwyn",
    JSON.stringify({
      intent: { kind: "hunt", mtype: "bee", hold: 0, t: 0 },
      mode: "rare",
      lead: "Jazwyn",
      seq: p.bots.Jazwyn.ctrl.state.S.seq,
      rare: p.bots.Jazwyn.ctrl.state.S.rare || { mtype: "phoenix", by: "Jazwyn", t: 0 },
      dlv: null,
      assembleUntil: p.world.clock.now() + 300000,
      rareGoneAt: 0,
      lastStatusAt: 0,
      lastHb: 0,
      huntQuest: 0,
      preRareSnap: { kind: "hunt", mtype: "bee", hold: 0 },
    })
  );
  p.bots.Jazwyn.ctrl = bootFighter(p.bots.Jazwyn.api, {
    now: () => p.world.clock.now(),
    farm: "armadillo",
  });
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
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.mtype, "bee");
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.kind, "hunt");
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /^rare_resume hunt bee/.test(g.m)));
});

test("adversary: rare_timeout resumes !hunt bee — not default armadillo", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, members: ["Jazwyn"] });
  p.bots.Jazwyn.api.storage.setItem(
    "v2state_Jazwyn",
    JSON.stringify({
      intent: { kind: "hunt", mtype: "bee", hold: 0, t: 0 },
      mode: "rare",
      lead: "Jazwyn",
      seq: {},
      rare: { mtype: "phoenix", by: "Sarene", t: 0 },
      dlv: null,
      assembleUntil: p.world.clock.now() + 500,
      rareGoneAt: 0,
      lastStatusAt: 0,
      lastHb: 0,
      huntQuest: 0,
      preRareSnap: { kind: "hunt", mtype: "bee", hold: 0 },
    })
  );
  p.bots.Jazwyn.ctrl = bootFighter(p.bots.Jazwyn.api, {
    now: () => p.world.clock.now(),
    farm: "armadillo",
  });
  for (let i = 0; i < 40; i++) {
    await p.bots.Jazwyn.ctrl.tick();
    p.world.drainOwedTime();
    p.world.advance(2000);
    if (p.bots.Jazwyn.api.log.game.some((g) => /rare_timeout/.test(g.m))) break;
  }
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /rare_timeout/.test(g.m)));
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.mtype, "bee");
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.kind, "hunt");
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /^rare_resume hunt bee/.test(g.m)));
});

test("adversary: rare_kill during hunt_quest keeps Daisy hunt target", async () => {
  const p = bootParty({
    pack: "goo",
    pots: 400,
    gold: 500000,
    members: ["Jazwyn", "Sarene", "Zarook", "Puppygirl"],
    packCount: 5,
  });
  // Keep enough remaining kills that the post-rare observation window tests
  // resume behavior rather than accidentally completing the Daisy hunt.
  p.world.monsterHuntQueue = [{ id: "goo", c: 80 }];
  p.bots.Puppygirl.ctrl.hunt_quest();
  for (let i = 0; i < 120; i++) {
    await p.tickAll();
    const h = getHunt(p.bots.Jazwyn.api.character);
    if (h && h.id === "goo" && h.c > 0 && nearPack(p.bots.Jazwyn.api, "goo", 350)) break;
  }
  const h0 = getHunt(p.bots.Jazwyn.api.character);
  assert.ok(h0 && h0.id === "goo" && h0.c > 0, "need active Daisy goo hunt");
  assert.ok(p.bots.Jazwyn.ctrl.huntQuest);

  const j = p.bots.Jazwyn.api.character;
  p.world.spawnMonster("US/III", j.map, "phoenix", { x: j.real_x, y: j.real_y }, "phx_hq");
  assert.ok(await waitRareKill(p), "expected rare_kill during hunt_quest");

  assert.ok(p.bots.Jazwyn.ctrl.huntQuest, "huntQuest flag must survive rare");
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.mtype, "goo");
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.kind, "hunt");
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /^rare_resume hunt goo/.test(g.m)));

  const killAt = p.bots.Jazwyn.api.log.game.find((g) => /rare_kill/.test(g.m)).t;
  for (let i = 0; i < 80; i++) await p.tickAll();
  const after = p.bots.Jazwyn.api.log.game.filter((g) => g.t >= killAt).map((g) => g.m);
  assert.ok(
    !after.some((m) => /Transfer armadillo/.test(m)),
    "hunt_quest must not fall back to armadillo after rare"
  );
  const h1 = getHunt(p.bots.Jazwyn.api.character);
  assert.ok(h1 && h1.id === "goo", "Daisy hunt condition must remain");
});

test("adversary: !resume after hold keeps !hunt mtype (does not demote to default farm kind)", async () => {
  const p = bootParty({ pack: "bee", pots: 200, members: ["Jazwyn", "Sarene"] });
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hunt", args: ["bee"] });
  for (let i = 0; i < 10; i++) await p.tickAll();
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hold", args: [] });
  assert.ok(p.bots.Jazwyn.ctrl.state.S.intent.hold);
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "resume", args: [] });
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.hold, 0);
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.mtype, "bee");
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.kind, "hunt");
});

test("adversary: follower rare_timeout keeps lead hunt intent (bee)", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, members: ["Jazwyn", "Sarene", "Zarook"] });
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hunt", args: ["bee"] });
  for (let i = 0; i < 30; i++) await p.tickAll();

  p.bots.Sarene.api.storage.setItem(
    "v2state_Sarene",
    JSON.stringify({
      intent: { kind: "hunt", mtype: "bee", hold: 0, t: 0 },
      mode: "rare",
      lead: "Jazwyn",
      seq: p.bots.Sarene.ctrl.state.S.seq,
      rare: { mtype: "phoenix", by: "Sarene", t: 0 },
      dlv: null,
      assembleUntil: p.world.clock.now() + 500,
      rareGoneAt: 0,
      lastStatusAt: 0,
      lastHb: 0,
      preRareSnap: { kind: "hunt", mtype: "bee", hold: 0 },
    })
  );
  p.bots.Sarene.ctrl = bootFighter(p.bots.Sarene.api, {
    now: () => p.world.clock.now(),
    farm: "armadillo",
    form: { dx: -45, dy: 55, face: 1 },
  });
  for (let i = 0; i < 40; i++) {
    await p.bots.Sarene.ctrl.tick();
    p.world.drainOwedTime();
    p.world.advance(2000);
    if (p.bots.Sarene.api.log.game.some((g) => /rare_timeout|rare_gone/.test(g.m))) break;
  }
  assert.strictEqual(p.bots.Sarene.ctrl.state.S.intent.mtype, "bee", "follower must keep bee after rare end");
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.mtype, "bee", "lead hunt intent untouched");
});

module.exports = { tests };
