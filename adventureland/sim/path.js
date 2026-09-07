"use strict";

const { isBlocked, dist } = require("./world");

const DOOR_COST = 800;

/** Playable envelopes — corners outside these are ignored (forces cave vs infinite detours). */
const MAP_BOUNDS = {
  main: { x0: -1400, y0: -900, x1: 1400, y1: 2200 },
  cave: { x0: -350, y0: -550, x1: 1250, y1: 180 },
};

function inBounds(map, x, y) {
  const b = MAP_BOUNDS[map];
  if (!b) return true;
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

function segmentHitsRect(x0, y0, x1, y1, r, pad) {
  pad = pad == null ? 1 : pad;
  const rx0 = r.x0 - pad,
    ry0 = r.y0 - pad,
    rx1 = r.x1 + pad,
    ry1 = r.y1 + pad;

  function inside(x, y) {
    return x > rx0 && x < rx1 && y > ry0 && y < ry1;
  }
  if (inside(x0, y0) || inside(x1, y1)) return true;

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

function keyOf(p) {
  return p.map + "|" + Math.round(p.x) + "|" + Math.round(p.y);
}

function walkable(map, x, y, G) {
  return inBounds(map, x, y) && !isBlocked(map, x, y, G);
}

function findPathSameMap(from, to, map, G) {
  if (!to || to.x == null || to.y == null) return null;
  const m = map || from.map || to.map;
  if (!walkable(m, to.x, to.y, G)) return null;
  if (!walkable(m, from.x, from.y, G)) return null;

  const rects = (G.maps[m] && G.maps[m].blocked) || [];
  const start = { x: from.x, y: from.y };
  const goal = { x: to.x, y: to.y };

  if (clearLine(start, goal, rects)) {
    return [{ map: m, x: goal.x, y: goal.y }];
  }

  const nodes = [start, goal];
  for (const r of rects) {
    for (const c of rectCorners(r)) {
      if (walkable(m, c.x, c.y, G)) nodes.push(c);
    }
  }

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
    if (u === 1) break;
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
  const out = [];
  for (let i = 1; i < chain.length; i++) {
    const p = nodes[chain[i]];
    out.push({ map: m, x: p.x, y: p.y });
  }
  return out;
}

function listDoors(G) {
  const edges = [];
  for (const mapName of Object.keys(G.maps || {})) {
    const m = G.maps[mapName];
    for (const d of m.doors || []) {
      const dest = G.maps[d.to];
      if (!dest || !dest.spawns) continue;
      const sp = dest.spawns[d.spawn != null ? d.spawn : 0];
      if (!sp) continue;
      edges.push({
        from: { map: mapName, x: d.x, y: d.y },
        to: { map: d.to, x: sp[0], y: sp[1] },
      });
    }
  }
  return edges;
}

function pathDist(from, wps) {
  let d = 0;
  let p = from;
  for (const w of wps) {
    d += dist(p, w) + (w.map !== p.map ? DOOR_COST : 0);
    p = w;
  }
  return d;
}

function findPath(from, to, map, G) {
  if (!to || to.x == null || to.y == null) return null;
  const start = {
    map: from.map || map || "main",
    x: from.x != null ? from.x : from.real_x,
    y: from.y != null ? from.y : from.real_y,
  };
  const goal = {
    map: to.map || map || start.map,
    x: to.x,
    y: to.y,
  };

  if (!walkable(goal.map, goal.x, goal.y, G)) return null;

  if (start.map === goal.map) {
    const same = findPathSameMap(start, goal, start.map, G);
    if (same) return same;
  }

  const doors = listDoors(G);
  const nodes = [start, goal];
  const seen = new Set([keyOf(start), keyOf(goal)]);
  for (const e of doors) {
    for (const p of [e.from, e.to]) {
      const k = keyOf(p);
      if (!seen.has(k) && walkable(p.map, p.x, p.y, G)) {
        seen.add(k);
        nodes.push({ map: p.map, x: p.x, y: p.y });
      }
    }
  }

  const n = nodes.length;
  const INF = 1e15;
  const cost = new Array(n).fill(INF);
  const prev = new Array(n).fill(-1);
  const prevVia = new Array(n).fill(null);
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
    if (u === 1) break;

    for (let v = 0; v < n; v++) {
      if (used[v] || nodes[u].map !== nodes[v].map) continue;
      const wps = findPathSameMap(nodes[u], nodes[v], nodes[u].map, G);
      if (!wps) continue;
      const w = pathDist(nodes[u], wps);
      if (cost[u] + w < cost[v]) {
        cost[v] = cost[u] + w;
        prev[v] = u;
        prevVia[v] = wps;
      }
    }

    for (const e of doors) {
      if (e.from.map !== nodes[u].map) continue;
      if (Math.abs(e.from.x - nodes[u].x) > 1 || Math.abs(e.from.y - nodes[u].y) > 1) continue;
      let v = -1;
      for (let i = 0; i < n; i++) {
        if (nodes[i].map === e.to.map && Math.abs(nodes[i].x - e.to.x) < 1 && Math.abs(nodes[i].y - e.to.y) < 1) {
          v = i;
          break;
        }
      }
      if (v < 0 || used[v]) continue;
      if (cost[u] + DOOR_COST < cost[v]) {
        cost[v] = cost[u] + DOOR_COST;
        prev[v] = u;
        prevVia[v] = [{ map: e.to.map, x: e.to.x, y: e.to.y, door: true }];
      }
    }
  }

  if (cost[1] >= INF) return null;

  const edges = [];
  for (let v = 1; v !== 0 && v !== -1; v = prev[v]) {
    edges.push(prevVia[v] || [{ map: nodes[v].map, x: nodes[v].x, y: nodes[v].y }]);
  }
  edges.reverse();
  const out = [];
  for (const wps of edges) {
    for (const p of wps) out.push({ map: p.map, x: p.x, y: p.y, door: p.door });
  }
  const last = out[out.length - 1];
  if (!last || last.map !== goal.map || Math.abs(last.x - goal.x) > 1 || Math.abs(last.y - goal.y) > 1) {
    out.push({ map: goal.map, x: goal.x, y: goal.y });
  }
  return out;
}

module.exports = {
  segmentHitsRect,
  segmentHitsAny,
  clearLine,
  findPath,
  findPathSameMap,
  listDoors,
  rectCorners,
  MAP_BOUNDS,
  inBounds,
};
