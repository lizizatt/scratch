"use strict";

const assert = require("assert");
const { loadScript } = require("./al_env");

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const flush = () => new Promise((r) => setTimeout(r, 30));

function merchant(over) {
  const items = new Array(42).fill(null);
  items[0] = { name: "stand0", q: 1 };
  const env = loadScript("merchant.js", Object.assign({
    name: "puppygirl", ctype: "merchant", gold: 500000, map: "main", items, esize: 38,
    real_x: 40, real_y: -20, _server: ["US", "III"]
  }, over || {}));
  env.SURVEY_MS = 500;
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character._bank = env.character.bank;
  return env;
}

function placeFighter(env, name, over) {
  const items = new Array(42).fill(null);
  items[0] = { name: "hpot1", q: 5 };
  items[1] = { name: "mpot1", q: 5 };
  env.parent.entities[name] = Object.assign({
    name, type: "character", map: "main", real_x: 40, real_y: -20, esize: 5, items, rip: false
  }, over || {});
  return env.parent.entities[name];
}

function wireGot(env) {
  const real = env.send_cm.bind(env);
  env.send_cm = async (name, data) => {
    const r = await real(name, data);
    if (data && data.dlv_sent && env.dlv_active) {
      env.dlv_active._got = { v: 1, dlv_got: 1, id: data.id, ok: 1 };
    }
    return r;
  };
}

const SAMPLES = [
  { farm: "goo", map: "main", x: 0, y: 180 },
  { farm: "croc", map: "main", x: 801, y: 1710 },
  { farm: "bat", map: "cave", x: -194, y: -461 },
  { farm: "arcticbee", map: "winterland", x: 1082, y: -873 },
  { farm: "porcupine", map: "desertland", x: -829, y: 135 }
];

for (const sample of SAMPLES) {
  test("field deliver pots at " + sample.farm + " without fighter moving", async () => {
    const env = merchant();
    env.GOLD_FLOAT = 0;
    const fighterStart = { map: sample.map, real_x: sample.x, real_y: sample.y, esize: 4 };
    const f = placeFighter(env, "Jazwyn", fighterStart);
    wireGot(env);
    env.emitCm("Jazwyn", {
      v: 1, dlv_req: 1, id: "f_" + sample.farm, kind: "pots",
      items: [{ name: "hpot1", q: 20 }],
      map: sample.map, x: sample.x, y: sample.y,
      server: ["US", "III"], esize: 4, farm: sample.farm
    });
    await flush();
    const r = await env.deliver_tick();
    assert.strictEqual(r, "done", sample.farm + " result=" + r);
    assert.strictEqual(f.map, sample.map, "fighter stayed on " + sample.map);
    assert.ok(Math.abs(f.real_x - sample.x) < 1 && Math.abs(f.real_y - sample.y) < 1, "fighter coords unchanged");
    assert.ok(env.log.sent.some((s) => s.item === "hpot1"));
    assert.ok((env.log.path || []).some((p) => p.to && p.to.map === sample.map), "merchant path reached " + sample.map);
    assert.ok(!(env.log.cm || []).some((c) => c.data && c.data.dlv_meet), "no meet request");
  });
}

test("fighter dry cancel stops merchant order", async () => {
  const env = merchant();
  placeFighter(env, "Jazwyn", { map: "cave", real_x: -194, real_y: -461, esize: 4 });
  env.emitCm("Jazwyn", {
    v: 1, dlv_req: 1, id: "dry1", kind: "pots",
    items: [{ name: "hpot1", q: 40 }],
    map: "cave", x: -194, y: -461, server: ["US", "III"], esize: 4, farm: "bat"
  });
  await flush();
  assert.ok(env.dlv_has_work());
  env.emitCm("Jazwyn", { v: 1, dlv_cancel: 1, id: "dry1", reason: "dry" });
  await flush();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!env.dlv_has_work(), "queue cleared on dry cancel");
  assert.ok((env.log.game || []).some((s) => /dlv:cancel id=dry1/.test(s) || /dlv:done id=dry1 ok=0/.test(s)));
});

