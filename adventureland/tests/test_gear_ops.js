"use strict";

const assert = require("assert");
const { loadScript } = require("./al_env");

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function flush(ms) { return new Promise((r) => setTimeout(r, ms == null ? 20 : ms)); }

function merchant(extra) {
  const items = new Array(42).fill(null);
  items[0] = { name: "stand0", q: 1 };
  return loadScript("merchant.js", Object.assign({
    name: "puppygirl", ctype: "merchant", gold: 400000, map: "main", items, esize: 40,
    real_x: 40, real_y: -20, _server: ["US", "II"]
  }, extra || {}));
}

function placeFighter(env, name, over) {
  const items = new Array(42).fill(null);
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

test("merchant hear_gear stores gear_ad esize from CM not vision", () => {
  const env = merchant();
  env.emitCm("Sarene", { gear_ad: 1, name: "Sarene", esize: 3, slots: { ring1: "-" } });
  assert.ok(env.gear_ads.Sarene);
  assert.strictEqual(env.gear_ads.Sarene.esize, 3);
});

test("plan_gifts prefers spiked shield over plain via dreturn score", () => {
  const env = merchant({ gold: 400000, esize: 30, map: "bank" });
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "sshield", level: 0, q: 1 };
  env.character._bank = env.character.bank;
  env.snap_bank();
  env.gear_ads.Jazwyn = {
    gear_ad: 1, name: "Jazwyn", esize: 4, _t: Date.now(),
    slots: { offhand: "shield@0", mainhand: "-", helmet: "-", chest: "-", pants: "-", shoes: "-", gloves: "-", cape: "-", belt: "-", amulet: "-", ring1: "-", ring2: "-" }
  };
  const gifts = env.plan_gifts();
  assert.ok(gifts.some((g) => g.who === "Jazwyn" && g.slot === "offhand" && g.it.name === "sshield"));
});

test("plan_gifts skips wrong-class weapons and full bags", () => {
  const env = merchant({ gold: 400000, esize: 30, map: "bank" });
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "staff", level: 0, q: 1 };
  env.character.bank.items0[1] = { name: "fireblade", level: 0, q: 1 };
  env.character._bank = env.character.bank;
  env.snap_bank();
  env.gear_ads.Jazwyn = {
    gear_ad: 1, name: "Jazwyn", esize: 0, _t: Date.now(),
    slots: { mainhand: "-", offhand: "-", helmet: "-", chest: "-", pants: "-", shoes: "-", gloves: "-", cape: "-", belt: "-", amulet: "-", ring1: "-", ring2: "-" }
  };
  env.gear_ads.Sarene = {
    gear_ad: 1, name: "Sarene", esize: 3, _t: Date.now(),
    slots: { mainhand: "-", offhand: "-", helmet: "-", chest: "-", pants: "-", shoes: "-", gloves: "-", cape: "-", belt: "-", amulet: "-", ring1: "-", ring2: "-" }
  };
  const gifts = env.plan_gifts();
  assert.ok(!gifts.some((g) => g.who === "Jazwyn"), "no space");
  assert.ok(gifts.some((g) => g.who === "Sarene" && g.it.name === "staff"));
  assert.ok(!gifts.some((g) => g.who === "Sarene" && g.it.name === "fireblade"));
});

