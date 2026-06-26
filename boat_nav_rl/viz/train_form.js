/** Pure training form logic — shared by train.js and Node unit tests. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.BoatNavTrainForm = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  /** Defaults mirror rewards.py / train.html form. */
  const REWARD_WEIGHT_GROUPS = [
    {
      title: "Encounter",
      fields: [
        { key: "cpa", label: "CPA hard", step: 1, default: 40 },
        { key: "cpa_soft", label: "CPA soft", step: 1, default: 12 },
        { key: "cpa_warning_mult", label: "CPA warn ×", step: 0.1, default: 2 },
        { key: "goal_threat_stay", label: "Threat in zone", step: 0.5, default: 6 },
        { key: "collision", label: "Collision", step: 5, default: 100 },
      ],
    },
    {
      title: "Navigation",
      fields: [
        { key: "goal_progress", label: "Goal progress", step: 0.5, default: 3 },
        { key: "cross_track", label: "Cross-track", step: 0.05, default: 0.65 },
        { key: "cross_track_scale_m", label: "Cross-track scale (m)", step: 1, default: 60 },
        { key: "approach_slow", label: "Approach decel", step: 0.05, default: 0.35 },
        { key: "approach_slow_range_m", label: "Approach range (m)", step: 1, default: 200 },
      ],
    },
    {
      title: "Goal hold",
      fields: [
        { key: "goal_arrival", label: "Goal arrival", step: 5, default: 50 },
        { key: "goal_arrival_early", label: "Early arrival", step: 1, default: 8 },
        { key: "hold_base", label: "Hold base", step: 0.5, default: 2 },
        { key: "hold_speed", label: "Hold speed", step: 0.5, default: 3 },
        { key: "hold_center", label: "Hold center", step: 0.1, default: 0.6 },
        { key: "hold_overspeed", label: "Hold overspeed", step: 0.5, default: 3 },
        { key: "hold_stationary_speed_mps", label: "Stationary (m/s)", step: 0.01, default: 0.15 },
      ],
    },
  ];

  function rewardWeightDefaults() {
    const weights = {};
    REWARD_WEIGHT_GROUPS.forEach((group) => {
      group.fields.forEach((field) => {
        weights[field.key] = field.default;
      });
    });
    return weights;
  }

  function clearCurriculumState() {
    return {
      activePresetId: null,
      activeScenarioPrefixes: null,
      activeCurriculumPhase: null,
    };
  }

  function curriculumFromPreset(preset) {
    if (!preset) return clearCurriculumState();
    return {
      activePresetId: preset.id,
      activeScenarioPrefixes: preset.scenario_category_prefixes || null,
      activeCurriculumPhase: preset.curriculum_phase ?? null,
    };
  }

  /**
   * Keep prior resume selection when still valid; default to fresh start (not latest run).
   */
  function resolveResumeSelection(history, previousValue) {
    const runIds = (history || []).map((r) => r.run_id);
    if (previousValue && runIds.includes(previousValue)) {
      return previousValue;
    }
    return "";
  }

  /**
   * @param {object} form — plain field values from the train form
   * @param {object} curriculum — activeScenarioPrefixes, curriculumPhase
   * @param {string|null|undefined} resumeRunId
   */
  function buildTrainingPayload(form, curriculum, resumeRunId) {
    const budgetMin = parseFloat(form.budgetMin);
    const payload = {
      mode: form.mode,
      budget_sec: Math.round((Number.isFinite(budgetMin) ? budgetMin : 0) * 60),
      snapshot_interval_min: Math.max(0, parseInt(form.snapshotIntervalMin, 10) || 0),
      n_envs: parseInt(form.nEnvs, 10),
      device: form.device,
      dynamics_jitter: Boolean(form.dynamicsJitter),
      robust_eval_enabled: Boolean(form.robustEval),
      goal_hold_sec: parseInt(form.goalHoldSec, 10) || 0,
      current_enabled: Boolean(form.currentEnabled),
      montage_enabled: Boolean(form.montageEnabled),
      plant: form.plant || {},
      reward_weights: form.rewardWeights || {},
      gated_hold: Boolean(form.gatedHold),
      scenario_category_prefixes: curriculum?.activeScenarioPrefixes ?? null,
      curriculum_phase: curriculum?.activeCurriculumPhase ?? null,
      resume_run_id: resumeRunId || null,
      notes: String(form.notes || "").trim(),
    };
    return payload;
  }

  return {
    REWARD_WEIGHT_GROUPS,
    rewardWeightDefaults,
    clearCurriculumState,
    curriculumFromPreset,
    resolveResumeSelection,
    buildTrainingPayload,
  };
});
