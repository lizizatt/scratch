"use strict";

const assert = require("assert");
const { createPartyState } = require("../src/party_state");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("applyHeartbeat: stale seq is ignored (no farm poison)", () => {
  const st = createPartyState("Sarene");
  st.applyHeartbeat("Jazwyn", { f: "armadillo", m: "farm", h: 0, seq: 5 }, ["Jazwyn", "Sarene"]);
  assert.strictEqual(st.S.intent.mtype, "armadillo");
  st.applyHeartbeat("Jazwyn", { f: "bee", m: "farm", h: 0, seq: 3 }, ["Jazwyn", "Sarene"]);
  assert.strictEqual(st.S.intent.mtype, "armadillo", "older seq must not rewrite mtype");
  assert.strictEqual(st.S.seq.Jazwyn, 5);
});

test("applyHeartbeat: non-lead cannot rewrite farm/mode/hold", () => {
  const st = createPartyState("Jazwyn");
  st.applyHeartbeat("Jazwyn", { f: "armadillo", m: "farm", h: 0, seq: 1 }, ["Jazwyn", "Sarene", "Zarook"]);
  st.applyHeartbeat("Zarook", { f: "bee", m: "rare", h: 1, seq: 1 }, ["Jazwyn", "Sarene", "Zarook"]);
  assert.strictEqual(st.S.intent.mtype, "armadillo");
  assert.strictEqual(st.S.mode, "farm");
  assert.strictEqual(st.S.intent.hold, 0);
  assert.strictEqual(st.S.seq.Zarook, 1, "seq still tracks non-lead");
});

test("applyHeartbeat: succession lead Sarene may publish", () => {
  const st = createPartyState("Zarook");
  st.S.lead = "Jazwyn";
  st.applyHeartbeat("Sarene", { f: "bee", m: "farm", h: 0, seq: 2 }, ["Sarene", "Zarook"]);
  assert.strictEqual(st.S.lead, "Sarene");
  assert.strictEqual(st.S.intent.mtype, "bee");
});

module.exports = { tests };
