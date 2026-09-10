"use strict";

/**
 * Merchant meet / transit geometry — pure helpers used by bootMerchant.
 * Keep pack-safe approach math out of the god-file tick loop.
 *
 * Name prefix `meet*` so compress (strip require) does not collide with
 * local wrappers inside merchant.js.
 */

const { FARM_XY, packCenter, safeMeet, nearPack, PACK_DANGER_R } = require("./packs");
const { merchantAvoidListMonsters } = require("./merchant_avoid");

/** Prefer the pack nearest a fresh fighter location over stale persisted intent. */
function meetFarmAt(farm, map, x, y) {
  if (map == null || x == null || y == null) return farm;
  let found = null;
  let best = Infinity;
  for (const mtype of Object.keys(FARM_XY)) {
    const p = FARM_XY[mtype];
    if (!p || p.map !== map) continue;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < best) {
      found = mtype;
      best = d;
    }
  }
  return found && best <= PACK_DANGER_R + 120 ? found : farm;
}

/**
 * On avoid fail: never smart_move into/through pack danger — town/retreat instead.
 * Open-field timeouts may still fall back to smart_move.
 */
function avoidFailPolicy(farm, selfMap, selfX, selfY, dest) {
  if (farm && nearPack(farm, selfMap, selfX, selfY)) return "retreat";
  if (farm && dest && nearPack(farm, dest.map || selfMap, dest.x, dest.y)) return "retreat";
  return "smart_move";
}

/**
 * Stand within SEND_RANGE of fighter without entering pack aggro.
 * If fighter is on pack, approach along the vector toward safeMeet.
 */
function meetApproachPoint(t, farm, sendRange) {
  const limit = sendRange || 320;
  const fx = t.real_x != null ? t.real_x : t.x;
  const fy = t.real_y != null ? t.real_y : t.y;
  const fmap = t.map;
  if (!farm || !nearPack(farm, fmap, fx, fy)) {
    return { map: fmap, x: fx, y: fy };
  }
  const safe = safeMeet(farm) || { map: fmap, x: fx, y: fy - (PACK_DANGER_R + 80) };
  let dx = safe.x - fx;
  let dy = safe.y - fy;
  const len = Math.hypot(dx, dy) || 1;
  const want = Math.min(limit - 40, len);
  let x = fx + (dx / len) * want;
  let y = fy + (dy / len) * want;
  if (nearPack(farm, fmap, x, y)) {
    x = safe.x;
    y = safe.y;
  }
  return { map: fmap, x: Math.round(x), y: Math.round(y) };
}

/** Delivery destination: safe approach to fighter, or safeMeet if no vision. */
function meetResolveDelivery(api, job, sendRange) {
  const farm = meetFarmAt(job.farm, job.map, job.x, job.y);
  const t = api.get_player(job.who);
  if (t && !t.rip) {
    const tx = t.real_x != null ? t.real_x : t.x;
    const ty = t.real_y != null ? t.real_y : t.y;
    return meetApproachPoint(t, meetFarmAt(farm, t.map, tx, ty), sendRange);
  }
  if (job.map != null && job.x != null && job.y != null) {
    const observedFarm = meetFarmAt(null, job.map, job.x, job.y);
    if (observedFarm) {
      const safe = safeMeet(observedFarm);
      if (safe) return safe;
    }
    if (!farm || !nearPack(farm, job.map, job.x, job.y)) {
      return { map: job.map, x: job.x, y: job.y };
    }
  }
  if (farm) {
    const safe = safeMeet(farm);
    if (safe) return safe;
  }
  const c = farm && packCenter(farm);
  if (c) return { map: c.map, x: c.x, y: c.y - 400 };
  return null;
}

/** Monsters that threaten transit — ignore the farm pack (safeMeet standoff handles those). */
function meetTransitBlockers(api, farm) {
  return merchantAvoidListMonsters(api).filter(meetTransitBlockerFilter(api, farm));
}

/** Same filter as meetTransitBlockers, for avoid goTo blocker refresh. */
function meetTransitBlockerFilter(api, farm) {
  return (m) => {
    if (!m || m.dead) return false;
    const mx = m.real_x != null ? m.real_x : m.x;
    const my = m.real_y != null ? m.real_y : m.y;
    if (farm && nearPack(farm, m.map || api.character.map, mx, my)) return false;
    return true;
  };
}

module.exports = {
  avoidFailPolicy,
  meetFarmAt,
  meetApproachPoint,
  meetResolveDelivery,
  meetTransitBlockers,
  meetTransitBlockerFilter,
};
