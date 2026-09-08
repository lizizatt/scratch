"use strict";

/**
 * Record scrubbable sim traces + a test catalog for the viz frontend.
 *
 *   node tools/record_viz.js
 *
 * Writes:
 *   viz/public/data/catalog.json
 *   viz/public/data/traces/<id>.json
 */

const fs = require("fs");
const path = require("path");
const { bootParty } = require("../src/boot_party");
const { gradeSim } = require("../sim/invariants");
const { HOME } = require("../src/constants");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "viz", "public", "data");
const TRACE_DIR = path.join(DATA, "traces");

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj));
}

/** Tag heuristics for coverage browsing (suite test names). */
function tagsFor(name) {
  const n = name.toLowerCase();
  const tags = [];
  if (/chat|throttle|heartbeat|human/.test(n)) tags.push("chat");
  if (/cm |cross-server|pm /.test(n) || /\bcm\b/.test(n)) tags.push("comms");
  if (/hop|hold|world|change_server|reconnect|heap|re-invite/.test(n)) tags.push("hop");
  if (/dlv|deliver|pots|town_fallback|merchant|bag|gold/.test(n)) tags.push("delivery");
  if (/rare|phoenix|assemble/.test(n)) tags.push("rare");
  if (/boot|succession|subset|zarook|sarene/.test(n)) tags.push("boot");
  if (/farm|armadillo|30 min|together/.test(n)) tags.push("farm");
  if (/smart_move|path|spider|blocked|clock|owe|sleep/.test(n)) tags.push("motion");
  if (/gear/.test(n)) tags.push("gear");
  if (/invariant|grade|hop lines/.test(n)) tags.push("invariants");
  if (!tags.length) tags.push("unit");
  return tags;
}

function planTag(name) {
  // Map to V2_PLAN §6.6 scenario numbers when obvious
  const n = name.toLowerCase();
  if (/\bboot\b|rejoin|succession|subset|ordering/.test(n)) return "6.6.1";
  if (/30 min|compressed|short farm|bee pack|goo pack|farm armadillo|farm bee|farm goo/.test(n)) return "6.6.2";
  if (/dlv|town_fallback|dry pots|status flowing|low_gold|bag-full|gold/.test(n)) return "6.6.3";
  if (/phoenix|rare|assemble|rare_gone|rare_timeout/.test(n)) return "6.6.4";
  if (/hold|resume|!world|hop-prep|heap wipe|re-invite|meet_home|world hop/.test(n)) return "6.6.5";
  if (/chat stress|throttle|heartbeat|reseed|human echo|~r|reboot reseeds/.test(n)) return "6.6.6";
  if (/path fail|smart_move phoenix|server_region unset|reload mid-job|cave past|spider|owe/.test(n)) return "6.6.7";
  if (/gear|bags tight|deadlock/.test(n)) return "6.6.8";
  return null;
}

function buildCatalog() {
  const suites = [
    { id: "comms", mod: require("../tests/test_comms") },
    { id: "scenarios", mod: require("../tests/test_scenarios") },
    { id: "adversarial", mod: require("../tests/test_adversarial") },
    { id: "boot", mod: require("../tests/test_boot_subsets") },
    { id: "packs", mod: require("../tests/test_packs") },
    { id: "dist", mod: require("../tests/test_dist") },
    { id: "mc", mod: require("../tests/test_mc_mvp") },
  ];
  const tests = [];
  for (const s of suites) {
    for (const t of s.mod.tests) {
      tests.push({
        name: t.name,
        suite: s.id,
        tags: tagsFor(t.name),
        plan: planTag(t.name),
        hasTrace: false,
        traceId: null,
      });
    }
  }
  return tests;
}

async function record(id, name, tags, runFn) {
  const p = await runFn({
    trace: { id, name, tags, sampleMs: 2000, maxFrames: 2000 },
  });
  if (p.trace) p.trace.stop();
  const grades = gradeSim(p.world, {});
  const json = p.trace.toJSON({ grades, ok: true });
  writeJson(path.join(TRACE_DIR, id + ".json"), json);
  return { id, grades, durationMs: json.durationMs, frameCount: json.frameCount, eventCount: json.eventCount };
}

