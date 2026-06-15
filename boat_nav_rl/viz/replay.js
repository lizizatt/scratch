/* Boat Nav RL replay viewer */

const canvas = document.getElementById("world");
const ctx = canvas.getContext("2d");
const runSelect = document.getElementById("runSelect");
const episodeSelect = document.getElementById("episodeSelect");
const metricsList = document.getElementById("metricsList");
const colregsContent = document.getElementById("colregsContent");
const playBtn = document.getElementById("playBtn");
const scrubber = document.getElementById("scrubber");
const stepLabel = document.getElementById("stepLabel");
const rangeLabel = document.getElementById("rangeLabel");
const speedRange = document.getElementById("speedRange");
const speedLabel = document.getElementById("speedLabel");
const overlayInfo = document.getElementById("overlayInfo");
const statusLine = document.getElementById("statusLine");
const refreshBtn = document.getElementById("refreshBtn");
const autoRefresh = document.getElementById("autoRefresh");

let state = {
  runId: null,
  metrics: null,
  episodes: [],
  episodeIndex: 0,
  frameIndex: 0,
  playing: false,
  lastFrameTime: 0,
  bounds: null,
  frameColregs: [],
  frameColregsLoading: false,
};

function queryRunFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("run");
}

function queryEpisodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const ep = params.get("episode");
  return ep != null ? parseInt(ep, 10) : null;
}

async function fetchJson(url, opts) {
  return BoatNavApi.fetchJson(url, opts);
}

async function loadRuns(selectRunId) {
  const data = await fetchJson("/api/runs");
  runSelect.innerHTML = "";
  for (const run of data.runs) {
    const opt = document.createElement("option");
    opt.value = run.id;
    const score = run.score != null ? run.score.toFixed(3) : "?";
    opt.textContent = `${run.id} · ${run.mode} · ${score} · ${run.notes || ""}`;
    runSelect.appendChild(opt);
  }
  const target = selectRunId || queryRunFromUrl() || data.latest;
  if (target && [...runSelect.options].some((o) => o.value === target)) {
    runSelect.value = target;
  } else if (runSelect.options.length) {
    runSelect.selectedIndex = 0;
  }
  if (runSelect.value) await loadRun(runSelect.value);
}

async function loadRun(runId) {
  statusLine.textContent = `Loading ${runId}…`;
  const data = await fetchJson(`/api/runs/${runId}`);
  state.runId = runId;
  state.metrics = data.metrics;
  state.episodes = data.traces.episodes || [];
  state.episodeIndex = 0;
  state.frameIndex = 0;
  state.playing = false;
  playBtn.textContent = "Play";

  const epFromUrl = queryEpisodeFromUrl();
  const epIndex =
    epFromUrl != null && epFromUrl >= 0 && epFromUrl < state.episodes.length ? epFromUrl : 0;
  state.episodeIndex = epIndex;
  state.frameIndex = 0;

  const url = epIndex > 0 ? `?run=${runId}&episode=${epIndex}` : `?run=${runId}`;
  history.replaceState(null, "", url);
  renderMetrics();
  populateEpisodes(epIndex);
  computeBounds();
  renderFrame();
  loadEpisodeFrameColregs();
  statusLine.textContent = `Loaded run ${runId} · ${state.episodes.length} eval episodes`;
}

function populateEpisodes(selectedIndex = 0) {
  episodeSelect.innerHTML = "";
  state.episodes.forEach((ep, i) => {
    const opt = document.createElement("option");
    const ok = ep.success ? "✓" : "✗";
    const col = ep.collision ? " COLL" : "";
    opt.value = String(i);
    opt.textContent = `${i + 1}. ${ep.scenario_name || "episode"} ${ok}${col} · ${Math.round(ep.final_goal_range_m || 0)}m`;
    episodeSelect.appendChild(opt);
  });
  const idx = Math.max(0, Math.min(selectedIndex, state.episodes.length - 1));
  episodeSelect.value = String(idx);
}

function renderMetrics() {
  const m = state.metrics || {};
  const scoreKey = m.mode === "navigate" ? "nav_score" : "avoid_score";
  const score = m[scoreKey];
  const rows = [
    ["Mode", m.mode],
    ["Score", score != null ? score.toFixed(3) : "—"],
    ["Success rate", fmtPct(m.success_rate)],
    ["Collision rate", fmtPct(m.collision_rate)],
    ["Energy score", m.mean_energy_score != null ? Number(m.mean_energy_score).toFixed(3) : "—"],
    ["COLREGS mean S", m.colregs_mean_safety != null ? `${Number(m.colregs_mean_safety).toFixed(1)}%` : "—"],
    ["COLREGS mean R", m.colregs_mean_protocol != null ? `${Number(m.colregs_mean_protocol).toFixed(1)}%` : "—"],
    ["Eval episodes", m.eval_episodes],
    ["Train time", m.train_elapsed_sec != null ? `${m.train_elapsed_sec}s` : "—"],
    ["Notes", m.notes || "—"],
  ];
  metricsList.innerHTML = rows
    .map(
      ([k, v]) =>
        `<dt>${k}</dt><dd class="${k === "Score" && score >= 0.7 ? "score-good" : ""}">${v}</dd>`
    )
    .join("");
}

