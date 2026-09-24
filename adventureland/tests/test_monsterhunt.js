"use strict";

/**
 * Monster Hunt (Daisy) — sim + docs validation.
 * Guide: adventure.land/docs/guide/services/monster-hunts
 * API: interact("monsterhunt"); smart_move("monsterhunter"); character.s.monsterhunt {id,c,sn,ms}
 */
const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { NPC } = require("../sim/world");
const {
  DAISY,
  DAISY_RANGE,
  formatHuntSn,
  getHunt,
  huntComplete,
  canAcceptHunts,
  shouldInteractDaisy,
  countTokens,
} = require("../src/monsterhunt");
const { runOneMonsterHunt, runMonsterHuntSeries, goDaisy } = require("../src/monsterhunt_runner");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("docs: Daisy coords match live maps.main monsterhunter NPC", () => {
  assert.strictEqual(DAISY.x, 126);
  assert.strictEqual(DAISY.y, -413);
  assert.strictEqual(NPC.monsterhunt.x, 126);
  assert.strictEqual(NPC.monsterhunt.y, -413);
  assert.strictEqual(NPC.daisy.x, NPC.monsterhunt.x);
});

test("docs: merchants cannot accept hunts", () => {
  assert.ok(canAcceptHunts("warrior"));
  assert.ok(canAcceptHunts("mage"));
  assert.ok(!canAcceptHunts("merchant"));
});

test("docs: shouldInteractDaisy only when absent or c===0", () => {
  assert.ok(shouldInteractDaisy({ ctype: "warrior", s: {} }));
  assert.ok(shouldInteractDaisy({ ctype: "warrior", s: { monsterhunt: { id: "goo", c: 0 } } }));
  assert.ok(!shouldInteractDaisy({ ctype: "warrior", s: { monsterhunt: { id: "goo", c: 2 } } }));
  assert.ok(!shouldInteractDaisy({ ctype: "merchant", s: {} }));
});

test("adversary: interact far from Daisy fails distance", async () => {
  const p = bootParty({ pack: "goo", pots: 50, members: ["Jazwyn"] });
  const api = p.bots.Jazwyn.api;
  api.character.map = "main";
  api.character.real_x = api.character.x = 0;
  api.character.real_y = api.character.y = 0;
  const r = await api.interact("monsterhunt");
  assert.ok(r && r.failed && r.reason === "distance");
});

test("adversary: merchant interact rejected", async () => {
  const p = bootParty({ pack: "goo", pots: 50, members: ["Puppygirl"] });
  const api = p.bots.Puppygirl.api;
  await api.smart_move({ to: "monsterhunt" });
  const r = await api.interact("monsterhunt");
  assert.ok(r && r.failed && r.reason === "merchant");
});

test("adversary: refuse interact while hunt.c > 0 (docs)", async () => {
  const p = bootParty({ pack: "goo", pots: 50, members: ["Jazwyn"] });
  const api = p.bots.Jazwyn.api;
  p.world.monsterHuntQueue = [{ id: "goo", c: 2 }];
  await goDaisy(api);
  const a = await api.interact("monsterhunt");
  assert.ok(a && a.started);
  const mid = await api.interact("monsterhunt");
  assert.ok(mid && mid.failed && mid.reason === "in_progress");
  assert.strictEqual(getHunt(api.character).c, 2);
});

test("adversary: wrong mtype kill does not decrement", async () => {
  const p = bootParty({ pack: "bee", pots: 50, members: ["Jazwyn"] });
  const api = p.bots.Jazwyn.api;
  p.world.monsterHuntQueue = [{ id: "goo", c: 3 }];
  await goDaisy(api);
  await api.interact("monsterhunt");
  const key = "US/III";
  const bees = p.world.spawnPack(key, "main", "bee", { x: api.character.real_x, y: api.character.real_y }, 1);
  const bee = bees[0];
  bee.hp = 1;
  api.character.real_x = api.character.x = bee.real_x;
  api.character.real_y = api.character.y = bee.real_y;
  api.character._lastAttackAt = -1e12;
  for (let i = 0; i < 5 && !bee.dead; i++) {
    api.character._lastAttackAt = -1e12;
    await api.attack(bee);
  }
  assert.ok(bee.dead, "bee should die");
  assert.strictEqual(getHunt(api.character).c, 3, "bee kill must not count for goo hunt");
});