test("run_gear_session holds, offers, waits got, resumes", async () => {
  const env = merchant({ gold: 400000, esize: 30, map: "main", x: 40, y: -20 });
  env.CYCLE_MS = 1;
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "sshield", level: 1, q: 1 };
  env.character._bank = env.character.bank;
  env.snap_bank();
  placeFighter(env, "Jazwyn", { real_x: 50, real_y: -20, esize: 5 });
  env.gear_ads.Jazwyn = {
    gear_ad: 1, name: "Jazwyn", esize: 5, _t: Date.now(),
    slots: { offhand: "-", mainhand: "-", helmet: "-", chest: "-", pants: "-", shoes: "-", gloves: "-", cape: "-", belt: "-", amulet: "-", ring1: "-", ring2: "-" }
  };
  const realCm = env.send_cm.bind(env);
  env.send_cm = async (name, data) => {
    const r = await realCm(name, data);
    if (data && data.gear_offer && data.id) {
      env.gear_offer_ids[data.id] = { gear_got: 1, id: data.id, ok: 1, name: data.name, slot: data.slot };
    }
    return r;
  };
  const r = await env.run_gear_session();
  assert.strictEqual(r, "ok");
  assert.ok(env.log.cm.some((c) => c.data && c.data.hold === 1));
  assert.ok(env.log.cm.some((c) => c.data && c.data.hold === 0));
  assert.ok(env.log.cm.some((c) => c.data && c.data.gear_offer === 1 && c.data.name === "sshield"));
  assert.ok(env.log.sent.some((s) => s && s.name === "Jazwyn"));
  assert.strictEqual(env.gear_session, false);
});

test("run_cycle skips stock_store while gear_session is sticky", async () => {
  const env = merchant({ gold: 400000, esize: 38 });
  env.gear_session = true;
  env.stock_store = async () => { env._stocked = true; return true; };
  env.run_combine = async () => {};
  env.upgrade_one = async () => null;
  env.ponty_buy = async () => null;
  env.run_gear_session = async () => "ok";
  const r = await env.run_econ();
  assert.strictEqual(r, true);
  assert.ok(!env._stocked, "stock must wait out gear_session");
});

test("pick_upgrade skips candycanesword grade>0", () => {
  const env = merchant();
  env.GEAR_RISK = 1;
  env.character.items[1] = { name: "candycanesword", level: 0 };
  env.character.items[2] = { name: "coat", level: 0 };
  assert.strictEqual(env.pick_upgrade(), 2);
});

test("pick_upgrade allows fireblade UNIQUE scroll1", () => {
  const env = merchant();
  env.GEAR_RISK = 1;
  env.character.items[1] = { name: "fireblade", level: 0 };
  assert.strictEqual(env.pick_upgrade(), 1);
  assert.strictEqual(env.scroll_for(env.character.items[1]), "scroll1");
});

test("pick_upgrade allows sshield on scroll0 list", () => {
  const env = merchant();
  env.GEAR_RISK = 0;
  env.character.items[1] = { name: "sshield", level: 0 };
  assert.strictEqual(env.pick_upgrade(), 1);
});

test("pick_upgrade skips UNIQUE when GEAR_RISK=0", () => {
  const env = merchant();
  env.GEAR_RISK = 0;
  env.character.items[1] = { name: "epyjamas", level: 0 };
  env.character.items[2] = { name: "eears", level: 0 };
  env.character.items[3] = { name: "coat", level: 1 };
  assert.strictEqual(env.pick_upgrade(), 3);
});

test("GEAR_RISK=1 allows UNIQUE scroll0 upgrades", () => {
  const env = merchant();
  env.GEAR_RISK = 1;
  env.character.items[1] = { name: "epyjamas", level: 0 };
  assert.strictEqual(env.pick_upgrade(), 1);
});

test("GEAR_RISK=1 allows UNIQUE scroll1 at grade boundary", () => {
  const env = merchant();
  env.GEAR_RISK = 1;
  env.character.items[1] = { name: "xmashat", level: 4 };
  assert.strictEqual(env.pick_upgrade(), 1);
  assert.strictEqual(env.scroll_for(env.character.items[1]), "scroll1");
});

test("upgrade_one buys scroll1 for grade1 UNIQUE", async () => {
  const env = merchant({ gold: 400000, esize: 38 });
  env.GOLD_FLOAT = 0;
  env.GEAR_RISK = 1;
  env.character.items[1] = { name: "xmashat", level: 4 };
  const r = await env.upgrade_one();
  assert.strictEqual(r, "ok");
  assert.ok(env.log.bought.some((b) => b && b.name === "scroll1"));
  assert.strictEqual(env.character.items[1].level, 5);
});

