/* Scenario overview — thumbnail grid of full eval trajectories */

const runSelect = document.getElementById("runSelect");
const filterSelect = document.getElementById("filterSelect");
const categorySelect = document.getElementById("categorySelect");
const refreshBtn = document.getElementById("refreshBtn");
const scenarioGrid = document.getElementById("scenarioGrid");
const emptyState = document.getElementById("emptyState");
const statusLine = document.getElementById("statusLine");

const statTotal = document.getElementById("statTotal");
const statSuccess = document.getElementById("statSuccess");
const statCollision = document.getElementById("statCollision");
const statScore = document.getElementById("statScore");
const statNotes = document.getElementById("statNotes");

let state = {
  runId: null,
  metrics: null,
  episodes: [],
  catalog: [],
};

function queryRunFromUrl() {
  return new URLSearchParams(window.location.search).get("run");
}

async function fetchJson(url) {
  return BoatNavApi.fetchJson(url);
}

async function loadCatalog() {
  try {
    const data = await fetchJson("/api/scenarios");
    state.catalog = data.scenarios || [];
  } catch (_) {
    state.catalog = [];
  }
}

async function loadRuns(selectRunId) {
  const data = await fetchJson("/api/runs");
  runSelect.innerHTML = "";
  for (const run of data.runs) {
    const opt = document.createElement("option");
    opt.value = run.id;
    const score = run.score != null ? run.score.toFixed(3) : "?";
    opt.textContent = `${run.id} · ${run.mode} · ${score}`;
    runSelect.appendChild(opt);
  }
  const target = selectRunId || queryRunFromUrl() || data.latest;
  if (target && [...runSelect.options].some((o) => o.value === target)) {
    runSelect.value = target;
  } else if (runSelect.options.length) {
    runSelect.selectedIndex = 0;
  }
  if (runSelect.value) await loadRun(runSelect.value);
  else {
    statusLine.textContent = "No training runs yet — run train.py first.";
    scenarioGrid.innerHTML = "";
  }
}

async function loadRun(runId) {
  statusLine.textContent = `Loading ${runId}…`;
  const data = await fetchJson(`/api/runs/${runId}`);
  state.runId = runId;
  state.metrics = data.metrics;
  state.episodes = data.traces?.episodes || [];
  history.replaceState(null, "", `?run=${runId}`);
  populateCategories();
  renderSummary();
  renderGrid();
  statusLine.textContent = `${state.episodes.length} scenarios · run ${runId}`;
}

function populateCategories() {
  const cats = new Set(state.episodes.map((e) => e.scenario_category || "uncategorized"));
  categorySelect.innerHTML = '<option value="all">All categories</option>';
  [...cats].sort().forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    categorySelect.appendChild(opt);
  });
}

function renderSummary() {
  const m = state.metrics || {};
  const total = state.episodes.length;
  const successes = state.episodes.filter((e) => e.success).length;
  const collisions = state.episodes.filter((e) => e.collision).length;
  const scoreKey = m.mode === "navigate" ? "nav_score" : "avoid_score";
  const score = m[scoreKey];

  statTotal.textContent = String(total);
  statSuccess.textContent = `${successes} (${total ? ((100 * successes) / total).toFixed(0) : 0}%)`;
  statCollision.textContent = `${collisions} (${total ? ((100 * collisions) / total).toFixed(0) : 0}%)`;
  statScore.textContent = score != null ? score.toFixed(3) : "—";
  statNotes.textContent = m.notes || "—";
  statNotes.title = m.notes || "";
}

function filteredEpisodes() {
  const filter = filterSelect.value;
  const cat = categorySelect.value;
  return state.episodes
    .map((ep, idx) => ({ ep, idx }))
    .filter(({ ep }) => {
      if (cat !== "all" && (ep.scenario_category || "uncategorized") !== cat) return false;
      if (filter === "success" && !ep.success) return false;
      if (filter === "failure" && ep.success) return false;
      if (filter === "collision" && !ep.collision) return false;
      return true;
    });
}

function outcomeBadge(ep) {
  if (ep.collision) return '<span class="badge bad">Collision</span>';
  if (ep.success) return '<span class="badge good">Success</span>';
  return '<span class="badge">Incomplete</span>';
}

function renderGrid() {
  const items = filteredEpisodes();
  scenarioGrid.innerHTML = "";
  emptyState.classList.toggle("hidden", items.length > 0);

  for (const { ep, idx } of items) {
    const card = document.createElement("article");
    card.className = "scenario-card";
    const name = BoatNavApi.escapeHtml(ep.scenario_name || `episode ${idx + 1}`);
    const category = BoatNavApi.escapeHtml(ep.scenario_category || "—");
    const desc = BoatNavApi.escapeHtml(ep.scenario_description || "");
    card.innerHTML = `
      <canvas width="320" height="220"></canvas>
      <div class="card-body">
        <div class="card-title">${name}</div>
        <div class="card-meta">
          <span class="tag">${category}</span>
          ${outcomeBadge(ep)}
        </div>
        <p class="card-desc">${desc}</p>
        <div class="card-stats">
          goal ${Math.round(ep.final_goal_range_m || 0)} m
        </div>
      </div>
    `;
    card.addEventListener("click", () => {
      window.location.href = `/?run=${state.runId}&episode=${idx}`;
    });
    scenarioGrid.appendChild(card);

    const canvas = card.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    BoatNavDraw.drawEpisodeFull(ctx, ep, canvas.width, canvas.height, {
      pad: 50,
      goalRadius: 4,
      endRadius: 3,
    });
  }
}

runSelect.addEventListener("change", () => loadRun(runSelect.value));
filterSelect.addEventListener("change", renderGrid);
categorySelect.addEventListener("change", renderGrid);
refreshBtn.addEventListener("click", () => loadRuns(state.runId));

(async () => {
  await loadCatalog();
  await loadRuns(queryRunFromUrl());
})().catch((err) => {
  statusLine.textContent = `Error: ${err.message}`;
});
