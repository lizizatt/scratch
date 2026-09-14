"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  createEncounterMovement,
  capturePartyFrame,
  resolveCombatThreat,
} = require("../src/party_movement");
const { createCombatRunner } = require("../src/combat_runner");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function fixture(name, ctype, range) {
  let at = 1000;
  const self = {
    name,
    ctype,
    map: "main",
    real_x: 0,
    real_y: 0,
    x: 0,
    y: 0,
    hp: 1000,
    max_hp: 1000,
    mp: 1000,
    max_mp: 1000,
    range,
  };
  const peers = {};
  const moved = [];
  const api = {
    character: self,
    parent: { entities: {} },
    _now: () => at,
    get_player: (peer) => peers[peer] || null,
    can_move_to: () => true,
    move: (x, y) => {
      moved.push({ x, y, at });
      self.real_x = self.x = x;
      self.real_y = self.y = y;
      return true;
    },
  };
  return {
    api,
    self,
    peers,
    moved,
    advance(ms) {
      at += ms;
    },
  };
}

function monster(id, x, y, target) {
  return {
    id,
    type: "monster",
    mtype: "rat",
    map: "main",
    real_x: x,
    real_y: y,
    x,
    y,
    hp: 100,
    max_hp: 100,
    dead: false,
    target: target || null,
  };
}

test("combat rotations have no movement capability", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "combat_rotations.js"),
    "utf8"
  );
  assert.ok(!/\bapi\.(?:move|smart_move|stop)\s*\(/.test(source));
});

test("movement helpers cannot be overwritten by combat bundle globals", () => {
  const root = path.join(__dirname, "..", "src");
  const movementSource = fs.readFileSync(path.join(root, "party_movement.js"), "utf8");
  const combatSource = fs.readFileSync(path.join(root, "combat_rotations.js"), "utf8");
  const names = (source) =>
    new Set(
      Array.from(source.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)).map(
        (match) => match[1]
      )
    );
  const movementNames = names(movementSource);
  const combatNames = names(combatSource);
  const collisions = Array.from(movementNames).filter((name) => combatNames.has(name));
  assert.deepStrictEqual(collisions, []);
});

test("combat runner executes independently of the movement directive", () => {
  const f = fixture("Jazwyn", "warrior", 40);
  let rotations = 0;
  const runner = createCombatRunner(f.api, {
    rotation: (mtype, dyn) => {
      rotations++;
      assert.strictEqual(mtype, "rat");
      assert.strictEqual(dyn.target.id, "rat");
      return "attack";
    },
  });
  const target = monster("rat", 100, 0);
  const movement = createEncounterMovement(f.api);
  const movementResult = movement.tick({ target, mtype: "rat", isLead: true });
  const combatResult = runner.tick({
    target,
    mtype: "rat",
    isLead: true,
    leadName: "Jazwyn",
  });
  assert.strictEqual(movementResult.directive.kind, "direct");
  assert.strictEqual(combatResult.action, "attack");
  assert.strictEqual(rotations, 1);
});

test("party frame is shared immutable input", () => {
  const f = fixture("Jazwyn", "warrior", 40);
  const target = monster("rat", 30, 0);
  const frame = capturePartyFrame(f.api, {
    target,
    mtype: "rat",
    leadName: "Jazwyn",
    isLead: true,
  });
  assert.ok(Object.isFrozen(frame));
  assert.strictEqual(frame.target, target);
  assert.strictEqual(frame.self, f.self);
});

test("stationary fighter emits no repeated movement while in range", () => {
  const f = fixture("Jazwyn", "warrior", 40);
  const target = monster("rat", 30, 0);
  const movement = createEncounterMovement(f.api);
  const first = movement.tick({ target, mtype: "rat", isLead: true });
  f.advance(250);
  const second = movement.tick({ target, mtype: "rat", isLead: true });
  assert.strictEqual(first.directive.kind, "hold");
  assert.strictEqual(second.directive.kind, "hold");
  assert.strictEqual(f.moved.length, 0);
});

