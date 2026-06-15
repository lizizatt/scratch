/**
 * Minimal multi-series line chart (no dependencies).
 */
const BoatNavChart = (() => {
  const COLORS = {
    goalRange: "#ffc857",
    score: "#45d483",
    success: "#3aa6ff",
    grid: "#243049",
    text: "#8fa3bf",
  };

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return Math.ceil(v / p) * p;
  }

  function yBounds(seriesList, options = {}) {
    const vals = seriesList
      .flatMap((s) => s.points.map((p) => p.y))
      .filter((v) => v != null);
    if (!vals.length) {
      return { yMin: 0, yMax: 1 };
    }
    let yMin = options.yMin;
    let yMax = options.yMax;
    if (options.yAutoRange) {
      yMin = Math.min(...vals);
      yMax = Math.max(...vals);
      const span = yMax - yMin;
      const pad = span > 0 ? span * 0.15 : Math.max(Math.abs(yMax), Math.abs(yMin), 1) * 0.1;
      if (options.yFloor != null) {
        yMin = Math.max(options.yFloor, yMin - pad);
      } else {
        yMin = yMin - pad;
      }
      yMax = yMax + pad;
    } else {
      yMin = yMin ?? 0;
      for (const s of seriesList) {
        if (s.yMax != null) yMax = Math.max(yMax ?? 0, s.yMax);
        else {
          for (const p of s.points) {
            if (p.y != null) yMax = Math.max(yMax ?? 0, p.y);
          }
        }
      }
      yMax = niceMax((yMax ?? 1) * 1.08);
    }
    if (options.yMax != null) {
      yMax = options.yAutoRange ? Math.min(yMax, options.yMax) : options.yMax;
    }
    if (yMax <= yMin) {
      yMax = yMin + 1;
    }
    return { yMin, yMax };
  }

  function drawLineChart(canvas, seriesList, options = {}) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const pad = { top: 24, right: 16, bottom: 36, left: 48 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#08101c";
    ctx.fillRect(0, 0, w, h);

    const allPoints = seriesList.flatMap((s) => s.points.filter((p) => p.y != null));
    if (!allPoints.length) {
      ctx.fillStyle = COLORS.text;
      ctx.font = "14px Segoe UI, system-ui, sans-serif";
      ctx.fillText(options.emptyText || "No data yet — run training", pad.left, h / 2);
      return;
    }

    const n = Math.max(...seriesList.map((s) => s.points.length));
    const count = Math.max(n - 1, 1);

    const { yMin, yMax } = yBounds(seriesList, options);
    const ySpan = yMax - yMin;

    // Grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      const val = yMin + ySpan * (1 - i / 4);
      ctx.fillStyle = COLORS.text;
      ctx.font = "10px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(val >= 100 ? 0 : 2), pad.left - 6, y + 3);
    }

    // Series
    for (const series of seriesList) {
      const pts = series.points;
      ctx.strokeStyle = series.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      pts.forEach((p, i) => {
        if (p.y == null) return;
        const x = pad.left + (plotW * i) / count;
        const y = pad.top + plotH * (1 - (p.y - yMin) / ySpan);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      // Dots
      pts.forEach((p, i) => {
        if (p.y == null) return;
        const x = pad.left + (plotW * i) / count;
        const y = pad.top + plotH * (1 - (p.y - yMin) / ySpan);
        ctx.fillStyle = series.color;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // X labels (sparse)
    ctx.fillStyle = COLORS.text;
    ctx.font = "10px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center";
    const step = Math.max(1, Math.floor(n / 6));
    for (let i = 0; i < n; i += step) {
      const x = pad.left + (plotW * i) / count;
      const label = seriesList[0].points[i]?.label || String(i + 1);
      ctx.fillText(label, x, h - 10);
    }

    // Legend
    let lx = pad.left;
    const ly = 14;
    ctx.font = "11px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "left";
    for (const series of seriesList) {
      ctx.fillStyle = series.color;
      ctx.fillRect(lx, ly - 8, 12, 3);
      ctx.fillStyle = COLORS.text;
      ctx.fillText(series.label, lx + 16, ly);
      lx += ctx.measureText(series.label).width + 36;
    }
  }

  return { drawLineChart, COLORS };
})();
