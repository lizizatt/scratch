"use strict";

const {
  FIGHTERS,
  FARM,
  HOME,
  JOB_MS,
  POTION_TARGET,
  GOLD_FLOAT_FIGHTER,
  SELL_WHITELIST,
} = require("./constants");
const { packCenter } = require("./packs");
const { isSellJunk, isGearPiece, planGifts } = require("./gear");

/**
 * Merchant logistics under Jazwyn command.
 * Idle on farm world; hops only for meet_home / to reach fighters.
 * When idle: bank junk/gear, push upgrades from bank, open stall for whitelist.
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
  const gearAds = {};
  let stallDone = false;
  let giftBusy = false;

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

  function closeStandIfOpen() {
    if (api.character.stand) {
      if (typeof api.close_stand === "function") api.close_stand();
      else if (api.parent && api.parent.close_merchant) api.parent.close_merchant();
    }
  }

  async function hearCm(m) {
    const d = m.message;
    if (!d || typeof d !== "object") return;
    if (d.gear_ad && d.name) {
      d._t = api._now ? api._now() : Date.now();
      gearAds[d.name] = d;
      return;
    }
    if (d.gear_got) {
      api.game_log("gear_got from=" + (m.name || "?") + " ok=" + (d.ok ? 1 : 0));
      return;
    }
    if (d.dlv_loot_done) {
      api.game_log("dlv:loot_done n=" + (d.n || 0));
      return;
    }
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
    closeStandIfOpen();
    const dest = { map: "main", x: 56, y: -122 };
    const nearVendor = () =>
      api.character.map === dest.map &&
      Math.hypot(api.character.real_x - dest.x, api.character.real_y - dest.y) < 40;

    if (!nearVendor()) {
      const r = await api.smart_move(dest);
      if (r && r.failed) {
        api.game_log("dlv:vendor_path_fail");
        return false;
      }
    }
    if (!nearVendor() && Math.hypot(api.character.real_x - dest.x, api.character.real_y - dest.y) > 60) {
      api.game_log("dlv:vendor_far");
      return false;
    }
    for (const it of items || []) {
      const need = it.q || POTION_TARGET;
      let have = 0;
      for (const bag of api.character.items || []) {
        if (bag && bag.name === it.name) have += bag.q == null ? 1 : bag.q;
      }
      const buyQ = need - have;
      if (buyQ <= 0) {
        api.game_log("dlv:have " + it.name + " " + have);
        continue;
      }
      if ((api.character.esize || 0) < 1) {
        api.game_log("dlv:no_space");
        return false;
      }
      await api.buy(it.name, buyQ);
      let after = 0;
      for (const bag of api.character.items || []) {
        if (bag && bag.name === it.name) after += bag.q == null ? 1 : bag.q;
      }
      if (after <= have) {
        api.game_log("dlv:buy_fail " + it.name);
        return false;
      }
      api.game_log("dlv:buy " + it.name + " " + buyQ);
    }
    return true;
  }

  /** §5D: leave town with ≥3 free slots for fighter take-backs. */
  async function ensureTakeBackSlots(need, keep) {
    need = need == null ? 3 : need;
    while ((api.character.esize || 0) < need && bagParkables(keep).length) {
      const before = bagParkables(keep).length;
      await parkToBank(keep);
      if (bagParkables(keep).length >= before) break;
    }
    if ((api.character.esize || 0) < need) {
      api.game_log("dlv:need_space esize=" + (api.character.esize || 0));
      return false;
    }
    return true;
  }

  function bagParkables(keep) {
    const out = [];
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (!it) continue;
      if (/^hpot|^mpot/.test(it.name)) continue;
      if (it.name === "stand0") continue;
      if (
        keep &&
        it.name === keep.name &&
        (it.level || 0) === (keep.level || 0)
      ) {
        continue;
      }
      if (isSellJunk(it, api.G) || isGearPiece(it, api.G)) out.push(i);
    }
    return out;
  }

  function listBankItems() {
    const bank = api.character.bank || api.character._bank;
    if (!bank) return [];
    const out = [];
    for (const pack of Object.keys(bank)) {
      if (pack === "gold") continue;
      const bag = bank[pack];
      if (!Array.isArray(bag)) continue;
      for (let i = 0; i < bag.length; i++) {
        const it = bag[i];
        if (!it) continue;
        out.push({ name: it.name, level: it.level || 0, pack, i, q: it.q });
      }
    }
    return out;
  }

  async function parkToBank(keep) {
    const idxs = bagParkables(keep);
    if (!idxs.length) return true;
    closeStandIfOpen();
    const r = await api.smart_move({ to: "bank" });
    if (r && r.failed) {
      api.game_log("bank:path_fail");
      return false;
    }
    let stored = 0;
    for (const i of idxs) {
      const it = api.character.items[i];
      if (!it) continue;
      const nm = it.name;
      const lv = it.level || 0;
      await api.bank_store(i);
      if (!api.character.items[i]) {
        stored++;
        api.game_log("bank:store " + nm + "@" + lv);
      }
    }
    if (bagParkables(keep).length && stored === 0) {
      api.game_log("bank:full");
      return false;
    }
    return bagParkables(keep).length === 0;
  }

  async function ensureGearInBag(gear) {
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (it && it.name === gear.name && (it.level || 0) === (gear.level || 0)) return i;
    }
    closeStandIfOpen();
    if (api.character.map !== "bank") {
      const r = await api.smart_move({ to: "bank" });
      if (r && r.failed) return -1;
    }
    const bank = listBankItems();
    const hit = bank.find((e) => e.name === gear.name && (e.level || 0) === (gear.level || 0));
    if (!hit) return -1;
    await api.bank_retrieve(hit.pack, hit.i);
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (it && it.name === gear.name && (it.level || 0) === (gear.level || 0)) return i;
    }
    return -1;
  }

  async function tryPlanGearGift() {
    if (giftBusy) return false;
    const ads = {};
    for (const who of FIGHTERS) {
      const ad = gearAds[who];
      if (!ad || !ad.slots) continue;
      ads[who] = ad;
    }
    const gifts = planGifts(listBankItems(), ads, api.G);
    if (!gifts.length) return false;
    const g = gifts[0];

    // Prefer batching onto a pending/active pot run for that fighter (P3)
    const pot = findPotJob(g.who);
    if (pot) {
      // deliverActive.maybeBatchGear attaches + pulls; don't start a second trip
      return false;
    }

    // Standalone dlv_gear only when the queue is idle
    if (store.q.length || store.active) return false;

    giftBusy = true;
    try {
      api.game_log("gear:plan " + g.it.name + "@" + (g.it.level || 0) + "->" + g.who);
      const bagI = await ensureGearInBag(g.it);
      if (bagI < 0) {
        api.game_log("gear:pull_fail " + g.it.name);
        return false;
      }
      const id = "g" + (api._now ? api._now() : Date.now()) + "_" + g.who.slice(0, 3);
      enqueue({
        id,
        kind: "dlv_gear",
        who: g.who,
        gear: { name: g.it.name, level: g.it.level || 0, slot: g.slot },
        farm: "armadillo",
        items: [],
      });
      return true;
    } finally {
      giftBusy = false;
    }
  }

  function findPotJob(who) {
    if (store.active && store.active.kind === "dlv_pots" && store.active.who === who) return store.active;
    return store.q.find((j) => j.kind === "dlv_pots" && j.who === who) || null;
  }

  /** Attach bank upgrade onto an active pot job before the farm walk (P3). */
  async function maybeBatchGear(job) {
    if (!job || job.kind !== "dlv_pots" || job.gear) return false;
    const ad = gearAds[job.who];
    if (!ad || !ad.slots) return false;
    const gifts = planGifts(listBankItems(), { [job.who]: ad }, api.G).filter((g) => g.who === job.who);
    if (!gifts.length) return false;
    const g = gifts[0];
    api.game_log("gear:plan " + g.it.name + "@" + (g.it.level || 0) + "->" + g.who);
    const bagI = await ensureGearInBag(g.it);
    if (bagI < 0) {
      api.game_log("gear:pull_fail " + g.it.name);
      return false;
    }
    job.gear = { name: g.it.name, level: g.it.level || 0, slot: g.slot };
    job.pulled = 1;
    api.game_log(
      "gear:batch id=" + job.id + " " + job.gear.name + "@" + (job.gear.level || 0) + "->" + job.who
    );
    return true;
  }

  async function openStall() {
    if (stallDone) return false;
    const bank = api.character.bank || api.character._bank;
    let junk = 0;
    if (bank) {
      for (const pack of Object.keys(bank)) {
        if (pack === "gold") continue;
        const bag = bank[pack];
        if (!Array.isArray(bag)) continue;
        for (const it of bag) {
          if (it && SELL_WHITELIST.indexOf(it.name) >= 0) junk++;
        }
      }
    }
    for (const it of api.character.items || []) {
      if (it && SELL_WHITELIST.indexOf(it.name) >= 0) junk++;
    }
    if (junk < 1) return false;

    closeStandIfOpen();
    let listI = api.character.items.findIndex((x) => x && SELL_WHITELIST.indexOf(x.name) >= 0);
    if (listI < 0) {
      const ents = listBankItems()
        .filter((e) => SELL_WHITELIST.indexOf(e.name) >= 0)
        .sort((a, b) => SELL_WHITELIST.indexOf(a.name) - SELL_WHITELIST.indexOf(b.name));
      if (!ents.length) return false;
      if (api.character.map !== "bank") {
        const r = await api.smart_move({ to: "bank" });
        if (r && r.failed) return false;
      }
      await api.bank_retrieve(ents[0].pack, ents[0].i);
      listI = api.character.items.findIndex((x) => x && SELL_WHITELIST.indexOf(x.name) >= 0);
    }
    if (listI < 0) return false;

    const plaza = { map: "main", x: 40, y: -20 };
    const r = await api.smart_move(plaza);
    if (r && r.failed) {
      api.game_log("stall:path_fail");
      return false;
    }
    if (typeof api.open_stand === "function") api.open_stand();
    else if (api.parent && api.parent.open_merchant) api.parent.open_merchant();
    const nm = api.character.items[listI].name;
    const price = (api.G.items[nm] && api.G.items[nm].g) || 100;
    api.trade(listI, price);
    stallDone = true;
    api.game_log("stall:open junk=" + junk);
    return true;
  }

  async function idleEcon() {
    await ensureFarmWorld();
    if (bagParkables().length) {
      await parkToBank();
      return;
    }
    if (await tryPlanGearGift()) return;
    await openStall();
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

    closeStandIfOpen();
    if (!(await ensureFarmWorld())) return;

    if (job.kind === "meet_home") {
      const reg = api.parent.server_region;
      const id = api.parent.server_identifier;
      if (!reg || !id) return;
      if (reg !== HOME[0] || id !== HOME[1]) {
        api.change_server(HOME[0], HOME[1]);
        return;
      }
      store.active = null;
      saveQ(store);
      return;
    }

    if (job.kind === "dlv_pots" && !job.bought) {
      const ok = await buyPots(job.items);
      if (!ok) return;
      job.bought = 1;
      saveQ(store);
    }

    // Batch bank upgrade onto pot run; wait briefly for gear_ad if bank has gear but no ad yet
    if (job.kind === "dlv_pots" && job.bought && !job.gear) {
      const now = api._now ? api._now() : Date.now();
      await maybeBatchGear(job);
      saveQ(store);
      if (!job.gear) {
        const ad = gearAds[job.who];
        const bankHasGear = listBankItems().some((e) => isGearPiece({ name: e.name, level: e.level || 0 }, api.G));
        if (!ad && bankHasGear) {
          if (job.gearWaitUntil == null) {
            job.gearWaitUntil = now + 8000;
            saveQ(store);
          }
          if (now < job.gearWaitUntil) return;
        }
      }
    }

    if (job.gear && !job.pulled) {
      const bagI = await ensureGearInBag(job.gear);
      if (bagI < 0) {
        api.game_log("dlv:gear_missing");
        if (job.kind === "dlv_gear") {
          store.active = null;
          saveQ(store);
          return;
        }
        job.gear = null;
      } else {
        job.pulled = 1;
        saveQ(store);
      }
    }

    // Leave bank after retrieve before field walk
    if (api.character.map === "bank") {
      const out = await api.smart_move({ map: "main", x: 40, y: -20 });
      if (out && out.failed) {
        api.game_log("dlv:bank_exit_fail");
        return;
      }
    }

    if (!(await ensureTakeBackSlots(3, job.gear && job.pulled ? job.gear : null))) return;

    let t = api.get_player(job.who);
    let map = job.map,
      x = job.x,
      y = job.y;
    if (t) {
      map = t.map;
      x = t.real_x;
      y = t.real_y;
    } else if ((map == null || x == null || y == null) && job.farm) {
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
      const p = (api.get_party() || {})[job.who];
      if (p && p.map) {
        await api.smart_move({
          map: p.map,
          x: p.real_x != null ? p.real_x : p.x,
          y: p.real_y != null ? p.real_y : p.y,
        });
        t = api.get_player(job.who);
      }
      if (!t) {
        api.game_log("dlv:no_vision");
        return;
      }
    }

    if ((t.gold || 0) < GOLD_FLOAT_FIGHTER) {
      try {
        api.send_gold(job.who, GOLD_FLOAT_FIGHTER - (t.gold || 0));
        api.game_log("gold_topup");
      } catch (e) {}
    }

    let sentPots = 0;
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (!it) continue;
      if (it.name !== "hpot1" && it.name !== "mpot1") continue;
      try {
        const r = await api.send_item(job.who, i, it.q == null ? 1 : it.q);
        if (r && r.failed) {
          api.game_log("dlv:send_fail " + it.name);
          continue;
        }
        api.game_log("dlv:send " + it.name + " id=" + job.id);
        sentPots++;
      } catch (e) {
        api.game_log("dlv:send_fail " + it.name);
      }
    }

    if (job.kind === "dlv_pots" && sentPots === 0) {
      api.game_log("dlv:empty_send");
      return;
    }

    if (job.gear) {
      for (let i = 0; i < api.character.items.length; i++) {
        const it = api.character.items[i];
        if (it && it.name === job.gear.name && (it.level || 0) === (job.gear.level || 0)) {
          const r = await api.send_item(job.who, i, 1);
          if (r && r.failed) {
            api.game_log("dlv:send_gear_fail " + it.name);
            return;
          }
          api.game_log(
            "dlv:send_gear " + it.name + "@" + (it.level || 0) + " id=" + job.id
          );
          await api.send_cm(job.who, {
            gear_offer: 1,
            id: job.id,
            name: job.gear.name,
            level: job.gear.level || 0,
            slot: job.gear.slot,
          });
          break;
        }
      }
    }

    await api.send_cm(job.who, { dlv_loot_q: 1, id: job.id });
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
      // Park tossed junk/gear before next delivery (P5). On path/full failure,
      // fall through so pot jobs are not starved by stuck parkables.
      if (!store.active && bagParkables().length) {
        const cleared = await parkToBank();
        if (!cleared && bagParkables().length) api.game_log("bank:park_stuck");
      }
      // Open stall once junk is banked even if pot queue stays busy
      if (!store.active && !stallDone) {
        const opened = await openStall();
        if (opened) return;
      }
      if (!store.active && store.q.length) {
        store.active = store.q.shift();
        saveQ(store);
        api.game_log("dlv:active " + store.active.kind + " -> " + store.active.who);
      }
      if (store.active) await deliverActive();
      else await idleEcon();
    } finally {
      busy = false;
    }
  }

  if (typeof api.clearHandlers === "function") api.clearHandlers();
  api.on("cm", (m) => {
    hearCm(m);
  });
  api.on("pm", (m) => {
    if (("" + m.message).indexOf("meet_home") >= 0 || ("" + m.message).indexOf("hold") >= 0) {
      enqueue({ id: "pm_hold_" + (api._now ? api._now() : Date.now()), kind: "meet_home", who: "party" });
    }
  });

  function hunt(mob) {
    const k = ("" + (mob || "")).toLowerCase().replace(/[^a-z0-9_]/g, "");
    const ban = ["spider", "scorpion", "bigbird"];
    if (!k) return;
    if (ban.indexOf(k) >= 0) {
      api.set_message("Skip " + k);
      api.game_log("Hunt skipped " + k);
      return;
    }
    api.send_cm("Jazwyn", { hunt: k });
    api.set_message("Hunt " + k);
    api.game_log("Hunt " + k);
  }
  function grind() {
    api.send_cm("Jazwyn", { grind: 1 });
    api.set_message("Grind");
    api.game_log("Grind sent");
  }
  function hold() {
    for (const n of FIGHTERS) api.send_cm(n, { hold: 1 });
    enqueue({ id: "hold_" + (api._now ? api._now() : Date.now()), kind: "meet_home", who: "party" });
    api.set_message("Hold");
    api.game_log("Hold sent");
  }
  function resume() {
    for (const n of FIGHTERS) api.send_cm(n, { hold: 0 });
    api.set_message("Stand");
    api.game_log("Resume sent");
  }
  function parseWorld(raw) {
    const p = ("" + (raw || ""))
      .trim()
      .replace(/[!/,]+/g, " ")
      .replace(/\s+/g, " ")
      .toUpperCase()
      .split(" ")
      .filter(Boolean);
    let parts = p[0] === "WORLD" ? p.slice(1) : p;
    if (parts.length === 1 && /^(I|II|III|IV|V|PVP)$/.test(parts[0])) return ["US", parts[0]];
    if (parts.length >= 2 && /^(US|EU|ASIA)$/.test(parts[0]) && /^[A-Z0-9]+$/.test(parts[1]))
      return [parts[0], parts[1]];
    return null;
  }
  function world(spec) {
    const s = parseWorld(spec);
    if (!s) {
      api.game_log("World bad");
      return;
    }
    api.send_cm("Jazwyn", { world: s });
    api.set_message("W " + s[0] + "/" + s[1]);
    api.game_log("World " + s[0] + "/" + s[1]);
  }

  return {
    tick,
    enqueue,
    hunt,
    grind,
    hold,
    resume,
    world,
    get store() {
      return store;
    },
    get gearAds() {
      return gearAds;
    },
  };
}

module.exports = { bootMerchant };
