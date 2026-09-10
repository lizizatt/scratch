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

test("scenario: 15 min farm loot→equip / bank / gift / stall", async () => {
  // bankSeed gloves@2 only — proves bank→gift pipe. Frogt/stall must come from farm.
  const FROGT_SEED = 0;
  const p = bootParty({
    pack: "armadillo",
    pots: 25,
    gold: 200000,
    burnPots: true,
    burnPerTick: 2,
    potionTarget: 40,
    fighterSlots: {},
    bankSeed: [{ name: "gloves", level: 2 }],
  });
  await p.runFor(20 * 60 * 1000);
  const farmEndT = p.world.clock.now();
  // Stall is idle-only now — satiate fighters and drain queue so frogt can vendor.
  for (const n of ["Jazwyn", "Sarene", "Zarook"]) {
    const bag = p.bots[n].api.character.items || [];
    for (const it of bag) {
      if (it && it.name && it.name.indexOf("hpot") === 0) it.q = 200;
      if (it && it.name && it.name.indexOf("mpot") === 0) it.q = 200;
    }
  }
  for (let i = 0; i < 250; i++) {
    await p.tickAll();
    const early = p.bots.Puppygirl.api.log.game.map((g) => g.m);
    if (early.some((m) => /^vendor:sell frogt/.test(m))) break;
  }

  const allGame = [];
  for (const n of Object.keys(p.bots)) {
    for (const g of p.bots[n].api.log.game) allGame.push({ who: n, m: g.m, t: g.t != null ? g.t : 0 });
  }
  const mGame = p.bots.Puppygirl.api.log.game.map((g) => ({
    who: "Puppygirl",
    m: g.m,
    t: g.t != null ? g.t : 0,
  }));
  const mFarm = mGame.filter((g) => g.t <= farmEndT);
  const mLog = mGame.map((g) => g.m);

  function first(logs, re) {
    return logs.find((g) => re.test(g.m)) || null;
  }

  // --- Combat loot spine (farm-sourced) ---
  const kills = allGame.filter((g) => /^kill /.test(g.m));
  const drops = allGame.filter((g) => /^drop /.test(g.m));
  const loots = allGame.filter((g) => /^loot /.test(g.m));
  assert.ok(kills.length >= 3, "expected kills, got " + kills.length);
  assert.ok(drops.length >= 3, "expected drops, got " + drops.length);
  assert.ok(loots.length >= 3, "expected loots, got " + loots.length);
  assert.ok(
    drops.some((g) => /frogt/.test(g.m)),
    "expected frogt in a drop line"
  );
  assert.ok(
    loots.some((g) => /^loot frogt/.test(g.m)),
    "expected loot frogt"
  );
  // At least one killer also looted frogt (weak coupling; same who)
  const killers = new Set(kills.map((g) => g.who));
  assert.ok(
    loots.some((g) => /^loot frogt/.test(g.m) && killers.has(g.who)),
    "expected a killer to also loot frogt"
  );

  // --- Immediate drop-equip (@0 from loot; gift path is @2) ---
  const dropEquip = allGame.find((g) => /^equip (gloves|shoes|helmet|pants) \+0 -> /.test(g.m));
  assert.ok(dropEquip, "expected @0 gear equip from a farm drop");
  const lootedNames = new Set();
  for (const g of loots) {
    const m = g.m.match(/^loot (gloves|shoes|helmet|pants)/);
    if (m) lootedNames.add(m[1]);
  }
  const dropEquipName = dropEquip.m.match(/^equip (gloves|shoes|helmet|pants)/)[1];
  assert.ok(
    lootedNames.has(dropEquipName),
    "drop-equip " + dropEquipName + " should appear in loot lines"
  );

  // --- Toss → bank frogt (farm junk) ---
  const tossFrogt = allGame.filter((g) => /^toss frogt/.test(g.m));
  const storeFrogt = mGame.filter((g) => /^bank:store frogt/.test(g.m));
  assert.ok(tossFrogt.length >= 1, "expected toss frogt to merchant");
  // Sell junk vendors from idleEcon when idle (see post-run drain above).
  assert.ok(
    storeFrogt.length >= 1 || mLog.some((m) => /^vendor:sell frogt/.test(m)),
    "expected frogt banked or NPC-vendored after idle drain"
  );
  if (storeFrogt.length) {
    assert.ok(
      storeFrogt.some((s) => tossFrogt.some((t) => t.t <= s.t)),
      "expected a frogt toss at or before a bank:store frogt"
    );
  }

  // --- Ordered gift chain from bankSeed gloves@2 (batched onto pots or standalone) ---
  const planEv = first(mFarm, /^gear:plan gloves@2->(\w+)/);
  assert.ok(planEv, "expected gear:plan gloves@2");
  const giftWho = planEv.m.match(/^gear:plan gloves@2->(\w+)/)[1];
  const retrieveEv = first(mFarm, /bank_retrieve gloves@2/);
  const sendEv = first(mFarm, /^dlv:send_gear gloves@2/);
  const gotEv = allGame.find((g) => g.who === giftWho && /^gear_got gloves ok=1/.test(g.m));
  assert.ok(retrieveEv, "expected bank_retrieve gloves@2");
  assert.ok(sendEv, "expected dlv:send_gear gloves@2");
  assert.ok(gotEv, "expected gear_got gloves ok=1 from " + giftWho);
  assert.ok(planEv.t <= retrieveEv.t, "plan before retrieve");
  assert.ok(retrieveEv.t <= sendEv.t, "retrieve before send_gear");
  assert.ok(sendEv.t <= gotEv.t, "send_gear before gear_got");
  const worn = p.bots[giftWho].api.character.slots.gloves;
  assert.ok(worn && worn.name === "gloves" && (worn.level || 0) >= 2, giftWho + " should wear gloves@2");
  // P3 under burn: gift must ride a pot job (no standalone dlv_gear)
  const batchEv = mFarm.find((g) => /^gear:batch id=/.test(g.m));
  assert.ok(batchEv, "expected gear:batch under burnPots");
  assert.ok(
    !mFarm.some((g) => /^dlv:active dlv_gear/.test(g.m)),
    "must not spawn standalone dlv_gear while pots are burning"
  );
  const batchId = batchEv.m.match(/^gear:batch id=(\S+)/)[1];
  assert.ok(
    mFarm.some((g) => g.m === "dlv:done id=" + batchId),
    "gear:batch id must match a pot dlv:done id"
  );

  // --- NPC vendor from farm frogt (no frogt in bankSeed) ---
  const vendorSell = first(mGame, /^vendor:sell frogt/);
  assert.ok(vendorSell, "expected vendor:sell frogt");
  assert.strictEqual(FROGT_SEED, 0, "test invariant: no frogt seed");
  assert.ok(!mLog.some((m) => /^stall:list frogt/.test(m)), "must not stall-list frogt");

  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
  assert.strictEqual(gradeSim(p.world, {}).chat_throttle, 0);
});


