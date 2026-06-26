/**
 * Shared canvas drawing for boat nav RL visualization.
 */
const BoatNavDraw = (() => {
  const COLLISION_RADIUS_M = 20;

  function computeBounds(steps, pad = 80) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const step of steps) {
      const pts = [step.own, step.goal, ...(step.contacts || [])];
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    if (!Number.isFinite(minX)) {
      return { minX: -500, maxX: 500, minY: -500, maxY: 500 };
    }
    return {
      minX: minX - pad,
      maxX: maxX + pad,
      minY: minY - pad,
      maxY: maxY + pad,
    };
  }

  function makeProjector(bounds, width, height) {
    return (x, y) => {
      const sx = ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * width;
      const sy = height - ((y - bounds.minY) / (bounds.maxY - bounds.minY)) * height;
      return [sx, sy];
    };
  }

  function drawBackground(ctx, width, height) {
    ctx.fillStyle = "#08101c";
    ctx.fillRect(0, 0, width, height);
  }

  function drawGrid(ctx, bounds, width, height, subtle = true) {
    if (!subtle) return;
    const toScreen = makeProjector(bounds, width, height);
    ctx.strokeStyle = "#152033";
    ctx.lineWidth = 1;
    const step = 200;
    for (let x = Math.floor(bounds.minX / step) * step; x <= bounds.maxX; x += step) {
      const [sx] = toScreen(x, 0);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
      ctx.stroke();
    }
    for (let y = Math.floor(bounds.minY / step) * step; y <= bounds.maxY; y += step) {
      const [, sy] = toScreen(0, y);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
      ctx.stroke();
    }
  }

  function drawPolyline(ctx, points, bounds, width, height, color, lineWidth = 2) {
    if (points.length < 2) return;
    const toScreen = makeProjector(bounds, width, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    let [sx, sy] = toScreen(points[0].x, points[0].y);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < points.length; i++) {
      [sx, sy] = toScreen(points[i].x, points[i].y);
      ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  function drawDot(ctx, x, y, bounds, width, height, color, radius = 4) {
    const toScreen = makeProjector(bounds, width, height);
    const [sx, sy] = toScreen(x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function contactTrails(steps) {
    const maxContacts = Math.max(
      0,
      ...steps.map((s) => (s.contacts ? s.contacts.length : 0))
    );
    const trails = [];
    for (let ci = 0; ci < maxContacts; ci++) {
      const path = [];
      for (const step of steps) {
        if (step.contacts && step.contacts[ci]) {
          path.push({ x: step.contacts[ci].x, y: step.contacts[ci].y });
        }
      }
      if (path.length) trails.push(path);
    }
    return trails;
  }

  /**
   * Draw full episode trajectory (thumbnail or overview).
   */
  function drawEpisodeFull(ctx, episode, width, height, options = {}) {
    const steps = episode.steps || [];
    if (!steps.length) {
      drawBackground(ctx, width, height);
      return;
    }

    const bounds = computeBounds(steps, options.pad ?? 60);
    drawBackground(ctx, width, height);
    drawGrid(ctx, bounds, width, height, options.grid !== false);

    const goal = steps[0].goal;
    drawDot(ctx, goal.x, goal.y, bounds, width, height, "#45d483", options.goalRadius ?? 5);

    for (const trail of contactTrails(steps)) {
      drawPolyline(ctx, trail, bounds, width, height, "rgba(255, 107, 107, 0.55)", 1.5);
      const last = trail[trail.length - 1];
      drawDot(ctx, last.x, last.y, bounds, width, height, "#ff6b6b", 3);
    }

    const ownPath = steps.map((s) => ({ x: s.own.x, y: s.own.y }));
    drawPolyline(ctx, ownPath, bounds, width, height, "rgba(107, 124, 255, 0.85)", 2);

    const start = steps[0].own;
    const end = steps[steps.length - 1].own;
    drawDot(ctx, start.x, start.y, bounds, width, height, "#9fd4ff", 3);
    drawDot(ctx, end.x, end.y, bounds, width, height, "#3aa6ff", options.endRadius ?? 4);

    if (options.showOutcome !== false) {
      const label = episode.collision ? "COLL" : episode.success ? "OK" : "—";
      const color = episode.collision ? "#ff6b6b" : episode.success ? "#45d483" : "#8fa3bf";
      ctx.font = "600 11px Segoe UI, system-ui, sans-serif";
      ctx.fillStyle = color;
      ctx.fillText(label, 8, 16);
    }
  }

  /**
   * Draw single animation frame (interactive replay).
   */
  function drawEpisodeFrame(ctx, episode, frameIndex, bounds, width, height) {
    const steps = episode.steps || [];
    const idx = Math.min(frameIndex, Math.max(steps.length - 1, 0));
    const step = steps[idx];
    if (!step) return;

    drawBackground(ctx, width, height);
    drawGrid(ctx, bounds, width, height);

    const toScreen = makeProjector(bounds, width, height);

    drawPolyline(ctx, steps.slice(0, idx + 1).map((s) => s.own), bounds, width, height, "rgba(107, 124, 255, 0.55)", 2);

    drawDot(ctx, step.goal.x, step.goal.y, bounds, width, height, "#45d483", 8);

    for (const c of step.contacts || []) {
      drawDot(ctx, c.x, c.y, bounds, width, height, "#ff6b6b", 6);
    }

    drawDot(ctx, step.own.x, step.own.y, bounds, width, height, "#3aa6ff", 7);
  }

  function subsampleEpisodes(episodes, maxEpisodes) {
    if (!episodes.length || maxEpisodes <= 0 || episodes.length <= maxEpisodes) {
      return episodes.slice();
    }
    const stride = Math.max(1, Math.floor(episodes.length / maxEpisodes));
    const picked = [];
    for (let i = 0; i < episodes.length && picked.length < maxEpisodes; i += stride) {
      picked.push(episodes[i]);
    }
    return picked;
  }

  function episodeFrameIndex(episode, progress) {
    const steps = episode.steps || [];
    if (!steps.length) return 0;
    const p = Math.min(Math.max(progress, 0), 1);
    return Math.round(p * (steps.length - 1));
  }

  function drawScoreBadge(ctx, cellX, cellY, cellW, score) {
    if (typeof BoatNavScoring === "undefined") return;
    const text = BoatNavScoring.formatScore(score);
    const color = BoatNavScoring.scoreColor(score);
    ctx.font = "700 10px Segoe UI, system-ui, sans-serif";
    const padX = 4;
    const padY = 2;
    const tw = ctx.measureText(text).width;
    const boxW = tw + padX * 2;
    const boxH = 14;
    const x = cellX + cellW - boxW - 3;
    const y = cellY + 3;
    ctx.fillStyle = "rgba(8, 16, 28, 0.82)";
    ctx.fillRect(x, y, boxW, boxH);
    ctx.fillStyle = color;
    ctx.fillText(text, x + padX, y + boxH - padY - 1);
  }

  function drawStepMontage(ctx, episodes, progress, width, height, options = {}) {
    const maxEpisodes = options.maxEpisodes ?? 48;
    const picked = subsampleEpisodes(episodes, maxEpisodes);
    if (!picked.length) {
      drawBackground(ctx, width, height);
      return { shown: 0, total: episodes.length, frameIndex: 0, maxSteps: 0 };
    }

    const cols = Math.ceil(Math.sqrt(picked.length));
    const rows = Math.ceil(picked.length / cols);
    const cellW = Math.floor(width / cols);
    const cellH = Math.floor(height / rows);
    let maxSteps = 0;

    drawBackground(ctx, width, height);
    for (let i = 0; i < picked.length; i++) {
      const ep = picked[i];
      const steps = ep.steps || [];
      maxSteps = Math.max(maxSteps, steps.length);
      const frameIndex = episodeFrameIndex(ep, progress);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const bounds = computeBounds(steps, options.pad ?? 50);

      ctx.save();
      ctx.beginPath();
      ctx.rect(col * cellW, row * cellH, cellW, cellH);
      ctx.clip();
      ctx.translate(col * cellW, row * cellH);
      drawEpisodeFrame(ctx, ep, frameIndex, bounds, cellW, cellH);
      ctx.restore();

      if (options.showLabels) {
        const label = ep.scenario_name ? ep.scenario_name.slice(0, 10) : `#${i + 1}`;
        ctx.font = "600 9px Segoe UI, system-ui, sans-serif";
        ctx.fillStyle = "rgba(143, 163, 191, 0.95)";
        ctx.fillText(label, col * cellW + 4, row * cellH + 12);
      }

      if (options.showScores !== false && typeof BoatNavScoring !== "undefined") {
        const mode = options.mode || ep.mode || "navigate";
        const score = BoatNavScoring.episodeMissionScore(ep, mode);
        drawScoreBadge(ctx, col * cellW, row * cellH, cellW, score);
      }
    }

    const globalFrame = Math.round(progress * Math.max(maxSteps - 1, 0));
    return {
      shown: picked.length,
      total: episodes.length,
      frameIndex: globalFrame,
      maxSteps,
    };
  }

  return {
    COLLISION_RADIUS_M,
    computeBounds,
    makeProjector,
    drawBackground,
    drawGrid,
    drawEpisodeFull,
    drawEpisodeFrame,
    drawStepMontage,
    drawScoreBadge,
    subsampleEpisodes,
    episodeFrameIndex,
    drawPolyline,
    drawDot,
    contactTrails,
  };
})();

if (typeof module !== "undefined") module.exports = BoatNavDraw;
