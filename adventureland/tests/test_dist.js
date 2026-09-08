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

test("dist: compressor emits ≤176-line slots", () => {
  const root = path.join(__dirname, "..");
  const report = buildAll(root);
  for (const k of Object.keys(report)) {
    assert.ok(report[k] <= MAX_LINES, k + " lines=" + report[k]);
    const p = path.join(root, "dist", k + ".js");
    assert.ok(fs.existsSync(p), p);
  }
});

test("dist: v2_lib+fighter define bootFighter and farm in sim", async () => {
  const root = path.join(__dirname, "..");
  const { buildSlot } = require("../tools/compress_code");
  const dist = path.join(root, "dist");
  buildAll(root);
  buildSlot(
    [
      path.join(root, "src/constants.js"),
      path.join(root, "src/packs.js"),
      path.join(root, "src/chat_queue.js"),
      path.join(root, "src/party_state.js"),
      path.join(root, "src/motion.js"),
    ],
    path.join(dist, "_test_lib.js")
  );
  buildSlot(
    [path.join(root, "src/al_api.js"), path.join(root, "src/fighter.js")],
    path.join(dist, "_test_fighter.js")
  );
  const lib = fs.readFileSync(path.join(dist, "_test_lib.js"), "utf8");
  const fighterSrc = fs.readFileSync(path.join(dist, "_test_fighter.js"), "utf8");

  const sandbox = {
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
  vm.createContext(sandbox);
  vm.runInContext(lib + "\n" + fighterSrc, sandbox);
  assert.strictEqual(typeof sandbox.bootFighter, "function");
  assert.strictEqual(typeof sandbox.createChatQueue, "function");

  const w = createWorld();
  const j = w.spawn(
    {
      name: "Jazwyn",
      map: "main",
      x: 526,
      y: 1846,
      items: [
        { name: "hpot1", q: 40 },
        { name: "mpot1", q: 40 },
      ],
    },
    "US",
    "III"
  );
  j._now = () => w.clock.now();
  const ctrl = sandbox.bootFighter(j, { now: () => w.clock.now() });
  for (let i = 0; i < 20; i++) {
    await ctrl.tick();
    w.advance(1000);
  }
  assert.ok(ctrl.state.S.intent.mtype);
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
