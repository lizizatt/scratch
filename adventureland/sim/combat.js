"use strict";

/**
 * Lightweight farm combat for sim (and shared shape with live slots).
 * Tank closes to melee; supports follow lead-target for assist DPS.
 * leadName/isLead always come from the caller (fighter.js `state.S.lead`, the
 * same dynamic succession source motion.js formation/follow uses) — no
 * hardcoded fighter name here.
 */

function dist(a, b) {
  const ax = a.real_x != null ? a.real_x : a.x;
  const ay = a.real_y != null ? a.real_y : a.y;
  const bx = b.real_x != null ? b.real_x : b.x;
  const by = b.real_y != null ? b.real_y : b.y;
  return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}

function stepToward(api, t, stepPx) {
  stepPx = stepPx == null ? 28 : stepPx;
  if (!t || t.dead) return false;
  const d = dist(api.character, t);
  const range = api.character.range || 40;
  if (d <= range) return true;
  const dx = (t.real_x != null ? t.real_x : t.x) - api.character.real_x;
  const dy = (t.real_y != null ? t.real_y : t.y) - api.character.real_y;
  const s = Math.min(stepPx, Math.max(4, d - range + 2));
  const nx = api.character.real_x + (dx / d) * s;
  const ny = api.character.real_y + (dy / d) * s;
  api.character.angle = Math.atan2(dy, dx);
  if (typeof api.move === "function") api.move(nx, ny);
  return dist(api.character, t) <= range;
}

function pickTarget(api, mtype, opts) {
  opts = opts || {};
  const leadName = opts.leadName || api.character.name;
  const isLead = opts.isLead != null ? opts.isLead : api.character.name === leadName;
  let t = null;
  if (!isLead) {
    const lead = typeof api.get_player === "function" ? api.get_player(leadName) : null;
    const tid = lead && lead.target;
    if (tid && api.get_monster) t = api.get_monster(tid);
    if ((!t || t.dead) && api.parent && api.parent.entities && tid) t = api.parent.entities[tid];
  }
  if (!t || t.type !== "monster" || t.dead) {
    if (typeof api.get_targeted_monster === "function") t = api.get_targeted_monster();
    if ((!t || t.dead || (mtype && t.mtype !== mtype)) && typeof api.get_nearest_monster === "function") {
      t = api.get_nearest_monster({ type: mtype }) || api.get_nearest_monster({ type: mtype, no_target: true });
    }
  }
  if (!t || t.type !== "monster" || t.dead) return null;
  return t;
}

/** Warrior / tank: close to melee then swing. */
function combatTank(api, mtype, opts) {
  if (api.character.rip) return;
  if (typeof api.is_moving === "function" && api.is_moving()) return;
  const t = pickTarget(api, mtype, Object.assign({ isLead: true }, opts));
  if (!t) return;
  if (typeof api.change_target === "function") api.change_target(t);
  if (typeof api.set_message === "function") api.set_message("Hunt " + t.mtype);
  if (!api.is_in_range(t)) {
    stepToward(api, t, 32);
    return;
  }
  if (typeof api.can_attack === "function" && api.can_attack(t)) api.attack(t);
}

/** Mage/priest assist: only swing lead's target when in range (formation handles spacing). */
function combatAssist(api, mtype, opts) {
  if (api.character.rip) return;
  if (typeof api.is_moving === "function" && api.is_moving()) return;
  const t = pickTarget(api, mtype, Object.assign({ isLead: false }, opts));
  if (!t) {
    if (typeof api.set_message === "function") api.set_message("Idle");
    return;
  }
  if (typeof api.change_target === "function") api.change_target(t);
  if (typeof api.set_message === "function") api.set_message("Hunt " + t.mtype);
  if (!api.is_in_range(t)) {
    // Soft nudge only — stay mostly on formation slot
    stepToward(api, t, 16);
    return;
  }
  if (typeof api.can_attack === "function" && api.can_attack(t)) api.attack(t);
}

module.exports = {
  dist,
  stepToward,
  pickTarget,
  combatTank,
  combatAssist,
};
