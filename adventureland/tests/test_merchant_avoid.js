"use strict";

/**
 * 1) Delivery arrive-and-wait → usual resolution (empty_send loop, then done when sendable).
 * 2) Merchant-only avoidance through a constrained cave valley of wandering bats.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { safeMeet, packCenter } = require("../src/packs");
const avoid = require("../src/merchant_avoid");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function dist(a, b) {
  return Math.hypot(
    (a.real_x != null ? a.real_x : a.x) - (b.real_x != null ? b.real_x : b.x),
    (a.real_y != null ? a.real_y : a.y) - (b.real_y != null ? b.real_y : b.y)
  );
}

test("adversary: cross-map merchant travel stages through the destination map", async () => {
  const calls = [];
  const api = {
    character: { map: "main", real_x: 0, real_y: 0, x: 0, y: 0, rip: false },
    async smart_move(dest) {
      calls.push(Object.assign({}, dest));
      if (dest.map === "desertland" && dest.x == null) {
        this.character.map = "desertland";
        this.character.real_x = this.character.x = 0;
        this.character.real_y = this.character.y = 0;
        return { success: true };
      }
      if (this.character.map !== dest.map) return { failed: true, reason: "no_path" };
      this.character.real_x = this.character.x = dest.x;
      this.character.real_y = this.character.y = dest.y;
      return { success: true };
    },
    can_move_to() {
      return true;
    },
    get_monsters() {
      return [];
    },
  };

  const result = await avoid.goTo(api, { map: "desertland", x: 391, y: -1200 });

  assert.ok(result && result.success, "staged desert route should arrive");
  assert.deepStrictEqual(calls, [
    { map: "desertland" },
    { map: "desertland", x: 391, y: -1200 },
  ]);
  assert.strictEqual(api.character.map, "desertland");
});

test("scenario: dlv arrive-and-wait at party, then resolve when fighter has space", async () => {
  // Live shape: Puppygirl reaches the party meet, sends fail (no_space), empty_send
  // keeps store.active — then resolves once the fighter can receive.
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const zApi = p.bots.Zarook.api;
  const mApi = p.bots.Puppygirl.api;
  const z = zApi.character;
  const m = mApi.character;
  z.gold = m.gold = 500000;

  const meet = safeMeet("armadillo");
  const pc = packCenter("armadillo");
  z.map = pc.map;
  z.real_x = z.x = pc.x;
  z.real_y = z.y = pc.y;
  m.map = "main";
  m.real_x = m.x = meet.x;
  m.real_y = m.y = meet.y;
  m.stand = false;
  m.items[0] = { name: "hpot1", q: 50 };
  m.items[1] = { name: "mpot1", q: 50 };
  m.esize = m.items.filter((x) => !x).length;

  // Gate sends until we flip — reproduces full-bag / refuse-receive stall.
  let blockSend = true;
  const realSend = mApi.send_item.bind(mApi);
  mApi.send_item = async function (who, i, q) {
    if (blockSend) return { failed: true, reason: "no_space" };
    return realSend(who, i, q);
  };

  p.bots.Zarook.ctrl._setDlv({ id: "wait_resolve", kind: "pots", t0: zApi._now(), acked: 1 });
  // Freeze fighter AI so it doesn't enqueue competing pot jobs mid-scenario.
  p.bots.Zarook.ctrl.tick = async () => {};

  p.bots.Puppygirl.ctrl.enqueue({
    id: "wait_resolve",
    kind: "dlv_pots",
    who: "Zarook",
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ],
    farm: "armadillo",
    bought: 1,
    map: pc.map,
    x: pc.x,
    y: pc.y,
  });

  let sawWait = false;
  for (let i = 0; i < 40; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "dlv:empty_send") && p.bots.Puppygirl.ctrl.store.active) {
      sawWait = true;
      break;
    }
  }
  assert.ok(sawWait, "expected empty_send wait while job active");
  assert.ok(p.bots.Puppygirl.ctrl.store.active, "job held during wait (parked logistics)");
  assert.ok(!mApi.log.game.some((g) => g.m === "dlv:done id=wait_resolve"), "not done yet");

  // Usual resolution path: receiver can accept → next attempt completes.
  blockSend = false;
  z.esize = Math.max(z.esize, 5);

  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "dlv:done id=wait_resolve")) break;
    if (mApi.log.game.some((g) => /^dlv:abort_empty/.test(g.m))) break;
  }
  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(
    msgs.some((x) => x === "dlv:done id=wait_resolve"),
    "must resolve to dlv:done once sendable, logs=" + msgs.filter((x) => /^dlv:/.test(x)).join(" | ")
  );
  assert.ok(z.items.some((it) => it && it.name === "hpot1"), "Zarook got pots");
  assert.ok(!p.bots.Puppygirl.ctrl.store.active, "active cleared");
});

test("unit: suggestAvoidStep dodges predicted intercept", () => {
  const self = { real_x: 0, real_y: 0 };
  const dest = { x: 0, y: 200 };
  const blockers = [{ id: "b", x: -40, y: 60, vx: 80, vy: 0, r: 30 }];
  const step = avoid.suggestAvoidStep(self, dest, blockers, {
    stepPx: 40,
    horizonMs: 900,
    margin: 16,
    canMoveTo: () => true,
  });
  assert.ok(step, "must find a step");
  assert.ok(!step.brake, "should not only brake");
  assert.ok(Math.abs(step.x) > 8 || step.clear > 0, "step clears predicted path");
  assert.ok(!avoid.willCollide({ x: step.x, y: step.y }, blockers, avoid.DEFAULTS));
});

test("scenario: merchant dodges wandering bats in cave valley", async () => {
  // Force a narrow eastbound corridor (the cave's natural gap is ~y∈(-120,-60));
  // wandering bats patrol inside. Naive beeline contact-rips; avoidance threads through.
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    members: ["Puppygirl"],
  });
  const api = p.bots.Puppygirl.api;
  api._now = () => p.world.clock.now();
  const c = api.character;
  c.map = "cave";
  c.real_x = c.x = 0;
  c.real_y = c.y = -90;
  c.rip = false;
  c.hp = c.max_hp;

  const valley = { x0: 30, y0: -112, x1: 560, y1: -68 };
  const inValley = (x, y) =>
    api.can_move_to(x, y) && y >= valley.y0 && y <= valley.y1 && x >= -10 && x <= 700;

  const bats = [];
  for (let i = 0; i < 5; i++) {
    const x = 90 + i * 120;
    const y = -90;
    const m = p.world.spawnMonster("US/III", "cave", "bat", { x, y }, "valley_bat_" + i);
    m.avoidR = 24;
    m._wander = {
      x0: valley.x0,
      y0: valley.y0,
      x1: valley.x1,
      y1: valley.y1,
      speed: 10,
      periodMs: 400,
    };
    bats.push(m);
  }

  // Control: walk straight into a static line of bats → contact rip.
  const suicide = bootParty({ pack: "armadillo", pots: 50, members: ["Puppygirl"] });
  const sApi = suicide.bots.Puppygirl.api;
  const sc = sApi.character;
  sc.map = "cave";
  sc.real_x = sc.x = 0;
  sc.real_y = sc.y = -90;
  for (let i = 0; i < 5; i++) {
    suicide.world.spawnMonster("US/III", "cave", "bat", { x: 35 + i * 25, y: -90 }, "kill_bat_" + i);
  }
  for (let i = 0; i < 30; i++) {
    sc.real_x = sc.x = Math.min(220, sc.real_x + 10);
    sc.real_y = sc.y = -90;
    const blockers = avoid.createTracker().update(avoid.listMonsters(sApi, 800), i * 100, 28);
    if (avoid.applyContact(sApi, blockers, 34) || sc.rip) break;
    suicide.world.clock.advance(80);
  }
  assert.ok(sc.rip, "control: walking straight through bats should contact-rip");

  const dest = { map: "cave", x: 640, y: -90 };
  const result = await avoid.goTo(api, dest, {
    blockers: () => avoid.listMonsters(api, 800),
    canMoveTo: inValley,
    maxSteps: 500,
    stepPx: 18,
    tickMs: 140,
    contactR: 16,
    bodyR: 24,
    margin: 14,
    horizonMs: 900,
    unsureFrac: 0.6,
    progressWeight: 1.0,
    clearWeight: 2.0,
    angleFan: 10,
    angleStepDeg: 14,
  });

  assert.ok(!c.rip, "must not die dodging through valley");
  assert.ok(result && result.success, "must arrive, got " + JSON.stringify(result));
  assert.ok(dist(c, dest) <= 40, "near dest, at " + c.real_x + "," + c.real_y);
  assert.ok(c.real_y <= valley.y1 && c.real_y >= valley.y0 - 5, "stayed in valley corridor");
  assert.ok(result.dodges >= 1 || result.brakes >= 1, "expected dodge/brake activity");
  assert.ok(bats.length === 5, "valley bats present");
});

test("unit: shouldEngageAvoid only when hostile within engageR", () => {
  const self = { real_x: 0, real_y: 0 };
  const far = [{ id: "goo", x: 400, y: 0 }];
  const near = [{ id: "goo", x: 120, y: 0 }];
  assert.strictEqual(avoid.shouldEngageAvoid(self, far, 180), false, "far mob skips avoid");
  assert.strictEqual(avoid.shouldEngageAvoid(self, near, 180), true, "near mob engages");
  assert.strictEqual(avoid.shouldEngageAvoid(self, [], 180), false, "empty");
  assert.ok(avoid.DEFAULTS.engageR <= 200 && avoid.DEFAULTS.engageR >= 120, "engageR short-range");
  assert.ok(avoid.nearestThreatDist(self, far) > avoid.DEFAULTS.engageR);
});

test("scenario: far town hostiles do not engage avoid (engageR gate)", async () => {
  // Repro shape: hostiles within list-vision (600) but outside engageR must not flip fieldMove to avoid.
  const p = bootParty({
    pack: "armadillo",
    pots: 50,
    gold: 200000,
    members: ["Puppygirl"],
  });
  const api = p.bots.Puppygirl.api;
  const c = api.character;
  c.map = "main";
  c.real_x = c.x = 40;
  c.real_y = c.y = -20;

  p.world.spawnMonster("US/III", "main", "goo", { x: 40 + 420, y: -20 }, "far_goo");
  p.world.spawnMonster("US/III", "main", "goo", { x: 40 + 90, y: -20 }, "near_goo");

  const listed = avoid.listMonsters(api, avoid.DEFAULTS.visionPx);
  assert.ok(listed.length >= 2, "both goos in list-vision");
  const farOnly = listed.filter((m) => (m.id || "").indexOf("far_") === 0 || Math.hypot((m.x || 0) - 40, (m.y || 0) + 20) > 300);
  assert.ok(farOnly.length >= 1);
  assert.strictEqual(
    avoid.shouldEngageAvoid(c, farOnly, avoid.DEFAULTS.engageR),
    false,
    "far-only set must not engage"
  );
  assert.strictEqual(
    avoid.shouldEngageAvoid(c, listed, avoid.DEFAULTS.engageR),
    true,
    "near goo in full list engages"
  );
});

test("avoidFailPolicy: near pack or dest-in-pack → retreat, else smart_move", () => {
  const { avoidFailPolicy } = require("../src/merchant_meet");
  const { packCenter, PACK_DANGER_R } = require("../src/packs");
  const pc = packCenter("armadillo");
  assert.strictEqual(
    avoidFailPolicy("armadillo", pc.map, pc.x, pc.y, { map: pc.map, x: pc.x + 500, y: pc.y }),
    "retreat",
    "self in pack"
  );
  assert.strictEqual(
    avoidFailPolicy("armadillo", pc.map, pc.x + PACK_DANGER_R + 80, pc.y, {
      map: pc.map,
      x: pc.x,
      y: pc.y,
    }),
    "retreat",
    "dest in pack"
  );
  assert.strictEqual(
    avoidFailPolicy("armadillo", "main", 40, -20, { map: "main", x: 100, y: -100 }),
    "smart_move",
    "open field"
  );
  assert.strictEqual(avoidFailPolicy(null, pc.map, pc.x, pc.y, pc), "smart_move", "no farm context");
});

module.exports = { tests };
