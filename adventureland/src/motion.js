"use strict";

const {
  FORM_R_IN,
  FORM_R_OUT,
  PRESENT_EXIT_MS,
  WAIT_PARTY_MS,
  RARE_WHITELIST,
  ASSEMBLE_TIMEOUT_MS,
  RARE_GONE_MS,
} = require("./constants");

function dist(a, b) {
  const ax = a.real_x != null ? a.real_x : a.x;
  const ay = a.real_y != null ? a.real_y : a.y;
  const bx = b.real_x != null ? b.real_x : b.x;
  const by = b.real_y != null ? b.real_y : b.y;
  return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}

/**
 * Present hysteresis + WaitParty + follow leader / assemble.
 */
function createMotion(api, opts) {
  opts = opts || {};
  const leadName = () => opts.leadName();
  let presentSince = 0;
  let absentSince = 0;
  let present = false;
  let waitUntil = 0;
  let movingTask = false;

  function leadEnt() {
    const n = leadName();
    if (!n || n === api.character.name) return null;
    return api.get_player(n) || (api.get_party() || {})[n] || null;
  }

  function evalPresent(now) {
    const L = leadEnt();
    const inVision = !!api.get_player(leadName());
    if (!L) {
      present = false;
      return false;
    }
    const d = L.map && L.map !== api.character.map ? 1e9 : dist(api.character, L);
    if (!present) {
      if (inVision && d < FORM_R_IN) {
        present = true;
        presentSince = now;
        absentSince = 0;
      }
    } else {
      const bad = !inVision || d > FORM_R_OUT;
      // While leader moving, use party-list distance only
      const leadMoving = opts.leadMoving && opts.leadMoving();
      if (leadMoving) {
        if (L.map === api.character.map && d < FORM_R_OUT) {
          absentSince = 0;
        } else if (!absentSince) absentSince = now;
        else if (now - absentSince >= PRESENT_EXIT_MS) present = false;
      } else if (bad) {
        if (!absentSince) absentSince = now;
        else if (now - absentSince >= PRESENT_EXIT_MS) present = false;
      } else absentSince = 0;
    }
    return present;
  }

  async function waitParty(now, ms) {
    waitUntil = now + (ms || WAIT_PARTY_MS);
    api.game_log("wait_party");
    while ((opts.now ? opts.now() : Date.now()) < waitUntil) {
      if (evalPresent(opts.now ? opts.now() : Date.now())) {
        waitUntil = 0;
        return true;
      }
      await api.sleep(500);
    }
    api.game_log("wait_timeout");
    // abort move, re-anchor — do not proceed split
    try {
      api.stop("smart");
    } catch (e) {}
    waitUntil = 0;
    return false;
  }

  async function followLeader() {
    const L = leadEnt();
    if (!L) return false;
    const map = L.map || api.character.map;
    const x = L.real_x != null ? L.real_x : L.x;
    const y = L.real_y != null ? L.real_y : L.y;
    if (map === api.character.map && dist(api.character, { x, y }) <= FORM_R_IN) return true;
    movingTask = true;
    try {
      await api.smart_move({ map, x, y });
    } finally {
      movingTask = false;
    }
    return true;
  }

  async function goTo(dest) {
    movingTask = true;
    try {
      return await api.smart_move(dest);
    } finally {
      movingTask = false;
    }
  }

  function spotRare() {
    for (const mtype of RARE_WHITELIST) {
      const m = api.get_nearest_monster({ type: mtype });
      if (m && !m.dead) return m;
    }
    return null;
  }

  return {
    evalPresent,
    waitParty,
    followLeader,
    goTo,
    spotRare,
    dist,
    get present() {
      return present;
    },
    get moving() {
      return movingTask;
    },
    ASSEMBLE_TIMEOUT_MS,
    RARE_GONE_MS,
  };
}

module.exports = { createMotion, dist };
