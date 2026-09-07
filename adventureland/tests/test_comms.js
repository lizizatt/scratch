"use strict";

const assert = require("assert");
const { createWorld } = require("../sim");
const { gradeFarmObserve, gradeLogs, mvpPass } = require("../sim/invariants");
const fs = require("fs");
const path = require("path");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("code chat: second message within 15s is chat_slowdown", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn", map: "main", real_x: 0, real_y: 0 });
  const a = j.party_say("~S f=armadillo");
  assert.strictEqual(a.ok, true);
  w.advance(10000);
  const b = j.party_say("~d p=low");
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.reason, "chat_slowdown");
  assert.ok(j.log.game.some((g) => /can't chat this fast/i.test(g.m)));
});

test("code chat: allowed after 16s", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn" });
  assert.strictEqual(j.party_say("one").ok, true);
  w.advance(16000);
  assert.strictEqual(j.party_say("two").ok, true);
});

test("human say resets window so code chat within 15s fails", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn" });
  w.comms.humanSay("Jazwyn", "!hold");
  w.advance(5000);
  const r = j.party_say("~S");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "chat_slowdown");
});

test("400ms floor blocks any rapid chat", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn" });
  assert.strictEqual(j.party_say("a").ok, true);
  // even without code gate, 400ms floor — but code gate fires first; advance past 15s then hit 400ms
  w.advance(16000);
  assert.strictEqual(j.party_say("b").ok, true);
  const r = j.party_say("c");
  assert.strictEqual(r.ok, false);
});

test("CM same-server delivers; cross-server omitted from receivers", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn" }, "US", "III");
  const p = w.spawn({ name: "Puppygirl" }, "US", "III");
  const got = [];
  p.on("cm", (m) => got.push(m.message));
  const r = await j.send_cm("Puppygirl", { job: "dlv_pots" });
  assert.deepStrictEqual(r.receivers, ["Puppygirl"]);
  assert.strictEqual(got.length, 1);

  p.change_server("US", "II");
  w.advance(60000); // reconnect
  w.tickReconnects();
  assert.strictEqual(w.where("Puppygirl").ident, "II");
  const r2 = await j.send_cm("Puppygirl", { job: "dlv_pots" });
  assert.deepStrictEqual(r2.receivers, []);
});

test("PM crosses servers", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn" }, "US", "III");
  const p = w.spawn({ name: "Puppygirl" }, "US", "II");
  const got = [];
  p.on("pm", (m) => got.push(m.message));
  const r = j.pm("Puppygirl", "meet_home");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(got[0], "meet_home");
});

test("get_player is vision-limited", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn", map: "main", real_x: 0, real_y: 0 });
  const s = w.spawn({ name: "Sarene", map: "main", real_x: 5000, real_y: 0 });
  w.formParty("US/III", ["Jazwyn", "Sarene"]);
  assert.strictEqual(j.get_player("Sarene"), null);
  assert.ok(j.get_party().Sarene);
  s.character.real_x = 100;
  s.character.x = 100;
  assert.ok(j.get_player("Sarene"));
});

test("smart_move to phoenix fails (no fixed spawn)", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn", map: "main", real_x: 0, real_y: 0 });
  const r = await j.smart_move({ to: "phoenix" });
  assert.strictEqual(r.failed, true);
});

test("smart_move to armadillo arrives with travel time", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn", map: "main", real_x: 0, real_y: 0 });
  const t0 = w.clock.now();
  const r = await j.smart_move({ to: "armadillo" });
  assert.strictEqual(r.success, true);
  assert.strictEqual(j.character.map, "main");
  assert.ok(Math.abs(j.character.real_x - 526) < 1);
  assert.ok(w.getOwedMs() > 0, "travel should be owed");
  w.drainOwedTime();
  assert.ok(w.clock.now() > t0);
});

test("path: routes around spider-island blocked rect", async () => {
  const { findPath, segmentHitsAny } = require("../sim/path");
  const { baseG } = require("../sim/world");
  const G = baseG();
  const blocked = G.maps.main.blocked;
  const from = { map: "main", x: 56, y: -122 };
  const to = { map: "main", x: 500, y: 200 };
  assert.ok(segmentHitsAny(from.x, from.y, to.x, to.y, blocked), "direct line must cross island");
  const wps = findPath(from, to, "main", G);
  assert.ok(wps && wps.length >= 2, "expected detour waypoints, got " + JSON.stringify(wps));
  // No waypoint inside blocked
  for (const p of wps) {
    assert.ok(!require("../sim/world").isBlocked("main", p.x, p.y, G), "wp in blocked " + JSON.stringify(p));
  }
  // Consecutive legs clear
  let prev = from;
  for (const p of wps) {
    assert.ok(!segmentHitsAny(prev.x, prev.y, p.x, p.y, blocked), "leg hits blocked " + JSON.stringify([prev, p]));
    prev = p;
  }
});

