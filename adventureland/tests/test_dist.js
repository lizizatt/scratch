"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { buildAll, MAX_LINES } = require("../tools/compress_code");
const { createWorld } = require("../sim");
const { bootFighter } = require("../src/fighter");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function readDist(root, name) {
  return fs.readFileSync(path.join(root, "dist", name), "utf8");
}

function makeSandbox() {
  return {
    console,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    parseInt,
    isFinite,
    setTimeout,
    clearTimeout,
    setInterval() {
      return 0;
    },
    clearInterval() {},
    localStorage: {
      _d: {},
      getItem(k) {
        return this._d[k] || null;
      },
      setItem(k, v) {
        this._d[k] = "" + v;
      },
    },
  };
}

test("dist: compressor emits ≤176-line slots", () => {
  const root = path.join(__dirname, "..");
  const report = buildAll(root);
  for (const k of Object.keys(report)) {
    assert.ok(report[k] <= MAX_LINES, k + " lines=" + report[k]);
    const p = path.join(root, "dist", k + ".js");
    assert.ok(fs.existsSync(p), p);
  }
});

test("dist: production packs contain gear batch/replace symbols", () => {
  const root = path.join(__dirname, "..");
  buildAll(root);
  const lib = readDist(root, "v2_lib.js");
  const fighter = readDist(root, "v2_fighter.js");
  const merchant = readDist(root, "v2_merchant.js");
  assert.ok(/planGifts/.test(lib), "v2_lib must include planGifts");
  assert.ok(/equipPending/.test(lib), "v2_lib must include equipPending");
  assert.ok(/gear:replaced/.test(fighter), "v2_fighter must include gear:replaced");
  assert.ok(/gear:batch/.test(merchant), "v2_merchant must include gear:batch");
  assert.ok(/maybeBatchGear|gear:batch id=/.test(merchant), "v2_merchant batch path present");
  assert.ok(/bank:park_stuck|bank:full/.test(merchant), "v2_merchant must not starve pots on park fail");
  assert.ok(/vendor:sell|tryVendorNpc/.test(merchant), "v2_merchant NPC vendor path present");
  assert.ok(/dlv:need_space|ensureTakeBackSlots/.test(merchant), "v2_merchant take-back reserve present");
  assert.ok(/dlv:empty_send|dlv:no_space/.test(merchant), "v2_merchant empty-send guard present");
  assert.ok(/gear:upgrade |tryUpgradeOne/.test(merchant), "v2_merchant upgrade path");
  assert.ok(/metrics kpm=/.test(fighter), "v2_fighter metrics kpm/gpm");
  assert.ok(/toss /.test(fighter) && /failed|no_space/.test(fighter), "v2_fighter toss checks send failure");
  assert.ok(/pickUpgradeIndex|eligibleUpgrade/.test(lib), "v2_lib upgrade helpers");
});

test("dist: v2_lib+v2_fighter boot and tick in sim (real dist files)", async () => {
  const root = path.join(__dirname, "..");
  buildAll(root);
  const lib = readDist(root, "v2_lib.js");
  const fighterSrc = readDist(root, "v2_fighter.js");
  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  vm.runInContext(lib + "\n" + fighterSrc, sandbox);
  assert.strictEqual(typeof sandbox.bootFighter, "function");
  assert.strictEqual(typeof sandbox.planGifts, "function");
  assert.strictEqual(typeof sandbox.equipPending, "function");

  const w = createWorld();
  const j = w.spawn(
    {
      name: "Jazwyn",
      map: "main",
      real_x: 526,
      real_y: 1846,
      x: 526,
      y: 1846,
      items: [
        { name: "hpot1", q: 40 },
        { name: "mpot1", q: 40 },
      ].concat(new Array(40).fill(null)),
      esize: 40,
    },
    "US",
    "III"
  );
  j._now = () => w.clock.now();
  const ctrl = sandbox.bootFighter(j, { now: () => w.clock.now(), farm: "bee" });
  for (let i = 0; i < 20; i++) {
    await ctrl.tick();
    w.advance(1000);
  }
  assert.strictEqual(ctrl.state.S.intent.mtype, "bee", "compressed fighter must honor opts.farm");
  assert.ok(
    j.log.game.some((g) => /gear_ad|hit |farm:|Transfer/.test(g.m)),
    "compressed fighter must emit gameplay logs while ticking"
  );
});

