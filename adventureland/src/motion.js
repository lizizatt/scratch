"use strict";

const {
  FORM_R_IN,
  FORM_R_OUT,
  FORM_NEAR,
  FORM_FAR,
  FORM_REANCHOR,
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

function formationPos(lead, form, angle) {
  const dx = form.dx || 0;
  const dy = form.dy || 0;
  const x = lead.real_x != null ? lead.real_x : lead.x;
  const y = lead.real_y != null ? lead.real_y : lead.y;
  if (form.face && angle != null && !isNaN(angle)) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { map: lead.map, x: x + dx * c - dy * s, y: y + dx * s + dy * c };
  }
  return { map: lead.map, x: x + dx, y: y + dy };
}

/**
 * Present hysteresis + WaitParty + follow leader / formation / assemble.
 */
function createMotion(api, opts) {
  opts = opts || {};
  const leadName = () => opts.leadName();
  let presentSince = 0;
  let absentSince = 0;
  let present = false;
  let waitUntil = 0;
  let movingTask = false;
  let formAnchor = null;
  let formSlot = null;
  let lastLeadAngle = 0;

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

  function followersNear() {
    const party = api.get_party() || {};
    const names = Object.keys(party).filter((n) => n !== api.character.name);
    if (!names.length) return true;
    for (const n of names) {
      const p = api.get_player(n) || party[n];
      if (!p) return false;
      if (p.map && p.map !== api.character.map) return false;
      if (dist(api.character, p) > FORM_R_OUT) return false;
    }
    return true;
  }

  async function waitParty(now, ms) {
    waitUntil = now + (ms || WAIT_PARTY_MS);
    api.game_log("wait_party");
    const selfIsLead = leadName() === api.character.name;
    while ((opts.now ? opts.now() : Date.now()) < waitUntil) {
      const t = opts.now ? opts.now() : Date.now();
      if (selfIsLead ? followersNear() : evalPresent(t)) {
        waitUntil = 0;
        return true;
      }
      await api.sleep(500);
    }
    api.game_log("wait_timeout");
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
      const r = await api.smart_move({ map, x, y });
      if (r && r.failed) api.game_log("smart_fail " + (r.reason || "fail"));
      return !(r && r.failed);
    } catch (e) {
      api.game_log("smart_fail " + ((e && e.reason) || (e && e.message) || "err"));
      return false;
    } finally {
      movingTask = false;
    }
  }

  /**
   * Loose formation (legacy): face-relative slot, re-anchor when lead drifts,
   * walk with move() inside FORM_R_IN, smart_move when farther.
   */
  async function followFormation(form) {
    if (!form) return followLeader();
    const L = leadEnt();
    if (!L) return false;
    const lx = L.real_x != null ? L.real_x : L.x;
    const ly = L.real_y != null ? L.real_y : L.y;
    if (L.angle != null) lastLeadAngle = L.angle;
    const ang = L.angle != null ? L.angle : lastLeadAngle;
    const ad =
      !formAnchor || formAnchor.map !== L.map
        ? 1e9
        : Math.sqrt((lx - formAnchor.x) * (lx - formAnchor.x) + (ly - formAnchor.y) * (ly - formAnchor.y));
    if (!formSlot || ad > FORM_REANCHOR) {
      formSlot = formationPos({ map: L.map, real_x: lx, real_y: ly, x: lx, y: ly }, form, ang);
      formAnchor = { map: L.map, x: lx, y: ly };
    }
    const slot = formSlot;
    const d = api.character.map !== slot.map ? 1e9 : dist(api.character, slot);
    if (api.character.map === slot.map && d <= FORM_NEAR) {
      try {
        api.stop("smart");
      } catch (e) {}
      return true;
    }
    if (api.character.map === slot.map && d <= FORM_R_IN) {
      try {
        api.stop("smart");
      } catch (e) {}
      if (d > FORM_FAR) api.move(slot.x, slot.y);
      return true;
    }
    movingTask = true;
    try {
      const r = await api.smart_move({ map: slot.map, x: slot.x, y: slot.y });
      if (r && r.failed) api.game_log("smart_fail " + (r.reason || "fail"));
      return !(r && r.failed);
    } catch (e) {
      api.game_log("smart_fail " + ((e && e.reason) || (e && e.message) || "err"));
      return false;
    } finally {
      movingTask = false;
    }
  }

  async function goTo(dest) {
    movingTask = true;
    try {
      const r = await api.smart_move(dest);
      if (r && r.failed) api.game_log("smart_fail " + (r.reason || "fail"));
      return r;
    } catch (e) {
      api.game_log("smart_fail " + ((e && e.reason) || (e && e.message) || "err"));
      return { failed: true, reason: e };
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
    followFormation,
    goTo,
    spotRare,
    dist,
    formationPos,
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

module.exports = { createMotion, dist, formationPos };
