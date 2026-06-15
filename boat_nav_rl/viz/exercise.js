/* Interactive exercise — 3 policy instances, click goal, double-click+drag intruders */

const VESSEL_COLORS = ["#3aa6ff", "#45d483", "#ffc857"];
const INTRUDER_COLORS = {
  dinghy: "#ffb46b",
  workboat: "#ff6b6b",
  freighter: "#ff5090",
};
const GOAL_RADIUS_M = 50;
const INTRUDER_DRAG_SPEED_SCALE = 28;
const INTRUDER_STATIONARY_DRAG_M = 15;

const canvas = document.getElementById("world");
const ctx = canvas.getContext("2d");
const runSelect = document.getElementById("runSelect");
const reloadBtn = document.getElementById("reloadBtn");
const resetBtn = document.getElementById("resetBtn");
const intruderClassSelect = document.getElementById("intruderClassSelect");
const clearIntrudersBtn = document.getElementById("clearIntrudersBtn");
const speedRange = document.getElementById("speedRange");
const speedLabel = document.getElementById("speedLabel");
const runningToggle = document.getElementById("runningToggle");
const vesselStats = document.getElementById("vesselStats");
const colregsContent = document.getElementById("colregsContent");
const overlayInfo = document.getElementById("overlayInfo");
const statusLine = document.getElementById("statusLine");
const modeWaypoint = document.getElementById("modeWaypoint");
const modeIntruder = document.getElementById("modeIntruder");

let state = {
  bounds: { min_x: -1200, max_x: 1200, min_y: -900, max_y: 900 },
  goal: { x: 0, y: 0 },
  vessels: [],
  contacts: [],
  colregs: null,
  trails: [[], [], []],
  running: true,
  stepping: false,
  lastFrame: 0,
  accum: 0,
};

let intruderDraft = null;
let suppressNextClick = false;

function isIntruderMode() {
  return modeIntruder.checked;
}

function syncMapModeUi() {
  canvas.classList.toggle("intruder-mode", isIntruderMode());
  canvas.classList.toggle("waypoint-mode", !isIntruderMode());
  if (intruderDraft) return;
  overlayInfo.textContent = isIntruderMode()
    ? "Click+drag on map to spawn intruder (short drag = stationary)"
    : "Click map to set waypoint";
}

function fetchJson(url, opts) {
  return BoatNavApi.fetchJson(url, opts);
}

function worldToScreen(x, y) {
  const b = state.bounds;
  const sx = ((x - b.min_x) / (b.max_x - b.min_x)) * canvas.width;
  const sy = canvas.height - ((y - b.min_y) / (b.max_y - b.min_y)) * canvas.height;
  return [sx, sy];
}

function screenToWorld(sx, sy) {
  const b = state.bounds;
  return {
    x: b.min_x + (sx / canvas.width) * (b.max_x - b.min_x),
    y: b.min_y + (1 - sy / canvas.height) * (b.max_y - b.min_y),
  };
}

function eventToWorld(ev) {
  const rect = canvas.getBoundingClientRect();
  const sx = ((ev.clientX - rect.left) / rect.width) * canvas.width;
  const sy = ((ev.clientY - rect.top) / rect.height) * canvas.height;
  return screenToWorld(sx, sy);
}

function velocityFromDrag(anchor, tip) {
  const dx = tip.x - anchor.x;
  const dy = tip.y - anchor.y;
  const dist = Math.hypot(dx, dy);
  if (dist < INTRUDER_STATIONARY_DRAG_M) {
    return { cog_deg: 0, sog_mps: 0 };
  }
  const cog_rad = Math.atan2(dx, dy);
  const sog_mps = Math.min(8, dist / INTRUDER_DRAG_SPEED_SCALE);
  return { cog_deg: (cog_rad * 180) / Math.PI, sog_mps };
}

function applyPayload(data) {
  if (data.bounds) state.bounds = data.bounds;
  if (data.goal) state.goal = data.goal;
  if (data.contacts) state.contacts = data.contacts;
  if (data.colregs) state.colregs = data.colregs;
  if (data.vessels) {
    data.vessels.forEach((v, i) => {
      const trail = state.trails[i] || (state.trails[i] = []);
      const last = trail[trail.length - 1];
      if (!last || last.x !== v.x || last.y !== v.y) {
        trail.push({ x: v.x, y: v.y });
        if (trail.length > 400) trail.shift();
      }
    });
    state.vessels = data.vessels;
  }
  renderStats();
  renderColregs();
  renderFrame();
}

function renderColregs() {
  ColregsPanel.renderColregsPanel(colregsContent, state.colregs, {
    showLive: true,
    emptyText: "Spawn intruders to see COLREGS safety (S) and protocol (R) scores.",
  });
}

