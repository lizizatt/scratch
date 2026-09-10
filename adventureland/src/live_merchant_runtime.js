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

  // Mainframe hot-reload can re-run slot code in the same worker.
  // Prevent multiple interval tickers from piling up.
  const key = "__al_v2_merchant_tick_iv_" + (api.character && api.character.name ? api.character.name : "unknown");
  try {
    if (typeof globalThis !== "undefined" && globalThis[key]) clearInterval(globalThis[key]);
  } catch (e) {}

  let tickBusy = false;
  const iv = setInterval(function () {
    if (tickBusy) return;
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
  }, 400);

  try {
    if (typeof globalThis !== "undefined") globalThis[key] = iv;
  } catch (e) {}
  return ctrl;
}
