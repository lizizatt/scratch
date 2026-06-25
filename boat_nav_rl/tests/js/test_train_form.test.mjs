import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadUmdModule } from "./load_umd.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const Util = loadUmdModule(join(root, "viz/util.js"));
const TrainForm = loadUmdModule(join(root, "viz/train_form.js"));

test("rewardWeightDefaults includes every configured key", () => {
  const weights = TrainForm.rewardWeightDefaults();
  const keys = TrainForm.REWARD_WEIGHT_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
  assert.equal(Object.keys(weights).length, keys.length);
  for (const key of keys) {
    assert.ok(Number.isFinite(weights[key]), `missing default for ${key}`);
  }
});

test("buildTrainingPayload converts budget minutes to seconds", () => {
  const payload = TrainForm.buildTrainingPayload(
    {
      mode: "navigate",
      budgetMin: "30",
      snapshotIntervalMin: "15",
      nEnvs: "8",
      device: "auto",
      dynamicsJitter: false,
      robustEval: false,
      goalHoldSec: "15",
      currentEnabled: false,
      montageEnabled: false,
      plant: { tau_heading_s: 1.2, tau_speed_s: 0.8, max_yaw_rate_deg_s: 25 },
      rewardWeights: { cpa: 40 },
      gatedHold: true,
      notes: "  smoke run  ",
    },
    TrainForm.clearCurriculumState(),
    null
  );
  assert.equal(payload.budget_sec, 1800);
  assert.equal(payload.snapshot_interval_min, 15);
  assert.equal(payload.n_envs, 8);
  assert.equal(payload.notes, "smoke run");
  assert.equal(payload.scenario_category_prefixes, null);
  assert.equal(payload.curriculum_phase, null);
  assert.equal(payload.resume_run_id, null);
});

test("buildTrainingPayload includes curriculum fields from preset", () => {
  const curriculum = TrainForm.curriculumFromPreset({
    id: "phase1",
    scenario_category_prefixes: ["traffic/"],
    curriculum_phase: 1,
  });
  const payload = TrainForm.buildTrainingPayload(
    {
      mode: "avoid",
      budgetMin: 60,
      snapshotIntervalMin: 0,
      nEnvs: 4,
      device: "cpu",
      dynamicsJitter: false,
      robustEval: true,
      goalHoldSec: 0,
      currentEnabled: false,
      montageEnabled: false,
      plant: {},
      rewardWeights: {},
      gatedHold: false,
      notes: "",
    },
    curriculum,
    "20260625_010101"
  );
  assert.deepEqual(payload.scenario_category_prefixes, ["traffic/"]);
  assert.equal(payload.curriculum_phase, 1);
  assert.equal(payload.resume_run_id, "20260625_010101");
});

test("clearCurriculumState nulls preset curriculum fields", () => {
  const cleared = TrainForm.clearCurriculumState();
  assert.equal(cleared.activePresetId, null);
  assert.equal(cleared.activeScenarioPrefixes, null);
  assert.equal(cleared.activeCurriculumPhase, null);
});

test("resolveResumeSelection keeps valid prior selection only", () => {
  const history = [{ run_id: "a" }, { run_id: "b" }];
  assert.equal(TrainForm.resolveResumeSelection(history, "b"), "b");
  assert.equal(TrainForm.resolveResumeSelection(history, "missing"), "");
  assert.equal(TrainForm.resolveResumeSelection(history, ""), "");
  assert.equal(TrainForm.resolveResumeSelection(history, null), "");
});

test("resolveResumeSelection does not auto-pick latest run", () => {
  const history = [{ run_id: "old" }, { run_id: "latest" }];
  assert.equal(TrainForm.resolveResumeSelection(history, undefined), "");
});