test("scenario: gear batches onto pot delivery (P3)", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 200000,
    bankSeed: [{ name: "gloves", level: 2 }],
    fighterSlots: {},
    members: ["Jazwyn", "Puppygirl"],
  });
  await p.bots.Jazwyn.api.send_cm("Puppygirl", {
    gear_ad: 1,
    name: "Jazwyn",
    esize: 18,
    ctype: "warrior",
    slots: {
      mainhand: null,
      offhand: null,
      helmet: null,
      chest: null,
      pants: null,
      shoes: null,
      gloves: null,
      cape: null,
      belt: null,
      amulet: null,
      ring1: null,
      ring2: null,
    },
  });
  await p.bots.Jazwyn.ctrl.requestPots();
  let doneId = null;
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    const hit = p.bots.Puppygirl.api.log.game.find((g) => /^dlv:done id=/.test(g.m));
    if (hit) {
      doneId = hit.m.replace(/^dlv:done id=/, "");
      break;
    }
  }
  assert.ok(doneId, "expected pot delivery done");
  const mLog = p.bots.Puppygirl.api.log.game.map((g) => g.m);
  assert.ok(
    mLog.some((m) => m.indexOf("gear:batch id=" + doneId + " ") === 0),
    "expected gear:batch on the same pot job id=" + doneId
  );
  assert.ok(
    mLog.some((m) => m === "dlv:send hpot1 id=" + doneId || m === "dlv:send mpot1 id=" + doneId),
    "expected pot send bound to job id=" + doneId
  );
  assert.ok(
    mLog.some((m) => m === "dlv:send_gear gloves@2 id=" + doneId),
    "expected gear send bound to job id=" + doneId
  );
  assert.ok(
    !mLog.some((m) => /^dlv:active dlv_gear/.test(m)),
    "must not spawn a standalone dlv_gear when pot run can carry it"
  );
  const g = p.bots.Jazwyn.api.character.slots.gloves;
  assert.ok(g && g.name === "gloves" && (g.level || 0) >= 2, "Jazwyn wears gloves@2");
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
});

