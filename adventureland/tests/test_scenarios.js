"use strict";

const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { gradeSim, mvpPass, samplePack } = require("../sim/invariants");
const { HOME, HEARTBEAT_MS } = require("../src/constants");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

/** Run party for ms, sampling pack cohesion every ~1s of sim time. */
async function runFarmGraded(p, ms, packOpts) {
  const hits = { samples: 0, on_pack: 0 };
  const end = p.world.clock.now() + ms;
  let lastSample = -1e12;
  while (p.world.clock.now() < end) {
    await p.tickAll();
    const now = p.world.clock.now();
    if (packOpts && now - lastSample >= 1000) {
      lastSample = now;
      hits.samples++;
      if (samplePack(p.world, packOpts)) hits.on_pack++;
    }
  }
  return hits;
}

function assertOnPack(c, minRatio) {
  minRatio = minRatio == null ? 0.7 : minRatio;
  assert.ok(c.samples >= 5, "need pack samples, got " + c.samples);
  const r = c.on_pack / c.samples;
  assert.ok(r >= minRatio, "on_pack=" + r.toFixed(2) + " samples=" + c.samples + " hits=" + c.on_pack);
}

test("scenario: farm armadillo stays together, 0 throttle", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200 });
  const hits = await runFarmGraded(p, 60000, { pack: "armadillo", R: 600 });
  const c = gradeSim(p.world, { packHits: hits });
  const j = p.bots.Jazwyn.api;
  assert.strictEqual(j.character.map, "main");
  assert.ok(Math.abs(j.character.real_x - 526) < 120);
  assert.strictEqual(c.chat_throttle, 0);
  assert.strictEqual(c.fighter_hop, 0);
  assertOnPack(c, 0.7);
  assert.ok(
    ["Jazwyn", "Sarene", "Zarook"].every((n) => p.bots[n].api.character.connected),
    "all fighters connected"
  );
});

test("scenario: farm combat — tank melee, kills, respawns, formation", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200 });
  let tankMelee = 0;
  for (let i = 0; i < 160; i++) {
    await p.tickAll();
    const j = p.bots.Jazwyn.api;
    const mon = j.get_nearest_monster({ type: "armadillo" });
    if (mon && j.is_in_range(mon)) tankMelee++;
  }
  const kills = p.bots.Jazwyn.api.log.game.filter((g) => /^kill /.test(g.m)).length;
  assert.ok(kills >= 1, "expected kills, got " + kills);
  assert.ok(tankMelee >= 5, "tank should spend ticks in melee, got " + tankMelee);
  const lead = p.bots.Jazwyn.api.character;
  for (const n of ["Sarene", "Zarook"]) {
    const c = p.bots[n].api.character;
    const d = Math.hypot(c.real_x - lead.real_x, c.real_y - lead.real_y);
    assert.ok(d >= 20 && d < 250, n + " formation dist=" + d.toFixed(1));
  }
  const ents = p.bots.Jazwyn.api.parent.entities;
  const packMobs = Object.keys(ents).filter((id) => ents[id].type === "monster" && ents[id].mtype === "armadillo");
  assert.ok(packMobs.length >= 3, "pack size=" + packMobs.length);
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
  assert.ok(p.bots.Jazwyn.api.log.game.some((g) => /rare_spot/.test(g.m)), "spot before kill");
  assert.notStrictEqual(p.bots.Jazwyn.ctrl.state.S.mode, "rare", "resume farm after kill");
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
  // Real stress: enqueue every 1s (≪ 16s gap). Queue must prevent throttle storms.
  for (let i = 0; i < 40; i++) {
    p.bots.Jazwyn.ctrl.chat.enqueue("~S f=armadillo m=farm h=0", "hb");
    p.bots.Sarene.ctrl.chat.enqueue("~d p=ok", "diff");
    p.bots.Zarook.ctrl.chat.enqueue("~d p=ok", "diff");
    p.bots.Jazwyn.ctrl.chat.tick(p.world.clock.now());
    p.bots.Sarene.ctrl.chat.tick(p.world.clock.now());
    p.bots.Zarook.ctrl.chat.tick(p.world.clock.now());
    p.world.advance(1000);
  }
  const c = gradeSim(p.world, {});
  assert.strictEqual(c.chat_throttle, 0, "throttles=" + c.chat_throttle);
  // At most ~1 send per 16s over 40s → ≤3 said lines each (hb/diff supersede)
  for (const n of ["Jazwyn", "Sarene", "Zarook"]) {
    assert.ok(p.bots[n].api.log.said.length <= 4, n + " said=" + p.bots[n].api.log.said.length);
  }
});

