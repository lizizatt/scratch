"use strict";

const { HEAL_HP_PCT, HEAL_MP_PCT } = require("./constants");

/**
 * Use one emergency HP/MP potion at the shared fighter/merchant thresholds.
 * The API owns inventory selection and cooldown semantics in both live and sim.
 */
async function maybeUsePots(api) {
  if (!api || typeof api.use_skill !== "function") return false;
  const c = api.character;
  if (!c || c.max_hp == null) return false;
  try {
    if (c.hp / c.max_hp < HEAL_HP_PCT) {
      if (typeof api.is_on_cooldown === "function" && api.is_on_cooldown("use_hp")) return false;
      const r = await Promise.resolve(api.use_skill("use_hp"));
      return !(r && r.failed);
    }
    if (c.max_mp && c.mp / c.max_mp < HEAL_MP_PCT) {
      if (typeof api.is_on_cooldown === "function" && api.is_on_cooldown("use_mp")) return false;
      const r = await Promise.resolve(api.use_skill("use_mp"));
      return !(r && r.failed);
    }
  } catch (e) {}
  return false;
}

module.exports = { maybeUsePots };
