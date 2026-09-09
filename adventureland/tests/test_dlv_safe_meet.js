"use strict";

/**
 * Live: Puppygirl walked onto packCenter during dlv and died.
 * Fix: approach to within SEND_RANGE along vector toward safeMeet — fighter stays on pack.
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { packCenter, safeMeet, nearPack, PACK_DANGER_R } = require("../src/packs");
const { SEND_RANGE } = require("../src/constants");

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

module.exports = { tests };
