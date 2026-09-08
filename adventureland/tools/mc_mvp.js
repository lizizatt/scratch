"use strict";

/**
 * MVP Monte Carlo (V2_PLAN §6.6): merchant silence + path-fail injection.
 *
 *   node tools/mc_mvp.js [N=20] [seed=1] [ms=120000]
 *
 * Failures dump {seed, run, counters, sampleLogs}. Suite uses a smaller N.
 */

const { bootParty } = require("../src/boot_party");
const { gradeSim, mvpPass } = require("../sim/invariants");

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function runOne(seed, ms) {
  const rand = mulberry32(seed);
  const pathFailRate = 0.02; // per tick chance to inject one smart_move fail
  const merchantSkipRate = 0.15; // fraction of ticks merchant is silent
  const p = bootParty({ pack: "armadillo", pots: 40, gold: 80000, burnPots: true });

  const names = ["Jazwyn", "Sarene", "Zarook", "Puppygirl"];
  const end = p.world.clock.now() + ms;
  while (p.world.clock.now() < end) {
    if (rand() < pathFailRate) {
      const who = names[Math.floor(rand() * names.length)];
      const api = p.bots[who] && p.bots[who].api;
      if (api && api._injectSmartFail) api._injectSmartFail(rand() < 0.5 ? "fail" : "stall");
    }
    const skipMerch = rand() < merchantSkipRate;
    for (const n of ["Jazwyn", "Sarene", "Zarook"]) await p.bots[n].ctrl.tick();
    if (!skipMerch) await p.bots.Puppygirl.ctrl.tick();
    p.world.drainOwedTime();
    p.world.advance(250);
  }

  const counters = gradeSim(p.world, { pack: "armadillo", R: 900 });
  const verdict = mvpPass(counters, { maxRestockFail: 8 });
  const sampleLogs = [];
  for (const n of names) {
    const logs = (p.bots[n].api.log.game || []).slice(-8).map((g) => g.m);
    sampleLogs.push({ who: n, lines: logs });
  }
  return { seed, ok: verdict.pass, reasons: verdict.reasons, counters, sampleLogs };
}

async function main() {
  const N = parseInt(process.argv[2] || "20", 10);
  const baseSeed = parseInt(process.argv[3] || "1", 10);
  const ms = parseInt(process.argv[4] || String(2 * 60 * 1000), 10);
  let pass = 0;
  const fails = [];
  for (let i = 0; i < N; i++) {
    const seed = baseSeed + i * 9973;
    const r = await runOne(seed, ms);
    if (r.ok) {
      pass++;
      process.stdout.write(".");
    } else {
      fails.push(r);
      process.stdout.write("F");
    }
  }
  console.log("\n" + pass + "/" + N + " passed (ms=" + ms + " baseSeed=" + baseSeed + ")");
  if (fails.length) {
    console.log(JSON.stringify(fails.slice(0, 3), null, 2));
    process.exit(1);
  }
}

module.exports = { runOne, mulberry32 };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