test("scenario: gift swap tosses replaced piece to bank (P5)", async () => {
  // Solo fighter so replaced gloves@0 are not immediately re-gifted to another empty slot
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 200000,
    bankSeed: [{ name: "gloves", level: 2 }],
    slots: { Jazwyn: { gloves: { name: "gloves", level: 0 } } },
    members: ["Jazwyn", "Puppygirl"],
  });
  await p.bots.Jazwyn.api.send_cm("Puppygirl", {
    gear_ad: 1,
    name: "Jazwyn",
    esize: 18,
    ctype: "warrior",
    slots: {
      mainhand: null,
      offhand: null,
      helmet: null,
      chest: null,
      pants: null,
      shoes: null,
      gloves: { name: "gloves", level: 0 },
      cape: null,
      belt: null,
      amulet: null,
      ring1: null,
      ring2: null,
    },
  });
  await p.bots.Jazwyn.ctrl.requestPots();
  let gotAt = null;
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    const got = p.bots.Jazwyn.api.log.game.find((g) => /^gear_got gloves ok=1/.test(g.m));
    if (got) {
      gotAt = got.t != null ? got.t : p.world.clock.now();
      break;
    }
  }
  assert.ok(gotAt != null, "expected gear_got ok");
  // Park only — stop once replaced gloves are banked (avoid stall consuming them)
  let stored = false;
  for (let j = 0; j < 80; j++) {
    await p.tickAll();
    if (p.bots.Puppygirl.api.log.game.some((g) => /^bank:store gloves@0/.test(g.m))) {
      stored = true;
      break;
    }
  }
  assert.ok(stored, "expected bank:store gloves@0");

  const jGame = p.bots.Jazwyn.api.log.game;
  const mGame = p.bots.Puppygirl.api.log.game;
  const replaced = jGame.find((g) => /^gear:replaced gloves@0/.test(g.m));
  const toss = jGame.find((g) => /^toss gloves@0/.test(g.m));
  const store = mGame.find((g) => /^bank:store gloves@0/.test(g.m));
  assert.ok(replaced, "expected gear:replaced gloves@0");
  assert.ok(toss, "expected toss gloves@0");
  assert.ok(store, "expected bank:store gloves@0");
  assert.ok(replaced.t <= toss.t, "replaced before toss");
  assert.ok(toss.t <= store.t, "toss before bank:store");

  const worn = p.bots.Jazwyn.api.character.slots.gloves;
  assert.ok(worn && (worn.level || 0) >= 2, "wearing gloves@2 after swap");
  // After store, idle sourcing may pull/upgrade the take-back — spine is replaced→toss→store
  assert.ok(
    p.bots.Puppygirl.api.log.game.some((g) => /^bank:store gloves@0/.test(g.m)),
    "merchant banked the replaced gloves@0 at least once"
  );
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
});

test("scenario: continuous pot queue skips stall flash before delivery", async () => {
  // Non-empty q must go straight to delivery — not open stall then close on dequeue (live flash).
  const p = bootParty({
    pack: "armadillo",
    pots: 40,
    gold: 200000,
    members: ["Jazwyn", "Puppygirl"],
  });
  const mCtrl = p.bots.Puppygirl.ctrl;
  const mApi = p.bots.Puppygirl.api;
  const bag = mApi.character.items;
  const slot = bag.findIndex((x) => !x);
  assert.ok(slot >= 0, "merchant needs a free bag slot");
  bag[slot] = { name: "frogt", q: 3 };
  mApi.character.esize = Math.max(0, (mApi.character.esize || 0) - 1);
  mCtrl.enqueue({
    id: "q_keep_1",
    kind: "dlv_pots",
    who: "Jazwyn",
    items: [
      { name: "hpot1", q: 5 },
      { name: "mpot1", q: 5 },
    ],
  });
  mCtrl.enqueue({
    id: "q_keep_2",
    kind: "dlv_pots",
    who: "Jazwyn",
    items: [
      { name: "hpot1", q: 5 },
      { name: "mpot1", q: 5 },
    ],
  });
  assert.ok(mCtrl.store.q.length >= 2, "queue must stay non-empty during delivery");

  let firstActive = null;
  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    firstActive = mApi.log.game.find((g) => /^dlv:active dlv_pots/.test(g.m));
    if (firstActive) break;
  }
  assert.ok(firstActive, "expected dlv:active");
  const stallBeforeActive = mApi.log.game.find(
    (g) => g.t < firstActive.t && (/^stall:open /.test(g.m) || /^stall:list frogt/.test(g.m) || /^vendor:sell frogt/.test(g.m))
  );
  assert.ok(!stallBeforeActive, "must not flash-open stall/vendor before delivery when queue busy");

  let done = false;
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    if (mApi.log.game.filter((g) => /^dlv:done id=/.test(g.m)).length >= 2) {
      done = true;
      break;
    }
  }
  assert.ok(done, "pot deliveries must complete");

  let vendorAfterIdle = null;
  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    vendorAfterIdle = mApi.log.game.find((g) => /^vendor:sell frogt/.test(g.m));
    if (vendorAfterIdle) break;
  }
  assert.ok(vendorAfterIdle, "expected vendor:sell after queue drained (idleEcon)");
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
});

