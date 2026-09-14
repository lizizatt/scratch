"use strict";

/**
 * The combat runner owns rotation execution. It deliberately has no movement
 * fallback: every tick either performs an action or reports why none was legal.
 */
function createCombatRunner(api, opts) {
  opts = opts || {};

  function tick(input) {
    if (!api.character || api.character.rip) return { action: "blocked" };
    if (opts.preCombat) {
      const pre = opts.preCombat(api, input);
      if (pre) return { action: pre, target: input.target || null };
    }
    if (!opts.rotation) return { action: "idle", target: input.target || null };
    return {
      action: opts.rotation(
        input.mtype,
        {
          leadName: input.leadName,
          isLead: input.isLead,
          target: input.target || null,
        },
        api
      ),
      target: input.target || null,
    };
  }

  return { tick };
}

module.exports = { createCombatRunner };
