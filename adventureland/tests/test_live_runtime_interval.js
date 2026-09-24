"use strict";

/**
 * Mainframe hot-reload re-runs slot code in the same worker.
 * v2_start_* must clear any prior setInterval or tick loops pile up.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function bootRuntimeTwice(opts) {
  const root = path.join(__dirname, "..");
  const name = opts.name;
  const runtimeFile = opts.runtimeFile;
  const startCall = opts.startCall;
  const intervalKey = opts.intervalKey;

  const intervals = {};
  let nextId = 1;
  const clearCalls = [];
  let setCalls = 0;

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    globalThis: {},
    character: { name },
    game_log() {},
    createAlApi() {
      return { character: { name } };
    },
    bootMerchant(api) {
      return {
        tick() {},
        hunt() {},
        grind() {},
        hold() {},
        resume() {},
        world() {},
      };
    },
    bootFighter(api) {
      return {
        tick() {},
        isLead() {
          return false;
        },
      };
    },
    FIGHTERS: ["Jazwyn", "Sarene", "Zarook"],
    loot() {},
    get_party() {
      return {};
    },
    send_party_invite() {},
    setInterval(fn, ms) {
      setCalls++;
      const id = nextId++;
      intervals[id] = { fn, ms };
      return id;
    },
    clearInterval(id) {
      clearCalls.push(id);
      delete intervals[id];
    },
  };

  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(root, "src", runtimeFile), "utf8");
  vm.runInContext(src, sandbox);

  sandbox[startCall]();
  const firstId = sandbox.globalThis[intervalKey];
  assert.ok(firstId, "first interval id stored");
  assert.ok(intervals[firstId], "first interval registered");

  sandbox[startCall]();
  const secondId = sandbox.globalThis[intervalKey];
  assert.ok(intervals[secondId], "second interval registered");

  return {
    firstId,
    secondId,
    clearCalls,
    setCalls,
    activeCount: Object.keys(intervals).length,
  };
}

test("live runtime: v2_start_merchant clears prior interval on reload", () => {
  const r = bootRuntimeTwice({
    name: "Puppygirl",
    runtimeFile: "live_merchant_runtime.js",
    startCall: "v2_start_merchant",
    intervalKey: "__al_v2_merchant_tick_iv_Puppygirl",
  });

  assert.strictEqual(r.setCalls, 2, "reload starts a second interval");
  assert.ok(r.clearCalls.indexOf(r.firstId) >= 0, "reload clears first interval");
  assert.notStrictEqual(r.secondId, r.firstId, "new interval id assigned");
  assert.strictEqual(r.activeCount, 1, "only one active interval");
});

test("live runtime: v2_start_fighter clears prior interval on reload", () => {
  const r = bootRuntimeTwice({
    name: "Jazwyn",
    runtimeFile: "live_fighter_runtime.js",
    startCall: "v2_start_fighter",
    intervalKey: "__al_v2_fighter_tick_iv_Jazwyn",
  });

  assert.strictEqual(r.setCalls, 2);
  assert.ok(r.clearCalls.indexOf(r.firstId) >= 0);
  assert.strictEqual(r.activeCount, 1);
});

test("dist: v2_fighter includes single-flight tick guard", () => {
  const root = path.join(__dirname, "..");
  const { buildAll } = require("../tools/compress_code");
  buildAll(root);
  const fighter = fs.readFileSync(path.join(root, "dist", "v2_fighter.js"), "utf8");
  const merchant = fs.readFileSync(path.join(root, "dist", "v2_merchant.js"), "utf8");
  assert.ok(/tickBusy/.test(fighter), "v2_fighter must skip overlapping async ticks");
  assert.ok(/tickBusy/.test(merchant), "v2_merchant must skip overlapping async ticks");
});

test("dist: v2 bundles include interval dedupe guard", () => {
  const root = path.join(__dirname, "..");
  const { buildAll } = require("../tools/compress_code");
  buildAll(root);
  const fighter = fs.readFileSync(path.join(root, "dist", "v2_fighter.js"), "utf8");
  const merchant = fs.readFileSync(path.join(root, "dist", "v2_merchant.js"), "utf8");
  assert.ok(/clearInterval/.test(fighter), "v2_fighter must clear prior tick interval");
  assert.ok(/clearInterval/.test(merchant), "v2_merchant must clear prior tick interval");
  assert.ok(/__al_v2_fighter_tick_iv_/.test(fighter), "fighter interval key present");
  assert.ok(/__al_v2_merchant_tick_iv_/.test(merchant), "merchant interval key present");
});

module.exports = { tests };
