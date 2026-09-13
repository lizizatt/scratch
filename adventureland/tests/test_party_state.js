"use strict";

const assert = require("assert");
const { createPartyState } = require("../src/party_state");
const { bootFighter } = require("../src/fighter");
const { createWorld } = require("../sim");

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

test("formatDiff: publishes explicit living and dead state", () => {
  const st = createPartyState("Jazwyn");
  st.setSelf({ pots: "low", task: "moving", rip: false });
  assert.strictEqual(st.formatDiff(), "~d p=low rip=0 task=moving");
  st.setSelf({ rip: true });
  assert.strictEqual(st.formatDiff(), "~d p=low rip=1 task=moving");
});

test("applyDiff: textual rip zero clears stale death state", () => {
  const st = createPartyState("Sarene");
  st.S.members.Jazwyn.rip = true;
  st.applyDiff("Jazwyn", { task: "moving", rip: "0" });
  assert.strictEqual(st.S.members.Jazwyn.rip, false);
  assert.strictEqual(st.S.members.Jazwyn.task, "moving");
});

test("fighter: task-only transition publishes without a potion change", async () => {
  const w = createWorld();
  const j = w.spawn(
    { name: "Jazwyn", items: [{ name: "hpot1", q: 500 }, { name: "mpot1", q: 500 }] },
    "US",
    "II"
  );
  w.formParty("US/III", ["Jazwyn"]);
  const sent = [];
  const say = j.party_say.bind(j);
  j.party_say = (message) => {
    sent.push(message);
    return say(message);
  };
  const ctrl = bootFighter(j, { now: () => w.clock.now(), farm: "armadillo" });
  ctrl.chat.tick(w.clock.now());
  w.advance(16000);
  ctrl.state.setIntent({ hold: 1 });
  await ctrl.tick();
  assert.ok(sent.some((line) => /task=hold/.test(line)), JSON.stringify(sent));
});

module.exports = { tests };
