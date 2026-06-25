/* Training page */

const trainForm = document.getElementById("trainForm");
const modeSelect = document.getElementById("modeSelect");
const budgetMin = document.getElementById("budgetMin");
const snapshotIntervalMin = document.getElementById("snapshotIntervalMin");
const nEnvs = document.getElementById("nEnvs");
const deviceSelect = document.getElementById("deviceSelect");
const dynamicsJitter = document.getElementById("dynamicsJitter");
const goalHoldSec = document.getElementById("goalHoldSec");
const currentEnabled = document.getElementById("currentEnabled");
const montageEnabled = document.getElementById("montageEnabled");
const robustEval = document.getElementById("robustEval");
const plantPanel = document.getElementById("plantPanel");
const tauHeading = document.getElementById("tauHeading");
const tauSpeed = document.getElementById("tauSpeed");
const maxYawRate = document.getElementById("maxYawRate");
const presetNominal = document.getElementById("presetNominal");
const presetAgile = document.getElementById("presetAgile");
const presetFreighter = document.getElementById("presetFreighter");
const rewardPanel = document.getElementById("rewardPanel");
const rewardWeightsGrid = document.getElementById("rewardWeightsGrid");
const gatedHold = document.getElementById("gatedHold");
const presetRewardDefaults = document.getElementById("presetRewardDefaults");
const resumeSelect = document.getElementById("resumeSelect");
const notesInput = document.getElementById("notesInput");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const jobStatus = document.getElementById("jobStatus");
const trainLog = document.getElementById("trainLog");
const statusLine = document.getElementById("statusLine");
const scoreChartSplit = document.getElementById("scoreChartSplit");
const scoreChartLivePane = document.getElementById("scoreChartLivePane");
const scoreChartCompleted = document.getElementById("scoreChartCompleted");
const scoreChartLive = document.getElementById("scoreChartLive");
const metricsGrid = document.getElementById("metricsGrid");
const rewardGrid = document.getElementById("rewardGrid");
const historyTable = document.querySelector("#historyTable tbody");
const montageCanvas = document.getElementById("montageCanvas");
const montageScrubber = document.getElementById("montageScrubber");
const montageStepLabel = document.getElementById("montageStepLabel");
const montageMeta = document.getElementById("montageMeta");
const montageOverviewLink = document.getElementById("montageOverviewLink");
const montagePngLink = document.getElementById("montagePngLink");
const presetButtons = document.getElementById("presetButtons");
const presetDescription = document.getElementById("presetDescription");

let history = [];
let lastCompletedRun = null;
let liveSeries = [];
let jobRunning = false;
let lastLiveHash = "";
let pollInFlight = false;
let animFrameId = null;

let plantConfig = null;
let defaultRewardWeights = null;
let montageEpisodes = [];
let montageRunId = null;
let montageLoadSeq = 0;
let trainingPresets = [];
let activePresetId = "quick_start";
let activeScenarioPrefixes = null;
let activeCurriculumPhase = null;

const METRIC_CHARTS = [
  {
    key: "success_rate",
    label: "Success rate",
    scale: 100,
    yMax: 100,
    color: "#3aa6ff",
    empty: "No eval yet",
  },
  {
    key: "avg_final_goal_range_m",
    label: "Avg goal range (m)",
    scale: 1,
    yFloor: 0,
    color: "#ffc857",
    empty: "No eval yet",
  },
  {
    key: "mean_goal_zone_speed_mps",
    label: "Goal-zone speed (m/s)",
    scale: 1,
    yFloor: 0,
    color: "#ff6b6b",
    empty: "No zone steps yet",
  },
  {
    key: "pct_goal_zone_at_min_speed",
    label: "At min speed in zone",
    scale: 100,
    yMax: 100,
    color: "#45d483",
    empty: "No zone steps yet",
  },
];

const REWARD_COMPONENTS = [
  { key: "progress", label: "Goal progress" },
  { key: "cross_track", label: "Cross-track", penalty: true },
  { key: "approach_slow", label: "Approach decel" },
  { key: "goal_arrival", label: "Goal arrival" },
  { key: "hold_speed", label: "Hold speed" },
  { key: "hold_center", label: "Hold center", penalty: true },
  { key: "hold_overspeed", label: "Hold overspeed", penalty: true },
  { key: "goal_threat_stay", label: "Threat in zone", penalty: true },
  { key: "smooth", label: "Smooth actions", penalty: true },
  { key: "cpa", label: "CPA", penalty: true },
  { key: "collision", label: "Collision", penalty: true },
];