async function loadRuns() {
  const data = await fetchJson("/api/runs");
  runSelect.innerHTML = "";
  for (const run of data.runs) {
    const opt = document.createElement("option");
    opt.value = run.id;
    const score = run.score != null ? (run.score * 100).toFixed(0) + "%" : "?";
    opt.textContent = `${run.id.slice(9)} · ${run.mode} · ${score}`;
    runSelect.appendChild(opt);
  }
  const target = new URLSearchParams(window.location.search).get("run") || data.latest;
  if (target && [...runSelect.options].some((o) => o.value === target)) {
    runSelect.value = target;
  }
}

async function initExercise() {
  overlayInfo.textContent = "Loading model…";
  await BoatNavApi.loadSimConstants().catch(() => {});
  state.trails = [[], [], []];
  state.contacts = [];
  const data = await fetchJson("/api/exercise/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_id: runSelect.value }),
  });
  applyPayload(data);
  syncMapModeUi();
  statusLine.textContent = `Model ${data.run_id} · ${data.mode}`;
}

async function setGoal(x, y) {
  const data = await fetchJson("/api/exercise/goal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x_m: x, y_m: y }),
  });
  applyPayload(data);
}

async function addIntruder(x, y, cog_deg, sog_mps) {
  const data = await fetchJson("/api/exercise/intruder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      x_m: x,
      y_m: y,
      cog_deg,
      sog_mps,
      vessel_class: intruderClassSelect.value,
    }),
  });
  applyPayload(data);
}

async function clearIntruders() {
  const data = await fetchJson("/api/exercise/intruders/clear", { method: "POST" });
  applyPayload(data);
  syncMapModeUi();
}

async function stepSim(steps) {
  if (state.stepping) return;
  state.stepping = true;
  try {
    const data = await fetchJson("/api/exercise/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps }),
    });
    applyPayload(data);
  } finally {
    state.stepping = false;
  }
}

async function resetVessels() {
  const data = await fetchJson("/api/exercise/reset", { method: "POST" });
  state.trails = [[], [], []];
  applyPayload(data);
}

function renderStats() {
  const contactLine =
    state.contacts.length > 0
      ? `<dt>Intruders</dt><dd>${state.contacts.length} active</dd>`
      : "";
  vesselStats.innerHTML =
    contactLine +
    state.vessels
      .map(
        (v, i) => `
      <dt>Vessel ${String.fromCharCode(65 + i)}</dt>
      <dd>
        ${Math.round(v.goal_range_m)} m to goal
        ${v.in_goal_zone ? " · in zone" : ""}
        ${v.goal_hold_steps > 0 ? ` · hold ${v.goal_hold_steps}/${v.goal_hold_required}s` : ""}
        · ${v.speed.toFixed(1)} m/s
      </dd>`
      )
      .join("");
}

function drawGrid() {
  ctx.fillStyle = "#08101c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#152033";
  ctx.lineWidth = 1;
  const b = state.bounds;
  const step = 200;
  for (let x = Math.floor(b.min_x / step) * step; x <= b.max_x; x += step) {
    const [sx] = worldToScreen(x, 0);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, canvas.height);
    ctx.stroke();
  }
  for (let y = Math.floor(b.min_y / step) * step; y <= b.max_y; y += step) {
    const [, sy] = worldToScreen(0, y);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(canvas.width, sy);
    ctx.stroke();
  }
}