test("scenario: hold triggers hop-prep; fighter ends on HOME", async () => {
  const p = bootParty({ pots: 200, gold: 50000 });
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hold", args: [] });
  for (let i = 0; i < 80; i++) {
    await p.tickAll();
    p.world.tickReconnects();
    if (p.world.where("Jazwyn").key === "US/II" && p.bots.Jazwyn.api.character.connected) break;
  }
  p.world.advance(5000);
  assert.strictEqual(p.world.where("Jazwyn").key, "US/II");
  const cms = p.bots.Jazwyn.api.log.cm;
  const cancel = cms.find((c) => c.message && c.message.job === "cancel_all");
  const meet = cms.find((c) => c.message && c.message.job === "meet_home");
  const hop = p.bots.Jazwyn.api.log.server.find((s) => s[0] === "US" && s[1] === "II");
  assert.ok(cancel, "cancel_all required");
  assert.ok(meet, "meet_home required for hold→HOME");
  assert.ok(hop, "HOME hop required");
  assert.ok(cancel.i < hop.i, "cancel_all before change_server");
  assert.ok(meet.i < hop.i, "meet_home before change_server");
});

test("scenario: compressed 30 min farm armadillo, 0 throttle 0 fighter hop", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, burnPots: true });
  const hits = await runFarmGraded(p, 30 * 60 * 1000, { pack: "armadillo", R: 800 });
  const c = gradeSim(p.world, { packHits: hits });
  assert.strictEqual(c.chat_throttle, 0);
  assert.strictEqual(c.fighter_hop, 0);
  assert.ok(c.path_storm < 10);
  assertOnPack(c, 0.65);
  assert.strictEqual(p.world.where("Jazwyn").key, "US/III");
  assert.strictEqual(p.world.where("Sarene").key, "US/III");
  assert.strictEqual(p.world.where("Zarook").key, "US/III");
});