test("fighter ignores meet and stays farming", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "hpot1", q: 20 };
  items[1] = { name: "mpot1", q: 20 };
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", items, gold: 50000, esize: 20,
    map: "cave", level: 42, real_x: -194, real_y: -461, _server: ["US", "III"]
  });
  env.dlv_pending = { id: "m1", kind: "pots", t0: Date.now(), acked: 1 };
  env.emitCm("puppygirl", { v: 1, dlv_meet: 1, id: "m1", where: "potions" });
  assert.strictEqual(env.character.map, "cave");
  assert.ok((env.log.game || []).some((s) => /dlv:meet ignored/.test(s)));
  assert.ok(!env.dlv_pending.meet);
});

test("fighter dry_pots towns and cancels delivery", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "helmet", q: 1 };
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", items, gold: 50000, esize: 20,
    map: "cave", level: 42, real_x: -194, real_y: -461, _server: ["US", "III"]
  });
  env.hold = false;
  env.dlv_pending = { id: "dry2", kind: "pots", t0: Date.now(), acked: 1 };
  assert.strictEqual(env.dry_pots(), true);
  await env.logistics();
  assert.ok((env.log.cm || []).some((c) => c.data && c.data.dlv_cancel && c.data.reason === "dry"));
  assert.ok(
    env.log.moved.some((d) => d && (d.to === "potions" || d.to === "bank" || (d.map === "main" && d.x != null))),
    "moves to potions plaza or bank"
  );
  assert.ok(!env.dlv_pending || env.dlv_pending.id !== "dry2", "old dry job cleared");
});

test("fighter tosses bank loot to nearby merchant", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "hpot1", q: 80 };
  items[1] = { name: "mpot1", q: 80 };
  items[2] = { name: "gem0", q: 1 };
  items[3] = { name: "snakefang", q: 1 };
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", items, gold: 5000, esize: 20,
    map: "cave", level: 42, real_x: 100, real_y: 100, _server: ["US", "III"]
  });
  env.parent.entities.Puppygirl = {
    name: "Puppygirl", type: "character", map: "cave", real_x: 110, real_y: 100,
    esize: 10, items: new Array(42).fill(null), rip: false
  };
  const n = await env.toss_loot();
  assert.ok(n >= 1, "toss count=" + n);
  assert.ok(env.log.sent.some((s) => s.item === "gem0" || s.item === "snakefang"));
  assert.ok(env.quantity("hpot1") >= 80);
});

test("toss_loot ignores stale merchant esize and still attempts", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "hpot1", q: 80 };
  items[1] = { name: "mpot1", q: 80 };
  items[2] = { name: "gem0", q: 1 };
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", items, gold: 5000, esize: 20,
    map: "cave", level: 42, real_x: 100, real_y: 100, _server: ["US", "III"]
  });
  env.parent.entities.Puppygirl = {
    name: "Puppygirl", type: "character", map: "cave", real_x: 110, real_y: 100,
    esize: 0, items: new Array(42).fill(null), rip: false
  };
  await env.toss_loot();
  assert.ok(!(env.log.game || []).some((s) => /toss skip/.test(s)), "must not skip on remote esize");
  assert.ok((env.log.game || []).some((s) => /toss fail|toss gem0/.test(s)));
});

test("toss_loot logs skip when merchant missing", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "hpot1", q: 80 };
  items[1] = { name: "mpot1", q: 80 };
  items[2] = { name: "gem0", q: 1 };
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", items, gold: 5000, esize: 20,
    map: "cave", level: 42, real_x: 100, real_y: 100, _server: ["US", "III"]
  });
  const n = await env.toss_loot();
  assert.strictEqual(n, 0);
  assert.ok((env.log.game || []).some((s) => /toss skip no_merch/.test(s)));
});