function drawTrail(trail, color) {
  if (trail.length < 2) return;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let [sx, sy] = worldToScreen(trail[0].x, trail[0].y);
  ctx.moveTo(sx, sy);
  for (let i = 1; i < trail.length; i++) {
    [sx, sy] = worldToScreen(trail[i].x, trail[i].y);
    ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawIntruder(c, { preview = false } = {}) {
  const color = INTRUDER_COLORS[c.vessel_class] || INTRUDER_COLORS.workboat;
  const [sx, sy] = worldToScreen(c.x, c.y);
  const [sx2] = worldToScreen(c.x + c.radius_m, c.y);
  const radPx = Math.max(4, Math.abs(sx2 - sx));
  ctx.strokeStyle = color;
  ctx.fillStyle = preview ? "rgba(255,107,107,0.15)" : "rgba(255,107,107,0.25)";
  ctx.lineWidth = preview ? 2 : 1.5;
  ctx.setLineDash(preview ? [6, 4] : []);
  ctx.beginPath();
  ctx.arc(sx, sy, radPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);

  if (c.sog_mps > 0.15) {
    const cog = (c.cog_deg * Math.PI) / 180;
    const len = Math.min(80, c.sog_mps * 18);
    const ex = c.x + len * Math.sin(cog);
    const ey = c.y + len * Math.cos(cog);
    const [tx, ty] = worldToScreen(ex, ey);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }
}

function drawVessel(v, color) {
  const [sx, sy] = worldToScreen(v.x, v.y);
  const ex = v.x + 45 * Math.sin(v.heading);
  const ey = v.y + 45 * Math.cos(v.heading);
  const [tx, ty] = worldToScreen(ex, ey);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(sx, sy, 8, 0, Math.PI * 2);
  ctx.fill();
}

function drawGoal() {
  const g = state.goal;
  const [gx, gy] = worldToScreen(g.x, g.y);
  const [gx2] = worldToScreen(g.x + GOAL_RADIUS_M, g.y);
  const rad = Math.abs(gx2 - gx);
  ctx.strokeStyle = "#45d483";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(gx, gy, rad, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#45d483";
  ctx.beginPath();
  ctx.arc(gx, gy, 6, 0, Math.PI * 2);
  ctx.fill();
}

function renderFrame() {
  drawGrid();
  state.contacts.forEach((c) => drawIntruder(c));
  if (intruderDraft) {
    const vel = velocityFromDrag(intruderDraft.anchor, intruderDraft.tip);
    drawIntruder(
      {
        x: intruderDraft.anchor.x,
        y: intruderDraft.anchor.y,
        radius_m:
          (BoatNavApi.getSimConstants().vessel_classes || {})[intruderClassSelect.value] || 15,
        vessel_class: intruderClassSelect.value,
        cog_deg: vel.cog_deg,
        sog_mps: vel.sog_mps,
      },
      { preview: true }
    );
  }
  state.vessels.forEach((v, i) => {
    drawTrail(state.trails[i], VESSEL_COLORS[i]);
    drawVessel(v, VESSEL_COLORS[i]);
  });
  drawGoal();
}

function tick(ts) {
  requestAnimationFrame(tick);
  if (intruderDraft) {
    renderFrame();
  }
  if (!state.running || !state.lastFrame) {
    state.lastFrame = ts;
    return;
  }
  const dt = ts - state.lastFrame;
  state.lastFrame = ts;
  if (!runningToggle.checked) return;

  const speed = parseInt(speedRange.value, 10);
  speedLabel.textContent = `${speed}×`;
  state.accum += dt;
  const msPerStep = 1000 / speed;
  if (!state.stepping && !intruderDraft && state.accum >= msPerStep) {
    state.accum -= msPerStep;
    stepSim(1);
  }
}

function finishIntruderDraft() {
  if (!intruderDraft) return;
  const vel = velocityFromDrag(intruderDraft.anchor, intruderDraft.tip);
  const anchor = intruderDraft.anchor;
  intruderDraft = null;
  window.removeEventListener("mousemove", onIntruderDragMove);
  window.removeEventListener("mouseup", onIntruderDragEnd);
  addIntruder(anchor.x, anchor.y, vel.cog_deg, vel.sog_mps)
    .then(() => {
      const label = vel.sog_mps < 0.15 ? "stationary" : `${vel.sog_mps.toFixed(1)} m/s @ ${Math.round(vel.cog_deg)}°`;
      overlayInfo.textContent = `Intruder placed (${label})`;
    })
    .catch((err) => {
      overlayInfo.textContent = err.message;
    });
}

function onIntruderDragMove(ev) {
  if (!intruderDraft) return;
  intruderDraft.tip = eventToWorld(ev);
  renderFrame();
}

function onIntruderDragEnd() {
  finishIntruderDraft();
  suppressNextClick = true;
  window.setTimeout(() => {
    suppressNextClick = false;
  }, 0);
}

canvas.addEventListener("mousedown", (ev) => {
  if (!isIntruderMode() || ev.button !== 0 || intruderDraft) return;
  ev.preventDefault();
  intruderDraft = { anchor: eventToWorld(ev), tip: eventToWorld(ev) };
  overlayInfo.textContent = "Drag to set course & speed";
  window.addEventListener("mousemove", onIntruderDragMove);
  window.addEventListener("mouseup", onIntruderDragEnd);
  renderFrame();
});

canvas.addEventListener("click", (ev) => {
  if (suppressNextClick || intruderDraft || isIntruderMode()) return;
  const { x, y } = eventToWorld(ev);
  setGoal(x, y).catch((err) => {
    overlayInfo.textContent = err.message;
  });
});

modeWaypoint.addEventListener("change", syncMapModeUi);
modeIntruder.addEventListener("change", syncMapModeUi);

reloadBtn.addEventListener("click", () => initExercise().catch((e) => (statusLine.textContent = e.message)));
resetBtn.addEventListener("click", () => resetVessels().catch((e) => (statusLine.textContent = e.message)));
clearIntrudersBtn.addEventListener("click", () =>
  clearIntruders().catch((e) => (overlayInfo.textContent = e.message))
);
runSelect.addEventListener("change", () => initExercise().catch((e) => (statusLine.textContent = e.message)));
speedRange.addEventListener("input", () => {
  speedLabel.textContent = `${speedRange.value}×`;
});

loadRuns()
  .then(() => initExercise())
  .then(() => {
    syncMapModeUi();
    return requestAnimationFrame(tick);
  })
  .catch((err) => {
    statusLine.textContent = err.message;
    overlayInfo.textContent = err.message;
  });
