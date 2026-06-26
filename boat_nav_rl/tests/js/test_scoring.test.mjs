import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadUmdModule } from "./load_umd.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BoatNavScoring = loadUmdModule(join(root, "viz/scoring.js"));

function ep(overrides = {}) {
  return {
    success: false,
    collision: false,
    cpa_unsafe_in_goal: false,
    cpa_unsafe_at_end: false,
    initial_goal_range_m: 400,
    goal_hold_required: 30,
    goal_zone_speeds: [],
    ...overrides,
  };
}

test("uses stored mission_score when version matches", () => {
  const e = { mission_score: 0.42, mission_score_version: 3, success: true };
  assert.equal(BoatNavScoring.episodeMissionScore(e, "avoid"), 0.42);
});

test("direct path scores above wide arc", () => {
  const direct = ep({
    success: true,
    min_goal_range_m: 5,
    final_goal_range_m: 5,
    entered_goal_zone: true,
    goal_hold_steps: 30,
    mean_cross_track_m: 12,
    max_cross_track_m: 28,
    goal_zone_speeds: Array(30).fill(0.05),
  });
  const wide = ep({
    success: true,
    min_goal_range_m: 4,
    final_goal_range_m: 4,
    entered_goal_zone: true,
    goal_hold_steps: 30,
    mean_cross_track_m: 75,
    max_cross_track_m: 110,
    goal_zone_speeds: Array(30).fill(0.05),
  });
  assert.ok(
    BoatNavScoring.episodeMissionScore(direct, "navigate") >
      BoatNavScoring.episodeMissionScore(wide, "navigate")
  );
});

test("recomputes stale mission_score from v2 traces", () => {
  const e = ep({
    mission_score: 0.99,
    mission_score_version: 2,
    success: true,
    min_goal_range_m: 5,
    final_goal_range_m: 5,
    entered_goal_zone: true,
    goal_hold_steps: 30,
    mean_cross_track_m: 80,
    max_cross_track_m: 120,
    goal_zone_speeds: Array(30).fill(0.05),
  });
  const score = BoatNavScoring.episodeMissionScore(e, "navigate");
  assert.ok(score < 0.85);
});

test("timeout near goal without zone entry scores well", () => {
  const e = ep({
    min_goal_range_m: 55,
    final_goal_range_m: 55,
    entered_goal_zone: false,
    goal_hold_steps: 0,
  });
  assert.ok(BoatNavScoring.episodeMissionScore(e, "navigate") > 0.75);
});

test("flyby scores lower than steady approach", () => {
  const flyby = ep({
    min_goal_range_m: 10,
    final_goal_range_m: 200,
    entered_goal_zone: true,
    goal_hold_steps: 0,
  });
  const steady = ep({
    min_goal_range_m: 55,
    final_goal_range_m: 55,
    entered_goal_zone: false,
    goal_hold_steps: 0,
  });
  assert.ok(
    BoatNavScoring.episodeMissionScore(flyby, "navigate") <
      BoatNavScoring.episodeMissionScore(steady, "navigate")
  );
});

test("zone buzz without hold is near zero", () => {
  const e = ep({
    min_goal_range_m: 15,
    final_goal_range_m: 20,
    entered_goal_zone: true,
    goal_hold_steps: 0,
  });
  assert.equal(BoatNavScoring.holdMultiplier(e), 0);
  assert.ok(BoatNavScoring.episodeMissionScore(e, "avoid") < 0.01);
});

test("full success scores high", () => {
  const e = ep({
    success: true,
    min_goal_range_m: 5,
    final_goal_range_m: 5,
    entered_goal_zone: true,
    goal_hold_steps: 30,
    goal_zone_speeds: Array(30).fill(0.05),
  });
  assert.ok(BoatNavScoring.episodeMissionScore(e, "avoid") > 0.85);
});

test("scoreColor tiers", () => {
  assert.equal(BoatNavScoring.scoreColor(0.9), "#45d483");
  assert.equal(BoatNavScoring.scoreColor(0.5), "#f0c040");
  assert.equal(BoatNavScoring.scoreColor(0.1), "#ff6b6b");
});