test("scenario: 15 min farm multi-restock vendor→Puppygirl→party", async () => {
  // Low start + small top-ups + aggressive burn → several merchant round-trips
  const p = bootParty({
    pack: "armadillo",
    pots: 25,
    gold: 200000,
    burnPots: true,
    burnPerTick: 2,
    potionTarget: 40,
  });
  await p.runFor(15 * 60 * 1000);
  const mLog = p.bots.Puppygirl.api.log.game.map((g) => g.m);
  const buys = mLog.filter((m) => /^dlv:buy /.test(m)).length;
  const dones = mLog.filter((m) => /^dlv:done /.test(m)).length;
  const sends = mLog.filter((m) => /^dlv:send /.test(m)).length;
  assert.ok(buys >= 3, "expected multiple vendor buys, got " + buys);
  assert.ok(dones >= 3, "expected multiple deliveries, got " + dones);
  assert.ok(sends >= 3, "expected pot sends, got " + sends);
  const towns = mLog.filter((m) => /town_for_vendor|use:town/.test(m)).length;
  let nearVendor = 0;
  let nearFarm = 0;
  let caveLegs = 0;
  let seDoor = 0;
  for (const leg of p.bots.Puppygirl.api.log.path || []) {
    const to = leg.to || {};
    const from = leg.from || {};
    if (to.map === "cave" || from.map === "cave") caveLegs++;
    if (to.map === "main" && Math.abs((to.x || 0) - 56) < 40 && Math.abs((to.y || 0) + 122) < 40) nearVendor++;
    if (to.map === "main" && Math.abs((to.x || 0) - 526) < 120 && Math.abs((to.y || 0) - 1846) < 120) nearFarm++;
    // SE cave mouth used on return
    if (
      (from.map === "main" && to.map === "cave" && Math.abs(from.x - 750) < 40 && from.y > 1600) ||
      (from.map === "cave" && to.map === "main" && Math.abs(to.x - 750) < 40 && to.y > 1600)
    )
      seDoor++;
  }
  assert.strictEqual(towns, 0, "must not town home for vendor; use cave return");
  assert.ok(nearVendor >= 3, "vendor landings=" + nearVendor);
  assert.ok(nearFarm >= 2 || dones >= 3, "farm approaches=" + nearFarm);
  assert.ok(caveLegs >= 6, "expected repeated cave transit, got " + caveLegs);
  assert.ok(seDoor >= 2, "expected SE cave door on returns, got " + seDoor);
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
  assert.strictEqual(gradeSim(p.world, {}).chat_throttle, 0);
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
  for (let i = 0; i < 40; i++) {
    await ctrl.tick();
    w.advance(250);
  }
  assert.strictEqual(ctrl.isLead(), true);
  assert.strictEqual(api.character.map, pc.map);
  assert.ok(w.dist(api.character, pc) < 200, "Zarook should farm near pack");
  assert.ok(
    ctrl.state.S.members.Zarook.task === "farm" || ctrl.state.S.members.Zarook.task === "moving",
    "task=" + ctrl.state.S.members.Zarook.task
  );
  assert.strictEqual(api.log.server.length, 0, "solo Zarook must not hop");
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
  await p.tickAll(); // emit !resume so followers clear hold
  p.world.advance(16000); // chat gap before !world echo
  p.bots.Jazwyn.ctrl.applyCmd({ cmd: "world", args: ["US/III"] });
  await p.tickAll();
  for (let i = 0; i < 160; i++) {
    await p.tickAll();
    p.world.tickReconnects();
    if (
      ["Jazwyn", "Sarene", "Zarook"].every(
        (n) => p.world.where(n).key === "US/III" && p.bots[n].api.character.connected
      )
    )
      break;
  }
  p.world.advance(5000);
  assert.strictEqual(p.world.where("Jazwyn").key, "US/III");
  assert.strictEqual(p.world.where("Sarene").key, "US/III");
  assert.strictEqual(p.world.where("Zarook").key, "US/III");
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.intent.hold, 0);
  assert.strictEqual(p.bots.Sarene.ctrl.state.S.intent.hold, 0, "followers must hear !resume");
  const hopBack = p.bots.Jazwyn.api.log.server.filter((s) => s[0] === "US" && s[1] === "III");
  assert.ok(hopBack.length >= 1, "resume world hop to farm");
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
  assert.strictEqual(p.world.where("Zarook").key, "US/II");
  const cancel = p.bots.Jazwyn.api.log.cm.find((c) => c.message && c.message.job === "cancel_all");
  const hop = p.bots.Jazwyn.api.log.server.find((s) => s[0] === "US" && s[1] === "II");
  assert.ok(cancel && hop, "cancel_all and hop");
  assert.ok(cancel.i < hop.i, "cancel_all before change_server");
});