test("upgrade_one uses calculate preview before real upgrade", async () => {
  const env = merchant({ gold: 400000, esize: 38 });
  env.GOLD_FLOAT = 0;
  env.GEAR_RISK = 0;
  env.character.items[1] = { name: "coat", level: 0 };
  env.character.items[2] = { name: "scroll0", q: 2 };
  const r = await env.upgrade_one();
  assert.strictEqual(r, "ok");
  assert.ok(env.log.upgraded.length >= 1);
  assert.strictEqual(env.character.items[1].level, 1);
});

test("ponty_buy purchases whitelist wbook0 under fair cap", async () => {
  const env = merchant({ gold: 400000, esize: 38 });
  env.GOLD_FLOAT = 100000;
  env.ponty = [{ name: "wbook0", rid: "w1", price: 20000, level: 0 }];
  const r = await env.ponty_buy();
  assert.strictEqual(r, "ok");
  assert.ok(env.log.secondhand.some((s) => s.name === "wbook0"));
  assert.ok(env.character.items.some((it) => it && it.name === "wbook0"));
});

test("ponty_buy still buys sshield when wbook0 already owned", async () => {
  const env = merchant({ gold: 400000, esize: 38 });
  env.GOLD_FLOAT = 100000;
  env.character.items[1] = { name: "wbook0", q: 1 };
  env.ponty = [
    { name: "wbook0", rid: "w1", price: 20000, level: 0 },
    { name: "sshield", rid: "s1", price: 40000, level: 0 }
  ];
  const r = await env.ponty_buy();
  assert.strictEqual(r, "ok");
  assert.ok(env.log.secondhand.some((s) => s.name === "sshield"));
  assert.ok(env.character.items.some((it) => it && it.name === "sshield"));
});

test("ponty_buy skips sshield when quota filled", async () => {
  const env = merchant({ gold: 400000, esize: 38 });
  env.GOLD_FLOAT = 100000;
  env.PONTY_WANT = [["sshield", 1], ["wbook0", 1]];
  env.character.items[1] = { name: "sshield", q: 1 };
  env.ponty = [{ name: "sshield", rid: "s1", price: 40000, level: 0 }];
  const r = await env.ponty_buy();
  assert.strictEqual(r, null);
  assert.deepStrictEqual(env.log.secondhand, []);
});

test("ponty_buy buys snakefang armorring mat under fair cap", async () => {
  const env = merchant({ gold: 400000, esize: 38 });
  env.GOLD_FLOAT = 100000;
  env.ponty = [{ name: "snakefang", rid: "f1", price: 2000, level: 0 }];
  const r = await env.ponty_buy();
  assert.strictEqual(r, "ok");
  assert.ok(env.log.secondhand.some((s) => s.name === "snakefang"));
});

test("ponty_buy prefers cheapest needed among fireblade craft mats and combine fodder", async () => {
  const env = merchant({ gold: 400000, esize: 38 });
  env.GOLD_FLOAT = 100000;
  env.ponty = [
    { name: "essenceoffire", rid: "e1", price: 90000, level: 0 },
    { name: "blade", rid: "b1", price: 12000, level: 0 },
    { name: "ringsj", rid: "r1", price: 40000, level: 0 },
    { name: "staff", rid: "st1", price: 20000, level: 0 },
    { name: "shield", rid: "sh1", price: 40000, level: 0 },
    { name: "hpbelt", rid: "hb1", price: 25000, level: 0 },
    { name: "hpamulet", rid: "ha1", price: 25000, level: 0 }
  ];
  const r = await env.ponty_buy();
  assert.strictEqual(r, "ok");
  assert.ok(env.log.secondhand.some((s) => s.name === "blade"));
  assert.strictEqual(env.log.secondhand.length, 1);
});

