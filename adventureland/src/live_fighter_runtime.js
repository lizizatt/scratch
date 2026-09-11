"use strict";

/**
 * Live helpers appended to v2_fighter slot (globals after compress).
 * Expects: bootFighter, createAlApi, FIGHTERS, character, use_skill, …
 * Emergency heal-pot use (hp/mp below trigger %) now lives in fighter.js's
 * own tick (maybeUsePots) so it's simulation-testable; no separate interval
 * needed here anymore.
 */

function v2_invite_party(ctrl) {
  try {
    if (!ctrl || !ctrl.isLead || !ctrl.isLead()) return;
    const p = get_party() || {};
    for (let i = 0; i < FIGHTERS.length; i++) {
      const n = FIGHTERS[i];
      if (n !== character.name && !p[n]) send_party_invite(n);
    }
  } catch (e) {}
}

function v2_start_fighter(opts) {
  opts = opts || {};
  const api = createAlApi();
  const ctrl = bootFighter(api, opts);
  let lastInvite = 0;

  // Mainframe hot-reload can re-run slot code in the same worker.
  // Prevent multiple interval tickers from piling up.
  const key = "__al_v2_fighter_tick_iv_" + (api.character && api.character.name ? api.character.name : "unknown");
  try {
    if (typeof globalThis !== "undefined" && globalThis[key]) clearInterval(globalThis[key]);
  } catch (e) {}

  let tickBusy = false;
  let emergencyRespawn = null;
  const iv = setInterval(function () {
    if (tickBusy) {
      try {
        if (character.rip && !emergencyRespawn && ctrl.respawnIfDead) {
          emergencyRespawn = Promise.resolve(ctrl.respawnIfDead())
            .catch(function (e) {
              const msg = e && e.message ? e.message : e && e.reason ? e.reason : e;
              game_log("respawn:" + (typeof msg === "string" ? msg : JSON.stringify(msg)));
            })
            .finally(function () {
              emergencyRespawn = null;
            });
        }
      } catch (e) {}
      return;
    }
    tickBusy = true;
    try {
      try {
        loot();
      } catch (e) {}
      const now = Date.now();
      if (now - lastInvite > 5000) {
        lastInvite = now;
        v2_invite_party(ctrl);
      }
      const p = ctrl.tick();
      if (p && typeof p.then === "function") {
        p.catch(function (e) {
          const msg = e && e.message ? e.message : e && e.reason ? e.reason : e;
          game_log("tick:" + (typeof msg === "string" ? msg : JSON.stringify(msg)));
        }).finally(function () {
          tickBusy = false;
        });
      } else {
        tickBusy = false;
      }
    } catch (e) {
      tickBusy = false;
      const msg = e && e.message ? e.message : e && e.reason ? e.reason : e;
      game_log("tick:" + (typeof msg === "string" ? msg : JSON.stringify(msg)));
    }
  }, 250);

  try {
    if (typeof globalThis !== "undefined") globalThis[key] = iv;
  } catch (e) {}
  return ctrl;
}

function on_party_invite(name) {
  if (typeof FIGHTERS !== "undefined" && FIGHTERS.indexOf(name) >= 0) {
    try {
      accept_party_invite(name);
      game_log("party:accept " + name);
    } catch (e) {}
  }
}