const REWARD_COLORS = [
  "#45d483",
  "#3aa6ff",
  "#ffc857",
  "#ff9f43",
  "#c678dd",
  "#56b6c2",
  "#e06c75",
  "#98c379",
  "#61afef",
  "#d19a66",
];

/** Config keys grouped for the train form (defaults in train_form.js). */
const REWARD_WEIGHT_GROUPS = BoatNavTrainForm.REWARD_WEIGHT_GROUPS;

let lastChartRender = 0;

function clearPresetCurriculumFields() {
  const cleared = BoatNavTrainForm.clearCurriculumState();
  activePresetId = cleared.activePresetId;
  activeScenarioPrefixes = cleared.activeScenarioPrefixes;
  activeCurriculumPhase = cleared.activeCurriculumPhase;
  renderPresetButtons();
}

function markFormEdited() {
  clearPresetCurriculumFields();
}

function liveMetricsFingerprint(series) {
  return BoatNavUtil.liveMetricsFingerprint(series);
}

function rewardWeightDefaults() {
  return BoatNavTrainForm.rewardWeightDefaults();
}

function applyTrainingPreset(preset) {
  if (!preset) return;
  const curriculum = BoatNavTrainForm.curriculumFromPreset(preset);
  activePresetId = curriculum.activePresetId;
  activeScenarioPrefixes = curriculum.activeScenarioPrefixes;
  activeCurriculumPhase = curriculum.activeCurriculumPhase;
  modeSelect.value = preset.mode;
  budgetMin.value = Math.round(preset.budget_sec / 60);
  goalHoldSec.value = preset.goal_hold_sec;
  gatedHold.checked = Boolean(preset.gated_hold);
  currentEnabled.checked = Boolean(preset.current_enabled);
  dynamicsJitter.checked = Boolean(preset.dynamics_jitter);
  robustEval.checked = Boolean(preset.robust_eval_enabled);
  montageEnabled.checked = Boolean(preset.montage_enabled);
  if (preset.snapshot_interval_min != null) {
    snapshotIntervalMin.value = String(preset.snapshot_interval_min);
  }
  applyRewardWeights(preset.reward_weights, preset.gated_hold);
  if (preset.notes) notesInput.value = preset.notes;
  if (presetDescription) {
    presetDescription.textContent = preset.description || preset.label;
  }
  renderPresetButtons();
  syncPlantUi();
}

function renderPresetButtons() {
  if (!presetButtons) return;
  presetButtons.innerHTML = "";
  trainingPresets.forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `ghost-btn${preset.id === activePresetId ? " active" : ""}`;
    btn.textContent = preset.label;
    btn.addEventListener("click", () => applyTrainingPreset(preset));
    presetButtons.appendChild(btn);
  });
}

async function loadTrainingPresets() {
  const data = await fetchJson("/api/curriculum/presets");
  trainingPresets = data.presets || [];
  renderPresetButtons();
  const quick = trainingPresets.find((p) => p.id === "quick_start") || trainingPresets[0];
  if (quick) applyTrainingPreset(quick);
}

function readPlantFromForm() {
  return {
    tau_heading_s: parseFloat(tauHeading.value),
    tau_speed_s: parseFloat(tauSpeed.value),
    max_yaw_rate_deg_s: parseFloat(maxYawRate.value),
  };
}

function buildRewardWeightInputs() {
  if (!rewardWeightsGrid || rewardWeightsGrid.dataset.built) return;
  REWARD_WEIGHT_GROUPS.forEach((group) => {
    const heading = document.createElement("div");
    heading.className = "reward-weight-group";
    heading.textContent = group.title;
    rewardWeightsGrid.appendChild(heading);
    group.fields.forEach((field) => {
      const label = document.createElement("label");
      label.htmlFor = `reward_${field.key}`;
      const input = document.createElement("input");
      input.type = "number";
      input.id = `reward_${field.key}`;
      input.name = `reward_${field.key}`;
      input.dataset.rewardKey = field.key;
      input.step = String(field.step ?? 0.1);
      input.min = String(field.min ?? 0);
      input.value = String(field.default ?? 0);
      label.appendChild(document.createTextNode(field.label));
      label.appendChild(input);
      rewardWeightsGrid.appendChild(label);
    });
  });
  rewardWeightsGrid.dataset.built = "1";
}