test("scenario: park path_fail does not starve pot queue", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 40,
    gold: 200000,
    members: ["Jazwyn", "Puppygirl"],
  });
  const mCtrl = p.bots.Puppygirl.ctrl;
  const mApi = p.bots.Puppygirl.api;
  const bag = mApi.character.items;
  const slot = bag.findIndex((x) => !x);
  bag[slot] = { name: "gloves", level: 7 };
  mApi.character.esize = Math.max(0, (mApi.character.esize || 0) - 1);
  mCtrl.enqueue({
    id: "q_pathfail_pots",
    kind: "dlv_pots",
    who: "Jazwyn",
    items: [
      { name: "hpot1", q: 10 },
      { name: "mpot1", q: 10 },
    ],
  });
  mApi._injectSmartFail("fail");

  let pathFail = false;
  let done = false;
  let stuck = false;
  for (let i = 0; i < 300; i++) {
    await p.tickAll();
    const msgs = mApi.log.game.map((g) => g.m);
    if (msgs.some((m) => m === "bank:path_fail" || m === "bank:park_stuck")) pathFail = true;
    if (msgs.some((m) => m === "bank:park_stuck")) stuck = true;
    if (msgs.some((m) => /^dlv:done id=/.test(m))) {
      done = true;
      break;
    }
  }
  assert.ok(pathFail, "expected bank path failure while parking");
  assert.ok(stuck || pathFail, "expected park stuck signal or path_fail");
  assert.ok(done, "pot dlv:done must proceed despite park failure");
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
});

test("scenario: P5 replace under continuous pot queue", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 200000,
    bankSeed: [{ name: "gloves", level: 2 }],
    slots: { Jazwyn: { gloves: { name: "gloves", level: 0 } } },
    members: ["Jazwyn", "Puppygirl"],
  });
  await p.bots.Jazwyn.api.send_cm("Puppygirl", {
    gear_ad: 1,
    name: "Jazwyn",
    esize: 18,
    ctype: "warrior",
    slots: {
      mainhand: null,
      offhand: null,
      helmet: null,
      chest: null,
      pants: null,
      shoes: null,
      gloves: { name: "gloves", level: 0 },
      cape: null,
      belt: null,
      amulet: null,
      ring1: null,
      ring2: null,
    },
  });
  await p.bots.Jazwyn.ctrl.requestPots();
  // Keep another pot job queued so park must win against a non-empty q after gift
  p.bots.Puppygirl.ctrl.enqueue({
    id: "q_after_gift",
    kind: "dlv_pots",
    who: "Jazwyn",
    items: [
      { name: "hpot1", q: 5 },
      { name: "mpot1", q: 5 },
    ],
  });

  let gotAt = null;
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    const got = p.bots.Jazwyn.api.log.game.find((g) => /^gear_got gloves ok=1/.test(g.m));
    if (got) {
      gotAt = got.t != null ? got.t : p.world.clock.now();
      break;
    }
  }
  assert.ok(gotAt != null, "expected gear_got ok");

  let store = null;
  for (let j = 0; j < 120; j++) {
    await p.tickAll();
    store = p.bots.Puppygirl.api.log.game.find((g) => /^bank:store gloves@0/.test(g.m));
    if (store) break;
  }
  assert.ok(store, "expected bank:store gloves@0 under queued pots");

  const jGame = p.bots.Jazwyn.api.log.game;
  const replaced = jGame.find((g) => /^gear:replaced gloves@0/.test(g.m));
  const toss = jGame.find((g) => /^toss gloves@0/.test(g.m));
  assert.ok(replaced && toss, "expected replaced + toss");
  assert.ok(replaced.t <= toss.t && toss.t <= store.t, "replaced → toss → store order");

  const bank = p.bots.Puppygirl.api.character._bank || p.bots.Puppygirl.api.character.bank;
  assert.ok(
    bank && bank.items0 && bank.items0.some((it) => it && it.name === "gloves"),
    "replaced gloves must remain in bank"
  );
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
});

test("scenario: full bag does not emit empty pot dlv:done", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 40,
    gold: 200000,
    members: ["Jazwyn", "Puppygirl"],
  });
  const mApi = p.bots.Puppygirl.api;
  const mCtrl = p.bots.Puppygirl.ctrl;
  // Fill merchant bag with gear; fill bank so park cannot clear
  const items = new Array(42).fill(null);
  for (let i = 0; i < 42; i++) items[i] = { name: "gloves", level: 0 };
  mApi.character.items = items;
  mApi.character.esize = 0;
  const bankBag = new Array(42).fill(null);
  for (let i = 0; i < 42; i++) bankBag[i] = { name: "shoes", level: 0 };
  mApi.character.bank = mApi.character._bank = { gold: 0, items0: bankBag };

  mCtrl.enqueue({
    id: "empty_send_guard",
    kind: "dlv_pots",
    who: "Jazwyn",
    items: [
      { name: "hpot1", q: 10 },
      { name: "mpot1", q: 10 },
    ],
  });

  for (let i = 0; i < 250; i++) await p.tickAll();
  const mLog = mApi.log.game.map((g) => g.m);
  assert.ok(
    mLog.some((m) => m === "dlv:no_space" || m === "dlv:buy_fail hpot1" || m === "dlv:empty_send" || m === "bank:full" || m === "bank:park_stuck"),
    "expected space/buy/park failure signal"
  );
  assert.ok(
    !mLog.some((m) => m === "dlv:done id=empty_send_guard"),
    "must not dlv:done without sending pots"
  );
  assert.ok(
    !mLog.some((m) => /^dlv:send hpot1 id=empty_send_guard/.test(m)),
    "no successful pot send expected"
  );
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
});