test("adversary: wrong-server kill does not decrement", async () => {
  const p = bootParty({ pack: "goo", pots: 50, members: ["Jazwyn"], server: ["US", "III"] });
  const api = p.bots.Jazwyn.api;
  p.world.monsterHuntQueue = [{ id: "goo", c: 2 }];
  await goDaisy(api);
  await api.interact("monsterhunt");
  assert.strictEqual(getHunt(api.character).sn, "US III");
  api.character.s.monsterhunt.sn = "EU I";
  const goos = p.world.spawnPack("US/III", "main", "goo", { x: api.character.real_x, y: api.character.real_y }, 1);
  goos[0].hp = 1;
  api.character.real_x = api.character.x = goos[0].real_x;
  api.character.real_y = api.character.y = goos[0].real_y;
  for (let i = 0; i < 5 && !goos[0].dead; i++) {
    api.character._lastAttackAt = -1e12;
    await api.attack(goos[0]);
  }
  assert.ok(goos[0].dead);
  assert.strictEqual(getHunt(api.character).c, 2, "off-server kill must not count");
});

test("unit: accept → kill to zero → turn-in grants monstertoken", async () => {
  const p = bootParty({ pack: "goo", pots: 200, members: ["Jazwyn"] });
  const api = p.bots.Jazwyn.api;
  p.world.monsterHuntQueue = [{ id: "goo", c: 2 }];
  await goDaisy(api);
  const started = await api.interact("monsterhunt");
  assert.ok(started.started);
  assert.strictEqual(getHunt(api.character).id, "goo");
  assert.strictEqual(getHunt(api.character).c, 2);

  for (let n = 0; n < 2; n++) {
    const pack = p.world.spawnPack("US/III", "main", "goo", { x: api.character.real_x + 10, y: api.character.real_y }, 1);
    pack[0].hp = 1;
    api.character.real_x = api.character.x = pack[0].real_x;
    api.character.real_y = api.character.y = pack[0].real_y;
    for (let i = 0; i < 5 && !pack[0].dead; i++) {
      api.character._lastAttackAt = -1e12;
      await api.attack(pack[0]);
    }
    assert.ok(pack[0].dead);
  }
  assert.ok(huntComplete(getHunt(api.character)));
  const before = countTokens(api.character.items);
  const done = await api.interact("monsterhunt");
  assert.ok(done.completed);
  assert.ok(!getHunt(api.character));
  assert.strictEqual(countTokens(api.character.items), before + 1);
});

test("adversary: smart_move to monsterhunt reaches Daisy range", async () => {
  const p = bootParty({ pack: "goo", pots: 50, members: ["Jazwyn"] });
  const api = p.bots.Jazwyn.api;
  const r = await api.smart_move({ to: "monsterhunt" });
  assert.ok(!(r && r.failed), "path to Daisy");
  const d = Math.hypot(api.character.real_x - DAISY.x, api.character.real_y - DAISY.y);
  assert.ok(d <= DAISY_RANGE, "must arrive in interact range, d=" + d);
});

test("scenario: 3 Daisy hunts (goo→bee→crab) turn-in loop via farm intent", async () => {
  const p = bootParty({
    pack: "goo",
    pots: 400,
    gold: 500000,
    members: ["Jazwyn", "Sarene", "Zarook"],
    packCount: 5,
  });
  // Three different overland targets (avoid armadillo cave delay in this scenario).
  p.world.monsterHuntQueue = [
    { id: "goo", c: 3 },
    { id: "bee", c: 3 },
    { id: "crab", c: 3 },
  ];

  const api = p.bots.Jazwyn.api;
  const tokens0 = countTokens(api.character.items);
  const results = await runMonsterHuntSeries(p, "Jazwyn", 3, { maxTicks: 1200 });

  assert.strictEqual(results.length, 3, "expected 3 hunt attempts");
  for (const r of results) {
    assert.ok(r && r.success, "hunt failed: " + JSON.stringify(r));
  }
  assert.deepStrictEqual(
    results.map((r) => r.id),
    ["goo", "bee", "crab"]
  );
  assert.strictEqual(countTokens(api.character.items), tokens0 + 3, "3 monstertokens from 3 turn-ins");
  assert.ok(!getHunt(api.character), "no active hunt after final turn-in");

  const logs = api.log.game.map((g) => g.m);
  assert.ok(logs.filter((m) => /^mhunt:done /.test(m)).length >= 3);
  assert.ok(logs.some((m) => m === "mhunt:token") || countTokens(api.character.items) >= tokens0 + 3);
});