function applyRewardWeights(weights, gatedHoldValue) {
  buildRewardWeightInputs();
  const source = weights || defaultRewardWeights || rewardWeightDefaults();
  Object.entries(source).forEach(([key, value]) => {
    const input = rewardWeightsGrid.querySelector(`[data-reward-key="${key}"]`);
    if (input && value != null) {
      input.value = value;
    }
  });
  if (gatedHoldValue != null) {
    gatedHold.checked = Boolean(gatedHoldValue);
  }
}

function readRewardWeightsFromForm() {
  buildRewardWeightInputs();
  const weights = {};
  rewardWeightsGrid.querySelectorAll("[data-reward-key]").forEach((input) => {
    const key = input.dataset.rewardKey;
    const value = parseFloat(input.value);
    if (key && Number.isFinite(value)) {
      weights[key] = value;
    }
  });
  return weights;
}

function applyPlantPreset(preset) {
  if (!preset) return;
  tauHeading.value = preset.tau_heading_s;
  tauSpeed.value = preset.tau_speed_s;
  maxYawRate.value = preset.max_yaw_rate_deg_s;
}

function syncPlantUi() {
  updatePlantPanelState();
}

function updatePlantPanelState() {
  const jitterOn = dynamicsJitter.checked;
  plantPanel.classList.toggle("disabled", jitterOn);
}

async function loadPlantConfig() {
  plantConfig = await fetchJson("/api/plant/config");
  applyPlantPreset(plantConfig.nominal);
  defaultRewardWeights = plantConfig.reward_weights || rewardWeightDefaults();
  const tr = plantConfig.training;
  if (tr) {
    if (tr.recommended_n_envs != null) {
      nEnvs.value = tr.recommended_n_envs;
    }
    if (tr.max_n_envs != null) {
      nEnvs.max = tr.max_n_envs;
    }
    const hint = document.getElementById("nEnvsHint");
    if (hint && tr.cpu_count != null) {
      hint.textContent = `Rollouts on CPU (${tr.vecenv_backend || "subproc"}, ${tr.cpu_count} cores). `
        + `Default ${tr.recommended_n_envs} envs, ${tr.rollout_steps_total || "?"} steps/update. GPU used for PPO learning.`;
    }
  }
  syncPlantUi();
}

function getTrainingPayload(resumeRunId) {
  return BoatNavTrainForm.buildTrainingPayload(
    {
      mode: modeSelect.value,
      budgetMin: budgetMin.value,
      snapshotIntervalMin: snapshotIntervalMin.value,
      nEnvs: nEnvs.value,
      device: deviceSelect.value,
      dynamicsJitter: dynamicsJitter.checked,
      robustEval: robustEval.checked,
      goalHoldSec: goalHoldSec.value,
      currentEnabled: currentEnabled.checked,
      montageEnabled: montageEnabled.checked,
      plant: readPlantFromForm(),
      rewardWeights: readRewardWeightsFromForm(),
      gatedHold: gatedHold.checked,
      notes: notesInput.value,
    },
    {
      activeScenarioPrefixes: activeScenarioPrefixes,
      activeCurriculumPhase: activeCurriculumPhase,
    },
    resumeRunId
  );
}

async function fetchJson(url, opts) {
  return BoatNavApi.fetchJson(url, opts);
}

function shortRunId(id) {
  return BoatNavUtil.shortRunId(id);
}

async function loadHistory() {
  const data = await fetchJson("/api/history");
  history = data.runs || [];
  populateResumeSelect();
  renderCharts();
  renderHistoryTable();
  statusLine.textContent = `${history.length} completed run(s)`;
  if (!jobRunning && history.length) {
    await loadMontageForRun(history[history.length - 1].run_id);
  }
}

function montageProgressFromScrubber() {
  const max = parseInt(montageScrubber.max, 10) || 0;
  const val = parseInt(montageScrubber.value, 10) || 0;
  return max > 0 ? val / max : 1;
}