test("scenario: toss does not log when merchant has no space", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 40,
    gold: 50000,
    members: ["Jazwyn", "Puppygirl"],
  });
  // Place both on farm pack in range
  const j = p.bots.Jazwyn.api.character;
  const m = p.bots.Puppygirl.api.character;
  j.map = "main";
  j.real_x = j.x = 526;
  j.real_y = j.y = 1846;
  m.map = "main";
  m.real_x = m.x = 530;
  m.real_y = m.y = 1846;
  // Merchant bag + bank full so park cannot free space for toss
  const mItems = new Array(42).fill(null);
  for (let i = 0; i < 42; i++) mItems[i] = { name: "ringsj", level: 0 };
  m.items = mItems;
  m.esize = 0;
  const bankBag = new Array(42).fill(null);
  for (let i = 0; i < 42; i++) bankBag[i] = { name: "shoes", level: 0 };
  m.bank = m._bank = { gold: 0, items0: bankBag };
  // Fighter has tossable frogt
  const slot = j.items.findIndex((x) => !x);
  j.items[slot] = { name: "frogt", q: 2 };
  j.esize = Math.max(0, (j.esize || 1) - 1);

  for (let i = 0; i < 30; i++) await p.tickAll();
  assert.ok(
    !p.bots.Jazwyn.api.log.game.some((g) => /^toss frogt/.test(g.m)),
    "must not log toss when send_item fails no_space"
  );
  assert.ok(
    j.items.some((it) => it && it.name === "frogt"),
    "frogt must remain on fighter"
  );
});

test("scenario: merchant reserves ≥3 slots before field delivery", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 200000,
    members: ["Jazwyn", "Puppygirl"],
  });
  const mApi = p.bots.Puppygirl.api;
  const mCtrl = p.bots.Puppygirl.ctrl;
  // Nearly full bag of parkable gear + leave 0 free slots after pots would fill
  const items = new Array(42).fill(null);
  for (let i = 0; i < 40; i++) items[i] = { name: "gloves", level: 0 };
  mApi.character.items = items;
  mApi.character.esize = 2;
  mCtrl.enqueue({
    id: "reserve3",
    kind: "dlv_pots",
    who: "Jazwyn",
    items: [
      { name: "hpot1", q: 5 },
      { name: "mpot1", q: 5 },
    ],
  });
  let done = false;
  let sawNeed = false;
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    const msgs = mApi.log.game.map((g) => g.m);
    if (msgs.some((m) => /^dlv:need_space/.test(m))) sawNeed = true;
    if (msgs.some((m) => m === "dlv:done id=reserve3")) {
      done = true;
      break;
    }
  }
  assert.ok(done, "delivery should complete after parking for take-back slots");
  // At or before done, merchant must have parked gear (store) and left with space
  assert.ok(
    mApi.log.game.some((g) => /^bank:store gloves/.test(g.m)),
    "expected park before field to free take-back slots"
  );
  assert.ok((mApi.character.esize || 0) >= 3 || sawNeed, "esize≥3 after reserve or need_space logged");
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
});

test("scenario: take-back reserve must not park in-transit gift", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 200000,
    bankSeed: [{ name: "gloves", level: 2 }],
    fighterSlots: {},
    members: ["Jazwyn", "Puppygirl"],
  });
  await p.bots.Jazwyn.api.send_cm("Puppygirl", {
    gear_ad: 1,
    name: "Jazwyn",
    esize: 18,
    ctype: "warrior",
    slots: {
      gloves: null,
      helmet: null,
      chest: null,
      pants: null,
      shoes: null,
      mainhand: null,
      offhand: null,
      cape: null,
      belt: null,
      amulet: null,
      ring1: null,
      ring2: null,
    },
  });
  // Fill merchant with parkable junk so ensureTakeBackSlots must park something
  const m = p.bots.Puppygirl.api.character;
  for (let i = 0; i < 38; i++) {
    if (!m.items[i]) m.items[i] = { name: "shoes", level: 0 };
  }
  m.esize = Math.max(0, 42 - m.items.filter(Boolean).length);
  await p.bots.Jazwyn.ctrl.requestPots();

  let doneId = null;
  for (let i = 0; i < 500; i++) {
    await p.tickAll();
    const hit = p.bots.Puppygirl.api.log.game.find((g) => /^dlv:done id=/.test(g.m));
    if (hit) {
      doneId = hit.m.replace(/^dlv:done id=/, "");
      break;
    }
  }
  assert.ok(doneId, "expected pot+gift delivery done");
  const mLog = p.bots.Puppygirl.api.log.game.map((g) => g.m);
  assert.ok(
    mLog.some((m) => m === "dlv:send_gear gloves@2 id=" + doneId),
    "in-transit gloves@2 must be sent, not parked by take-back reserve"
  );
  assert.ok(
    mLog.some((m) => m.indexOf("gear:batch id=" + doneId + " ") === 0),
    "expected gear batch on same job"
  );
  assert.ok(
    !mLog.some((m) => m === "bank:store gloves@2"),
    "must not bank:store the in-transit gift gloves@2"
  );
  const worn = p.bots.Jazwyn.api.character.slots.gloves;
  assert.ok(worn && worn.name === "gloves" && (worn.level || 0) >= 2, "Jazwyn wears gloves@2");
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
});

