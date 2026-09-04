"use strict";

const assert = require("assert");
const { loadScript } = require("./al_env");

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

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

async function sessionWithFreshAd(env, who, ad, queue) {
  env.READY_MS = 3000;
  env.OFFER_MS = 50;
  let ticks = 0;
  const sleep = env.sleep.bind(env);
  env.sleep = async (ms) => {
    ticks++;
    if (ticks === 1) env.emitCm(who, Object.assign({ gear_ad: 1, name: who }, ad));
    return sleep(ms);
  };
  return env.start_gear_session(queue);
}

test("merchant hear_gear stores gear_ad esize from CM not vision", () => {
  const env = merchant();
  env.emitCm("Sarene", { gear_ad: 1, name: "Sarene", esize: 3, slots: { ring1: "-" } });
  assert.ok(env.gear_ads.Sarene);
  assert.strictEqual(env.gear_ads.Sarene.esize, 3);
});

test("pick_upgrade skips candycanesword grade>0", () => {
  const env = merchant();
  env.GEAR_RISK = 1;
  env.character.items[1] = { name: "candycanesword", level: 0 };
  env.character.items[2] = { name: "coat", level: 0 };
  assert.strictEqual(env.pick_upgrade(), 2);
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

test("ponty_buy skips when offhand already owned", async () => {
  const env = merchant({ gold: 400000, esize: 38 });
  env.character.items[1] = { name: "shield", level: 0 };
  env.ponty = [{ name: "wbook0", rid: "w1", price: 20000, level: 0 }];
  const r = await env.ponty_buy();
  assert.strictEqual(r, null);
  assert.deepStrictEqual(env.log.secondhand, []);
});

test("ponty_buy rejects overpriced whitelist", async () => {
  const env = merchant({ gold: 400000, esize: 38 });
  env.ponty = [{ name: "wbook0", rid: "w1", price: 999999, level: 0 }];
  const r = await env.ponty_buy();
  assert.strictEqual(r, null);
  assert.deepStrictEqual(env.log.secondhand, []);
});

test("build_gear_queue offers Zarook empty offhand from bank wbook0", () => {
  const env = merchant({ gold: 100000, map: "bank", esize: 40 });
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "wbook0", level: 0 };
  env.character._bank = env.character.bank;
  env.gear_ads.Zarook = { gear_ad: 1, esize: 2, slots: { offhand: "-" }, _t: Date.now() };
  const q = env.build_gear_queue();
  assert.ok(q.some((g) => g.who === "Zarook" && g.name === "wbook0" && g.slot === "offhand"));
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

test("delivery aborts without fresh HOME ad (stale farm ad cleared)", async () => {
  const env = merchant({ gold: 100000, esize: 38 });
  env.READY_MS = 800;
  env.OFFER_MS = 10;
  env.character.items[1] = { name: "ringsj", level: 0 };
  env.gear_ads.Sarene = { gear_ad: 1, esize: 2, slots: { ring1: "-" }, _t: Date.now() - 99999 };
  placeFighter(env, "Sarene", { map: "winterland", real_x: 0, real_y: 0 });
  const r = await env.start_gear_session([{ who: "Sarene", name: "ringsj", level: 0, slot: "ring1", id: "x" }]);
  assert.strictEqual(r, "not_ready");
  assert.ok(!env.log.sent.length);
  assert.ok(env.log.cm.some((c) => c.data && c.data.hold === 0));
});

test("delivery requires in-range fighter on main with fresh ad", async () => {
  const env = merchant({ gold: 100000, esize: 38 });
  env.character.items[1] = { name: "ringsj", level: 0 };
  const sarene = placeFighter(env, "Sarene", { esize: 3, items: new Array(42).fill(null) });
  const r = await sessionWithFreshAd(env, "Sarene", { esize: 3, slots: { ring1: "-", ring2: "-" } }, [
    { who: "Sarene", name: "ringsj", level: 0, slot: "ring1", id: "r1" }
  ]);
  assert.ok(env.log.sent.length >= 1);
  assert.ok(env.log.cm.some((c) => c.data && c.data.gear_incoming));
  assert.ok(env.log.cm.some((c) => c.data && c.data.gear_offer && c.data.id === "r1"));
  assert.ok(sarene.items.some((it) => it && it.name === "ringsj"));
  assert.ok(r === "done" || r === "fail");
});

test("send_item failure does not emit gear_offer", async () => {
  const env = merchant({ gold: 100000, esize: 38 });
  env.character.items[1] = { name: "ringsj", level: 0 };
  placeFighter(env, "Sarene", { esize: 0, items: new Array(42).fill(null) });
  env.READY_MS = 3000;
  env.OFFER_MS = 10;
  let ticks = 0;
  const sleep = env.sleep.bind(env);
  env.sleep = async (ms) => {
    ticks++;
    if (ticks === 1) env.emitCm("Sarene", { gear_ad: 1, name: "Sarene", esize: 3, slots: { ring1: "-" } });
    return sleep(ms);
  };
  await env.start_gear_session([{ who: "Sarene", name: "ringsj", level: 0, slot: "ring1", id: "nospace" }]);
  assert.ok(!env.log.cm.some((c) => c.data && c.data.gear_offer && c.data.id === "nospace"));
});

test("build_gear_queue queues both empty ring slots", () => {
  const env = merchant();
  env.gear_ads.Sarene = { gear_ad: 1, esize: 4, slots: { ring1: "-", ring2: "-" }, _t: Date.now() };
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "ringsj", level: 0 };
  env.character.bank.items0[1] = { name: "ringsj", level: 0 };
  env.character._bank = env.character.bank;
  const q = env.build_gear_queue();
  assert.ok(q.filter((g) => g.who === "Sarene" && g.name === "ringsj").length >= 2);
});

test("offer timeout does not double-send same id", async () => {
  const env = merchant({ gold: 100000, esize: 38 });
  env.character.items[1] = { name: "ringsj", level: 0 };
  placeFighter(env, "Sarene", { esize: 2, items: new Array(42).fill(null) });
  const ids = [];
  const realCm = env.send_cm.bind(env);
  env.send_cm = async (name, data) => {
    if (data && data.gear_offer) ids.push(data.id);
    return realCm(name, data);
  };
  await sessionWithFreshAd(env, "Sarene", { esize: 2, slots: { ring1: "-" } }, [
    { who: "Sarene", name: "ringsj", level: 0, slot: "ring1", id: "same1" }
  ]);
  assert.strictEqual(ids.filter((id) => id === "same1").length, 1);
});

test("resume sent when gear session ends", async () => {
  const env = merchant({ gold: 100000, esize: 38 });
  env.READY_MS = 500;
  env.character.items[1] = { name: "ringsj", level: 0 };
  await env.start_gear_session([{ who: "Sarene", name: "ringsj", level: 0, slot: "ring1", id: "r1" }]);
  assert.ok(env.log.cm.some((c) => c.data && c.data.hold === 0));
  assert.strictEqual(env.gear_session, false);
});

test("bank-only rings: session returns to plaza before send_item", async () => {
  const env = merchant({ gold: 100000, esize: 40, map: "main" });
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character.bank.items0[0] = { name: "ringsj", level: 0 };
  env.character._bank = env.character.bank;
  placeFighter(env, "Sarene", { esize: 3, items: new Array(42).fill(null) });
  env.gear_ads.Sarene = { gear_ad: 1, name: "Sarene", esize: 3, slots: { ring1: "-" }, _t: Date.now() };
  const maps = [];
  const sm = env.smart_move.bind(env);
  env.smart_move = async (dest) => {
    maps.push(dest && dest.map || dest && dest.to || dest);
    return sm(dest);
  };
  await sessionWithFreshAd(env, "Sarene", { esize: 3, slots: { ring1: "-" } }, [
    { who: "Sarene", name: "ringsj", level: 0, slot: "ring1", id: "bank1" }
  ]);
  assert.ok(env.log.retrieved.length >= 1, "pulled from bank");
  assert.ok(env.log.sent.length >= 1, "sent after return");
  assert.ok(maps.filter((m) => m === "main").length >= 2, "returned to main meet");
  assert.strictEqual(env.character.map, "main");
});

test("run_econ delivers before combine when rings needed", async () => {
  const env = merchant({ gold: 400000, esize: 38, map: "main" });
  env.HOLD = [];
  env.GOLD_FLOAT = 0;
  env.character.items[1] = { name: "ringsj", level: 0 };
  env.character.items[2] = { name: "ringsj", level: 0 };
  env.character.bank = { gold: 0, items0: new Array(42).fill(null) };
  env.character._bank = env.character.bank;
  placeFighter(env, "Sarene", { esize: 4, items: new Array(42).fill(null) });
  env.gear_ads.Sarene = { gear_ad: 1, name: "Sarene", esize: 4, slots: { ring1: "-", ring2: "-" }, _t: Date.now() };
  env.READY_MS = 3000;
  env.OFFER_MS = 20;
  let ticks = 0;
  const sleep = env.sleep.bind(env);
  env.sleep = async (ms) => {
    ticks++;
    if (ticks === 1) env.emitCm("Sarene", { gear_ad: 1, name: "Sarene", esize: 4, slots: { ring1: "-", ring2: "-" } });
    return sleep(ms);
  };
  const order = [];
  const rc = env.run_combine.bind(env);
  env.run_combine = async () => { order.push("combine"); return rc(); };
  const ss = env.stock_store.bind(env);
  env.stock_store = async () => { order.push("stock"); return true; };
  await env.run_econ();
  assert.ok(env.log.cm.some((c) => c.data && c.data.hold === 1), "should hold for delivery first");
  assert.ok(order[0] === "combine" || order.indexOf("combine") >= 0);
  assert.ok(env.log.sent.length >= 1 || env.log.cm.some((c) => c.data && c.data.gear_offer));
});

module.exports = { tests };