test("ponty_buy skips blade when blade+essence quotas filled but still buys shield", async () => {
  const env = merchant({ gold: 400000, esize: 38 });
  env.GOLD_FLOAT = 100000;
  env.character.items[1] = { name: "blade", q: 2 };
  env.character.items[2] = { name: "essenceoffire", q: 2 };
  env.character.items[3] = { name: "staff", q: 2 };
  env.character.items[4] = { name: "ringsj", q: 6 };
  env.character.items[5] = { name: "hpbelt", q: 3 };
  env.character.items[6] = { name: "hpamulet", q: 3 };
  env.ponty = [
    { name: "blade", rid: "b1", price: 10000, level: 0 },
    { name: "shield", rid: "sh1", price: 40000, level: 0 }
  ];
  const r = await env.ponty_buy();
  assert.strictEqual(r, "ok");
  assert.ok(env.log.secondhand.some((s) => s.name === "shield"));
  assert.ok(!env.log.secondhand.some((s) => s.name === "blade"));
});

test("HOLD protects Ponty craft mats and plain shield from sale listing", async () => {
  const env = merchant({ gold: 400000, esize: 30 });
  env.character.items[1] = { name: "blade", q: 1, level: 0 };
  env.character.items[2] = { name: "essenceoffire", q: 1 };
  env.character.items[3] = { name: "shield", q: 1, level: 0 };
  env.character.items[4] = { name: "helmet", q: 1, level: 0 };
  assert.strictEqual(env.hold_item(env.character.items[1]), true);
  assert.strictEqual(env.hold_item(env.character.items[2]), true);
  assert.strictEqual(env.hold_item(env.character.items[3]), true);
  assert.strictEqual(env.sell_ok(env.character.items[1]), false);
  assert.strictEqual(env.sell_ok(env.character.items[4]), true);
  await env.list_sale();
  assert.ok(!env.log.traded.some((t) => t.i === 1 || t.i === 2 || t.i === 3));
  assert.ok(env.log.traded.some((t) => t.i === 4));
});

test("ponty_buy rejects overpriced whitelist", async () => {
  const env = merchant({ gold: 400000, esize: 38 });
  env.ponty = [{ name: "wbook0", rid: "w1", price: 999999, level: 0 }];
  const r = await env.ponty_buy();
  assert.strictEqual(r, null);
  assert.deepStrictEqual(env.log.secondhand, []);
});

test("upgrade_one pulls eligible coat from bank after park", async () => {
  const env = merchant({ gold: 400000, esize: 40, map: "bank" });
  env.GOLD_FLOAT = 0;
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "coat", level: 1 };
  env.character._bank = env.character.bank;
  env.character.items[1] = { name: "scroll0", q: 2 };
  const r = await env.upgrade_one();
  assert.strictEqual(r, "ok");
  assert.ok(env.log.retrieved.length >= 1);
  assert.ok(env.log.upgraded.length >= 1);
});

test("dlv_req queues job and acks ok", async () => {
  const env = merchant();
  env.emitCm("Jazwyn", {
    v: 1, dlv_req: 1, id: "p1", kind: "pots",
    items: [{ name: "hpot1", q: 40 }], map: "main", x: 40, y: -20,
    server: ["US", "III"], esize: 4
  });
  await flush();
  assert.ok(env.dlv_has_work());
  assert.ok(env.log.cm.some((c) => c.data && c.data.dlv_ack && c.data.ok === 1 && c.data.id === "p1"));
  assert.ok((env.log.game || []).some((s) => /dlv:req id=p1/.test(s)));
  assert.ok((env.log.game || []).some((s) => /dlv:ack id=p1 ok=1/.test(s)));
});