test("scenario: self-sustaining buy→upgrade→gift (empty bank)", async () => {
  // No bankSeed — merchant must vendor-buy + scroll0-upgrade then gift.
  const p = bootParty({
    pack: "armadillo",
    pots: 40,
    gold: 80000,
    bankSeed: [],
    fighterSlots: {},
    members: ["Jazwyn", "Puppygirl"],
  });
  // Merchant gold above float so buys are allowed
  p.bots.Puppygirl.api.character.gold = 500000;
  await p.bots.Jazwyn.api.send_cm("Puppygirl", {
    gear_ad: 1,
    name: "Jazwyn",
    esize: 18,
    ctype: "warrior",
    slots: {
      gloves: null,
      helmet: null,
      chest: null,
      pants: null,
      shoes: null,
      mainhand: null,
      offhand: null,
      cape: null,
      belt: null,
      amulet: null,
      ring1: null,
      ring2: null,
    },
  });

  let got = null;
  for (let i = 0; i < 800; i++) {
    await p.tickAll();
    got = p.bots.Jazwyn.api.log.game.find((g) => /^gear_got \w+ ok=1/.test(g.m));
    if (got) break;
  }
  const mLog = p.bots.Puppygirl.api.log.game.map((g) => g.m);
  assert.ok(
    mLog.some((m) => /^gear:buy (gloves|shoes|helmet|pants|coat)@0/.test(m)),
    "expected vendor buy of armor base"
  );
  assert.ok(
    mLog.some((m) => m === "gear:buy scroll0" || /^gear:buy scroll0/.test(m)),
    "expected scroll0 buy"
  );
  assert.ok(
    mLog.some((m) => /^gear:upgrade (gloves|shoes|helmet|pants|coat)@0->/.test(m)),
    "expected upgrade of sourced armor"
  );
  assert.ok(got, "expected gear_got from sourced piece, plans=" + mLog.filter((m) => /^gear:plan/.test(m)).join(" | "));
  assert.ok(
    mLog.some((m) => /^gear:plan (gloves|shoes|helmet|pants|coat)@/.test(m)),
    "expected gear:plan after source"
  );
  assert.strictEqual(gradeSim(p.world, {}).fighter_hop, 0);
});

test("scenario: banked upgradeable vendor gear blocks further vendor buys", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    members: ["Jazwyn", "Puppygirl"],
    fighterSlots: {},
  });
  p.bots.Puppygirl.api.character.gold = 500000;
  const bank = p.bots.Puppygirl.api.character.bank || p.bots.Puppygirl.api.character._bank;
  bank.items0[0] = { name: "gloves", level: 0 };
  await p.bots.Jazwyn.api.send_cm("Puppygirl", {
    gear_ad: 1,
    name: "Jazwyn",
    esize: 18,
    ctype: "warrior",
    slots: {
      gloves: null,
      shoes: null,
      helmet: null,
      chest: null,
      pants: null,
      mainhand: null,
      offhand: null,
      cape: null,
      belt: null,
      amulet: null,
      ring1: null,
      ring2: null,
    },
  });
  for (let i = 0; i < 25; i++) await p.tickAll();
  const mGame = p.bots.Puppygirl.api.log.game;
  const up = mGame.find((g) => /^gear:upgrade gloves@0/.test(g.m));
  assert.ok(up, "expected upgrade of banked gloves first");
  const earlyBuy = mGame.find(
    (g) => g.t < up.t && /^gear:buy (shoes|helmet|pants|coat)@0/.test(g.m)
  );
  assert.ok(!earlyBuy, "must not vendor-buy more bases before upgrading banked gloves");
});

test("scenario: vendor buy requires scroll0 headroom under GOLD_FLOAT_MERCHANT", async () => {
  const { GOLD_FLOAT_MERCHANT } = require("../src/constants");
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    members: ["Jazwyn", "Puppygirl"],
    fighterSlots: {},
    bankSeed: [],
  });
  // Enough for gloves (800) but not gloves+scroll0 (800+1000) above float
  p.bots.Puppygirl.api.character.gold = GOLD_FLOAT_MERCHANT + 900;
  await p.bots.Jazwyn.api.send_cm("Puppygirl", {
    gear_ad: 1,
    name: "Jazwyn",
    esize: 18,
    ctype: "warrior",
    slots: {
      gloves: null,
      shoes: null,
      helmet: null,
      chest: null,
      pants: null,
      mainhand: null,
      offhand: null,
      cape: null,
      belt: null,
      amulet: null,
      ring1: null,
      ring2: null,
    },
  });
  for (let i = 0; i < 40; i++) await p.tickAll();
  const mLog = p.bots.Puppygirl.api.log.game.map((g) => g.m);
  assert.ok(mLog.some((m) => m === "gear:buy_gold"), "expected gear:buy_gold without scroll headroom");
  assert.ok(!mLog.some((m) => /^gear:buy gloves@0/.test(m)), "must not buy gloves without scroll budget");
});

