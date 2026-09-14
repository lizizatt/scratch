"use strict";

const { LEADER_ORDER, FORM_R_OUT } = require("./constants");

const MOVEMENT = {
  holdRadius: 18,
  commandDeadband: 12,
  commandCadenceMs: 500,
  separationEnter: 20,
  separationExit: 34,
  orbitStep: 34,
  interceptHorizonMs: 750,
};

function movementPoint(entity) {
  if (!entity) return null;
  const x = entity.real_x != null ? entity.real_x : entity.x;
  const y = entity.real_y != null ? entity.real_y : entity.y;
  return x == null || y == null ? null : { x, y };
}

function movementDistance(a, b) {
  const ap = movementPoint(a);
  const bp = movementPoint(b);
  return ap && bp ? Math.hypot(ap.x - bp.x, ap.y - bp.y) : Infinity;
}

function movementVisibleMonsters(api) {
  const entities = (api.parent && api.parent.entities) || {};
  return Object.keys(entities)
    .map((id) => entities[id])
    .filter(
      (entity) =>
        entity &&
        entity.type === "monster" &&
        !entity.dead &&
        !/^target(?:_|$)/.test(entity.mtype || "")
    );
}

function movementValidTarget(target, mtype) {
  return !!(
    target &&
    target.type === "monster" &&
    !target.dead &&
    (!mtype || target.mtype === mtype) &&
    !/^target(?:_|$)/.test(target.mtype || "")
  );
}

/**
 * Resolve once per farm tick so movement and combat use the same monster.
 * Reachability is movement policy, not target eligibility.
 */
function resolveCombatTarget(api, mtype, dyn) {
  if (!api.character) return null;
  if (dyn && movementValidTarget(dyn.target, mtype)) return dyn.target;
  const leadName = (dyn && dyn.leadName) || "Jazwyn";
  const lead = api.get_player(leadName);
  const isLead = dyn && dyn.isLead != null ? dyn.isLead : api.character.name === leadName;
  let target = null;
  if (!isLead && lead && lead.target && api.get_monster) {
    target = api.get_monster(lead.target) || ((api.parent && api.parent.entities) || {})[lead.target];
  }
  if (!movementValidTarget(target, mtype) && api.get_targeted_monster) target = api.get_targeted_monster();
  if (!movementValidTarget(target, mtype)) {
    target = movementVisibleMonsters(api)
      .filter((monster) => !mtype || monster.mtype === mtype)
      .sort((a, b) => {
        const aClaimed = a.target && a.target !== api.character.name ? 1 : 0;
        const bClaimed = b.target && b.target !== api.character.name ? 1 : 0;
        return (
          aClaimed - bClaimed ||
          movementDistance(api.character, a) - movementDistance(api.character, b) ||
          String(a.id).localeCompare(String(b.id))
        );
      })[0];
  }
  return movementValidTarget(target, mtype) ? target : null;
}

function resolveCombatThreat(api) {
  if (!api.character) return null;
  return (
    movementVisibleMonsters(api)
      .filter((monster) => monster.target === api.character.name)
      .sort(
        (a, b) =>
          movementDistance(api.character, a) - movementDistance(api.character, b) ||
          String(a.id).localeCompare(String(b.id))
      )[0] || null
  );
}

function capturePartyFrame(api, input) {
  const at = api._now ? api._now() : Date.now();
  const self = api.character;
  const members = LEADER_ORDER.map((name) =>
    name === self.name ? self : api.get_player(name)
  ).filter(Boolean);
  return Object.freeze({
    frameId: at + ":" + self.name,
    now: at,
    self,
    members,
    target: input.target || null,
    threat: input.threat || null,
    mtype: input.mtype || null,
    leadName: input.leadName || "Jazwyn",
    isLead: !!input.isLead,
    pack: input.pack || null,
  });
}

function movementHold(reason) {
  return { kind: "hold", reason };
}

function movementBlocked(reason) {
  return { kind: "hold", reason, blocked: true };
}

function movementDirect(x, y, reason, posture) {
  return { kind: "direct", x, y, reason, posture };
}