test("dlv_req rejects no_space", async () => {
  const env = merchant();
  env.emitCm("Jazwyn", {
    v: 1, dlv_req: 1, id: "full1", kind: "pots",
    items: [{ name: "hpot1", q: 40 }], map: "main", x: 0, y: 0,
    server: ["US", "III"], esize: 0
  });
  await flush();
  assert.ok(!env.dlv_has_work());
  assert.ok(env.log.cm.some((c) => c.data && c.data.dlv_ack && c.data.ok === 0 && c.data.reason === "no_space"));
});

test("duplicate dlv_req re-acks without double queue", async () => {
  const env = merchant();
  const req = {
    v: 1, dlv_req: 1, id: "dup1", kind: "pots",
    items: [{ name: "hpot1", q: 10 }], map: "main", x: 0, y: 0,
    server: ["US", "III"], esize: 3
  };
  env.emitCm("Jazwyn", req);
  await flush();
  assert.strictEqual(env.dlv_q.filter((j) => j.id === "dup1").length, 1);
  const t0 = env.dlv_q[0].t0;
  await new Promise((r) => setTimeout(r, 5));
  env.emitCm("Jazwyn", req);
  await flush();
  assert.strictEqual(env.dlv_q.filter((j) => j.id === "dup1").length, 1);
  assert.strictEqual(env.dlv_q[0].t0, t0);
  assert.ok(env.log.cm.filter((c) => c.data && c.data.dlv_ack && c.data.id === "dup1").length >= 2);
});

test("deliver_tick prefers FIGHTERS[0] over older Zarook job", async () => {
  const env = merchant({ gold: 400000, esize: 38, _server: ["US", "III"] });
  env.GOLD_FLOAT = 0;
  placeFighter(env, "Jazwyn", { map: "main", real_x: 40, real_y: -20, esize: 4 });
  placeFighter(env, "Zarook", { map: "main", real_x: 50, real_y: -20, esize: 4 });
  wireGot(env);
  const old = Date.now() - 60000;
  env.dlv_q = [
    { id: "z1", who: "Zarook", kind: "pots", items: [{ name: "hpot1", q: 5 }], map: "main", x: 50, y: -20, server: ["US", "III"], esize: 4, t0: old },
    { id: "j1", who: "Jazwyn", kind: "pots", items: [{ name: "hpot1", q: 5 }], map: "main", x: 40, y: -20, server: ["US", "III"], esize: 4, t0: Date.now() }
  ];
  env.dlv_save();
  const r = await env.deliver_tick();
  assert.strictEqual(r, "done");
  assert.ok(env.log.cm.some((c) => c.name === "Jazwyn" && c.data && c.data.dlv_done && c.data.ok === 1));
  assert.ok(env.dlv_q.some((j) => j.who === "Zarook"));
});

test("deliver_tick buys pots, walks, send_item, handshake done", async () => {
  const env = merchant({ gold: 400000, esize: 38, _server: ["US", "III"] });
  env.GOLD_FLOAT = 0;
  // stay off blacklisted east-island packs (spider boundary) so delivery walks to the fighter
  placeFighter(env, "Jazwyn", { map: "main", real_x: 80, real_y: 120, esize: 4 });
  wireGot(env);
  env.emitCm("Jazwyn", {
    v: 1, dlv_req: 1, id: "job1", kind: "pots",
    items: [{ name: "hpot1", q: 40 }, { name: "mpot1", q: 40 }],
    map: "main", x: 80, y: 120, server: ["US", "III"], esize: 4
  });
  await flush();
  const r = await env.deliver_tick();
  assert.strictEqual(r, "done");
  assert.ok(env.log.bought.some((b) => b.name === "hpot1"));
  assert.ok(env.log.sent.some((s) => s.item === "hpot1"));
  assert.ok(env.log.cm.some((c) => c.data && c.data.dlv_here));
  assert.ok(env.log.cm.some((c) => c.data && c.data.dlv_sent));
  assert.ok(env.log.cm.some((c) => c.data && c.data.dlv_done && c.data.ok === 1));
  assert.ok((env.log.game || []).some((s) => /dlv:done id=job1 ok=1/.test(s)));
  assert.ok(!env.dlv_has_work());
});

