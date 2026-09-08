"use strict";

/**
 * Live helpers for v2_merchant slot — exposes hunt/world/hold on global for console.
 */

function v2_start_merchant() {
  const api = createAlApi();
  const ctrl = bootMerchant(api, {});
  // Console surface (operator commands from Puppygirl only)
  hunt = function (mob) {
    return ctrl.hunt(mob);
  };
  grind = function () {
    return ctrl.grind();
  };
  hold = function () {
    return ctrl.hold();
  };
  resume = function () {
    return ctrl.resume();
  };
  world = function (spec) {
    return ctrl.world(spec);
  };
  setInterval(function () {
    try {
      const p = ctrl.tick();
      if (p && typeof p.then === "function") p.catch(function (e) {
        game_log("mtick:" + (e && e.message ? e.message : e));
      });
    } catch (e) {
      game_log("mtick:" + (e && e.message ? e.message : e));
    }
  }, 400);
  return ctrl;
}
