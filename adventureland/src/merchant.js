"use strict";

const { FIGHTERS, FARM, HOME, JOB_MS, POTION_TARGET, GOLD_FLOAT_FIGHTER, SEND_RANGE } = require("./constants");
const { packCenter } = require("../sim/world");

/**
 * Merchant logistics under Jazwyn command.
 * Idle on farm world; hops only for meet_home / to reach fighters.
 */
function bootMerchant(api, opts) {
  opts = opts || {};
  const name = api.character.name;
  const QK = "dlv_q_" + name;

  function loadQ() {
    try {
      const r = JSON.parse(api.storage.getItem(QK) || "null");
      if (r && r.q) return r;
    } catch (e) {}
    return { q: [], active: null };
  }
  function saveQ(q) {
    try {
      api.storage.setItem(QK, JSON.stringify(q));
    } catch (e) {}
  }

  let store = loadQ();
  let busy = false;

  function enqueue(job) {
    if (store.q.length >= 8) {
      api.game_log("dlv:queue_full");
      return false;
    }
    if (store.q.some((j) => j.id === job.id)) return true;
    job.t0 = api._now ? api._now() : Date.now();
    store.q.push(job);
    saveQ(store);
    return true;
  }

  async function hearCm(m) {
    const d = m.message;
    if (!d || typeof d !== "object") return;
    if (d.job === "cancel_all") {
      store.q = store.q.filter((j) => j.who !== d.who && j.id !== d.id);
      if (store.active && (store.active.who === d.who || store.active.id === d.id)) store.active = null;
      saveQ(store);
      api.game_log("dlv:cancel");
      return;
    }
    if (d.job === "dlv_pots" || d.job === "dlv_gear") {
      const ok = enqueue({
        id: d.id,
        kind: d.job,
        who: d.who,
        items: d.items,
        farm: d.farm,
        map: d.map,
        x: d.x,
        y: d.y,
        gear: d.gear,
      });
      await api.send_cm(d.who, { dlv_ack: 1, id: d.id, ok: ok ? 1 : 0, reason: ok ? null : "queue" });
      return;
    }
    if (d.dlv_loc && store.active && d.id === store.active.id) {
      store.active.map = d.map;
      store.active.x = d.x;
      store.active.y = d.y;
      saveQ(store);
    }
    if (d.job === "meet_home") {
      enqueue({ id: "hold_" + (api._now ? api._now() : Date.now()), kind: "meet_home", who: "party" });
    }
  }

  async function ensureFarmWorld() {
    const reg = api.parent.server_region;
    const id = api.parent.server_identifier;
    if (!reg || !id) return false;
    if (reg === FARM[0] && id === FARM[1]) return true;
    api.change_server(FARM[0], FARM[1]);
    return false;
  }

  async function buyPots(items) {
    await api.smart_move({ to: "potions" });
    for (const it of items || []) {
      await api.buy(it.name, it.q || POTION_TARGET);
      api.game_log("dlv:buy " + it.name + " " + it.q);
    }
  }

  async function deliverActive() {
    const job = store.active;
    if (!job) return;
    if ((api._now ? api._now() : Date.now()) - job.t0 > JOB_MS) {
      api.game_log("dlv:job_ttl");
      store.active = null;
      saveQ(store);
      return;
    }

    // Same server as fighters (farm)
    if (!(await ensureFarmWorld())) return;

    if (job.kind === "meet_home") {
      const reg = api.parent.server_region;
      const id = api.parent.server_identifier;
      if (!reg || !id) return; // wait until region ready — do NOT clear active
      if (reg !== HOME[0] || id !== HOME[1]) {
        api.change_server(HOME[0], HOME[1]);
        return;
      }
      store.active = null;
      saveQ(store);
      return;
    }

    if (job.kind === "dlv_pots" && !job.bought) {
      await buyPots(job.items);
      job.bought = 1;
      saveQ(store);
    }

    // Locate fighter
    let t = api.get_player(job.who);
    let map = job.map,
      x = job.x,
      y = job.y;
    if (t) {
      map = t.map;
      x = t.real_x;
      y = t.real_y;
    } else if (job.farm) {
      const c = packCenter(job.farm);
      if (c) {
        map = c.map;
        x = c.x;
        y = c.y;
      }
    }
    await api.send_cm(job.who, {
      status: 1,
      id: job.id,
      phase: "enroute",
      map: api.character.map,
      x: api.character.real_x,
      y: api.character.real_y,
    });

    const r = await api.smart_move({ map, x, y });
    if (r && r.failed) {
      api.game_log("dlv:path_fail");
      await api.send_cm(job.who, { nack: "path", id: job.id });
      return;
    }

    t = api.get_player(job.who);
    if (!t) {
      api.game_log("dlv:no_vision");
      return;
    }

    // Top up gold if needed
    if ((t.gold || 0) < GOLD_FLOAT_FIGHTER) {
      api.send_gold(job.who, GOLD_FLOAT_FIGHTER - (t.gold || 0));
      api.game_log("gold_topup");
    }

    // Send pots from bag
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (!it) continue;
      if (it.name !== "hpot1" && it.name !== "mpot1") continue;
      const sr = await api.send_item(job.who, i, it.q == null ? 1 : it.q);
      if (sr && sr.success) api.game_log("dlv:send " + it.name);
    }

    // Optional gear piece from bank job
    if (job.kind === "dlv_gear" && job.gear) {
      // MVP: item already in bag by name+level
      for (let i = 0; i < api.character.items.length; i++) {
        const it = api.character.items[i];
        if (it && it.name === job.gear.name && (it.level || 0) === (job.gear.level || 0)) {
          await api.send_item(job.who, i, 1);
          break;
        }
      }
    }

    await api.send_cm(job.who, { dlv_done: 1, id: job.id, ok: 1 });
    api.game_log("dlv:done id=" + job.id);
    store.active = null;
    saveQ(store);
  }

  async function tick() {
    if (!api._now) api._now = () => (opts.now ? opts.now() : Date.now());
    if (busy) return;
    busy = true;
    try {
      if (!store.active && store.q.length) {
        store.active = store.q.shift();
        saveQ(store);
        api.game_log("dlv:active " + store.active.kind + " -> " + store.active.who);
      }
      if (store.active) await deliverActive();
      else {
        // idle on farm world
        await ensureFarmWorld();
      }
    } finally {
      busy = false;
    }
  }

  api.on("cm", (m) => {
    hearCm(m);
  });
  api.on("pm", (m) => {
    // cross-world hold summons
    if (("" + m.message).indexOf("meet_home") >= 0 || ("" + m.message).indexOf("hold") >= 0) {
      enqueue({ id: "pm_hold_" + (api._now ? api._now() : Date.now()), kind: "meet_home", who: "party" });
    }
  });

  return {
    tick,
    enqueue,
    get store() {
      return store;
    },
  };
}

module.exports = { bootMerchant };