test("deliver_tick hops when fighter server differs", async () => {
  const env = merchant({ gold: 400000, esize: 38, _server: ["US", "II"] });
  env.emitCm("Jazwyn", {
    v: 1, dlv_req: 1, id: "hop1", kind: "pots",
    items: [{ name: "hpot1", q: 10 }], map: "main", x: 10, y: 10,
    server: ["US", "III"], esize: 3
  });
  await flush();
  const r = await env.deliver_tick();
  assert.strictEqual(r, "hop");
  assert.deepStrictEqual(env.log.server[env.log.server.length - 1], ["US", "III"]);
  assert.ok((env.log.game || []).some((s) => /dlv:hop US\/III/.test(s)));
  assert.ok(env.dlv_has_work());
});

test("localStorage resume after hop keeps queue", () => {
  const key = "dlv_q_puppygirl";
  const env1 = merchant({ _storage: {} });
  env1.dlv_q = [{ id: "persist1", who: "Jazwyn", kind: "pots", items: [{ name: "hpot1", q: 5 }], map: "main", x: 1, y: 2, server: ["US", "III"], esize: 3, state: "active", t0: Date.now() }];
  env1.dlv_active = env1.dlv_q[0];
  env1.dlv_save();
  const raw = env1.localStorage.getItem(key);
  assert.ok(raw);
  const env2 = merchant({ _storage: { [key]: raw } });
  assert.ok(env2.dlv_has_work());
  assert.strictEqual(env2.dlv_active.id, "persist1");
});

test("cm_send enforces CM_GAP_MS", async () => {
  const env = merchant();
  env.CM_GAP_MS = 700;
  env.last_cm_t = Date.now();
  const sleeps = [];
  const real = env.sleep.bind(env);
  env.sleep = async (ms) => { sleeps.push(ms); return real(ms); };
  await env.cm_send("Jazwyn", { v: 1, ping: 1 });
  assert.ok(sleeps.some((ms) => ms > 0 && ms <= 700));
});

test("deliver_tick rip fails without send", async () => {
  const env = merchant({ gold: 400000, esize: 38, _server: ["US", "III"] });
  env.GOLD_FLOAT = 0;
  placeFighter(env, "Jazwyn", { map: "main", real_x: 40, real_y: -20, esize: 4, rip: true });
  env.emitCm("Jazwyn", {
    v: 1, dlv_req: 1, id: "rip1", kind: "pots",
    items: [{ name: "hpot1", q: 10 }], map: "main", x: 40, y: -20,
    server: ["US", "III"], esize: 4
  });
  await flush();
  const r = await env.deliver_tick();
  assert.strictEqual(r, "fail");
  assert.ok(env.log.cm.some((c) => c.data && c.data.dlv_done && c.data.ok === 0 && c.data.reason === "rip"));
  assert.ok(!env.log.sent.length);
});

test("dlv_loc updates active job coordinates", async () => {
  const env = merchant();
  env.emitCm("Jazwyn", {
    v: 1, dlv_req: 1, id: "loc1", kind: "pots",
    items: [{ name: "hpot1", q: 5 }], map: "main", x: 0, y: 0,
    server: ["US", "III"], esize: 2
  });
  await flush();
  env.emitCm("Jazwyn", { v: 1, dlv_loc: 1, id: "loc1", map: "main", x: 900, y: -50, server: ["US", "III"] });
  const j = env.dlv_find("loc1");
  assert.strictEqual(j.x, 900);
  assert.strictEqual(j.y, -50);
});