function renderMontageCanvas() {
  if (!montageEpisodes.length || !montageCanvas) return;
  const ctx = montageCanvas.getContext("2d");
  const progress = montageProgressFromScrubber();
  const info = BoatNavDraw.drawStepMontage(
    ctx,
    montageEpisodes,
    progress,
    montageCanvas.width,
    montageCanvas.height,
    { maxEpisodes: 48, showLabels: true }
  );
  const lastStep = Math.max(info.maxSteps - 1, 0);
  montageStepLabel.textContent = `step ${info.frameIndex} / ${lastStep} · ${info.shown}/${info.total} scenarios`;
}

async function loadMontageForRun(runId) {
  if (!runId || runId === montageRunId) {
    renderMontageCanvas();
    return;
  }
  const seq = ++montageLoadSeq;
  try {
    const data = await fetchJson(`/api/runs/${runId}`);
    if (seq !== montageLoadSeq) return;
    montageEpisodes = data.traces?.episodes || [];
    montageRunId = runId;
    montageOverviewLink.href = `/scenarios.html?run=${runId}`;

    if (data.metrics?.montage?.step_montage) {
      montagePngLink.href = `/api/runs/${runId}/step_montage.png`;
      montagePngLink.classList.remove("hidden");
      const sec = data.metrics.montage.montage_sec;
      montagePngLink.textContent = sec != null ? `Saved PNG (${sec}s)` : "Saved PNG";
    } else {
      montagePngLink.classList.add("hidden");
    }

    const maxSteps = montageEpisodes.reduce(
      (m, ep) => Math.max(m, (ep.steps || []).length),
      0
    );
    montageScrubber.max = String(Math.max(maxSteps - 1, 0));
    montageScrubber.value = montageScrubber.max;

    const score = data.metrics?.nav_score ?? data.metrics?.avoid_score;
    montageMeta.textContent = `Run ${shortRunId(runId)} · ${montageEpisodes.length} eval episodes · score ${score != null ? score.toFixed(3) : "?"}`;
    montageScrubber.disabled = false;
    renderMontageCanvas();
  } catch (err) {
    montageMeta.textContent = `Montage unavailable: ${err.message}`;
    montageScrubber.disabled = true;
  }
}

function historyMetricPoints(key, scale = 1) {
  return history.map((r) => ({
    y: r[key] != null ? r[key] * scale : null,
    label: shortRunId(r.run_id),
  }));
}

function liveMetricPoints(key, scale = 1) {
  return liveSeries.map((p) => ({
    y: p[key] != null ? p[key] * scale : null,
    label: `${Math.round(p.t_sec)}s`,
  }));
}

function breakdownDisplayY(key, raw, spec) {
  return BoatNavUtil.breakdownDisplayY(raw, spec);
}

function historyBreakdownPoints(key, spec) {
  return history.map((r) => ({
    y: breakdownDisplayY(key, r.reward_breakdown_mean?.[key] ?? null, spec),
    label: shortRunId(r.run_id),
  }));
}

function liveBreakdownPoints(key, spec) {
  return liveSeries.map((p) => ({
    y: breakdownDisplayY(key, p.reward_breakdown?.[key] ?? null, spec),
    label: `${Math.round(p.t_sec)}s`,
  }));
}

function buildMetricGrid() {
  if (metricsGrid.dataset.built) return;
  METRIC_CHARTS.forEach((spec) => {
    const pane = document.createElement("div");
    pane.className = "chart-pane-sm";
    pane.innerHTML = `
      <h3 class="chart-pane-title">${spec.label}</h3>
      <canvas class="metric-chart-completed" data-key="${spec.key}" width="400" height="170"></canvas>
      <canvas class="metric-chart-live hidden" data-key="${spec.key}" width="400" height="130"></canvas>
    `;
    metricsGrid.appendChild(pane);
  });
  metricsGrid.dataset.built = "1";
}

function buildRewardGrid() {
  if (rewardGrid.dataset.built) return;
  REWARD_COMPONENTS.forEach((spec, i) => {
    const pane = document.createElement("div");
    pane.className = "chart-pane-sm";
    pane.innerHTML = `
      <h3 class="chart-pane-title">${spec.label}</h3>
      <canvas class="reward-chart-completed" data-key="${spec.key}" width="400" height="170"></canvas>
      <canvas class="reward-chart-live hidden" data-key="${spec.key}" width="400" height="130"></canvas>
    `;
    rewardGrid.appendChild(pane);
  });
  rewardGrid.dataset.built = "1";
}

