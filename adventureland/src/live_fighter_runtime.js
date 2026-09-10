"use strict";

/**
 * Live helpers appended to v2_fighter slot (globals after compress).
 * Expects: bootFighter, createAlApi, FIGHTERS, character, use_skill, …
 */

function v2_use_pots() {
  try {
    if (typeof is_on_cooldown === "function" && is_on_cooldown("use_hp")) return;
    if (character.hp / character.max_hp < 0.55) use_skill("use_hp");
    else if (character.mp / character.max_mp < 0.5) use_skill("use_mp");
  } catch (e) {}
}

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
  const iv = setInterval(function () {
    if (tickBusy) return;
    tickBusy = true;
    try {
      v2_use_pots();
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