function fmtPct(v) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function renderColregsForEpisode() {
  const ep = currentEpisode();
  const colregs = ep.colregs;
  if (!colregs || !colregs.encounters?.length) {
    ColregsPanel.renderColregsPanel(colregsContent, null, {
      emptyText: "No contacts in this episode.",
    });
    return;
  }
  const frameRow = ColregsPanel.nearestFrameScore(state.frameColregs, state.frameIndex);
  const merged = frameRow
    ? {
        ...colregs,
        mean_safety_S: frameRow.mean_safety_S ?? colregs.mean_safety_S,
        mean_protocol_R: frameRow.mean_protocol_R ?? colregs.mean_protocol_R,
        min_safety_S: frameRow.min_safety_S ?? colregs.min_safety_S,
        by_rule: frameRow.by_rule || colregs.by_rule,
        encounters: frameRow.encounters?.length ? frameRow.encounters : colregs.encounters,
        live: frameRow.live,
      }
    : colregs;
  ColregsPanel.renderColregsPanel(colregsContent, merged, {
    title: frameRow ? `COLREGS · step ${state.frameIndex}` : "COLREGS · episode",
    showLive: Boolean(frameRow?.live?.live_contacts?.length),
  });
}

async function loadEpisodeFrameColregs() {
  const ep = currentEpisode();
  const steps = ep.steps || [];
  state.frameColregs = [];
  if (!steps.length || !(steps[0].contacts || []).length) {
    renderColregsForEpisode();
    return;
  }
  state.frameColregsLoading = true;
  renderColregsForEpisode();
  try {
    const data = await fetchJson("/api/colregs/frames", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        steps,
        scenario_category: ep.scenario_category || "",
      }),
    });
    state.frameColregs = data.frames || [];
  } catch (err) {
    console.warn("COLREGS frame series failed", err);
  } finally {
    state.frameColregsLoading = false;
    renderColregsForEpisode();
  }
}

function currentEpisode() {
  return state.episodes[state.episodeIndex] || { steps: [] };
}

function computeBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ep of state.episodes) {
    for (const step of ep.steps) {
      const pts = [step.own, step.goal, ...(step.contacts || [])];
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
  }
  const pad = 120;
  if (!Number.isFinite(minX)) {
    state.bounds = { minX: -500, maxX: 500, minY: -500, maxY: 500 };
    return;
  }
  state.bounds = {
    minX: minX - pad,
    maxX: maxX + pad,
    minY: minY - pad,
    maxY: maxY + pad,
  };
}

function worldToScreen(x, y) {
  const b = state.bounds;
  const w = canvas.width;
  const h = canvas.height;
  const sx = ((x - b.minX) / (b.maxX - b.minX)) * w;
  const sy = h - ((y - b.minY) / (b.maxY - b.minY)) * h;
  return [sx, sy];
}

function drawGrid() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#08101c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#152033";
  ctx.lineWidth = 1;
  const b = state.bounds;
  const step = 200;
  for (let x = Math.floor(b.minX / step) * step; x <= b.maxX; x += step) {
    const [sx] = worldToScreen(x, 0);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, canvas.height);
    ctx.stroke();
  }
  for (let y = Math.floor(b.minY / step) * step; y <= b.maxY; y += step) {
    const [, sy] = worldToScreen(0, y);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(canvas.width, sy);
    ctx.stroke();
  }
}