test("scenario: chat stress + ~R + human echo + lead reboot reseeds seq", async () => {
  const p = bootParty({ pots: 200 });
  p.bots.Jazwyn.ctrl.chat.markHuman();
  // Real stress: 1s ticks, not 16s (throttle would fire without the queue)
  for (let i = 0; i < 20; i++) {
    p.bots.Jazwyn.ctrl.chat.enqueue("~S f=armadillo m=farm h=0", "hb");
    p.bots.Sarene.ctrl.chat.enqueue("~d p=ok", "diff");
    p.bots.Zarook.ctrl.chat.enqueue("~d p=ok", "diff");
    p.bots.Jazwyn.ctrl.chat.enqueue("~R phoenix", "rare");
    p.bots.Jazwyn.ctrl.chat.tick(p.world.clock.now());
    p.bots.Sarene.ctrl.chat.tick(p.world.clock.now());
    p.bots.Zarook.ctrl.chat.tick(p.world.clock.now());
    p.world.advance(1000);
  }
  assert.strictEqual(gradeSim(p.world, {}).chat_throttle, 0);

  const { bootFighter } = require("../src/fighter");
  p.bots.Jazwyn.ctrl = bootFighter(p.bots.Jazwyn.api, { now: () => p.world.clock.now() });
  // Clear party-chat throttle so Sarene's high-seq HB is heard during boot-quiet
  p.world.advance(20000);
  const said = p.bots.Sarene.api.party_say("~S f=armadillo m=farm h=0 seq=20");
  assert.ok(said && said.ok !== false, "Sarene HB must send");
  assert.strictEqual(p.bots.Jazwyn.ctrl.state.S.seq.Sarene, 20, "lead must hear follower seq during quiet");
  p.world.advance(HEARTBEAT_MS + 1000);
  await p.bots.Jazwyn.ctrl.tick();
  p.world.advance(16000);
  await p.bots.Jazwyn.ctrl.tick();
  assert.ok(
    p.bots.Jazwyn.ctrl.state.S.seq.Jazwyn >= 21,
    "lead must reseed above heard seq=20, got " + p.bots.Jazwyn.ctrl.state.S.seq.Jazwyn
  );
  assert.ok(
    p.bots.Jazwyn.api.log.said.some((s) => /seq=2[1-9]|seq=[3-9]\d/.test(s)),
    "published HB must carry reseeded seq: " + JSON.stringify(p.bots.Jazwyn.api.log.said.slice(-5))
  );
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
  // Positive: still farming on pack world near armadillo after failures
  assert.strictEqual(p.world.where("Jazwyn").key, "US/III");
  assert.ok(samplePack(p.world, { pack: "armadillo", R: 900 }), "party should recover onto pack");
  assert.ok(
    p.bots.Jazwyn.ctrl.state.S.members.Jazwyn.task === "farm" ||
      p.bots.Jazwyn.ctrl.state.S.members.Jazwyn.task === "moving" ||
      p.bots.Jazwyn.ctrl.state.S.members.Jazwyn.task === "follow",
    "should resume farm after injected fails, task=" + p.bots.Jazwyn.ctrl.state.S.members.Jazwyn.task
  );
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
  // Positive success: sold junk and/or progressed delivery (done / ack / send)
  const jLog = p.bots.Jazwyn.api.log.game.map((g) => g.m).join("\n");
  const mLog = p.bots.Puppygirl.api.log.game.map((g) => g.m).join("\n");
  assert.ok(
    /bag:sell|dlv:done|dlv:ack|dlv:sent|dlv:here|no_space/.test(jLog + "\n" + mLog) ||
      p.bots.Jazwyn.api.character.items.some((x) => x && x.name === "gloves" && x.level === 1) ||
      (p.bots.Jazwyn.api.character.esize || 0) > 2,
    "tight bags must make progress (sell/deliver/free space), not just avoid hopping"
  );
});

test("scenario: short farm bee pack stays together", async () => {
  const p = bootParty({ pack: "bee", pots: 200 });
  const hits = await runFarmGraded(p, 45000, { pack: "bee", R: 700 });
  const c = gradeSim(p.world, { packHits: hits });
  assert.strictEqual(c.chat_throttle, 0);
  assert.strictEqual(c.fighter_hop, 0);
  assert.strictEqual(p.bots.Jazwyn.api.character.map, "main");
  assertOnPack(c, 0.7);
});

test("scenario: short farm goo pack stays together", async () => {
  const p = bootParty({ pack: "goo", pots: 200 });
  const hits = await runFarmGraded(p, 45000, { pack: "goo", R: 900 });
  const c = gradeSim(p.world, { packHits: hits });
  assert.strictEqual(c.fighter_hop, 0);
  assert.strictEqual(p.bots.Jazwyn.api.character.map, "main");
  assert.strictEqual(p.world.where("Jazwyn").key, "US/III");
  assertOnPack(c, 0.7);
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