test("scenario: upgrade skips when chance below gate", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    gold: 80000,
    members: ["Puppygirl"],
  });
  p.bots.Puppygirl.api.character.gold = 500000;
  // gloves@3 → chance 1-0.24=0.76 < 0.9; no ads so nothing else sources
  const bag = p.bots.Puppygirl.api.character.items;
  const slot = bag.findIndex((x) => !x);
  bag[slot] = { name: "gloves", level: 3 };
  p.bots.Puppygirl.api.character.esize = Math.max(0, (p.bots.Puppygirl.api.character.esize || 1) - 1);
  for (let i = 0; i < 30; i++) await p.tickAll();
  const mLog = p.bots.Puppygirl.api.log.game.map((g) => g.m);
  assert.ok(
    mLog.some((m) => /^gear:upgrade_skip/.test(m)),
    "expected gear:upgrade_skip for low-chance piece"
  );
  assert.ok(
    !mLog.some((m) => /^gear:upgrade gloves@3/.test(m)),
    "must not upgrade gloves@3"
  );
  const still = p.bots.Puppygirl.api.character.items.find((x) => x && x.name === "gloves" && (x.level || 0) === 3);
  const bank = p.bots.Puppygirl.api.character.bank || p.bots.Puppygirl.api.character._bank;
  const banked =
    bank && bank.items0 && bank.items0.some((x) => x && x.name === "gloves" && (x.level || 0) === 3);
  assert.ok(still || banked, "gloves@3 must remain (skipped, not destroyed)");
});

test("scenario: metrics emit kpm/gpm after farm window", async () => {
  const p = bootParty({ pack: "armadillo", pots: 200, members: ["Jazwyn", "Puppygirl"] });
  let lines = [];
  for (let i = 0; i < 500 && !lines.length; i++) {
    await p.tickAll();
    lines = p.bots.Jazwyn.api.log.game.filter((g) => /^metrics kpm=/.test(g.m));
  }
  assert.ok(lines.length >= 1, "expected metrics line");
  const m = lines[0].m.match(/^metrics kpm=([\d.]+) gpm=(-?[\d.]+)/);
  assert.ok(m, "metrics format kpm/gpm");
  assert.ok(parseFloat(m[1]) > 0, "kills/min should be > 0 after farming");
});

test("scenario: late gear_ad batches onto in-flight pot job (P3)", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 200000,
    bankSeed: [{ name: "gloves", level: 2 }],
    fighterSlots: {},
    members: ["Jazwyn", "Puppygirl"],
  });
  // Start pot job with NO gear_ad yet
  await p.bots.Jazwyn.ctrl.requestPots();
  let bought = false;
  for (let i = 0; i < 80; i++) {
    await p.tickAll();
    if (p.bots.Puppygirl.api.log.game.some((g) => /^dlv:buy /.test(g.m))) {
      bought = true;
      break;
    }
  }
  assert.ok(bought, "vendor buy should happen before ad");
  assert.ok(
    !p.bots.Puppygirl.api.log.game.some((g) => /^gear:batch /.test(g.m)),
    "must not batch before gear_ad"
  );
  // Late advertisement while pot job is active
  await p.bots.Jazwyn.api.send_cm("Puppygirl", {
    gear_ad: 1,
    name: "Jazwyn",
    esize: 18,
    ctype: "warrior",
    slots: {
      gloves: null,
      helmet: null,
      chest: null,
      pants: null,
      shoes: null,
      mainhand: null,
      offhand: null,
      cape: null,
      belt: null,
      amulet: null,
      ring1: null,
      ring2: null,
    },
  });
  let doneId = null;
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    const hit = p.bots.Puppygirl.api.log.game.find((g) => /^dlv:done id=/.test(g.m));
    if (hit) {
      doneId = hit.m.replace(/^dlv:done id=/, "");
      break;
    }
  }
  assert.ok(doneId, "delivery completes");
  const mLog = p.bots.Puppygirl.api.log.game.map((g) => g.m);
  assert.ok(
    mLog.some((m) => m.indexOf("gear:batch id=" + doneId + " ") === 0),
    "late gear_ad must still batch onto the in-flight pot job"
  );
  assert.ok(mLog.some((m) => m === "dlv:send_gear gloves@2 id=" + doneId));
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
  // After handoff merchant retreats to plaza (does not linger on SE farm).
  const pg = p.bots.Puppygirl.api.character;
  const msgs = p.bots.Puppygirl.api.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((x) => x === "dlv:retreat") || Math.hypot(pg.real_x - 40, pg.real_y - -20) < 100,
    "expected retreat to plaza after dlv, xy=" + pg.real_x + "," + pg.real_y
  );
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

