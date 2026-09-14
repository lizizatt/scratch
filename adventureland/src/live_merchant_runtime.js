"use strict";

/**
 * Live helpers for v2_merchant slot — exposes hunt/world/hold on global for console.
 */

function v2_err(e) {
  if (e == null) return String(e);
  if (typeof e === "string") return e;
  if (e.message) return e.message;
  if (e.reason) return String(e.reason);
  try {
    return JSON.stringify(e);
  } catch (x) {
    return String(e);
  }
}

function v2_start_merchant() {
  const api = createAlApi();
  const ctrl = bootMerchant(api, {});
  // Console surface (operator commands from Puppygirl only)
  hunt = function (mob) {
    return ctrl.hunt(mob);
  };
  hunt_quest = function (on) {
    return ctrl.hunt_quest(on);
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
  hunter_progression = function () {
    return ctrl.startHunterPlan();
  };

  // Mainframe hot-reload can re-run slot code in the same worker.
  // Prevent multiple interval tickers from piling up.
  const key = "__al_v2_merchant_tick_iv_" + (api.character && api.character.name ? api.character.name : "unknown");
  try {
    if (typeof globalThis !== "undefined" && globalThis[key]) clearInterval(globalThis[key]);
  } catch (e) {}

  let tickBusy = false;
  let emergencyRespawn = null;
  const iv = setInterval(function () {
    // Long smart_move/delivery awaits keep tickBusy true for seconds. Keep
    // checking life support from the interval while that work is active.
    if (tickBusy) {
      try {
        if (character.rip && !emergencyRespawn && ctrl.respawnIfDead) {
          emergencyRespawn = Promise.resolve(ctrl.respawnIfDead())
            .catch(function (e) {
              game_log("respawn:" + v2_err(e));
            })
            .finally(function () {
              emergencyRespawn = null;
            });
        }
        ctrl.usePots();
      } catch (e) {}
      return;
    }
    tickBusy = true;
    try {
      const p = ctrl.tick();
      if (p && typeof p.then === "function") {
        p.then(
          function () {
            tickBusy = false;
          },
          function (e) {
            tickBusy = false;
            game_log("mtick:" + v2_err(e));
          }
        );
        return;
      }
    } catch (e) {
      game_log("mtick:" + v2_err(e));
    }
    tickBusy = false;
  // Merchant planning scans the live bag and bank. Running that work at the
  // fighter cadence can exceed Mainframe's sustained CPU budget while idle;
  // 1.5s remains comfortably inside potion and logistics response windows.
  }, 1500);

  try {
    if (typeof globalThis !== "undefined") globalThis[key] = iv;
  } catch (e) {}
  return ctrl;
}