test("only deterministic lower-priority member yields an overlap", () => {
  const sarene = fixture("Sarene", "mage", 120);
  sarene.peers.Jazwyn = {
    name: "Jazwyn",
    map: "main",
    real_x: 2,
    real_y: 0,
  };
  const movement = createEncounterMovement(sarene.api);
  const result = movement.tick({ target: monster("rat", 80, 0), mtype: "rat" });
  assert.strictEqual(result.directive.posture, "separate");
  assert.strictEqual(sarene.moved.length, 1);

  const jazwyn = fixture("Jazwyn", "warrior", 40);
  jazwyn.peers.Sarene = {
    name: "Sarene",
    map: "main",
    real_x: 2,
    real_y: 0,
  };
  const anchor = createEncounterMovement(jazwyn.api);
  const held = anchor.tick({ target: monster("rat", 30, 0), mtype: "rat" });
  assert.strictEqual(held.directive.reason, "separate_priority");
  assert.strictEqual(jazwyn.moved.length, 0);
});

test("ranged fighter kites tangentially when personally threatened", () => {
  const f = fixture("Sarene", "mage", 120);
  const target = monster("rat", 40, 0, "Sarene");
  const movement = createEncounterMovement(f.api);
  const result = movement.tick({ target, threat: target, mtype: "rat" });
  assert.strictEqual(result.directive.posture, "kite");
  assert.ok(Math.abs(result.directive.y) > 20, "kite destination must include tangential motion");
  assert.strictEqual(f.moved.length, 1);
});

test("ranged fighter kites a secondary attacker without changing combat target", () => {
  const f = fixture("Sarene", "mage", 120);
  const combatTarget = monster("rat_primary", 80, 0);
  const threat = monster("rat_threat", 20, 0, "Sarene");
  f.api.parent.entities = {
    rat_primary: combatTarget,
    rat_threat: threat,
  };
  const movement = createEncounterMovement(f.api);
  const result = movement.tick({
    target: combatTarget,
    threat: resolveCombatThreat(f.api),
    mtype: "rat",
  });

  test("distant personal threat does not replace the movement target", () => {
    const f = fixture("Jazwyn", "warrior", 40);
    const combatTarget = monster("rat_primary", 100, 0);
    const threat = monster("rat_threat", 30, 0, "Jazwyn");
    const movement = createEncounterMovement(f.api);
    const result = movement.tick({
      target: combatTarget,
      threat,
      mtype: "rat",
    });
    assert.strictEqual(result.directive.posture, "approach");
    assert.ok(result.directive.x > 40, "warrior must continue toward the combat target");
  });

  test("ranged fighter escapes exact overlap with a threat", () => {
    const f = fixture("Sarene", "mage", 120);
    const threat = monster("rat_threat", 0, 0, "Sarene");
    const movement = createEncounterMovement(f.api);
    const result = movement.tick({
      target: threat,
      threat,
      mtype: "rat",
    });
    assert.strictEqual(result.directive.posture, "kite");
    assert.ok(
      Math.hypot(result.directive.x, result.directive.y) > 1,
      "kite destination must leave the overlap"
    );
  });
  assert.strictEqual(result.frame.target, combatTarget);
  assert.strictEqual(result.frame.threat, threat);
  assert.strictEqual(result.directive.posture, "kite");
});

test("unchanged movement destination is command-rate limited", () => {
  const f = fixture("Jazwyn", "warrior", 5);
  const target = monster("rat", 100, 0);
  const movement = createEncounterMovement(f.api);
  movement.tick({ target, mtype: "rat", isLead: true });
  f.self.real_x = f.self.x = 0;
  f.advance(250);
  movement.tick({ target, mtype: "rat", isLead: true });
  assert.strictEqual(f.moved.length, 1);
});

module.exports = { tests };
