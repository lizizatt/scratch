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

test("adversary: confirmed bat delivery keeps the observed bat spawn", () => {
  const alternate = packCenter("bat", "cave", 1110, 60);
  assert.deepStrictEqual(alternate, { map: "cave", x: 1110, y: 60 });
  assert.deepStrictEqual(safeMeet("bat", "cave", 1110, 60), {
    map: "cave",
    x: 890,
    y: 140,
  });
  assert.deepStrictEqual(
    meetResolveDelivery(
      { get_player: () => null },
      {
        who: "Zarook",
        farm: "bat",
        farmConfirmed: true,
        map: "cave",
        x: 1110,
        y: 60,
      },
      SEND_RANGE
    ),
    { map: "cave", x: 890, y: 140 }
  );
});

test("adversary: an unlisted bat spawn derives a local standoff", () => {
  const observed = { map: "cave", x: -900, y: 900 };
  const meet = safeMeet("bat", observed.map, observed.x, observed.y);
  assert.strictEqual(meet.map, observed.map);
  assert.ok(Math.hypot(meet.x - observed.x, meet.y - observed.y) <= SEND_RANGE);
  assert.ok(Math.hypot(meet.x, meet.y) < Math.hypot(observed.x, observed.y));
  assert.ok(
    Math.hypot(meet.x - packCenter("bat").x, meet.y - packCenter("bat").y) > SEND_RANGE,
    "must not fall back to the unrelated default bat spawn"
  );
});

test("adversary: stale farm on an event map cannot crash safe meet", () => {
  const job = {
    who: "Sarene",
    farm: "bat",
    farmConfirmed: true,
    map: "spookytown",
    x: 32,
    y: 1404,
  };
  const meet = meetResolveDelivery({ get_player: () => null }, job, SEND_RANGE);
  assert.strictEqual(meet.map, "spookytown");
  assert.ok(Number.isFinite(meet.x) && Number.isFinite(meet.y));
  assert.ok(Math.hypot(meet.x - job.x, meet.y - job.y) <= SEND_RANGE);
});

