"use strict";

/**
 * Sim/scenario driver: accept Daisy hunt → farm via existing !hunt intent → turn in.
 * Does not change live fighter tick by default; tests/scenarios call this explicitly.
 */
const { packCenter } = require("./packs");
const {
  DAISY,
  getHunt,
  huntComplete,
  shouldInteractDaisy,
  canAcceptHunts,
} = require("./monsterhunt");

async function goDaisy(api) {
  // Coords first (LESSONS); named to:"monsterhunt" also works in sim.
  let r = await api.smart_move({ map: DAISY.map, x: DAISY.x, y: DAISY.y });
  if (r && r.failed) r = await api.smart_move({ to: "monsterhunt" });
  return !(r && r.failed);
}

/**
 * One full cycle: Daisy → farm hunt.id until c===0 → Daisy turn-in.
 * @param {object} p bootParty result
 * @param {string} hunterName usually Jazwyn
 * @param {object} [opts]
 * @param {number} [opts.maxTicks=800]
 * @param {function} [opts.onAccept]
 */
async function runOneMonsterHunt(p, hunterName, opts) {
  opts = opts || {};
  const api = p.bots[hunterName].api;
  const ctrl = p.bots[hunterName].ctrl;
  if (!canAcceptHunts(api.character.ctype)) {
    api.game_log("mhunt:merchant_skip");
    return { failed: true, reason: "merchant" };
  }

  if (!(await goDaisy(api))) {
    api.game_log("mhunt:daisy_path_fail");
    return { failed: true, reason: "path" };
  }
  if (!shouldInteractDaisy(api.character)) {
    api.game_log("mhunt:busy c=" + (getHunt(api.character) && getHunt(api.character).c));
    return { failed: true, reason: "busy" };
  }

  const acc = await api.interact("monsterhunt");
  if (acc && acc.failed) {
    api.game_log("mhunt:accept_fail " + (acc.reason || ""));
    return { failed: true, reason: acc.reason || "accept" };
  }
  if (!(acc && acc.started)) {
    api.game_log("mhunt:accept_miss");
    return { failed: true, reason: "no_start" };
  }

  const hunt = getHunt(api.character);
  if (!hunt || !hunt.id) return { failed: true, reason: "no_hunt" };
  api.game_log("mhunt:start id=" + hunt.id + " c=" + hunt.c + " sn=" + hunt.sn);
  if (typeof opts.onAccept === "function") opts.onAccept(hunt);

  // Drive existing party intent (farm !hunt infrastructure).
  if (ctrl && typeof ctrl.applyCmd === "function") {
    ctrl.applyCmd({ cmd: "hunt", args: [hunt.id] });
  }

  const pc = packCenter(hunt.id);
  if (pc) {
    // Coords move to pack before tick-farm — walking from Daisy every tick is too slow at 30px/s.
    const mr = await api.smart_move({ map: pc.map, x: pc.x, y: pc.y });
    if (mr && mr.failed) {
      api.game_log("mhunt:pack_path_fail");
      return { failed: true, reason: "pack_path" };
    }
    if (typeof p.world.spawnPack === "function") {
      const key = (api.parent.server_region || "US") + "/" + (api.parent.server_identifier || "III");
      p.world.spawnPack(key, pc.map, hunt.id, pc, 5);
    }
  }

  const maxTicks = opts.maxTicks != null ? opts.maxTicks : 800;
  for (let i = 0; i < maxTicks; i++) {
    const h = getHunt(api.character);
    if (!h) return { failed: true, reason: "hunt_cleared" };
    if (huntComplete(h)) break;
    await p.tickAll();
  }

  const mid = getHunt(api.character);
  if (!huntComplete(mid)) {
    api.game_log("mhunt:timeout c=" + (mid && mid.c));
    return { failed: true, reason: "timeout", hunt: mid };
  }

  if (!(await goDaisy(api))) {
    api.game_log("mhunt:return_path_fail");
    return { failed: true, reason: "return_path" };
  }
  const done = await api.interact("monsterhunt");
  if (done && done.failed) {
    api.game_log("mhunt:turnin_fail " + (done.reason || ""));
    return { failed: true, reason: done.reason || "turnin" };
  }
  if (!(done && done.completed)) {
    api.game_log("mhunt:turnin_miss");
    return { failed: true, reason: "no_complete" };
  }
  api.game_log("mhunt:done id=" + hunt.id);
  return { success: true, id: hunt.id };
}

/**
 * Run N sequential Daisy hunts (queue assigned by sim world.monsterHuntQueue).
 */
async function runMonsterHuntSeries(p, hunterName, n, opts) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await runOneMonsterHunt(p, hunterName, opts);
    out.push(r);
    if (r && r.failed) break;
  }
  return out;
}

module.exports = { goDaisy, runOneMonsterHunt, runMonsterHuntSeries };