function movementClampStep(from, to, maxStep) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (!d || d <= maxStep) return { x: to.x, y: to.y };
  return { x: from.x + (dx / d) * maxStep, y: from.y + (dy / d) * maxStep };
}

function createEncounterMovement(api) {
  const samples = {};
  let lastCommand = null;
  let lastBlockedAt = -Infinity;
  let separationPeer = null;

  function safePoint(x, y) {
    return !api.can_move_to || api.can_move_to(x, y);
  }

  function planSeparation(frame) {
    const selfIndex = LEADER_ORDER.indexOf(frame.self.name);
    let closest = null;
    for (const peer of frame.members) {
      if (peer.name === frame.self.name || peer.map !== frame.self.map) continue;
      const d = movementDistance(frame.self, peer);
      if (d < MOVEMENT.separationEnter && (!closest || d < closest.distance)) {
        closest = { peer, distance: d };
      }
    }
    if (!closest) {
      separationPeer = null;
      return null;
    }
    const peerIndex = LEADER_ORDER.indexOf(closest.peer.name);
    if (selfIndex >= 0 && peerIndex >= 0 && selfIndex < peerIndex) {
      return movementHold("separate_priority");
    }
    const selfPoint = movementPoint(frame.self);
    const peerPoint = movementPoint(closest.peer);
    let dx = selfPoint.x - peerPoint.x;
    let dy = selfPoint.y - peerPoint.y;
    if (!dx && !dy) {
      const angle = ((selfIndex < 0 ? 0 : selfIndex) * 2 * Math.PI) / LEADER_ORDER.length;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
    }
    const len = Math.hypot(dx, dy) || 1;
    const destination = {
      x: selfPoint.x + (dx / len) * MOVEMENT.separationExit,
      y: selfPoint.y + (dy / len) * MOVEMENT.separationExit,
    };
    separationPeer = closest.peer.name;
    return safePoint(destination.x, destination.y)
      ? movementDirect(destination.x, destination.y, "separate:" + separationPeer, "separate")
      : movementBlocked("separate_blocked");
  }

  function sampleTarget(frame) {
    const target = frame.target;
    if (!target) return null;
    const p = movementPoint(target);
    const previous = samples[target.id];
    const current = {
      x: p.x,
      y: p.y,
      at: frame.now,
      range: movementDistance(frame.self, target),
    };
    samples[target.id] = current;
    if (!previous || current.at <= previous.at) return { current, previous: null, vx: 0, vy: 0 };
    const dt = current.at - previous.at;
    return {
      current,
      previous,
      vx: ((current.x - previous.x) * 1000) / dt,
      vy: ((current.y - previous.y) * 1000) / dt,
    };
  }

  function planKite(frame, targetSample, desiredRange) {
    const selfPoint = movementPoint(frame.self);
    const targetPoint = targetSample.current;
    let dx = selfPoint.x - targetPoint.x;
    let dy = selfPoint.y - targetPoint.y;
    if (!dx && !dy) {
      const index = Math.max(0, LEADER_ORDER.indexOf(frame.self.name));
      const angle = (index * 2 * Math.PI) / LEADER_ORDER.length;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
    }
    const d = Math.hypot(dx, dy) || 1;
    const radialError = desiredRange - d;
    const direction = frame.self.name === "Sarene" ? 1 : -1;
    const tangentX = direction * (-dy / d);
    const tangentY = direction * (dx / d);
    const radialX = dx / d;
    const radialY = dy / d;
    const destination = {
      x: selfPoint.x + tangentX * MOVEMENT.orbitStep + radialX * radialError * 0.5,
      y: selfPoint.y + tangentY * MOVEMENT.orbitStep + radialY * radialError * 0.5,
    };
    return safePoint(destination.x, destination.y)
      ? movementDirect(destination.x, destination.y, "kite", "kite")
      : movementBlocked("kite_blocked");
  }

  function planApproach(frame, targetSample, desiredRange) {
    const selfPoint = movementPoint(frame.self);
    const targetPoint = targetSample.current;
    const dx = selfPoint.x - targetPoint.x;
    const dy = selfPoint.y - targetPoint.y;
    const d = Math.hypot(dx, dy) || 1;
    const outwardVelocity =
      ((targetPoint.x - selfPoint.x) * targetSample.vx +
        (targetPoint.y - selfPoint.y) * targetSample.vy) /
      d;
    const fleeing =
      targetSample.previous &&
      (targetSample.current.range > targetSample.previous.range + 1 || outwardVelocity > 2);
    let destination;
    if (fleeing) {
      const horizon = MOVEMENT.interceptHorizonMs / 1000;
      destination = {
        x: targetPoint.x + targetSample.vx * horizon,
        y: targetPoint.y + targetSample.vy * horizon,
      };
    } else {
      destination = {
        x: targetPoint.x + (dx / d) * desiredRange,
        y: targetPoint.y + (dy / d) * desiredRange,
      };
    }
    destination = movementClampStep(selfPoint, destination, 80);
    if (!safePoint(destination.x, destination.y)) return movementBlocked("approach_blocked");
    return movementDirect(
      destination.x,
      destination.y,
      fleeing ? "pursue_flee" : "approach",
      fleeing ? "pursue_flee" : "approach"
    );
  }

  function plan(frame) {
    if (!frame.self || frame.self.rip) return movementHold("disabled");
    const separation = planSeparation(frame);
    if (separation) return separation;
    if (!frame.target) return movementHold("no_target");
    const range = Math.max(1, Number(frame.self.range || 40));
    const desiredRange = frame.self.ctype === "warrior" ? Math.min(25, range * 0.6) : range * 0.72;
    const ranged = frame.self.ctype === "mage" || frame.self.ctype === "priest";
    const threat = frame.threat;
    if (
      ranged &&
      threat &&
      movementDistance(frame.self, threat) < desiredRange * 0.85
    ) {
      return planKite(
        frame,
        sampleTarget(Object.assign({}, frame, { target: threat })),
        desiredRange
      );
    }
    const targetSample = sampleTarget(frame);
    const targetDistance = targetSample.current.range;
    if (targetDistance <= range) return movementHold("in_range");
    return planApproach(frame, targetSample, desiredRange);
  }

  function apply(directive, at) {
    if (!directive) return { emitted: false, directive };
    if (directive.kind === "hold") {
      if (directive.blocked && at - lastBlockedAt >= 5000 && api.game_log) {
        api.game_log("combat_path_blocked " + (directive.mtype || directive.reason || "movement"));
        lastBlockedAt = at;
      }
      return { emitted: false, blocked: !!directive.blocked, directive };
    }
    if (directive.kind !== "direct") return { emitted: false, directive };
    if (
      lastCommand &&
      at - lastCommand.at < MOVEMENT.commandCadenceMs &&
      Math.hypot(directive.x - lastCommand.x, directive.y - lastCommand.y) <
        MOVEMENT.commandDeadband
    ) {
      return { emitted: false, directive };
    }
    if (!safePoint(directive.x, directive.y)) {
      if (at - lastBlockedAt >= 5000 && api.game_log) {
        api.game_log("combat_path_blocked " + (directive.mtype || directive.posture || "movement"));
        lastBlockedAt = at;
      }
      return { emitted: false, blocked: true, directive };
    }
    const result = api.move(directive.x, directive.y);
    if (result !== false) lastCommand = { x: directive.x, y: directive.y, at };
    if (result === false && at - lastBlockedAt >= 5000 && api.game_log) {
      api.game_log("combat_path_blocked " + (directive.mtype || directive.posture || "movement"));
      lastBlockedAt = at;
    }
    return { emitted: result !== false, blocked: result === false, directive };
  }

  function tick(input) {
    const frame = capturePartyFrame(api, input);
    const directive = plan(frame);
    directive.mtype = frame.mtype;
    return { frame, directive, execution: apply(directive, frame.now) };
  }

  return { plan, apply, tick };
}

module.exports = {
  MOVEMENT,
  point: movementPoint,
  movementDistance,
  visibleMonsters: movementVisibleMonsters,
  resolveCombatTarget,
  resolveCombatThreat,
  capturePartyFrame,
  createEncounterMovement,
};