test("dist: v2_lib+v2_merchant P3 batch on pot job (real dist files)", async () => {
  const root = path.join(__dirname, "..");
  buildAll(root);
  const lib = readDist(root, "v2_lib.js");
  const merchantSrc = readDist(root, "v2_merchant.js");
  const fighterSrc = readDist(root, "v2_fighter.js");
  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  // lib once, then fighter+merchant (merchant al_api may overwrite — fine)
  vm.runInContext(lib + "\n" + fighterSrc + "\n" + merchantSrc, sandbox);
  assert.strictEqual(typeof sandbox.bootMerchant, "function");
  assert.strictEqual(typeof sandbox.bootFighter, "function");

  const w = createWorld();
  const bank = { gold: 0, items0: [{ name: "gloves", level: 2 }].concat(new Array(41).fill(null)) };
  const j = w.spawn(
    {
      name: "Jazwyn",
      ctype: "warrior",
      map: "main",
      real_x: 526,
      real_y: 1846,
      items: new Array(42).fill(null),
      esize: 42,
      gold: 50000,
    },
    "US",
    "III"
  );
  const m = w.spawn(
    {
      name: "Puppygirl",
      ctype: "merchant",
      map: "main",
      real_x: 56,
      real_y: -122,
      gold: 2e6,
      items: new Array(42).fill(null),
      esize: 30,
      _bank: bank,
    },
    "US",
    "III"
  );
  j._now = () => w.clock.now();
  m._now = () => w.clock.now();
  const fCtrl = sandbox.bootFighter(j, { now: () => w.clock.now(), farm: "armadillo" });
  const mCtrl = sandbox.bootMerchant(m, { now: () => w.clock.now() });

  await j.send_cm("Puppygirl", {
    gear_ad: 1,
    name: "Jazwyn",
    esize: 40,
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
  await fCtrl.requestPots();

  let doneId = null;
  for (let i = 0; i < 400; i++) {
    await fCtrl.tick();
    await mCtrl.tick();
    w.drainOwedTime();
    w.advance(250);
    const hit = m.log.game.find((g) => /^dlv:done id=/.test(g.m));
    if (hit) {
      doneId = hit.m.replace(/^dlv:done id=/, "");
      break;
    }
  }
  assert.ok(doneId, "compressed merchant must complete pot delivery");
  const mLog = m.log.game.map((g) => g.m);
  assert.ok(
    mLog.some((line) => line.indexOf("gear:batch id=" + doneId + " ") === 0),
    "compressed merchant must gear:batch onto pot job"
  );
  assert.ok(
    mLog.some((line) => line === "dlv:send_gear gloves@2 id=" + doneId),
    "compressed merchant must send_gear with job id"
  );
  const worn = j.character.slots.gloves;
  assert.ok(worn && worn.name === "gloves" && (worn.level || 0) >= 2, "fighter equipped gift via dist path");
});

test("fighter: rip triggers respawn path", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn", map: "main", x: 0, y: 0 }, "US", "III");
  j.character.rip = true;
  j._now = () => w.clock.now();
  const ctrl = bootFighter(j, { now: () => w.clock.now() });
  await ctrl.tick();
  assert.strictEqual(j.character.rip, false);
  assert.ok(j.log.game.some((g) => /rip:respawn/.test(g.m)));
});

test("fighter: hold hop-prep CMs meet_home", async () => {
  const w = createWorld();
  const j = w.spawn(
    {
      name: "Jazwyn",
      map: "main",
      x: 0,
      y: 0,
      gold: 1e6,
      items: [
        { name: "hpot1", q: 200 },
        { name: "mpot1", q: 200 },
      ],
    },
    "US",
    "III"
  );
  const p = w.spawn({ name: "Puppygirl", map: "main", x: 10, y: 10 }, "US", "III");
  j._now = () => w.clock.now();
  p._now = () => w.clock.now();
  const { bootMerchant } = require("../src/merchant");
  const mctrl = bootMerchant(p, { now: () => w.clock.now() });
  const ctrl = bootFighter(j, { now: () => w.clock.now() });
  ctrl.applyCmd({ type: "cmd", cmd: "hold", args: [] });
  for (let i = 0; i < 30; i++) {
    await ctrl.tick();
    await mctrl.tick();
    w.advance(2000);
    const q = mctrl.store.q.concat(mctrl.store.active ? [mctrl.store.active] : []);
    if (q.some((job) => job && job.kind === "meet_home")) break;
  }
  const q = mctrl.store.q.concat(mctrl.store.active ? [mctrl.store.active] : []);
  assert.ok(q.some((job) => job && job.kind === "meet_home"), "merchant got meet_home");
});

module.exports = { tests };