test("party survey aggregates needs, multi-drops pots, loots, returns town", async () => {
  const env = merchant({ map: "main", real_x: 40, real_y: -20, esize: 30 });
  env.GOLD_FLOAT = 0;
  const jaz = placeFighter(env, "Jazwyn", {
    map: "cave", real_x: -194, real_y: -461, esize: 6,
    needItems: [{ name: "hpot1", q: 30 }, { name: "mpot1", q: 20 }],
    items: (() => {
      const a = new Array(42).fill(null);
      a[0] = { name: "hpot1", q: 5 };
      a[1] = { name: "mpot1", q: 5 };
      a[2] = { name: "gem0", q: 1 };
      a[3] = { name: "snakefang", q: 1 };
      return a;
    })()
  });
  const sar = placeFighter(env, "Sarene", {
    map: "cave", real_x: -180, real_y: -450, esize: 6,
    needItems: [{ name: "hpot1", q: 25 }],
    items: (() => {
      const a = new Array(42).fill(null);
      a[0] = { name: "hpot1", q: 10 };
      a[1] = { name: "mpot1", q: 40 };
      a[2] = { name: "intearring", q: 1 };
      return a;
    })()
  });
  placeFighter(env, "Zarook", {
    map: "cave", real_x: -170, real_y: -440, esize: 8,
    needItems: [],
    items: (() => {
      const a = new Array(42).fill(null);
      a[0] = { name: "hpot1", q: 200 };
      a[1] = { name: "mpot1", q: 200 };
      a[2] = { name: "seashell", q: 1 };
      return a;
    })()
  });
  wireGot(env);
  env.emitCm("Jazwyn", {
    v: 1, dlv_req: 1, id: "party1", kind: "pots",
    items: [{ name: "hpot1", q: 30 }, { name: "mpot1", q: 20 }],
    map: "cave", x: -194, y: -461, server: ["US", "III"], esize: 6, farm: "bat"
  });
  await flush();
  const r = await env.deliver_tick();
  assert.strictEqual(r, "done", "result=" + r);
  assert.ok((env.log.game || []).some((s) => /dlv:need_q Jazwyn/.test(s)));
  assert.ok((env.log.game || []).some((s) => /dlv:need_q Sarene/.test(s)));
  assert.ok((env.log.game || []).some((s) => /dlv:survey /.test(s)));
  assert.ok(env.log.bought.some((b) => b.name === "hpot1" && b.q >= 55), "bought aggregated hpot");
  assert.ok(env.log.sent.some((s) => s.name === "Jazwyn" && s.item === "hpot1"));
  assert.ok(env.log.sent.some((s) => s.name === "Sarene" && s.item === "hpot1"));
  assert.ok((env.log.looted || []).some((l) => l.from === "Jazwyn" && l.item === "gem0"));
  assert.ok((env.log.looted || []).some((l) => l.from === "Sarene" && l.item === "intearring"));
  assert.ok((env.log.looted || []).some((l) => l.from === "Zarook" && l.item === "seashell"));
  assert.ok((env.log.game || []).some((s) => /dlv:home/.test(s)));
  assert.ok(env.character.map === "bank" || env.character.map === "main");
  assert.strictEqual(jaz.map, "cave");
  assert.strictEqual(sar.map, "cave");
});

test("fighter answers need_q and loot_q without pending job", async () => {
  const items = new Array(42).fill(null);
  items[0] = { name: "hpot1", q: 40 };
  items[1] = { name: "mpot1", q: 40 };
  items[2] = { name: "gem0", q: 1 };
  const env = loadScript("warrior.js", {
    name: "Jazwyn", ctype: "warrior", items, gold: 50000, esize: 20,
    map: "cave", level: 42, real_x: -194, real_y: -461, _server: ["US", "III"]
  });
  env.parent.entities.Puppygirl = {
    name: "Puppygirl", type: "character", map: "cave", real_x: -190, real_y: -461,
    esize: 10, items: new Array(42).fill(null), rip: false
  };
  env.emitCm("puppygirl", { v: 1, dlv_need_q: 1, id: "nq1" });
  await flush();
  assert.ok((env.log.cm || []).some((c) => c.data && c.data.dlv_need && c.data.id === "nq1"));
  env.emitCm("puppygirl", { v: 1, dlv_loot_q: 1, id: "nq1" });
  await flush();
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(env.log.sent.some((s) => s.item === "gem0"));
  assert.ok((env.log.cm || []).some((c) => c.data && c.data.dlv_loot_done));
});

test("world smart_move records cross-map path cost", async () => {
  const env = merchant({ map: "main", real_x: 40, real_y: -20 });
  await env.smart_move({ to: "bat" });
  assert.strictEqual(env.character.map, "cave");
  assert.ok((env.log.path || []).some((p) => p.dist > 2000));
});

module.exports = { tests };