test("adversary: runOneMonsterHunt refuses mid-hunt Daisy spam path", async () => {
  const p = bootParty({ pack: "goo", pots: 100, members: ["Jazwyn"] });
  p.world.monsterHuntQueue = [{ id: "goo", c: 5 }];
  const api = p.bots.Jazwyn.api;
  await goDaisy(api);
  await api.interact("monsterhunt");
  // Attempt second full cycle while still in progress — runner should nack busy
  const r = await runOneMonsterHunt(p, "Jazwyn", { maxTicks: 5 });
  assert.ok(r && r.failed && r.reason === "busy");
});

test("live: hunt_quest() CM enables lead Daisy chain via tick", async () => {
  const p = bootParty({
    pack: "goo",
    pots: 400,
    gold: 500000,
    members: ["Jazwyn", "Sarene", "Zarook", "Puppygirl"],
    packCount: 5,
  });
  // Same pack type so sim farm pack stays populated across turn-ins.
  p.world.monsterHuntQueue = [
    { id: "goo", c: 2 },
    { id: "goo", c: 2 },
  ];
  const mCtrl = p.bots.Puppygirl.ctrl;
  const jCtrl = p.bots.Jazwyn.ctrl;
  const api = p.bots.Jazwyn.api;
  const tokens0 = countTokens(api.character.items);

  mCtrl.hunt_quest();
  await p.tickAll();
  assert.ok(jCtrl.huntQuest, "fighter huntQuest latched from merchant CM");

  let done = 0;
  for (let i = 0; i < 2000; i++) {
    await p.tickAll();
    done = api.log.game.filter((g) => g.m === "mhunt:done").length;
    if (done >= 2) break;
  }
  assert.ok(done >= 2, "expected ≥2 Daisy turn-ins via tickHuntQuest, got " + done);
  assert.ok(
    api.log.game.filter((g) => g.m === "mhunt:token").length >= 2 ||
      countTokens(api.character.items) >= tokens0 + 2,
    "monstertokens from turn-ins"
  );
  assert.ok(api.log.game.some((g) => /^mhunt:start id=goo/.test(g.m)));

  mCtrl.hunt_quest(0);
  await p.tickAll();
  assert.ok(!jCtrl.huntQuest, "hunt_quest(0) disables");
});

test("adversary: hunt_quest off does not visit Daisy", async () => {
  const p = bootParty({ pack: "armadillo", pots: 100, members: ["Jazwyn"] });
  p.world.monsterHuntQueue = [{ id: "goo", c: 1 }];
  for (let i = 0; i < 40; i++) await p.tickAll();
  assert.ok(!getHunt(p.bots.Jazwyn.api.character), "no hunt without hunt_quest");
  assert.ok(!p.bots.Jazwyn.api.log.game.some((g) => /^mhunt:/.test(g.m)));
});

