/* Training page */

const trainForm = document.getElementById("trainForm");
const modeSelect = document.getElementById("modeSelect");
const budgetMin = document.getElementById("budgetMin");
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

let history = [];
let lastCompletedRun = null;
let liveSeries = [];
let jobRunning = false;
let lastLiveHash = "";
let pollInFlight = false;
let animFrameId = null;

let plantConfig = null;
let montageEpisodes = [];
let montageRunId = null;

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

function readPlantFromForm() {
  return {
    tau_heading_s: parseFloat(tauHeading.value),
    tau_speed_s: parseFloat(tauSpeed.value),
    max_yaw_rate_deg_s: parseFloat(maxYawRate.value),
  };
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
  if (plantConfig.goal_hold_sec_default != null) {
    goalHoldSec.value = plantConfig.goal_hold_sec_default;
  }
  if (plantConfig.default_mode) {
    modeSelect.value = plantConfig.default_mode;
  }
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
  return {
    mode: modeSelect.value,
    budget_sec: Math.round(parseFloat(budgetMin.value) * 60),
    n_envs: parseInt(nEnvs.value, 10),
    device: deviceSelect.value,
    dynamics_jitter: dynamicsJitter.checked,
    robust_eval_enabled: robustEval.checked,
    goal_hold_sec: parseInt(goalHoldSec.value, 10) || 0,
    current_enabled: currentEnabled.checked,
    montage_enabled: montageEnabled.checked,
    plant: readPlantFromForm(),
    resume_run_id: resumeRunId || null,
    notes: notesInput.value.trim(),
  };
}

async function fetchJson(url, opts) {
  return BoatNavApi.fetchJson(url, opts);
}

function shortRunId(id) {
  if (!id) return "—";
  return id.length > 15 ? id.slice(9) : id;
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
  try {
    const data = await fetchJson(`/api/runs/${runId}`);
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
    renderMontageCanvas();
  } catch (err) {
    montageMeta.textContent = `Montage unavailable: ${err.message}`;
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
  if (raw == null) return null;
  if (spec?.penalty) return -raw;
  return raw;
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
    resumeSelect.appendChild(opt);
  });
  if (prev && [...resumeSelect.options].some((o) => o.value === prev)) {
    resumeSelect.value = prev;
  } else if (history.length) {
    resumeSelect.value = history[history.length - 1].run_id;
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
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><a href="/scenarios.html?run=${r.run_id}">${r.run_id}</a></td>
      <td>${r.mode}</td>
      <td>${r.score != null ? (r.score * 100).toFixed(1) + "%" : "—"}</td>
      <td>${r.avg_final_goal_range_m != null ? Math.round(r.avg_final_goal_range_m) : "—"}</td>
      <td>${r.train_session || 1}</td>
      <td>${r.notes || ""}</td>
    `;
    tr.addEventListener("click", () => {
      resumeSelect.value = r.run_id;
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
    renderCharts();
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
    const hash = JSON.stringify(lm);
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
  const body = getTrainingPayload(resumeRunId);
  if (body.resume_run_id === "") body.resume_run_id = null;

  await fetchJson("/api/train", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  jobStatus.className = "job-status running";
  jobStatus.textContent = "Starting…";
  setJobRunning(true);
  pollJobStatus();
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
montageScrubber.addEventListener("input", renderMontageCanvas);

loadPlantConfig()
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
