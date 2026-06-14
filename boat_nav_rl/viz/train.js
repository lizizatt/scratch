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
const goalChartSplit = document.getElementById("goalChartSplit");
const scoreChartSplit = document.getElementById("scoreChartSplit");
const goalChartLivePane = document.getElementById("goalChartLivePane");
const scoreChartLivePane = document.getElementById("scoreChartLivePane");
const goalRangeChartCompleted = document.getElementById("goalRangeChartCompleted");
const goalRangeChartLive = document.getElementById("goalRangeChartLive");
const scoreChartCompleted = document.getElementById("scoreChartCompleted");
const scoreChartLive = document.getElementById("scoreChartLive");
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
  goalChartSplit.classList.toggle("chart-split-live", showLive);
  scoreChartSplit.classList.toggle("chart-split-live", showLive);
  goalChartLivePane.classList.toggle("hidden", !showLive);
  scoreChartLivePane.classList.toggle("hidden", !showLive);
}

function renderCharts() {
  updateChartLayout();

  const goalPoints = history.map((r) => ({
    y: r.avg_final_goal_range_m,
    label: shortRunId(r.run_id),
  }));
  const scorePoints = history.map((r) => ({
    y: r.score != null ? r.score * 100 : null,
    label: shortRunId(r.run_id),
  }));

  const liveGoal = liveSeries.map((p) => ({
    y: p.avg_final_goal_range_m,
    label: `${Math.round(p.t_sec)}s`,
  }));
  const liveScore = liveSeries.map((p) => ({
    y: p.score != null ? p.score * 100 : null,
    label: `${Math.round(p.t_sec)}s`,
  }));

  BoatNavChart.drawLineChart(
    goalRangeChartCompleted,
    [
      {
        label: "Avg goal (m)",
        color: BoatNavChart.COLORS.goalRange,
        points: goalPoints,
      },
    ],
    { emptyText: "No runs yet — start training below" }
  );

  BoatNavChart.drawLineChart(
    scoreChartCompleted,
    [
      {
        label: "Score (%)",
        color: BoatNavChart.COLORS.score,
        points: scorePoints,
        yMax: 100,
      },
    ],
    { emptyText: "No runs yet" }
  );

  if (jobRunning) {
    BoatNavChart.drawLineChart(
      goalRangeChartLive,
      [
        {
          label: "Avg goal (m)",
          color: "#ff9f43",
          points: liveGoal,
        },
      ],
      { emptyText: "Waiting for first mini-eval (~20s)…", yAutoRange: true, yFloor: 0 }
    );
    BoatNavChart.drawLineChart(
      scoreChartLive,
      [
        {
          label: "Score (%)",
          color: "#ff9f43",
          points: liveScore,
        },
      ],
      { emptyText: "Waiting for first mini-eval (~20s)…", yAutoRange: true, yFloor: 0, yMax: 100 }
    );
  }
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
