/* AL Sim Viz — browse suite + scrub recorded traces */
(() => {
  const COLORS = {
    Jazwyn: "#e0b45a",
    Sarene: "#6a9ec9",
    Zarook: "#9a7bc4",
    Puppygirl: "#c97a9a",
  };

  const state = {
    catalog: null,
    filterTag: null,
    filterQ: "",
    selectedTest: null,
    traces: {},
    activeTrace: null,
    frameIdx: 0,
    playing: false,
    playTimer: null,
  };

  const $ = (id) => document.getElementById(id);

  function fmtMs(ms) {
    if (ms == null) return "—";
    if (ms < 1000) return ms + "ms";
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
    return (ms / 60000).toFixed(1) + "m";
  }

  async function loadCatalog() {
    const res = await fetch("/data/catalog.json");
    if (!res.ok) throw new Error("Missing catalog.json — run: node tools/record_viz.js");
    state.catalog = await res.json();
  }

  async function loadTrace(id) {
    if (state.traces[id]) return state.traces[id];
    const res = await fetch("/data/traces/" + id + ".json");
    if (!res.ok) throw new Error("trace missing: " + id);
    const t = await res.json();
    state.traces[id] = t;
    return t;
  }

  function setTab(name) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === name));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("is-on", p.id === "panel-" + name));
  }

  function filteredTests() {
    const q = state.filterQ.trim().toLowerCase();
    return state.catalog.tests.filter((t) => {
      if (state.filterTag && t.tags.indexOf(state.filterTag) < 0) return false;
      if (!q) return true;
      return (t.name + " " + t.suite + " " + (t.plan || "") + " " + t.tags.join(" ")).toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderTagFilters() {
    const tags = Object.keys(state.catalog.coverage).sort();
    const row = $("tag-filters");
    row.innerHTML = "";
    const all = document.createElement("button");
    all.type = "button";
    all.className = "chip" + (state.filterTag ? "" : " is-on");
    all.textContent = "all";
    all.onclick = () => {
      state.filterTag = null;
      renderTests();
      renderTagFilters();
    };
    row.appendChild(all);
    for (const tag of tags) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (state.filterTag === tag ? " is-on" : "");
      b.textContent = tag;
      b.onclick = () => {
        state.filterTag = tag;
        renderTests();
        renderTagFilters();
      };
      row.appendChild(b);
    }
  }

  function renderTests() {
    const list = $("test-list");
    list.innerHTML = "";
    for (const t of filteredTests()) {
      const li = document.createElement("li");
      if (state.selectedTest && state.selectedTest.name === t.name) li.classList.add("is-on");
      li.innerHTML =
        '<div class="name"></div><div class="meta"></div>';
      li.querySelector(".name").textContent = t.name;
      li.querySelector(".meta").textContent =
        t.suite +
        (t.plan ? " · " + t.plan : "") +
        (t.hasTrace ? " · trace" : "") +
        " · " +
        t.tags.join(", ");
      li.onclick = () => {
        state.selectedTest = t;
        renderTests();
        renderDetail(t);
      };
      list.appendChild(li);
    }
  }

  function renderDetail(t) {
    const el = $("test-detail");
    const grades = t.grades
      ? Object.keys(t.grades)
          .filter((k) => typeof t.grades[k] === "number" && t.grades[k] > 0)
          .map((k) => k + "=" + t.grades[k])
          .join(" · ")
      : "";
    el.innerHTML =
      "<h3></h3>" +
      '<p class="muted"></p>' +
      '<div class="tags"></div>' +
      (grades ? '<p class="mono"></p>' : "") +
      '<p class="muted" style="margin-top:1rem"></p>' +
      '<button class="btn" type="button" id="open-trace"></button>';
    el.querySelector("h3").textContent = t.name;
    el.querySelector(".muted").textContent = "Suite: " + t.suite + (t.plan ? " · Plan " + t.plan : "");
    const tags = el.querySelector(".tags");
    for (const tag of t.tags) {
      const s = document.createElement("span");
      s.className = "chip";
      s.textContent = tag;
      tags.appendChild(s);
    }
    if (grades) el.querySelector(".mono").textContent = "Grades: " + grades;
    const hint = el.querySelectorAll(".muted")[1];
    const btn = $("open-trace");
    if (t.hasTrace) {
      hint.textContent = "Recorded timeline available for scrubbing.";
      btn.textContent = "Open in Scrub";
      btn.disabled = false;
      btn.onclick = async () => {
        setTab("scrub");
        $("trace-select").value = t.traceId;
        await selectTrace(t.traceId);
      };
    } else {
      hint.textContent =
        "No timeline yet. Unit/comms tests appear here for coverage; party scenarios are recorded via tools/record_viz.js.";
      btn.textContent = "No trace";
      btn.disabled = true;
    }
  }

  function renderCoverage() {
    const tagsEl = $("cov-tags");
    const planEl = $("cov-plan");
    tagsEl.innerHTML = "";
    planEl.innerHTML = "";
    const cov = state.catalog.coverage;
    const max = Math.max(1, ...Object.values(cov).map((c) => c.tests));
    for (const tag of Object.keys(cov).sort()) {
      const c = cov[tag];
      tagsEl.appendChild(barRow(tag, c.tests, c.withTrace, max));
    }
    const plan = state.catalog.planCoverage || {};
    for (const key of Object.keys(plan).sort()) {
      const c = plan[key];
      const row = barRow(key, c.tests, c.withTrace, Math.max(1, ...Object.values(plan).map((x) => x.tests)));
      row.title = (c.names || []).join("\n");
      planEl.appendChild(row);
    }
    $("cov-meta").textContent =
      state.catalog.testCount +
      " tests · " +
      state.catalog.traceCount +
      " recorded traces · generated " +
      (state.catalog.generatedAt || "");
  }

  function barRow(label, tests, withTrace, max) {
    const row = document.createElement("div");
    row.className = "bar-row";
    const fill = Math.round((tests / max) * 100);
    const traced = tests ? Math.round((withTrace / tests) * 100) : 0;
    row.innerHTML =
      "<span></span><div class='bar-track'><div class='bar-fill'></div></div><span></span>";
    row.children[0].textContent = label;
    row.querySelector(".bar-fill").style.width = fill + "%";
    row.children[2].textContent = tests + " · " + traced + "% traced";
    return row;
  }

  function renderTraceSelect() {
    const sel = $("trace-select");
    sel.innerHTML = "";
    for (const t of state.catalog.traces || []) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.id + " (" + fmtMs(t.durationMs) + ", " + t.eventCount + " ev)";
      sel.appendChild(opt);
    }
    sel.onchange = () => selectTrace(sel.value);
  }

  async function selectTrace(id) {
    stopPlay();
    const tr = await loadTrace(id);
    state.activeTrace = tr;
    state.frameIdx = 0;
    const scrub = $("scrub");
    scrub.max = Math.max(0, tr.frames.length - 1);
    scrub.value = 0;
    renderGrades(tr.grades || {});
    renderFrame();
  }

  function renderGrades(g) {
    const el = $("grade-pills");
    el.innerHTML = "";
    const keys = ["chat_throttle", "fighter_hop", "dlv_done", "town_fallback", "rare_spot", "path_storm"];
    for (const k of keys) {
      if (g[k] == null) continue;
      const s = document.createElement("span");
      s.className = "pill " + (k === "dlv_done" || k === "rare_spot" ? (g[k] > 0 ? "ok" : "") : g[k] > 0 ? "bad" : "ok");
      s.textContent = k + " " + g[k];
      el.appendChild(s);
    }
  }

  function currentFrame() {
    const tr = state.activeTrace;
    if (!tr || !tr.frames.length) return null;
    return tr.frames[Math.min(state.frameIdx, tr.frames.length - 1)];
  }

  function renderFrame() {
    const tr = state.activeTrace;
    const frame = currentFrame();
    if (!tr || !frame) return;
    $("time-label").textContent = fmtMs(frame.t);
    $("scrub").value = String(state.frameIdx);

    const lines = [];
    lines.push("t=" + frame.t + "  frame " + (state.frameIdx + 1) + "/" + tr.frames.length);
    for (const name of Object.keys(frame.chars || {})) {
      const c = frame.chars[name];
      lines.push(
        name.slice(0, 3) +
          "  " +
          c.server +
          "  " +
          c.map +
          " (" +
          c.x +
          "," +
          c.y +
          ")" +
          (c.connected ? "" : "  OFF")
      );
    }
    $("frame-meta").textContent = lines.join("\n");

    drawMap(frame);
    renderEvents(frame.t);
  }

  function drawMap(frame) {
    const canvas = $("map");
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // World bounds covering potions → past spider island → armadillo
    const x0 = -100,
      x1 = 900,
      y0 = -450,
      y1 = 2200;
    const sx = (x) => ((x - x0) / (x1 - x0)) * w;
    const sy = (y) => ((y - y0) / (y1 - y0)) * h;

    // Spider-island exclusion (LESSONS)
    const blocked = [{ x0: 304, y0: -300, x1: 688, y1: 120 }];
    for (const r of blocked) {
      ctx.fillStyle = "rgba(70, 90, 120, 0.45)";
      ctx.strokeStyle = "rgba(140, 170, 210, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(sx(r.x0), sy(r.y0), sx(r.x1) - sx(r.x0), sy(r.y1) - sy(r.y0));
      ctx.strokeRect(sx(r.x0), sy(r.y0), sx(r.x1) - sx(r.x0), sy(r.y1) - sy(r.y0));
    }
    ctx.fillStyle = "rgba(140, 170, 210, 0.85)";
    ctx.font = "11px IBM Plex Mono";
    ctx.fillText("blocked water", sx(320), sy(-280));

    // Route trail from earlier frames (Puppygirl)
    const tr = state.activeTrace;
    if (tr && tr.frames) {
      ctx.strokeStyle = "rgba(201, 122, 154, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= state.frameIdx; i++) {
        const ch = tr.frames[i].chars && tr.frames[i].chars.Puppygirl;
        if (!ch || ch.map !== "main") continue;
        const px = sx(ch.x),
          py = sy(ch.y);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else ctx.lineTo(px, py);
      }
      if (started) ctx.stroke();
    }

    ctx.fillStyle = "rgba(139,145,124,0.5)";
    ctx.fillText("main", 12, 20);

    for (const m of frame.monsters || []) {
      if (m.map !== "main") continue;
      ctx.fillStyle = "rgba(196,92,74,0.85)";
      ctx.beginPath();
      ctx.arc(sx(m.x), sy(m.y), 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(232,226,212,0.7)";
      ctx.fillText(m.mtype || "mob", sx(m.x) + 10, sy(m.y) + 4);
    }

    for (const name of Object.keys(frame.chars || {})) {
      const c = frame.chars[name];
      if (c.map !== "main") continue;
      const col = COLORS[name] || "#e8e2d4";
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(sx(c.x), sy(c.y), name === "Puppygirl" ? 6 : 8, 0, Math.PI * 2);
      ctx.fill();
      if (!c.connected) {
        ctx.strokeStyle = "#c45c4a";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = col;
      ctx.fillText(name[0], sx(c.x) + 10, sy(c.y) - 6);
    }
  }

  function renderEvents(t) {
    const tr = state.activeTrace;
    const el = $("event-log");
    el.innerHTML = "";
    const windowStart = Math.max(0, t - 60000);
    const evs = (tr.events || []).filter((e) => e.t <= t && e.t >= windowStart);
    const show = evs.slice(-120);
    let last = null;
    for (const e of show) {
      const li = document.createElement("li");
      if (!last || t - e.t < 1500) {
        /* mark near tip */
      }
      last = e;
      const kind = e.kind || "log";
      const m = e.m != null ? e.m : e.to ? JSON.stringify(e.to) : "";
      li.innerHTML = '<span class="who"></span> <span class="kind"></span> <span class="msg"></span>';
      li.querySelector(".who").textContent = (e.who || "?") + "@" + fmtMs(e.t);
      li.querySelector(".kind").textContent = kind;
      li.querySelector(".msg").textContent = m.length > 120 ? m.slice(0, 120) + "…" : m;
      el.appendChild(li);
    }
    if (el.lastElementChild) el.lastElementChild.classList.add("is-now");
    el.scrollTop = el.scrollHeight;
  }

  function stopPlay() {
    state.playing = false;
    if (state.playTimer) clearInterval(state.playTimer);
    state.playTimer = null;
    $("btn-play").textContent = "Play";
  }

  function togglePlay() {
    if (!state.activeTrace) return;
    if (state.playing) {
      stopPlay();
      return;
    }
    state.playing = true;
    $("btn-play").textContent = "Pause";
    state.playTimer = setInterval(() => {
      if (state.frameIdx >= state.activeTrace.frames.length - 1) {
        stopPlay();
        return;
      }
      state.frameIdx++;
      renderFrame();
    }, 120);
  }

  async function boot() {
    document.querySelectorAll(".tab").forEach((b) => {
      b.addEventListener("click", () => setTab(b.dataset.tab));
    });
    $("filter-q").addEventListener("input", (e) => {
      state.filterQ = e.target.value;
      renderTests();
    });
    $("scrub").addEventListener("input", (e) => {
      stopPlay();
      state.frameIdx = Number(e.target.value);
      renderFrame();
    });
    $("btn-play").addEventListener("click", togglePlay);

    try {
      await loadCatalog();
    } catch (err) {
      $("test-detail").innerHTML = '<p class="muted"></p>';
      $("test-detail").querySelector("p").textContent = String(err.message || err);
      return;
    }

    renderTagFilters();
    renderTests();
    renderCoverage();
    renderTraceSelect();
    if (state.catalog.traces && state.catalog.traces.length) {
      await selectTrace(state.catalog.traces[0].id);
    }
  }

  boot();
})();