test("smart_move: Puppygirl walks multi-leg route past spider island", async () => {
  const w = createWorld();
  const p = w.spawn({ name: "Puppygirl", ctype: "merchant", map: "main", real_x: 56, real_y: -122 });
  const r = await p.smart_move({ map: "main", x: 500, y: 200 });
  assert.ok(r.success, JSON.stringify(r));
  assert.ok(r.waypoints && r.waypoints.length >= 2, "waypoints=" + JSON.stringify(r.waypoints));
  assert.ok(p.log.path.length >= 2, "path legs=" + p.log.path.length);
  w.drainOwedTime();
  assert.ok(Math.abs(p.character.real_x - 500) < 2);
  assert.ok(Math.abs(p.character.real_y - 200) < 2);
  // Never logged a straight-through single leg from start to end
  assert.ok(
    !p.log.path.some(
      (leg) =>
        leg.from.x === 56 &&
        leg.from.y === -122 &&
        Math.abs(leg.to.x - 500) < 1 &&
        Math.abs(leg.to.y - 200) < 1
    ),
    "must not take direct blocked chord"
  );
});

test("blocked spider-island rectangle rejects can_move_to", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn", map: "main" });
  assert.strictEqual(j.can_move_to(500, 0), false);
  assert.strictEqual(j.can_move_to(100, 100), true);
});

test("change_server wipes presence until reconnect; storage survives", async () => {
  const w = createWorld();
  const p = w.spawn({ name: "Puppygirl", map: "main" }, "US", "III");
  p.storage.setItem("dlv_q_Puppygirl", JSON.stringify({ q: [{ id: "1" }] }));
  p.change_server("US", "II");
  assert.strictEqual(p.character.connected, false);
  assert.strictEqual(p.storage.getItem("dlv_q_Puppygirl").indexOf('"1"') >= 0, true);
  w.advance(10000);
  assert.strictEqual(p.character.connected, false);
  w.advance(50000);
  assert.strictEqual(p.character.connected, true);
  assert.strictEqual(w.where("Puppygirl").key, "US/II");
});

test("server_region unset after reconnect for delay window", async () => {
  const w = createWorld();
  const p = w.spawn({ name: "Puppygirl" }, "US", "III");
  p.change_server("US", "II");
  w.advance(55000);
  assert.strictEqual(p.character.connected, true);
  assert.strictEqual(p.parent.server_region, null);
  w.advance(3000);
  assert.strictEqual(p.parent.server_region, "US");
  assert.strictEqual(p.parent.server_identifier, "II");
});

test("send_item requires same map + range + space", async () => {
  const w = createWorld();
  const p = w.spawn({ name: "Puppygirl", map: "main", real_x: 0, real_y: 0, esize: 10 });
  const j = w.spawn({ name: "Jazwyn", map: "main", real_x: 50, real_y: 0, esize: 10, items: new Array(42).fill(null) });
  p.character.items[0] = { name: "hpot1", q: 200 };
  p.character.esize = 9;
  const r = await p.send_item("Jazwyn", 0, 200);
  assert.strictEqual(r.success, true);
  assert.strictEqual(j.character.items.find((x) => x && x.name === "hpot1").q, 200);
});

test("invariant monitor grades farm observe artifact", async () => {
  const p = path.join(__dirname, "..", "legacy", "_live_farm_observe.json");
  const result = JSON.parse(fs.readFileSync(p, "utf8"));
  const c = gradeFarmObserve(result);
  assert.strictEqual(c.chat_throttle, 0);
  const m = mvpPass(c, { allowFighterHop: 0 });
  assert.strictEqual(m.pass, true, m.reasons.join(","));
});

test("invariant monitor detects phoenix path storm", async () => {
  const p = path.join(__dirname, "..", "legacy", "_live_phoenix_observe_run.txt");
  const buf = fs.readFileSync(p);
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
  const lines = text.split(/\r?\n/);
  const c = gradeLogs(lines);
  assert.ok(c.path_storm >= 10, "expected path storm, got " + c.path_storm);
  const m = mvpPass(c);
  assert.strictEqual(m.pass, false);
  assert.ok(m.reasons.some((r) => r.indexOf("path_storm") === 0));
});

test("per-character chat budgets are independent", async () => {
  const w = createWorld();
  const j = w.spawn({ name: "Jazwyn" });
  const s = w.spawn({ name: "Sarene" });
  assert.strictEqual(j.party_say("j1").ok, true);
  assert.strictEqual(s.party_say("s1").ok, true); // same tick, different writers — OK
});

module.exports = { tests };
