"use strict";

const { isBlocked, dist } = require("./world");

/** True if open segment (x0,y0)-(x1,y1) intersects axis-aligned rect (inclusive edges with pad). */
function segmentHitsRect(x0, y0, x1, y1, r, pad) {
  pad = pad == null ? 1 : pad;
  const rx0 = r.x0 - pad,
    ry0 = r.y0 - pad,
    rx1 = r.x1 + pad,
    ry1 = r.y1 + pad;

  // Endpoint inside
  function inside(x, y) {
    return x > rx0 && x < rx1 && y > ry0 && y < ry1;
  }
  if (inside(x0, y0) || inside(x1, y1)) return true;

  // Liang–Barsky style clip: if any portion of segment is inside, it hits
  let t0 = 0,
    t1 = 1;
  const dx = x1 - x0,
    dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - rx0, rx1 - x0, y0 - ry0, ry1 - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  // Overlap with [0,1] means the clipped segment is non-empty → intersects interior
  return t0 < t1 && t1 >= 0 && t0 <= 1;
}

function segmentHitsAny(x0, y0, x1, y1, rects) {
  for (const r of rects || []) {
    if (segmentHitsRect(x0, y0, x1, y1, r, 2)) return true;
  }
  return false;
}

function clearLine(a, b, rects) {
  return !segmentHitsAny(a.x, a.y, b.x, b.y, rects);
}

function rectCorners(r, m) {
  m = m == null ? 24 : m;
  return [
    { x: r.x0 - m, y: r.y0 - m },
    { x: r.x0 - m, y: r.y1 + m },
    { x: r.x1 + m, y: r.y0 - m },
    { x: r.x1 + m, y: r.y1 + m },
  ];
}

/**
 * Same-map path around blocked rectangles (spider-island style).
 * Returns waypoints including the destination (not including start).
 * Cross-map: single dest waypoint (door/town handled elsewhere).
 */
function findPath(from, to, map, G) {
  if (!to || to.x == null || to.y == null) return [];
  if (from.map && to.map && from.map !== to.map) {
    return [{ map: to.map, x: to.x, y: to.y }];
  }
  const m = map || from.map || to.map;
  if (isBlocked(m, to.x, to.y, G)) return null;

  const rects = (G.maps[m] && G.maps[m].blocked) || [];
  const start = { x: from.x, y: from.y };
  const goal = { x: to.x, y: to.y };

  if (clearLine(start, goal, rects)) {
    return [{ map: m, x: goal.x, y: goal.y }];
  }

  const nodes = [start, goal];
  for (const r of rects) {
    for (const c of rectCorners(r)) {
      if (!isBlocked(m, c.x, c.y, G)) nodes.push(c);
    }
  }

  // Dijkstra on fully connected clear-line graph
  const n = nodes.length;
  const INF = 1e15;
  const cost = new Array(n).fill(INF);
  const prev = new Array(n).fill(-1);
  const used = new Array(n).fill(false);
  cost[0] = 0;

  for (let iter = 0; iter < n; iter++) {
    let u = -1,
      best = INF;
    for (let i = 0; i < n; i++) {
      if (!used[i] && cost[i] < best) {
        best = cost[i];
        u = i;
      }
    }
    if (u < 0) break;
    used[u] = true;
    if (u === 1) break; // reached goal (index 1)
    for (let v = 0; v < n; v++) {
      if (used[v]) continue;
      if (!clearLine(nodes[u], nodes[v], rects)) continue;
      const w = dist(nodes[u], nodes[v]);
      if (cost[u] + w < cost[v]) {
        cost[v] = cost[u] + w;
        prev[v] = u;
      }
    }
  }

  if (cost[1] >= INF) return null;

  const chain = [];
  for (let v = 1; v !== -1; v = prev[v]) chain.push(v);
  chain.reverse();
  // drop start (0); emit waypoints
  const out = [];
  for (let i = 1; i < chain.length; i++) {
    const p = nodes[chain[i]];
    out.push({ map: m, x: p.x, y: p.y });
  }
  return out;
}

module.exports = {
  segmentHitsRect,
  segmentHitsAny,
  clearLine,
  findPath,
  rectCorners,
};