function drawCircle(x, y, rM, color, fillAlpha = 0.15) {
  const [sx, sy] = worldToScreen(x, y);
  const [sx2] = worldToScreen(x + rM, y);
  const rad = Math.abs(sx2 - sx);
  ctx.beginPath();
  ctx.arc(sx, sy, rad, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = color.replace(")", `, ${fillAlpha})`).replace("rgb", "rgba");
  if (color.startsWith("#")) {
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = color;
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawHeadingArrow(x, y, heading, lengthM, color) {
  const [sx, sy] = worldToScreen(x, y);
  const ex = x + lengthM * Math.sin(heading);
  const ey = y + lengthM * Math.cos(heading);
  const [tx, ty] = worldToScreen(ex, ey);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
}

function drawTrail(steps, idx) {
  if (idx < 1) return;
  ctx.strokeStyle = "rgba(107, 124, 255, 0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const first = steps[0].own;
  let [sx, sy] = worldToScreen(first.x, first.y);
  ctx.moveTo(sx, sy);
  for (let i = 1; i <= idx; i++) {
    const p = steps[i].own;
    [sx, sy] = worldToScreen(p.x, p.y);
    ctx.lineTo(sx, sy);
  }
  ctx.stroke();
}

function renderFrame() {
  const ep = currentEpisode();
  const steps = ep.steps || [];
  const idx = Math.min(state.frameIndex, Math.max(steps.length - 1, 0));
  const step = steps[idx] || null;

  drawGrid();
  if (!step) return;

  drawTrail(steps, idx);

  // Goal
  const [gx, gy] = worldToScreen(step.goal.x, step.goal.y);
  ctx.fillStyle = "#45d483";
  ctx.beginPath();
  ctx.arc(gx, gy, 8, 0, Math.PI * 2);
  ctx.fill();
  drawCircle(step.goal.x, step.goal.y, BoatNavApi.getSimConstants().goal_success_range_m || 50, "#45d483", 0.08);

  // Contacts
  const ownRadiusM = BoatNavApi.getSimConstants().own_radius_m || 15;
  for (const c of step.contacts || []) {
    const contactRadiusM = c.radius_m || ownRadiusM;
    drawCircle(c.x, c.y, contactRadiusM, "#ff6b6b", 0.12);
    drawCircle(c.x, c.y, BoatNavApi.cpaSafeRadiusM(c, ownRadiusM), "#ffc857", 0.05);
    drawHeadingArrow(c.x, c.y, c.cog, 40, "#ff9f9f");
    const [cx, cy] = worldToScreen(c.x, c.y);
    ctx.fillStyle = "#ff6b6b";
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Own ship
  drawCircle(step.own.x, step.own.y, ownRadiusM, "#3aa6ff", 0.15);
  drawHeadingArrow(step.own.x, step.own.y, step.own.heading, 50, "#3aa6ff");
  drawHeadingArrow(step.own.x, step.own.y, step.own.cmd_heading, 35, "#9fd4ff");
  const [ox, oy] = worldToScreen(step.own.x, step.own.y);
  ctx.fillStyle = "#3aa6ff";
  ctx.beginPath();
  ctx.arc(ox, oy, 7, 0, Math.PI * 2);
  ctx.fill();

  scrubber.max = String(Math.max(steps.length - 1, 0));
  scrubber.value = String(idx);
  stepLabel.textContent = `Step ${idx} / ${Math.max(steps.length - 1, 0)} · t=${step.t}s`;
  const minR = step.min_range_m != null ? `${Math.round(step.min_range_m)} m` : "∞";
  rangeLabel.textContent = `goal ${Math.round(step.goal_range_m)} m · nearest ${minR}`;

  overlayInfo.innerHTML = `
    <strong>${ep.scenario_name || "episode"}</strong><br/>
    SOG ${step.own.speed.toFixed(1)} m/s · ψ ${radToDeg(step.own.heading).toFixed(0)}°<br/>
    cmd ψ ${radToDeg(step.own.cmd_heading).toFixed(0)}° · cmd V ${step.own.cmd_speed.toFixed(1)} m/s<br/>
    ${ep.collision ? '<span class="score-bad">COLLISION</span>' : ep.success ? '<span class="score-good">SUCCESS</span>' : "in progress"}
  `;
  renderColregsForEpisode();
}

function radToDeg(r) {
  return (r * 180) / Math.PI;
}

function tick(ts) {
  if (state.playing) {
    const speed = parseFloat(speedRange.value);
    const interval = 1000 / (10 * speed);
    if (ts - state.lastFrameTime >= interval) {
      const ep = currentEpisode();
      const max = (ep.steps || []).length - 1;
      if (state.frameIndex >= max) {
        state.playing = false;
        playBtn.textContent = "Play";
      } else {
        state.frameIndex += 1;
        renderFrame();
      }
      state.lastFrameTime = ts;
    }
    requestAnimationFrame(tick);
  }
}

playBtn.addEventListener("click", () => {
  state.playing = !state.playing;
  playBtn.textContent = state.playing ? "Pause" : "Play";
  if (state.playing) {
    state.lastFrameTime = performance.now();
    requestAnimationFrame(tick);
  }
});

scrubber.addEventListener("input", () => {
  state.frameIndex = parseInt(scrubber.value, 10);
  renderFrame();
});

episodeSelect.addEventListener("change", () => {
  state.episodeIndex = parseInt(episodeSelect.value, 10);
  state.frameIndex = 0;
  state.frameColregs = [];
  const url =
    state.episodeIndex > 0
      ? `?run=${state.runId}&episode=${state.episodeIndex}`
      : `?run=${state.runId}`;
  history.replaceState(null, "", url);
  renderFrame();
  loadEpisodeFrameColregs();
});

runSelect.addEventListener("change", () => loadRun(runSelect.value));

refreshBtn.addEventListener("click", () => loadRuns(state.runId));

speedRange.addEventListener("input", () => {
  speedLabel.textContent = `${speedRange.value}×`;
});

setInterval(async () => {
  if (!autoRefresh.checked) return;
  try {
    const data = await fetchJson("/api/runs");
    if (data.latest && data.latest !== state.runId) {
      await loadRuns(data.latest);
    }
  } catch (_) {
    /* ignore polling errors */
  }
}, 5000);

loadRuns(queryRunFromUrl()).catch((err) => {
  statusLine.textContent = `Error: ${err.message}. Run train.py first.`;
});

BoatNavApi.loadSimConstants().catch(() => {});
