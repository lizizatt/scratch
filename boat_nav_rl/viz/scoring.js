/**
 * Per-episode mission score v3 — mirrors eval_parallel.py (MISSION_SCORE_VERSION = 3).
 */
const BoatNavScoring = (() => {
  const MISSION_SCORE_VERSION = 3;
  const COLLISION_SCORE_FACTOR = 0.08;
  const CPA_UNSAFE_GOAL_FACTOR = 0.45;
  const DEFAULT_GOAL_HOLD_REQUIRED = 30;
  const DEFAULT_GOAL_SUCCESS_RANGE_M = 50;
  const APPROACH_FALLBACK_SCALE_M = 200;
  const ENERGY_SCORE_BLEND = 0.25;
  const DIRECTNESS_SCORE_BLEND = 0.22;
  const DIRECTNESS_SCORE_SCALE_M = 60;
  const DIRECTNESS_MAX_SCALE_MULT = 1.25;

  function colregsEnabledForMode(mode) {
    return mode !== "navigate";
  }

  function episodeRangeM(episode, key) {
    const v = episode[key];
    if (v == null || !Number.isFinite(v)) return null;
    return v;
  }

  function approachScaleM(episode) {
    const initial = episodeRangeM(episode, "initial_goal_range_m");
    if (initial != null && initial > DEFAULT_GOAL_SUCCESS_RANGE_M) return initial;
    return APPROACH_FALLBACK_SCALE_M;
  }

  function rangeQuality(rangeM, scaleM) {
    const scale = Math.max(scaleM, DEFAULT_GOAL_SUCCESS_RANGE_M, 1e-6);
    return Math.max(0, Math.min(1, 1 - rangeM / scale));
  }

  function approachFactor(episode) {
    const scale = approachScaleM(episode);
    let mn = episodeRangeM(episode, "min_goal_range_m");
    let fin = episodeRangeM(episode, "final_goal_range_m");
    if (mn == null && fin == null) return 0;
    if (mn == null) mn = fin;
    if (fin == null) fin = mn;
    const qMin = rangeQuality(mn, scale);
    const qFin = rangeQuality(fin, scale);
    return Math.sqrt(Math.max(0, qMin * qFin));
  }

  function holdMultiplier(episode) {
    if (episode.success) return 1;
    if (!episode.entered_goal_zone) return 1;
    const steps = episode.goal_hold_steps ?? 0;
    if (steps <= 0) return 0;
    const required = episode.goal_hold_required ?? DEFAULT_GOAL_HOLD_REQUIRED;
    if (required <= 0) return 1;
    return Math.min(1, steps / required);
  }

  function crossTrackM(legX, legY, goalX, goalY, px, py) {
    const dx = goalX - legX;
    const dy = goalY - legY;
    const segLenSq = dx * dx + dy * dy;
    if (segLenSq < 1e-6) return Math.hypot(px - legX, py - legY);
    return Math.abs((px - legX) * dy - (py - legY) * dx) / Math.sqrt(segLenSq);
  }

  function crossTrackFromTrace(episode) {
    const steps = episode.steps || [];
    if (steps.length < 2) return { mean: null, max: null };
    const start = steps[0];
    const goal = start.goal || {};
    const legX = start.own?.x ?? 0;
    const legY = start.own?.y ?? 0;
    const goalX = goal.x ?? 0;
    const goalY = goal.y ?? 0;
    const samples = [];
    for (let i = 1; i < steps.length; i++) {
      const own = steps[i].own || {};
      const gr = Math.hypot(goalX - (own.x ?? 0), goalY - (own.y ?? 0));
      if (gr < DEFAULT_GOAL_SUCCESS_RANGE_M) continue;
      samples.push(crossTrackM(legX, legY, goalX, goalY, own.x ?? 0, own.y ?? 0));
    }
    if (!samples.length) return { mean: null, max: null };
    const sum = samples.reduce((a, b) => a + b, 0);
    return { mean: sum / samples.length, max: Math.max(...samples) };
  }

  function directnessFactor(episode) {
    let meanCt = episodeRangeM(episode, "mean_cross_track_m");
    let maxCt = episodeRangeM(episode, "max_cross_track_m");
    if (meanCt == null && maxCt == null) {
      const fromTrace = crossTrackFromTrace(episode);
      meanCt = fromTrace.mean;
      maxCt = fromTrace.max;
    }
    if (meanCt == null && maxCt == null) return 1;
    if (meanCt == null) meanCt = maxCt;
    if (maxCt == null) maxCt = meanCt;
    const qMean = rangeQuality(meanCt, DIRECTNESS_SCORE_SCALE_M);
    const qMax = rangeQuality(maxCt, DIRECTNESS_SCORE_SCALE_M * DIRECTNESS_MAX_SCALE_MULT);
    return Math.sqrt(Math.max(0, qMean * qMax));
  }

  function speedEnergyFraction(speedMps, vMax = 8) {
    const n = speedMps / Math.max(vMax, 1e-6);
    return n * n;
  }

  function energyFromSpeeds(speeds) {
    if (!speeds.length) return 1;
    const meanFrac =
      speeds.reduce((s, v) => s + speedEnergyFraction(v), 0) / speeds.length;
    return Math.max(0, 1 - meanFrac);
  }

  function energyFactor(episode) {
    const speeds = episode.goal_zone_speeds || [];
    if (!speeds.length) return 1;
    return energyFromSpeeds(speeds);
  }

  function cpaUnsafeForScoring(episode, mode) {
    if (!colregsEnabledForMode(mode)) return false;
    if ("cpa_unsafe_at_end" in episode) return Boolean(episode.cpa_unsafe_at_end);
    return Boolean(episode.cpa_unsafe_in_goal);
  }

  function safetyFactor(episode, mode) {
    let factor = 1;
    if (episode.collision) factor *= COLLISION_SCORE_FACTOR;
    if (cpaUnsafeForScoring(episode, mode)) factor *= CPA_UNSAFE_GOAL_FACTOR;
    return factor;
  }

  function episodeMissionScore(episode, mode, options = {}) {
    const storedVersion = episode.mission_score_version ?? 1;
    if (
      episode.mission_score != null &&
      !options.forceRecompute &&
      storedVersion === MISSION_SCORE_VERSION
    ) {
      return episode.mission_score;
    }
    const epMode = mode || episode.mode || "navigate";
    const approach = approachFactor(episode);
    const hold = holdMultiplier(episode);
    const safety = safetyFactor(episode, epMode);
    const directness = directnessFactor(episode);
    const energy = energyFactor(episode);
    const core = approach * hold * safety;
    const directBlend = (1 - DIRECTNESS_SCORE_BLEND) + DIRECTNESS_SCORE_BLEND * directness;
    const energyBlend = (1 - ENERGY_SCORE_BLEND) + ENERGY_SCORE_BLEND * energy;
    return Math.max(0, Math.min(1, core * directBlend * energyBlend));
  }

  function scoreColor(score) {
    if (score >= 0.8) return "#45d483";
    if (score >= 0.4) return "#f0c040";
    return "#ff6b6b";
  }

  function formatScore(score) {
    return `${Math.round(score * 100)}%`;
  }

  return {
    MISSION_SCORE_VERSION,
    episodeMissionScore,
    approachFactor,
    holdMultiplier,
    directnessFactor,
    safetyFactor,
    energyFactor,
    scoreColor,
    formatScore,
    colregsEnabledForMode,
  };
})();

if (typeof module !== "undefined") module.exports = BoatNavScoring;