async function main() {
  ensureDir(TRACE_DIR);
  const catalog = buildCatalog();
  const recorded = [];

  // Curated scrubbable party scenarios (full bootParty runs)
  recorded.push(
    await record("farm-1min", "scenario: farm armadillo 1 min", ["farm", "chat", "combat"], async (o) => {
      const p = bootParty(
        Object.assign({ pack: "armadillo", pots: 200 }, o, {
          trace: Object.assign({}, o.trace, { sampleMs: 500, maxFrames: 4000 }),
        })
      );
      // Include one heartbeat in the 1-min window
      await p.runFor(65000);
      return p;
    })
  );

  recorded.push(
    await record("dlv-dry", "scenario: dry pots → delivery", ["delivery", "farm"], async (o) => {
      const p = bootParty(Object.assign({ pack: "armadillo", pots: 0, gold: 50000 }, o));
      await p.bots.Jazwyn.ctrl.requestPots();
      for (let i = 0; i < 200; i++) {
        await p.tickAll();
        if (p.bots.Jazwyn.api.log.game.some((g) => /dlv:done/.test(g.m))) break;
        if (p.bots.Puppygirl.api.log.game.some((g) => /dlv:done/.test(g.m))) break;
      }
      return p;
    })
  );

  recorded.push(
    await record("rare-phoenix", "scenario: phoenix spot → kill", ["rare", "farm"], async (o) => {
      const p = bootParty(Object.assign({ pack: "armadillo", pots: 200 }, o));
      p.world.spawnMonster("US/III", "main", "phoenix", { x: 526, y: 1846 }, "phx1");
      for (let i = 0; i < 100; i++) {
        await p.tickAll();
        if (p.bots.Jazwyn.api.log.game.some((g) => /rare_kill/.test(g.m))) break;
      }
      return p;
    })
  );

  recorded.push(
    await record("hold-home", "scenario: hold → HOME hop + re-invite", ["hop", "hold"], async (o) => {
      const p = bootParty(Object.assign({ pots: 200, gold: 50000 }, o));
      p.bots.Jazwyn.ctrl.applyCmd({ cmd: "hold", args: [] });
      for (let i = 0; i < 400; i++) {
        await p.tickAll();
        if (
          ["Jazwyn", "Sarene", "Zarook"].every(
            (n) => p.world.where(n).key === HOME[0] + "/" + HOME[1] && p.bots[n].api.character.connected
          )
        )
          break;
      }
      p.world.advance(5000);
      return p;
    })
  );

  recorded.push(
    await record("puppy-route", "Puppygirl via cave past ridge to SE party", ["delivery", "motion"], async (o) => {
      const p = bootParty(Object.assign({ pack: "armadillo", pots: 0, gold: 50000 }, o));
      for (const n of ["Jazwyn", "Sarene", "Zarook"]) {
        p.bots[n].api.character.map = "main";
        p.bots[n].api.character.real_x = 750;
        p.bots[n].api.character.x = 750;
        p.bots[n].api.character.real_y = 1750;
        p.bots[n].api.character.y = 1750;
        p.bots[n].ctrl.tick = async () => {};
      }
      p.bots.Puppygirl.api.character.real_x = 56;
      p.bots.Puppygirl.api.character.x = 56;
      p.bots.Puppygirl.api.character.real_y = -122;
      p.bots.Puppygirl.api.character.y = -122;
      await p.bots.Jazwyn.ctrl.requestPots();
      for (let i = 0; i < 600; i++) {
        await p.tickAll();
        if (
          p.bots.Jazwyn.api.log.game.some((g) => /dlv:done/.test(g.m)) ||
          p.bots.Puppygirl.api.log.game.some((g) => /dlv:done/.test(g.m))
        )
          break;
      }
      return p;
    })
  );

  recorded.push(
    await record("farm-5min", "scenario: compressed 5 min farm", ["farm", "chat"], async (o) => {
      const p = bootParty(Object.assign({ pack: "armadillo", pots: 200, burnPots: true }, o));
      await p.runFor(5 * 60 * 1000);
      return p;
    })
  );

  recorded.push(
    await record("world-hop", "scenario: !world hop-prep to US/II", ["hop", "hold"], async (o) => {
      const p = bootParty(Object.assign({ pack: "armadillo", pots: 200, gold: 50000 }, o));
      p.bots.Jazwyn.ctrl.applyCmd({ cmd: "world", args: ["US/II"] });
      for (let i = 0; i < 120; i++) {
        await p.tickAll();
        if (
          ["Jazwyn", "Sarene", "Zarook"].every(
            (n) => p.world.where(n).key === "US/II" && p.bots[n].api.character.connected
          )
        )
          break;
      }
      p.world.advance(5000);
      return p;
    })
  );

  recorded.push(
    await record("path-fail-farm", "scenario: path fail injection farm", ["farm", "motion"], async (o) => {
      const p = bootParty(Object.assign({ pack: "armadillo", pots: 200, burnPots: true }, o));
      for (let i = 0; i < 60; i++) {
        if (i % 11 === 0 && p.bots.Jazwyn.api._injectSmartFail) {
          p.bots.Jazwyn.api._injectSmartFail("fail");
        }
        await p.tickAll();
      }
      return p;
    })
  );

  recorded.push(
    await record("farm-bee", "scenario: short bee farm", ["farm"], async (o) => {
      const p = bootParty(Object.assign({ pack: "bee", pots: 200 }, o));
      await p.runFor(45000);
      return p;
    })
  );

  const byId = {};
  for (const r of recorded) byId[r.id] = r;

  // Attach traces to catalog rows by name match / tags
  const traceByName = {
    "scenario: farm armadillo stays together, 0 throttle": "farm-1min",
    "scenario: dry pots → merchant delivery → dlv_done": "dlv-dry",
    "scenario: phoenix spot → assemble → kill → resume, no fighter hop": "rare-phoenix",
    "scenario: hold triggers hop-prep; fighter ends on HOME": "hold-home",
    "hop: heap wipe clears handlers; storage restores hold; party re-invite": "hold-home",
    "scenario: compressed 30 min farm armadillo, 0 throttle 0 fighter hop": "farm-5min",
    "scenario: Puppygirl delivers via cave past ridge + island": "puppy-route",
    "smart_move: Puppygirl routes through cave to SE destination": "puppy-route",
    "scenario: !world hop-prep lands party on target server": "world-hop",
    "scenario: path fail injection during farm — no Transfer/Port storm": "path-fail-farm",
    "scenario: short farm bee pack stays together": "farm-bee",
  };

  for (const t of catalog) {
    const tid = traceByName[t.name];
    if (tid && byId[tid]) {
      t.hasTrace = true;
      t.traceId = tid;
      t.grades = byId[tid].grades;
    }
  }

  const coverage = {};
  for (const t of catalog) {
    for (const tag of t.tags) {
      if (!coverage[tag]) coverage[tag] = { tests: 0, withTrace: 0 };
      coverage[tag].tests++;
      if (t.hasTrace) coverage[tag].withTrace++;
    }
  }

  const planCoverage = {};
  for (let i = 1; i <= 8; i++) {
    const key = "6.6." + i;
    planCoverage[key] = { tests: 0, withTrace: 0, names: [] };
  }
  for (const t of catalog) {
    if (!t.plan) continue;
    planCoverage[t.plan].tests++;
    planCoverage[t.plan].names.push(t.name);
    if (t.hasTrace) planCoverage[t.plan].withTrace++;
  }

  writeJson(path.join(DATA, "catalog.json"), {
    generatedAt: new Date().toISOString(),
    testCount: catalog.length,
    traceCount: recorded.length,
    traces: recorded.map((r) => ({
      id: r.id,
      durationMs: r.durationMs,
      frameCount: r.frameCount,
      eventCount: r.eventCount,
      grades: r.grades,
    })),
    coverage,
    planCoverage,
    tests: catalog,
  });

  console.log("Wrote", catalog.length, "catalog tests,", recorded.length, "traces →", DATA);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