function drawDualSeries(completedCanvas, liveCanvas, completedPoints, livePoints, spec) {
  const yAutoRange = spec.yMax == null;
  const chartOpts = {
    emptyText: spec.empty || "No completed runs yet",
    yAutoRange,
    yMax: spec.yMax,
  };
  if (spec.penalty || spec.yFloor != null) {
    chartOpts.yFloor = spec.yFloor ?? 0;
  }
  const seriesOpts = {
    label: spec.label,
    color: spec.color,
    yMax: spec.yMax,
  };
  BoatNavChart.drawLineChart(
    completedCanvas,
    [{ ...seriesOpts, points: completedPoints }],
    chartOpts
  );
  if (liveCanvas) {
    liveCanvas.classList.toggle("hidden", !jobRunning);
    if (jobRunning) {
      BoatNavChart.drawLineChart(
        liveCanvas,
        [{ ...seriesOpts, color: "#ff9f43", points: livePoints }],
        {
          ...chartOpts,
          emptyText: "Waiting for periodic eval…",
        }
      );
    }
  }
}

function populateResumeSelect() {
  const prev = resumeSelect.value;
  resumeSelect.innerHTML = '<option value="">Fresh start</option>';
  [...history].reverse().forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r.run_id;
    const score = r.score != null ? r.score.toFixed(3) : "?";
    opt.textContent = `${r.run_id} · ${r.mode} · ${score}`;
    if (r.reward_weights) {
      opt.dataset.rewardWeights = JSON.stringify(r.reward_weights);
      if (r.gated_hold != null) {
        opt.dataset.gatedHold = r.gated_hold ? "1" : "0";
      }
    }
    resumeSelect.appendChild(opt);
  });
  resumeSelect.value = BoatNavTrainForm.resolveResumeSelection(history, prev);
  syncRewardWeightsFromResume();
}

function syncRewardWeightsFromResume() {
  const opt = resumeSelect.selectedOptions[0];
  if (!opt || !opt.value) {
    applyRewardWeights(defaultRewardWeights, plantConfig?.gated_hold_default);
    return;
  }
  if (opt.dataset.rewardWeights) {
    try {
      const weights = JSON.parse(opt.dataset.rewardWeights);
      const gated =
        opt.dataset.gatedHold != null
          ? opt.dataset.gatedHold === "1"
          : plantConfig?.gated_hold_default;
      applyRewardWeights(weights, gated);
    } catch (err) {
      /* keep current form values */
    }
  }
}

function updateChartLayout() {
  const showLive = jobRunning;
  scoreChartSplit.classList.toggle("chart-split-live", showLive);
  scoreChartLivePane.classList.toggle("hidden", !showLive);
  document.querySelectorAll(".metric-chart-live, .reward-chart-live").forEach((el) => {
    el.classList.toggle("hidden", !showLive);
  });
}

function renderCharts() {
  buildMetricGrid();
  buildRewardGrid();
  updateChartLayout();

  const scorePoints = history.map((r) => ({
    y: r.score != null ? r.score * 100 : null,
    label: shortRunId(r.run_id),
  }));
  const liveScore = liveSeries.map((p) => ({
    y: p.score != null ? p.score * 100 : null,
    label: `${Math.round(p.t_sec)}s`,
  }));

  BoatNavChart.drawLineChart(
    scoreChartCompleted,
    [{ label: "Score (%)", color: BoatNavChart.COLORS.score, points: scorePoints, yMax: 100 }],
    { emptyText: "No runs yet — start training below" }
  );

  if (jobRunning) {
    BoatNavChart.drawLineChart(
      scoreChartLive,
      [{ label: "Score (%)", color: "#ff9f43", points: liveScore, yMax: 100 }],
      { emptyText: "Waiting for periodic eval…", yAutoRange: true, yFloor: 0, yMax: 100 }
    );
  }

  METRIC_CHARTS.forEach((spec) => {
    const completed = metricsGrid.querySelector(
      `.metric-chart-completed[data-key="${spec.key}"]`
    );
    const live = metricsGrid.querySelector(`.metric-chart-live[data-key="${spec.key}"]`);
    drawDualSeries(
      completed,
      live,
      historyMetricPoints(spec.key, spec.scale),
      liveMetricPoints(spec.key, spec.scale),
      spec
    );
  });

  REWARD_COMPONENTS.forEach((spec, i) => {
    const completed = rewardGrid.querySelector(
      `.reward-chart-completed[data-key="${spec.key}"]`
    );
    const live = rewardGrid.querySelector(`.reward-chart-live[data-key="${spec.key}"]`);
    const color = REWARD_COLORS[i % REWARD_COLORS.length];
    drawDualSeries(
      completed,
      live,
      historyBreakdownPoints(spec.key, spec),
      liveBreakdownPoints(spec.key, spec),
      { ...spec, color, empty: "No breakdown data (re-run eval)" }
    );
  });
}