test("adversary: 3 lead deaths on Daisy hunt soft-abandons to default farm until hunt clears", async () => {
  // No server abandon API — soft-skip lethal hunt.id and farm armadillo until condition gone.
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    farm: "armadillo",
    members: ["Jazwyn", "Sarene"],
  });
  const api = p.bots.Jazwyn.api;
  const ctrl = p.bots.Jazwyn.ctrl;
  p.world.monsterHuntQueue = [{ id: "bee", c: 5 }];
  ctrl.setHuntQuest(true);
  // Plant an active bee hunt (skip Daisy path).
  api.character.s = api.character.s || {};
  api.character.s.monsterhunt = {
    id: "bee",
    c: 5,
    sn: "US III",
    ms: 1800000,
    expiresAt: p.world.clock.now() + 1800000,
  };
  for (let i = 0; i < 5; i++) await p.tickAll();
  assert.strictEqual(ctrl.state.S.intent.mtype, "bee");
  assert.strictEqual(ctrl.state.S.intent.kind, "hunt");

  for (let d = 0; d < 3; d++) {
    api.character.rip = true;
    api.character.hp = 0;
    await p.tickAll();
    assert.ok(!api.character.rip, "respawned after death " + (d + 1));
  }

  const msgs = api.log.game.map((g) => g.m);
  assert.ok(msgs.some((m) => /^mhunt:death id=bee n=3/.test(m)), "third death logged");
  assert.ok(msgs.some((m) => m === "mhunt:soft_abandon id=bee farm=armadillo"), "soft abandon");
  assert.strictEqual(ctrl.mhuntSoftSkipId, "bee");
  assert.strictEqual(ctrl.state.S.intent.kind, "farm");
  assert.strictEqual(ctrl.state.S.intent.mtype, "armadillo");

  // While soft-skipped, further ticks must not re-hunt bee.
  for (let i = 0; i < 20; i++) await p.tickAll();
  assert.strictEqual(ctrl.state.S.intent.mtype, "armadillo");
  assert.ok(getHunt(api.character) && getHunt(api.character).id === "bee", "condition still active");

  // Hunt clears (expire) → soft_resume; next Daisy accept resumes chain.
  delete api.character.s.monsterhunt;
  p.world.monsterHuntQueue = [{ id: "goo", c: 2 }];
  p.world.spawnPack("US/III", "main", "goo", require("../src/packs").packCenter("goo"), 5);
  let resumed = false;
  for (let i = 0; i < 200; i++) {
    await p.tickAll();
    if (api.log.game.some((g) => /^mhunt:soft_resume/.test(g.m))) resumed = true;
    if (getHunt(api.character) && getHunt(api.character).id === "goo") break;
  }
  assert.ok(resumed, "expected soft_resume after hunt cleared");
  assert.ok(!ctrl.mhuntSoftSkipId, "skip cleared");
  assert.ok(getHunt(api.character) && getHunt(api.character).id === "goo", "accepted next hunt");
});

test("adversary: soft-abandon followers leave bee via lead intent+hb", async () => {
  const p = bootParty({
    pack: "armadillo",
    pots: 200,
    farm: "armadillo",
    members: ["Jazwyn", "Sarene", "Zarook"],
  });
  const api = p.bots.Jazwyn.api;
  const ctrl = p.bots.Jazwyn.ctrl;
  const sCtrl = p.bots.Sarene.ctrl;
  const zCtrl = p.bots.Zarook.ctrl;
  const { packCenter } = require("../src/packs");
  const bee = packCenter("bee");
  p.world.monsterHuntQueue = [{ id: "bee", c: 5 }];
  ctrl.setHuntQuest(true);
  api.character.s = api.character.s || {};
  api.character.s.monsterhunt = {
    id: "bee",
    c: 5,
    sn: "US III",
    ms: 1800000,
    expiresAt: p.world.clock.now() + 1800000,
  };
  // Place party on bee so soft-abandon must pull them off.
  for (const n of ["Jazwyn", "Sarene", "Zarook"]) {
    const c = p.bots[n].api.character;
    c.map = bee.map;
    c.real_x = c.x = bee.x + (n === "Sarene" ? 10 : n === "Zarook" ? -10 : 0);
    c.real_y = c.y = bee.y;
  }
  for (let i = 0; i < 8; i++) await p.tickAll();
  assert.strictEqual(ctrl.state.S.intent.mtype, "bee");

  for (let d = 0; d < 3; d++) {
    api.character.rip = true;
    api.character.hp = 0;
    await p.tickAll();
  }
  assert.strictEqual(ctrl.mhuntSoftSkipId, "bee");
  assert.strictEqual(ctrl.state.S.intent.mtype, "armadillo");

  let followersOk = false;
  for (let i = 0; i < 80; i++) {
    await p.tickAll();
    if (
      sCtrl.state.S.intent.mtype === "armadillo" &&
      zCtrl.state.S.intent.mtype === "armadillo"
    ) {
      followersOk = true;
      break;
    }
  }
  assert.ok(followersOk, "followers must pick up lead armadillo farm via hb/intent");
  // Not still pathing independently to bee as hunt target.
  assert.notStrictEqual(sCtrl.state.S.intent.kind, "hunt");
  assert.notStrictEqual(zCtrl.state.S.intent.kind, "hunt");
});

module.exports = { tests };

if (require.main === module) {
  (async () => {
    for (const t of tests) {
      await t.fn();
      console.log("ok", t.name);
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