test("scenario: Puppygirl routes to the fighter's alternate bat spawn", async () => {
  const p = bootParty({
    pack: "bat",
    pots: 0,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const fighter = p.bots.Zarook.api;
  fighter.character.map = "cave";
  fighter.character.x = fighter.character.real_x = 1110;
  fighter.character.y = fighter.character.real_y = 60;
  p.world.refreshPartyCoords("US/III");
  await fighter.send_cm("Puppygirl", {
    job: "dlv_pots",
    id: "p_alt_bat",
    who: "Zarook",
    items: [{ name: "hpot1", q: 10 }],
    farm: "bat",
    map: "cave",
    x: 1110,
    y: 60,
  });

  for (let i = 0; i < 20; i++) {
    await p.bots.Puppygirl.ctrl.tick();
    p.world.advance(500);
  }

  const logs = p.bots.Puppygirl.api.log.game.map((entry) => entry.m);
  assert.ok(logs.some((line) => line === "dlv:meet cave 890,140"), logs.join(" | "));
  assert.ok(!logs.some((line) => line === "dlv:spawn bat"), "must not delegate ambiguous bat routing");
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

test("adversary: snake fallback avoids the unreachable north grove", async () => {
  const G = baseG();
  const plaza = { map: "main", x: 40, y: -20 };
  const oldMeet = { map: "main", x: -82, y: 1720 };
  const meet = safeMeet("snake");
  const snake = packCenter("snake");

  assert.strictEqual(findPath(plaza, oldMeet, "main", G), null, "old live failure must be blocked");
  assert.ok(findPath(plaza, meet, "main", G), "replacement meetup must be reachable");
  assert.ok(!nearPack("snake", meet.map, meet.x, meet.y), "replacement must remain outside snake danger");
  assert.ok(Math.hypot(meet.x - snake.x, meet.y - snake.y) <= SEND_RANGE, "replacement must be in send range");
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
  p.bots.Zarook.ctrl.state.S.intent.mtype = "bee";
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

test("adversary: fresh fighter farm intent overrides stale delivery coordinates", async () => {
  const p = bootParty({
    pack: "snake",
    pots: 50,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const snake = packCenter("snake");
  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_farm_intent",
    kind: "dlv_pots",
    who: "Zarook",
    items: [],
    farm: "snake",
    map: snake.map,
    x: snake.x,
    y: snake.y,
  });
  const job = p.bots.Puppygirl.ctrl.store.q[0];

  await p.bots.Zarook.api.send_cm("Puppygirl", {
    dlv_loc: 1,
    id: "p_farm_intent",
    farm: "bee",
    map: "main",
    x: snake.x,
    y: snake.y,
  });

  assert.strictEqual(job.farm, "bee", "explicit live farm intent wins over stale pack coordinates");
  assert.deepStrictEqual(meetResolveDelivery({ get_player: () => null }, job, SEND_RANGE), safeMeet("bee"));
});

test("adversary: another character cannot rewrite a delivery location", async () => {
  const p = bootParty({
    pack: "snake",
    pots: 50,
    gold: 500000,
    members: ["Sarene", "Zarook", "Puppygirl"],
  });
  const snake = packCenter("snake");
  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_spoofed_loc",
    kind: "dlv_pots",
    who: "Zarook",
    items: [],
    farm: "snake",
    map: snake.map,
    x: snake.x,
    y: snake.y,
  });
  const job = p.bots.Puppygirl.ctrl.store.q[0];

  await p.bots.Sarene.api.send_cm("Puppygirl", {
    dlv_loc: 1,
    id: "p_spoofed_loc",
    farm: "bee",
    map: "main",
    x: packCenter("bee").x,
    y: packCenter("bee").y,
  });

  assert.strictEqual(job.farm, "snake");
  assert.strictEqual(job.locSeq, undefined);
});

test("adversary: preflight retargets a fresh stale request before first field route", async () => {
  const p = bootParty({
    pack: "bee",
    pots: 50,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const zApi = p.bots.Zarook.api;
  const mApi = p.bots.Puppygirl.api;
  const z = zApi.character;
  const m = mApi.character;
  const snake = packCenter("snake");
  const bee = packCenter("bee");
  clearPots(z.items);
  z.esize = z.items.filter((x) => !x).length;
  z.map = bee.map;
  z.real_x = z.x = bee.x;
  z.real_y = z.y = bee.y;
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;
  p.bots.Zarook.ctrl.state.S.intent.mtype = "bee";
  p.bots.Zarook.ctrl._setDlv({ id: "p_preflight", kind: "pots", t0: zApi._now(), acked: 1 });
  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_preflight",
    kind: "dlv_pots",
    who: "Zarook",
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ],
    farm: "snake",
    map: snake.map,
    x: snake.x,
    y: snake.y,
  });

  for (let i = 0; i < 500; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "dlv:done id=p_preflight")) break;
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(msgs.some((x) => x === "dlv:retarget snake->bee"));
  assert.ok(msgs.some((x) => x === "dlv:meet main 300,1059"));
  assert.ok(!msgs.some((x) => x === "dlv:meet main -280,1810"), "must not visit stale snake meetup");
  assert.ok(msgs.some((x) => x === "dlv:done id=p_preflight"));
});

test("adversary: confirmed cross-map farm uses the observed spawn route", async () => {
  const p = bootParty({
    pack: "bat",
    pots: 50,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const zApi = p.bots.Zarook.api;
  const mApi = p.bots.Puppygirl.api;
  const z = zApi.character;
  const m = mApi.character;
  const snake = packCenter("snake");
  const bat = packCenter("bat");
  clearPots(z.items);
  z.esize = z.items.filter((x) => !x).length;
  z.map = bat.map;
  z.real_x = z.x = bat.x;
  z.real_y = z.y = bat.y;
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;
  p.bots.Zarook.ctrl.state.S.intent.mtype = "bat";
  p.bots.Zarook.ctrl._setDlv({ id: "p_named_bat", kind: "pots", t0: zApi._now(), acked: 1 });
  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_named_bat",
    kind: "dlv_pots",
    who: "Zarook",
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ],
    farm: "snake",
    map: snake.map,
    x: snake.x,
    y: snake.y,
  });

  for (let i = 0; i < 500; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "dlv:done id=p_named_bat")) break;
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(msgs.some((x) => x === "dlv:retarget snake->bat"));
  assert.ok(msgs.some((x) => x === "dlv:meet cave -350,-320"));
  assert.ok(!mApi.log.moved.some((d) => d && d.to === "bat"), "named bat routing is ambiguous");
  assert.ok(msgs.some((x) => x === "dlv:done id=p_named_bat"), msgs.filter((x) => /^dlv:/.test(x)).join(" | "));
});

test("adversary: accepted same-farm reroute cannot fall through to empty_send", async () => {
  const p = bootParty({
    pack: "bat",
    pots: 50,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const zApi = p.bots.Zarook.api;
  const mApi = p.bots.Puppygirl.api;
  const z = zApi.character;
  const m = mApi.character;
  const bat = packCenter("bat");
  clearPots(z.items);
  z.esize = z.items.filter((x) => !x).length;
  z.map = bat.map;
  z.real_x = z.x = bat.x;
  z.real_y = z.y = bat.y;
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;
  p.bots.Zarook.ctrl.state.S.intent.mtype = "bat";
  p.bots.Zarook.ctrl._setDlv({ id: "p_same_farm_move", kind: "pots", t0: zApi._now(), acked: 1 });
  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_same_farm_move",
    kind: "dlv_pots",
    who: "Zarook",
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ],
    farm: "bat",
    map: bat.map,
    x: bat.x,
    y: bat.y,
  });

  let moved = false;
  const realMove = mApi.smart_move.bind(mApi);
  mApi.smart_move = async (dest) => {
    const r = await realMove(dest);
    if (!moved && dest && dest.map === "cave") {
      moved = true;
      z.real_x = z.x = 1110;
      z.real_y = z.y = 60;
      p.world.refreshPartyCoords("US/III");
    }
    return r;
  };

  for (let i = 0; i < 40; i++) {
    await p.tickAll();
    if (moved && mApi.log.game.some((g) => g.m === "dlv:reroute")) break;
  }

  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(moved);
  assert.ok(msgs.some((x) => x === "dlv:reroute"));
  assert.ok(!msgs.some((x) => x === "dlv:no_vision"));
  assert.ok(!msgs.some((x) => x === "dlv:empty_send"));
});