function renderHistoryTable() {
  historyTable.innerHTML = "";
  history.forEach((r, i) => {
    const tr = document.createElement("tr");
    const notes = BoatNavApi.escapeHtml(r.notes || "");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><a href="/scenarios.html?run=${r.run_id}">${r.run_id}</a></td>
      <td>${r.mode}</td>
      <td>${r.score != null ? (r.score * 100).toFixed(1) + "%" : "—"}</td>
      <td>${r.avg_final_goal_range_m != null ? Math.round(r.avg_final_goal_range_m) : "—"}</td>
      <td>${r.train_session || 1}</td>
      <td>${notes}</td>
    `;
    tr.addEventListener("click", () => {
      resumeSelect.value = r.run_id;
      syncRewardWeightsFromResume();
    });
    tr.addEventListener("mouseenter", () => loadMontageForRun(r.run_id));
    historyTable.appendChild(tr);
  });
}

function setJobRunning(running) {
  jobRunning = running;
  startBtn.disabled = running;
  pauseBtn.disabled = !running;
  if (running) {
    startLiveLoop();
  } else {
    stopLiveLoop();
    renderCharts();
  }
}

function startLiveLoop() {
  if (animFrameId != null) return;
  let lastPoll = 0;
  const frame = (ts) => {
    if (!jobRunning) {
      animFrameId = null;
      return;
    }
    if (ts - lastPoll > 700) {
      lastPoll = ts;
      pollJobStatus();
    }
    if (ts - lastChartRender > 700) {
      lastChartRender = ts;
      renderCharts();
    }
    animFrameId = requestAnimationFrame(frame);
  };
  animFrameId = requestAnimationFrame(frame);
}

function stopLiveLoop() {
  if (animFrameId != null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

async function pollJobStatus() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const st = await fetchJson("/api/train/status");
    const running = st.running || st.state === "running" || st.state === "cancelling";
    setJobRunning(running);

    jobStatus.className = "job-status " + (running ? "running" : st.state || "idle");
    if (st.state === "cancelling") {
      jobStatus.textContent = "Pausing… finishing current step and saving checkpoint";
    } else if (running) {
      const live = st.live_elapsed_sec != null ? ` · ${st.live_elapsed_sec}s` : "";
      const sc = st.live_score != null ? ` · score=${(st.live_score * 100).toFixed(0)}%` : "";
      const succ =
        st.live_successes != null && st.live_eval_episodes
          ? ` · ${st.live_successes}/${st.live_eval_episodes} eval`
          : "";
      const dev = st.device ? ` · ${st.device}` : "";
      const jit = st.dynamics_jitter ? " · jitter" : "";
      const cur = st.current_enabled ? " · current" : "";
      const hold = st.goal_hold_sec != null ? ` · hold=${st.goal_hold_sec}s` : "";
      jobStatus.textContent = `Training… mode=${st.mode || "?"}${hold}${cur}${jit}${dev}${live}${succ}${sc}`;
    } else if (st.state === "completed") {
      jobStatus.textContent = `Completed → run ${st.run_id || "?"} score=${st.score != null ? st.score.toFixed(3) : "?"}`;
    } else if (st.state === "cancelled") {
      jobStatus.textContent = `Paused → saved run ${st.run_id || "?"} (checkpoint + eval)`;
    } else if (st.state === "failed") {
      jobStatus.textContent = `Failed (exit ${st.exit_code})`;
    } else {
      jobStatus.textContent = "Idle";
    }

    trainLog.textContent = st.log_tail || "";
    trainLog.scrollTop = trainLog.scrollHeight;

    const lm = st.live_metrics && st.live_metrics.series ? st.live_metrics.series : [];
    const hash = liveMetricsFingerprint(lm);
    if (hash !== lastLiveHash) {
      lastLiveHash = hash;
      liveSeries = lm;
    }

    if (!running && (st.state === "completed" || st.state === "cancelled") && st.run_id && st.run_id !== lastCompletedRun) {
      lastCompletedRun = st.run_id;
      liveSeries = [];
      lastLiveHash = "";
      montageRunId = null;
      await loadHistory();
      await loadMontageForRun(st.run_id);
    }
  } catch (err) {
    jobStatus.textContent = `Status error: ${err.message}`;
    jobStatus.className = "job-status failed";
  } finally {
    pollInFlight = false;
  }
}

async function startTraining(resumeRunId) {
  liveSeries = [];
  lastLiveHash = "";
  lastChartRender = 0;
  const body = getTrainingPayload(resumeRunId);
  if (body.resume_run_id === "") body.resume_run_id = null;

  startBtn.disabled = true;
  try {
    await fetchJson("/api/train", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    jobStatus.className = "job-status running";
    jobStatus.textContent = "Starting…";
    setJobRunning(true);
    pollJobStatus();
  } finally {
    if (!jobRunning) {
      startBtn.disabled = false;
    }
  }
}

async function pauseTraining() {
  pauseBtn.disabled = true;
  jobStatus.textContent = "Requesting pause…";
  try {
    await fetchJson("/api/train/cancel", { method: "POST" });
    pollJobStatus();
  } catch (err) {
    jobStatus.textContent = err.message;
    jobStatus.className = "job-status failed";
    pauseBtn.disabled = !jobRunning;
  }
}

trainForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await startTraining(resumeSelect.value || null);
  } catch (err) {
    jobStatus.textContent = err.message;
    jobStatus.className = "job-status failed";
  }
});

pauseBtn.addEventListener("click", pauseTraining);

dynamicsJitter.addEventListener("change", updatePlantPanelState);
presetNominal.addEventListener("click", () => applyPlantPreset(plantConfig?.nominal));
presetAgile.addEventListener("click", () => applyPlantPreset(plantConfig?.agile));
presetFreighter.addEventListener("click", () => applyPlantPreset(plantConfig?.freighter));
presetRewardDefaults.addEventListener("click", () => {
  applyRewardWeights(
    defaultRewardWeights || rewardWeightDefaults(),
    plantConfig?.gated_hold_default ?? true
  );
});
resumeSelect.addEventListener("change", syncRewardWeightsFromResume);
montageScrubber.addEventListener("input", renderMontageCanvas);

[
  modeSelect,
  budgetMin,
  snapshotIntervalMin,
  nEnvs,
  deviceSelect,
  dynamicsJitter,
  goalHoldSec,
  currentEnabled,
  montageEnabled,
  robustEval,
  gatedHold,
  notesInput,
  tauHeading,
  tauSpeed,
  maxYawRate,
].forEach((el) => {
  if (!el) return;
  el.addEventListener("input", markFormEdited);
  el.addEventListener("change", markFormEdited);
});
rewardWeightsGrid?.addEventListener("input", markFormEdited);

buildRewardWeightInputs();

loadPlantConfig()
  .then(() => loadTrainingPresets())
  .then(() => loadHistory())
  .then(async () => {
    try {
      const health = await BoatNavApi.checkHealth();
      const gpu = health.gpu || {};
      if (gpu.cuda_available && gpu.cuda_device) {
        statusLine.textContent = `${history.length} completed run(s) · GPU: ${gpu.cuda_device}`;
        if (deviceSelect.value === "auto") {
          deviceSelect.value = "auto";
        }
      } else if (gpu.install_hint) {
        statusLine.textContent = `${history.length} completed run(s) · CPU PyTorch (GPU: pip install -r requirements-gpu.txt)`;
      }
    } catch (err) {
      jobStatus.textContent = err.message;
      jobStatus.className = "job-status failed";
      statusLine.textContent = "Server connection failed";
      throw err;
    }
    return pollJobStatus();
  })
  .catch((err) => {
    statusLine.textContent = err.message;
  });

setInterval(() => {
  if (!jobRunning) pollJobStatus();
}, 5000);
