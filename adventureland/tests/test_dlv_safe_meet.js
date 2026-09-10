"use strict";

/**
 * Live: Puppygirl walked onto packCenter during dlv and died.
 * Fix: approach to within SEND_RANGE along vector toward safeMeet — fighter stays on pack.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { packCenter, safeMeet, nearPack, PACK_DANGER_R } = require("../src/packs");
const { meetResolveDelivery } = require("../src/merchant_meet");
const { SEND_RANGE } = require("../src/constants");
const { baseG } = require("../sim/world");
const { findPath } = require("../sim/path");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function clearPots(items) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it && /^hpot|^mpot/.test(it.name)) items[i] = null;
  }
}

function dist(a, b) {
  return Math.hypot(
    (a.real_x != null ? a.real_x : a.x) - (b.real_x != null ? b.real_x : b.x),
    (a.real_y != null ? a.real_y : a.y) - (b.real_y != null ? b.real_y : b.y)
  );
}

test("adversary: stale reboot farm retargets from current fighter coordinates", async () => {
  const bee = packCenter("bee");
  const meet = meetResolveDelivery(
    { get_player: () => null },
    {
      who: "Zarook",
      farm: "armadillo",
      map: bee.map,
      x: bee.x,
      y: bee.y,
    },
    SEND_RANGE
  );
  assert.deepStrictEqual(meet, safeMeet("bee"), "current pack coordinates override stale farm intent");

  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const ctrl = p.bots.Puppygirl.ctrl;
  ctrl.enqueue({
    id: "p_stale_reboot",
    kind: "dlv_pots",
    who: "Zarook",
    items: [],
    farm: "armadillo",
    map: packCenter("armadillo").map,
    x: packCenter("armadillo").x,
    y: packCenter("armadillo").y,
  });
  ctrl.store.active = ctrl.store.q.shift();
  let stops = 0;
  const realStop = p.bots.Puppygirl.api.stop.bind(p.bots.Puppygirl.api);
  p.bots.Puppygirl.api.stop = (what) => {
    stops++;
    return realStop(what);
  };

  await p.bots.Zarook.api.send_cm("Puppygirl", {
    dlv_loc: 1,
    id: "p_stale_reboot",
    map: bee.map,
    x: bee.x,
    y: bee.y,
  });

  assert.strictEqual(ctrl.store.active.farm, "bee", "fresh beacon retargets persisted active job");
  assert.strictEqual(stops, 1, "active stale movement is interrupted");
  assert.ok(
    p.bots.Puppygirl.api.log.game.some((g) => g.m === "dlv:retarget armadillo->bee"),
    "retarget is visible in merchant logs"
  );
  assert.ok(
    p.bots.Puppygirl.api.log.game.some((g) => g.m === "dlv:reroute"),
    "route interruption is visible in merchant logs"
  );
});

test("adversary: bee fallback avoids the unreachable north grove", async () => {
  const G = baseG();
  const plaza = { map: "main", x: 40, y: -20 };
  const oldMeet = { map: "main", x: 546, y: 900 };
  const meet = safeMeet("bee");
  const bee = packCenter("bee");

  assert.strictEqual(findPath(plaza, oldMeet, "main", G), null, "old live failure must be blocked");
  assert.ok(findPath(plaza, meet, "main", G), "replacement meetup must be reachable");
  assert.ok(!nearPack("bee", meet.map, meet.x, meet.y), "replacement must remain outside bee danger");
  assert.ok(Math.hypot(meet.x - bee.x, meet.y - bee.y) <= SEND_RANGE, "replacement must be in send range");

  const p = bootParty({
    pack: "bee",
    pots: 0,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const zApi = p.bots.Zarook.api;
  const mApi = p.bots.Puppygirl.api;
  const z = zApi.character;
  const m = mApi.character;
  clearPots(z.items);
  z.esize = z.items.filter((x) => !x).length;
  z.map = bee.map;
  z.real_x = z.x = bee.x;
  z.real_y = z.y = bee.y;
  m.map = plaza.map;
  m.real_x = m.x = plaza.x;
  m.real_y = m.y = plaza.y;
  m.stand = false;

  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_bee_geometry",
    kind: "dlv_pots",
    who: "Zarook",
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ],
    farm: "bee",
    map: bee.map,
    x: bee.x,
    y: bee.y,
  });

  for (let i = 0; i < 500; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "dlv:done id=p_bee_geometry")) break;
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(msgs.some((x) => x === "dlv:done id=p_bee_geometry"), "bee delivery must complete");
  assert.ok(!msgs.some((x) => /^dlv:path_fail/.test(x)), "bee delivery must not path_fail");
});

test("adversary: delivery status elicits current location before fighter is dry", async () => {
  const p = bootParty({
    pack: "croc",
    pots: 50,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const zApi = p.bots.Zarook.api;
  const mApi = p.bots.Puppygirl.api;
  const bee = packCenter("bee");
  const z = zApi.character;
  z.map = bee.map;
  z.real_x = z.x = bee.x;
  z.real_y = z.y = bee.y;
  p.bots.Zarook.ctrl._setDlv({ id: "p_low_reboot", kind: "pots", t0: zApi._now(), acked: 1 });
  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_low_reboot",
    kind: "dlv_pots",
    who: "Zarook",
    items: [],
    farm: "croc",
    map: packCenter("croc").map,
    x: packCenter("croc").x,
    y: packCenter("croc").y,
  });
  const job = p.bots.Puppygirl.ctrl.store.q[0];
  delete job.locAt;

  await mApi.send_cm("Zarook", {
    status: 1,
    id: "p_low_reboot",
    phase: "enroute",
    meet: 1,
    map: "main",
    x: 750,
    y: 1800,
  });

  assert.strictEqual(job.farm, "bee", "status response corrects stale farm while pots are merely low");
  assert.strictEqual(job.map, bee.map);
  assert.strictEqual(job.x, bee.x);
  assert.strictEqual(job.y, bee.y);
});

test("adversary: merchant approaches send-range outside pack; fighter stays", async () => {
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
  z.gold = 500000;
  m.gold = 500000;
  clearPots(z.items);
  z.esize = z.items.filter((x) => !x).length;

  const pc = packCenter("armadillo");
  z.map = pc.map;
  z.real_x = z.x = pc.x;
  z.real_y = z.y = pc.y;
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;

  p.bots.Zarook.ctrl._setDlv({ id: "p_safe_meet", kind: "pots", t0: zApi._now(), acked: 1 });
  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_safe_meet",
    kind: "dlv_pots",
    who: "Zarook",
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ],
    farm: "armadillo",
    map: pc.map,
    x: pc.x,
    y: pc.y,
  });

  let merchantEnteredPack = false;
  const realMove = mApi.smart_move.bind(mApi);
  mApi.smart_move = async (dest) => {
    const r = await realMove(dest);
    if (nearPack("armadillo", m.map, m.real_x, m.real_y)) merchantEnteredPack = true;
    if (dest && nearPack("armadillo", dest.map || m.map, dest.x, dest.y)) merchantEnteredPack = true;
    return r;
  };

  const zStart = { x: z.real_x, y: z.real_y };
  for (let i = 0; i < 600; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "dlv:done id=p_safe_meet")) break;
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(!merchantEnteredPack, "merchant must never enter pack danger r=" + PACK_DANGER_R);
  assert.ok(
    msgs.some((x) => x === "dlv:done id=p_safe_meet"),
    "must dlv:done, logs=" + msgs.filter((x) => /^dlv:/.test(x)).join(" | ")
  );
  assert.ok(msgs.some((x) => x === "dlv:retreat"), "must retreat plaza after delivery");
  assert.ok(z.items.some((it) => it && it.name === "hpot1"), "Zarook received pots");
  assert.ok(dist(m, z) <= SEND_RANGE || msgs.some((x) => /^dlv:send /.test(x)), "traded in send range");
  // Fighter should not have been forced off the pack for the handoff.
  assert.ok(
    nearPack("armadillo", z.map, z.real_x, z.real_y) ||
      Math.hypot(z.real_x - zStart.x, z.real_y - zStart.y) < 30,
    "fighter stays on/near pack (merchant approaches)"
  );
  const meet = safeMeet("armadillo");
  assert.ok(
    msgs.some((x) => /^dlv:meet /.test(x)),
    "logs approach meet"
  );
  // Approach point should be tradeable from pack center.
  assert.ok(Math.hypot(meet.x - pc.x, meet.y - pc.y) <= SEND_RANGE, "safeMeet within SEND_RANGE of pack");
});

test("adversary: town fallback fighter — meet at fighter not packCenter", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const z = p.bots.Zarook.api.character;
  const m = p.bots.Puppygirl.api.character;
  const mApi = p.bots.Puppygirl.api;
  z.gold = m.gold = 500000;
  clearPots(z.items);
  z.esize = z.items.filter((x) => !x).length;
  const town = { map: "main", x: 56, y: -122 };
  z.map = town.map;
  z.real_x = z.x = town.x;
  z.real_y = z.y = town.y;
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;

  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_town_meet",
    kind: "dlv_pots",
    who: "Zarook",
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ],
    farm: "armadillo",
    map: packCenter("armadillo").map,
    x: packCenter("armadillo").x,
    y: packCenter("armadillo").y,
  });

  let wentToPack = false;
  const realMove = mApi.smart_move.bind(mApi);
  mApi.smart_move = async (dest) => {
    if (dest && nearPack("armadillo", dest.map || "main", dest.x, dest.y)) wentToPack = true;
    return realMove(dest);
  };

  for (let i = 0; i < 400; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "dlv:done id=p_town_meet")) break;
  }

  assert.ok(!wentToPack, "must not path to pack when fighter is in town");
  assert.ok(
    mApi.log.game.some((g) => g.m === "dlv:done id=p_town_meet"),
    "must complete town meet delivery"
  );
});

test("adversary: empty_send retreats and aborts after 5 misses", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 0,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const mApi = p.bots.Puppygirl.api;
  const z = p.bots.Zarook.api.character;
  const m = mApi.character;
  z.gold = m.gold = 500000;
  clearPots(z.items);
  // Fighter unreachable — no vision so ensureSendRange fails.
  z.map = "cave";
  z.real_x = z.x = -100;
  z.real_y = z.y = -200;
  m.map = "main";
  m.real_x = m.x = 750;
  m.real_y = m.y = 1800;
  m.items[0] = { name: "hpot1", q: 50 };
  m.items[1] = { name: "mpot1", q: 50 };
  m.esize = m.items.filter((x) => !x).length;

  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_empty_abort",
    kind: "dlv_pots",
    who: "MissingFighter",
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ],
    farm: "armadillo",
    bought: 1,
    map: "main",
    x: 526,
    y: 1846,
  });

  for (let i = 0; i < 80; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => /^dlv:abort_empty/.test(g.m))) break;
  }
  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(msgs.filter((x) => x === "dlv:retreat").length >= 1, "must retreat on empty");
  assert.ok(msgs.some((x) => /^dlv:abort_empty/.test(x)), "must abort after empties");
  assert.ok(!p.bots.Puppygirl.ctrl.store.active, "active cleared");
});

module.exports = { tests };