test("adversary: fighter moving packs during delivery reroutes without empty retreat", async () => {
  const p = bootParty({
    pack: "snake",
    pots: 50,
    gold: 500000,
    members: ["Zarook", "Puppygirl"],
  });
  const zApi = p.bots.Zarook.api;
  const mApi = p.bots.Puppygirl.api;
  const z = zApi.character;
  const m = mApi.character;
  const snake = packCenter("snake");
  const bee = packCenter("bee");
  clearPots(z.items);
  z.esize = z.items.filter((x) => !x).length;
  z.map = snake.map;
  z.real_x = z.x = snake.x;
  z.real_y = z.y = snake.y;
  m.map = "main";
  m.real_x = m.x = 40;
  m.real_y = m.y = -20;
  m.stand = false;
  p.bots.Zarook.ctrl.state.S.intent.mtype = "snake";
  p.bots.Zarook.ctrl._setDlv({ id: "p_move_midroute", kind: "pots", t0: zApi._now(), acked: 1 });

  p.bots.Puppygirl.ctrl.enqueue({
    id: "p_move_midroute",
    kind: "dlv_pots",
    who: "Zarook",
    items: [
      { name: "hpot1", q: 50 },
      { name: "mpot1", q: 50 },
    ],
    farm: "snake",
    map: snake.map,
    x: snake.x,
    y: snake.y,
  });

  let moved = false;
  let delayedLocation = null;
  const realFighterSend = zApi.send_cm.bind(zApi);
  const realMove = mApi.smart_move.bind(mApi);
  mApi.smart_move = async (dest) => {
    const r = await realMove(dest);
    if (!moved && dest && dest.map === safeMeet("snake").map && dest.x === safeMeet("snake").x) {
      moved = true;
      z.map = bee.map;
      z.real_x = z.x = bee.x;
      z.real_y = z.y = bee.y;
      p.bots.Zarook.ctrl.state.S.intent.mtype = "bee";
      zApi.send_cm = async (to, message) => {
        if (to === "Puppygirl" && message && message.dlv_loc) {
          delayedLocation = message;
          return { receivers: [], locals: [] };
        }
        return realFighterSend(to, message);
      };
    }
    return r;
  };

  for (let i = 0; i < 100; i++) {
    await p.tickAll();
    if (moved && mApi.log.game.some((g) => g.m === "dlv:await_loc")) break;
  }

  let msgs = mApi.log.game.map((g) => g.m);
  assert.ok(moved, "fighter must move after merchant commits to the first route");
  assert.ok(delayedLocation, "post-arrival location response must be delayed");
  assert.ok(msgs.some((x) => x === "dlv:await_loc"), "merchant must wait through delayed CM response");
  assert.ok(!msgs.some((x) => x === "dlv:empty_send"), "delayed response must not count as an empty send");

  zApi.send_cm = realFighterSend;
  await realFighterSend("Puppygirl", delayedLocation);
  for (let i = 0; i < 500; i++) {
    await p.tickAll();
    if (mApi.log.game.some((g) => g.m === "dlv:done id=p_move_midroute")) break;
  }

  msgs = mApi.log.game.map((g) => g.m);
  assert.ok(msgs.some((x) => x === "dlv:reroute"), "lost vision must trigger a fresh route");
  assert.ok(msgs.some((x) => x === "dlv:meet main 300,1059"), "merchant must route to the new bee spawn");
  assert.ok(
    msgs.some((x) => x === "dlv:done id=p_move_midroute"),
    "delivery must complete at the new pack; logs=" + msgs.filter((x) => /^dlv:/.test(x)).join(" | ")
  );
  assert.ok(!msgs.some((x) => x === "dlv:empty_send"), "stale route must not count as an empty send");
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

test("adversary: missing fighter waits for location instead of empty retreat", async () => {
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

  for (let i = 0; i < 20; i++) {
    await p.tickAll();
  }
  const msgs = mApi.log.game.map((g) => g.m);
  assert.ok(msgs.some((x) => x === "dlv:await_loc"), "must wait for a fresh location");
  assert.ok(!msgs.some((x) => x === "dlv:empty_send"), "missing reply must not count as an empty send");
  assert.ok(!msgs.some((x) => x === "dlv:retreat"), "must not wander back and forth while awaiting location");
  assert.ok(p.bots.Puppygirl.ctrl.store.active, "active remains pending until its normal TTL");
});

module.exports = { tests };