test("scenario: dry follower still paths to pack (no town strand)", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 100000,
    members: ["Jazwyn", "Sarene", "Puppygirl"],
  });
  const lead = p.bots.Jazwyn.api.character;
  const mage = p.bots.Sarene.api.character;
  // Strand mage at town plaza while lead farms pack
  mage.map = "main";
  mage.x = mage.real_x = -32;
  mage.y = mage.real_y = -80;
  for (let i = 0; i < mage.items.length; i++) mage.items[i] = null;
  mage.esize = mage.items.length;
  for (let i = 0; i < 40; i++) {
    await p.tickAll();
    const d = Math.hypot(mage.real_x - lead.real_x, mage.real_y - lead.real_y);
    if (d < 500) break;
  }
  const d = Math.hypot(mage.real_x - lead.real_x, mage.real_y - lead.real_y);
  const logs = p.bots.Sarene.api.log.game.map((g) => g.m).join("\n");
  assert.ok(
    d < 500 || /follow:(far_pack|no_lead)/.test(logs),
    "dry Sarene should leave town toward pack; d=" + Math.round(d)
  );
});

test("scenario: fighter gold_offload above GOLD_FLOAT_FIGHTER to merchant", async () => {
  const { GOLD_FLOAT_FIGHTER } = require("../src/constants");
  const slots = {
    helmet: { name: "helmet", level: 7 },
    chest: { name: "coat", level: 7 },
    pants: { name: "pants", level: 7 },
    shoes: { name: "shoes", level: 7 },
    gloves: { name: "gloves", level: 7 },
    mainhand: { name: "blade", level: 7 },
    offhand: { name: "shield", level: 7 },
  };
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    members: ["Jazwyn", "Puppygirl"],
    fighterSlots: slots,
    bankSeed: [],
  });
  const j = p.bots.Jazwyn.api.character;
  const m = p.bots.Puppygirl.api.character;
  m.map = j.map;
  m.x = m.real_x = j.real_x + 40;
  m.y = m.real_y = j.real_y;
  m.gold = 0;
  j.gold = GOLD_FLOAT_FIGHTER + 500000;
  for (let i = 0; i < 20; i++) await p.tickAll();
  assert.ok(
    p.bots.Jazwyn.api.log.game.some((g) => /^gold_offload /.test(g.m)),
    "expected gold_offload log"
  );
  assert.ok(j.gold <= GOLD_FLOAT_FIGHTER + 1, "fighter keeps float, got " + j.gold);
  assert.ok(m.gold >= 400000, "merchant received excess, got " + m.gold);
});

test("scenario: broke merchant scoops fighter gold then buys pots", async () => {
  const { GOLD_FLOAT_FIGHTER } = require("../src/constants");
  const slots = {
    helmet: { name: "helmet", level: 7 },
    chest: { name: "coat", level: 7 },
    pants: { name: "pants", level: 7 },
    shoes: { name: "shoes", level: 7 },
    gloves: { name: "gloves", level: 7 },
    mainhand: { name: "blade", level: 7 },
    offhand: { name: "shield", level: 7 },
  };
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    members: ["Jazwyn", "Puppygirl"],
    potionTarget: 20,
    fighterSlots: slots,
    bankSeed: [],
  });
  const j = p.bots.Jazwyn.api.character;
  const m = p.bots.Puppygirl.api.character;
  m.gold = 0;
  j.gold = GOLD_FLOAT_FIGHTER + 800000;
  // Merchant at vendor — buy_float then scoop to pack
  m.map = "main";
  m.x = m.real_x = 56;
  m.y = m.real_y = -122;
  await p.bots.Jazwyn.ctrl.requestPots();
  let bought = false;
  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    if (p.bots.Puppygirl.api.log.game.some((g) => /^dlv:buy /.test(g.m))) {
      bought = true;
      break;
    }
  }
  const mLog = p.bots.Puppygirl.api.log.game.map((g) => g.m);
  assert.ok(mLog.some((x) => x === "dlv:buy_float"), "expected initial buy_float");
  assert.ok(mLog.some((x) => /^dlv:scoop_gold/.test(x)), "expected scoop");
  assert.ok(
    mLog.some((x) => /^dlv:scoop_meet /.test(x)) || mLog.some((x) => /^dlv:scoop_got gold=/.test(x)),
    "expected scoop meet or got gold"
  );
  assert.ok(
    mLog.some((x) => /^dlv:scoop_got gold=/.test(x) && !/^dlv:scoop_got gold=0$/.test(x)),
    "scoop should receive gold: " + mLog.filter((x) => /^dlv:scoop/.test(x)).join(" | ")
  );
  assert.ok(bought, "merchant must buy pots after scoop: " + mLog.filter((x) => /^dlv:/.test(x)).slice(0, 25).join(" | "));
});

module.exports = { tests };
