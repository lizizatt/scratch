"use strict";

/**
 * Merchant-only local avoidance — trajectory prediction + lateral dodge.
 * Not used by fighters. Pure geometry; caller supplies can_move_to / sleep / entities.
 */

const { AVOID_ENGAGE_R } = require("./constants");

const DEFAULTS = {
  bodyR: 30,
  margin: 16,
  stepPx: 36,
  horizonMs: 800,
  horizonSteps: 4,
  angleFan: 7,
  angleStepDeg: 22,
  maxSteps: 220,
  arriveR: 28,
  contactR: 34,
  tickMs: 280,
  clearWeight: 1.6,
  progressWeight: 1.0,
  unsureFrac: 0.45,
  /** Only engage avoid steering when a hostile is this close (px). Far vision still lists for dodging once engaged. */
  engageR: AVOID_ENGAGE_R,
  /** List / predict hostiles out to this radius while avoid is active. */
  visionPx: 600,
};

function xyOf(e) {
  return {
    x: e.real_x != null ? e.real_x : e.x,
    y: e.real_y != null ? e.real_y : e.y,
    map: e.map,
  };
}

function distXY(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function createTracker() {
  const prev = new Map();
  return {
    /** @returns {{id,x,y,vx,vy,r}[]} blockers with px/s velocity */
    update(entities, now, bodyR) {
      const out = [];
      const seen = new Set();
      for (const e of entities || []) {
        if (!e || e.dead || e.rip) continue;
        const id = e.id || e.name || e.mtype || "?";
        seen.add(id);
        const p = xyOf(e);
        const last = prev.get(id);
        let vx = 0,
          vy = 0;
        if (last && now > last.t) {
          const dt = (now - last.t) / 1000;
          if (dt > 0.02 && dt < 2.5) {
            vx = (p.x - last.x) / dt;
            vy = (p.y - last.y) / dt;
          }
        }
        prev.set(id, { x: p.x, y: p.y, t: now });
        out.push({
          id,
          x: p.x,
          y: p.y,
          vx,
          vy,
          r: e.avoidR != null ? e.avoidR : bodyR,
        });
      }
      for (const id of prev.keys()) {
        if (!seen.has(id)) prev.delete(id);
      }
      return out;
    },
  };
}

function predict(b, tMs) {
  const t = Math.max(0, tMs) / 1000;
  return { x: b.x + b.vx * t, y: b.y + b.vy * t };
}

/** Min distance-to-surface over prediction horizon (negative = intrusion). */
function minClearance(xy, blockers, opts) {
  const horizon = opts.horizonMs;
  const steps = opts.horizonSteps;
  let best = Infinity;
  for (const b of blockers) {
    const speed = Math.hypot(b.vx || 0, b.vy || 0);
    // Random-walk uncertainty: inflate disk by a fraction of travel over the horizon.
    const unsure = speed * (horizon / 1000) * (opts.unsureFrac != null ? opts.unsureFrac : 0.45);
    for (let i = 0; i <= steps; i++) {
      const t = (horizon * i) / steps;
      const p = predict(b, t);
      const gap = distXY(xy, p) - (b.r + opts.margin + unsure);
      if (gap < best) best = gap;
    }
  }
  return best;
}

function willCollide(xy, blockers, opts) {
  return minClearance(xy, blockers, opts) < 0;
}

function nearestBlocker(xy, blockers) {
  let best = null,
    bestD = Infinity;
  for (const b of blockers) {
    const d = distXY(xy, b);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/**
 * Pick a short step toward dest that stays clear of predicted blocker disks.
 * @returns {{x,y,clear,progress}|null}
 */
function suggestAvoidStep(self, dest, blockers, opts) {
  opts = Object.assign({}, DEFAULTS, opts || {});
  const me = xyOf(self);
  const goal = { x: dest.x, y: dest.y };
  const dx = goal.x - me.x;
  const dy = goal.y - me.y;
  const dist = Math.hypot(dx, dy) || 1;
  if (dist <= opts.arriveR) return { x: me.x, y: me.y, clear: Infinity, progress: 0, arrived: 1 };

  const ux = dx / dist;
  const uy = dy / dist;
  const can = opts.canMoveTo || (() => true);
  const step = Math.min(opts.stepPx, dist);
  const fan = opts.angleFan | 0;
  const deg = opts.angleStepDeg;

  // If already soft-overlapping prediction, flee from nearest first.
  const near = nearestBlocker(me, blockers);
  if (near && distXY(me, near) < near.r + opts.margin + 6) {
    const fx = me.x - near.x;
    const fy = me.y - near.y;
    const fl = Math.hypot(fx, fy) || 1;
    const nx = me.x + (fx / fl) * step;
    const ny = me.y + (fy / fl) * step;
    if (can(nx, ny) && !willCollide({ x: nx, y: ny }, blockers, opts)) {
      return { x: nx, y: ny, clear: minClearance({ x: nx, y: ny }, blockers, opts), progress: 0, flee: 1 };
    }
  }

  let best = null;
  for (let k = -fan; k <= fan; k++) {
    const rad = (k * deg * Math.PI) / 180;
    const cx = Math.cos(rad);
    const sx = Math.sin(rad);
    const rx = ux * cx - uy * sx;
    const ry = ux * sx + uy * cx;
    const nx = me.x + rx * step;
    const ny = me.y + ry * step;
    if (!can(nx, ny)) continue;
    if (willCollide({ x: nx, y: ny }, blockers, opts)) continue;
    const clear = minClearance({ x: nx, y: ny }, blockers, opts);
    const progress = (nx - me.x) * ux + (ny - me.y) * uy;
    const score = opts.progressWeight * progress + opts.clearWeight * Math.min(clear, 80);
    if (!best || score > best.score) {
      best = { x: nx, y: ny, clear, progress, score };
    }
  }

  // Brake: stay put if moving is worse and current cell is clear enough
  if (!best) {
    if (!willCollide(me, blockers, opts) && can(me.x, me.y)) {
      return { x: me.x, y: me.y, clear: minClearance(me, blockers, opts), progress: 0, brake: 1 };
    }
    // Panic sidestep: try pure laterals even if progress is negative
    for (let k = 1; k <= fan + 2; k++) {
      for (const sign of [-1, 1]) {
        const rad = ((sign * k * deg) * Math.PI) / 180;
        const cx = Math.cos(rad);
        const sx = Math.sin(rad);
        const rx = ux * cx - uy * sx;
        const ry = ux * sx + uy * cx;
        const nx = me.x + rx * step;
        const ny = me.y + ry * step;
        if (!can(nx, ny)) continue;
        if (willCollide({ x: nx, y: ny }, blockers, opts)) continue;
        const clear = minClearance({ x: nx, y: ny }, blockers, opts);
        return { x: nx, y: ny, clear, progress: 0, panic: 1 };
      }
    }
    return null;
  }
  return best;
}

function merchantAvoidListMonsters(api, visionPx) {
  const out = [];
  const push = (e) => {
    if (!e || e.dead) return;
    if (e.type === "monster" || e.mtype) out.push(e);
  };
  if (typeof api.get_monsters === "function") {
    const bag = api.get_monsters() || [];
    if (Array.isArray(bag)) bag.forEach(push);
    else Object.keys(bag).forEach((k) => push(bag[k]));
  }
  if (!out.length) {
    const ents =
      (api.parent && api.parent.entities) ||
      (typeof api.get_entities === "function" && api.get_entities()) ||
      null;
    if (ents) {
      for (const id of Object.keys(ents)) push(ents[id]);
    }
  }
  // Vision gate — don't steer around off-screen packs across the map.
  const me = api.character;
  if (!me) return out;
  const vision = visionPx != null ? visionPx : DEFAULTS.visionPx;
  return out.filter((e) => distXY(xyOf(me), xyOf(e)) <= vision);
}

/** Distance to nearest blocker, or Infinity if none. */
function nearestThreatDist(self, blockers) {
  if (!self || !blockers || !blockers.length) return Infinity;
  const me = xyOf(self);
  let best = Infinity;
  for (const b of blockers) {
    const d = distXY(me, xyOf(b));
    if (d < best) best = d;
  }
  return best;
}

/**
 * Avoid pathing is for close threats only — far hostiles within list-vision must not
 * trap the merchant in town corners until avoid:fail timeout.
 */
function shouldEngageAvoid(self, blockers, engageR) {
  const r = engageR != null ? engageR : DEFAULTS.engageR;
  return nearestThreatDist(self, blockers) <= r;
}

function applyContact(api, blockers, contactR) {
  const me = xyOf(api.character);
  for (const b of blockers) {
    if (distXY(me, b) < contactR) {
      api.character.rip = true;
      api.character.hp = 0;
      if (typeof api.game_log === "function") api.game_log("avoid:contact " + (b.id || "?"));
      return b;
    }
  }
  return null;
}

/**
 * Step toward dest while dodging predicted monster disks.
 * Cross-map: falls back to api.smart_move once, then resumes local steering.
 */
async function merchantAvoidGoTo(api, dest, opts) {
  opts = Object.assign({}, DEFAULTS, opts || {});
  const tracker = opts.tracker || createTracker();
  const nowFn = () => (api._now ? api._now() : Date.now());
  const sleep = async (ms) => {
    if (typeof api.sleep === "function") await api.sleep(ms);
  };
  const canMoveTo =
    opts.canMoveTo ||
    ((x, y) => (typeof api.can_move_to === "function" ? api.can_move_to(x, y) : true));

  if (!dest || dest.x == null || dest.y == null) return { failed: true, reason: "bad_dest" };

  // Enter the map first. Live smart_move can fail to resolve a deep coordinate
  // across transporter boundaries even though both individual legs are valid.
  if (dest.map && dest.map !== api.character.map) {
    if (typeof api.smart_move !== "function") return { failed: true, reason: "cross_map" };
    let entry;
    try {
      entry = await api.smart_move({ map: dest.map });
    } catch (e) {
      entry = { failed: true, reason: (e && e.reason) || (e && e.message) || "entry_failed" };
    }
    if (entry && entry.failed) {
      const direct = await api.smart_move({ map: dest.map, x: dest.x, y: dest.y });
      if (direct && direct.failed) return direct;
    } else if (api.character.map !== dest.map) {
      return { failed: true, reason: "wrong_map" };
    } else if (distXY(xyOf(api.character), dest) > opts.arriveR) {
      const local = await api.smart_move({ map: dest.map, x: dest.x, y: dest.y });
      if (local && local.failed) return local;
    }
    if (distXY(xyOf(api.character), dest) <= opts.arriveR) return { success: true };
  }

  let dodges = 0;
  let brakes = 0;
  for (let i = 0; i < opts.maxSteps; i++) {
    if (api.character.rip) return { failed: true, reason: "rip", dodges, brakes };

    const now = nowFn();
    const raw = typeof opts.blockers === "function" ? opts.blockers() : opts.blockers || merchantAvoidListMonsters(api);
    const blockers = tracker.update(raw, now, opts.bodyR);

    // Soft zone: flee before hard contact-rip (wander can step onto us mid-tick).
    const me0 = xyOf(api.character);
    const threat = nearestBlocker(me0, blockers);
    if (threat && distXY(me0, threat) < opts.contactR + 10) {
      const fx = me0.x - threat.x;
      const fy = me0.y - threat.y;
      const fl = Math.hypot(fx, fy) || 1;
      const nx = me0.x + (fx / fl) * opts.stepPx;
      const ny = me0.y + (fy / fl) * opts.stepPx;
      if (canMoveTo(nx, ny)) {
        api.move(nx, ny);
        dodges++;
        await sleep(opts.tickMs);
        continue;
      }
    }
    if (applyContact(api, blockers, opts.contactR)) {
      return { failed: true, reason: "rip", dodges, brakes };
    }

    const me = xyOf(api.character);
    if (me.map && dest.map && me.map !== dest.map) {
      return { failed: true, reason: "wrong_map", dodges, brakes };
    }
    if (distXY(me, dest) <= opts.arriveR) {
      return { success: true, dodges, brakes, steps: i };
    }

    const step = suggestAvoidStep(
      api.character,
      dest,
      blockers,
      Object.assign({}, opts, { canMoveTo })
    );
    if (!step) {
      await sleep(opts.tickMs);
      brakes++;
      continue;
    }
    if (step.arrived) return { success: true, dodges, brakes, steps: i };
    if (step.brake) {
      brakes++;
      await sleep(opts.tickMs);
      continue;
    }
    if (step.panic || step.flee || Math.abs(step.progress) < opts.stepPx * 0.35) dodges++;

    const ok = api.move(step.x, step.y);
    if (!ok) {
      brakes++;
      await sleep(opts.tickMs);
      continue;
    }
    await sleep(opts.tickMs);
  }
  return { failed: true, reason: "timeout", dodges, brakes };
}

module.exports = {
  DEFAULTS,
  xyOf,
  distXY,
  createTracker,
  predict,
  minClearance,
  willCollide,
  nearestBlocker,
  nearestThreatDist,
  shouldEngageAvoid,
  suggestAvoidStep,
  listMonsters: merchantAvoidListMonsters,
  applyContact,
  goTo: merchantAvoidGoTo,
  merchantAvoidGoTo,
  merchantAvoidListMonsters,
};