test("dlv_ping replies with on-my-way status", async () => {
  const env = merchant();
  env.emitCm("Jazwyn", {
    v: 1, dlv_req: 1, id: "st1", kind: "pots",
    items: [{ name: "hpot1", q: 5 }], map: "main", x: 900, y: -50,
    server: ["US", "III"], esize: 2
  });
  await flush();
  env.log.cm = [];
  env.emitCm("Jazwyn", { v: 1, dlv_ping: 1, id: "st1" });
  await flush();
  const st = env.log.cm.find((c) => c.data && c.data.dlv_status);
  assert.ok(st, "expected dlv_status reply");
  assert.strictEqual(st.data.id, "st1");
  assert.ok(/On my way|Queued|Grabbing|Almost|tunnel/i.test(st.data.msg || st.data.phase));
});

test("dlv_field_far is geography not monster name", () => {
  const env = merchant({ real_x: 0, real_y: 0 });
  assert.ok(env.dlv_field_far({ x: 900, y: 0, map: "main" }));
  assert.ok(!env.dlv_field_far({ x: 40, y: 0, map: "main", farm: "goo" }));
});

test("dlv_goto walks to fighter on same map", async () => {
  const env = merchant({ real_x: 40, real_y: -20, x: 40, y: -20, map: "main" });
  placeFighter(env, "Jazwyn", { map: "main", real_x: 100, real_y: 100, esize: 4 });
  const ok = await env.dlv_goto({ who: "Jazwyn", map: "main", x: 100, y: 100, farm: "goo", t0: Date.now() });
  assert.ok(ok);
  assert.ok(env.character.map === "main");
  assert.ok(env.parent.distance(env.character, env.parent.entities.Jazwyn) <= 320);
});

test("logistics prefers deliver_tick over econ when queue non-empty", async () => {
  const env = merchant({ gold: 400000, esize: 38, _server: ["US", "III"] });
  env.GOLD_FLOAT = 0;
  env.cycle_at = 0;
  let combined = false;
  let delivered = false;
  env.run_combine = async () => { combined = true; };
  env.upgrade_one = async () => { combined = true; };
  env.dlv_has_work = () => true;
  env.deliver_tick = async () => { delivered = true; return "busy"; };
  await env.logistics();
  assert.ok(delivered);
  assert.ok(!combined);
});

test("run_econ yields to delivery between steps", async () => {
  const env = merchant({ gold: 400000, esize: 38, _server: ["US", "III"] });
  let upgraded = false;
  env.run_combine = async () => {};
  env.upgrade_one = async () => { upgraded = true; };
  env.dlv_q = [{ id: "y1", who: "Jazwyn", kind: "pots", items: [], t0: Date.now() }];
  env.dlv_active = env.dlv_q[0];
  const r = await env.run_econ();
  assert.strictEqual(r, "dlv");
  assert.ok(!upgraded);
});

test("run_combine yields mid-loop when delivery arrives", async () => {
  const env = merchant({ gold: 400000, esize: 38, _server: ["US", "III"] });
  let steps = 0;
  env.combine_step = async () => {
    steps += 1;
    if (steps === 1) {
      env.dlv_q = [{ id: "mid1", who: "Jazwyn", kind: "pots", items: [], t0: Date.now() }];
      env.dlv_active = env.dlv_q[0];
      return "ok";
    }
    return "ok";
  };
  const r = await env.run_combine();
  assert.strictEqual(r, "dlv");
  assert.strictEqual(steps, 1);
});

test("logistics drains delivery after econ yields", async () => {
  const env = merchant({ gold: 400000, esize: 38, _server: ["US", "III"] });
  env.cycle_at = 0;
  let drained = 0;
  env.go_npc = async () => true;
  env.park_bag = async () => true;
  env.snap_bank = () => {};
  env.run_econ = async () => {
    env.dlv_q = [{ id: "y2", who: "Jazwyn", kind: "pots", items: [], t0: Date.now() }];
    env.dlv_active = env.dlv_q[0];
    return "dlv";
  };
  env.deliver_tick = async () => {
    drained += 1;
    env.dlv_q = [];
    env.dlv_active = null;
    return "done";
  };
  await env.logistics();
  assert.ok(drained >= 1);
});

module.exports = { tests };
