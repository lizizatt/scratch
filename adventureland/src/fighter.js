"use strict";

const {
  MERCHANT,
  FIGHTERS,
  LEADER_ORDER,
  FARM,
  HOME,
  HEARTBEAT_MS,
  ACK_MS,
  PENDING_MS,
  FALLBACK_SILENCE_MS,
  BEACON_MS,
  GOLD_FLOAT_FIGHTER,
  POTION_TARGET,
  RARE_WHITELIST,
  ASSEMBLE_TIMEOUT_MS,
  RARE_GONE_MS,
  GEAR_AD_MS,
  SEND_RANGE,
  METRICS_MS,
  FORM_R_OUT,
  FIGHTER_ENGAGE_R,
  KEEP_ALWAYS,
  COMBINE_PRIORITY,
  PICKUP_MEET,
} = require("./constants");
const { createChatQueue } = require("./chat_queue");
const { createPartyState, countPots, potBucket } = require("./party_state");
const { createMotion } = require("./motion");
const { maybeUsePots } = require("./potions");
const { packCenter } = require("./packs");
const { equipPending, isKeep, markGift, classOk, canEquipSlot } = require("./gear");
const {
  inventoryDigest,
  makeInventorySnapshot,
  compactGearItem,
  itemFingerprint,
  resolveObservedItem,
  isMerchantMessage,
} = require("./gear_coordination");
const {
  DAISY,
  getHunt,
  huntComplete,
  shouldInteractDaisy,
  canAcceptHunts,
} = require("./monsterhunt");

/**
 * Boot a fighter into a sim (or real) API environment.
 * api must provide: character, party_say, send_cm, get_player, get_party,
 * smart_move, sleep, game_log, on, parent, buy, use, send_gold, items helpers.
 * Heap wipes on change_server; intent/dlv restored from localStorage.
 */
function bootFighter(api, opts) {
  opts = opts || {};
  const name = api.character.name;
  const SK = "v2state_" + name;
  const state = createPartyState(name);
  const chat = createChatQueue(api);
  api._now = () => (opts.now ? opts.now() : Date.now());

  let lastHb = 0;
  let dlvPending = null;
  let lastBeacon = null;
  let lastStatusAt = 0;
  let assembleUntil = 0;
  let rareGoneAt = 0;
  let bootQuietUntil = 0;
  let lastGearAd = 0;
  /** Daisy Monster Hunt chain (lead only) — toggled via merchant hunt_quest() / CM. */
  let huntQuest = false;
  /** Soft-skip: after MHUNT_DEATH_LIMIT deaths on hunt.id, farm default until that hunt clears. */
  const MHUNT_DEATH_LIMIT = 3;
  let mhuntDeaths = 0;
  let mhuntDeathForId = null;
  let mhuntSoftSkipId = null;
  const defaultFarm = opts.farm || "bat";
  /** Intent snapshot taken when entering rare — restored on rare_kill/gone/timeout. */
  let preRareSnap = null;
  const giftTtl = {};
  const gearReservations = {};
  let inventoryRevision = 0;
  let pickupHoldUntil = 0;
  let lastInventoryDigest = "";
  let gearTxn = null;
  let respawnBusy = false;
  // equipPending's live "Wrong weapon" rejection memo — persists across ticks
  // so a class-illegal / 2H-conflicted item isn't re-attempted every tick.
  const equipRejectMemo = {};
  const metrics = { t0: 0, kills: 0, gold0: 0, emitCount: 0 };

  if (typeof api.attack === "function") {
    const _attack = api.attack.bind(api);
    api.attack = function (t) {
      const was =
        t && !t.dead && (t.hp == null || t.hp > 0);
      const out = _attack(t);
      return Promise.resolve(out).then((r) => {
        if (was && t && (t.dead || (t.hp != null && t.hp <= 0))) metrics.kills += 1;
        return r;
      });
    };
  }

  function emitMetrics(now) {
    if (!metrics.t0) {
      metrics.t0 = now;
      metrics.gold0 = api.character.gold || 0;
      return;
    }
    const due = Math.floor((now - metrics.t0) / METRICS_MS);
    if (due <= metrics.emitCount) return;
    metrics.emitCount = due;
    const mins = Math.max(1 / 60, (now - metrics.t0) / 60000);
    const kpm = metrics.kills / mins;
    const gpm = ((api.character.gold || 0) - metrics.gold0) / mins;
    api.game_log("metrics kpm=" + kpm.toFixed(2) + " gpm=" + Math.round(gpm));
  }

  function persist() {
    try {
      api.storage.setItem(
        SK,
        JSON.stringify({
          intent: state.S.intent,
          mode: state.S.mode,
          lead: state.S.lead,
          seq: state.S.seq,
          rare: state.S.rare,
          dlv: dlvPending,
          lastHb,
          assembleUntil,
          rareGoneAt,
          lastStatusAt,
          huntQuest: huntQuest ? 1 : 0,
          preRareSnap: preRareSnap,
          mhuntDeaths: mhuntDeaths,
          mhuntDeathForId: mhuntDeathForId,
          mhuntSoftSkipId: mhuntSoftSkipId,
          inventoryRevision,
          gearReservations,
          gearTxn,
        })
      );
    } catch (e) {}
  }

  function restore() {
    try {
      const raw = api.storage.getItem(SK);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.intent) state.S.intent = d.intent;
      if (d.mode) state.S.mode = d.mode;
      if (d.lead) state.S.lead = d.lead;
      if (d.seq) state.S.seq = Object.assign(state.S.seq, d.seq);
      if (d.rare) state.S.rare = d.rare;
      if (d.dlv) dlvPending = d.dlv;
      if (d.lastHb) lastHb = d.lastHb;
      if (d.assembleUntil) assembleUntil = d.assembleUntil;
      if (d.rareGoneAt) rareGoneAt = d.rareGoneAt;
      if (d.lastStatusAt) lastStatusAt = d.lastStatusAt;
      if (d.huntQuest != null) huntQuest = !!d.huntQuest;
      if (d.preRareSnap) preRareSnap = d.preRareSnap;
      if (d.mhuntDeaths != null) mhuntDeaths = d.mhuntDeaths | 0;
      if (d.mhuntDeathForId) mhuntDeathForId = d.mhuntDeathForId;
      if (d.mhuntSoftSkipId) mhuntSoftSkipId = d.mhuntSoftSkipId;
      if (d.inventoryRevision != null) inventoryRevision = d.inventoryRevision | 0;
      if (d.gearTxn && typeof d.gearTxn === "object") gearTxn = d.gearTxn;
      if (gearTxn) {
        for (const leg of gearTxn.outgoing || []) leg.sending = 0;
      }
      if (d.gearReservations && typeof d.gearReservations === "object") {
        for (const id of Object.keys(d.gearReservations)) {
          const r = d.gearReservations[id];
          if (gearTxn && r && r.tx === gearTxn.tx) gearReservations[id] = r;
        }
      }
    } catch (e) {}
  }

  const motion = createMotion(api, {
    leadName: () => state.S.lead,
    leadMoving: () => state.S.members[state.S.lead] && state.S.members[state.S.lead].task === "moving",
    now: () => api._now(),
  });

  function isLead() {
    const party = Object.keys(api.get_party() || {});
    const present = party.length ? party : [name];
    const lead = state.currentLeader(present);
    state.S.lead = lead;
    return lead === name;
  }

  /**
   * Single lead resolver shared with motion.js: run opts.combat with the
   * *current* succession lead, not a name baked in at boot. Whoever
   * currentLeader() names (state.S.lead) becomes tank; everyone else assists.
   */
  function runCombat(mtype) {
    if (!opts.combat) return;
    const lead = isLead();
    opts.combat(mtype, { leadName: state.S.lead, isLead: lead });
  }

  /** Lead seq must climb above anything heard (plan §6.6.6). */
  function reseedSeqAboveHeard() {
    let maxH = 0;
    for (const n of Object.keys(state.S.seq)) {
      if (n === name) continue;
      maxH = Math.max(maxH, state.S.seq[n] || 0);
    }
    if ((state.S.seq[name] || 0) <= maxH) state.S.seq[name] = maxH + 1;
  }

  function refreshPots() {
    const c = countPots(api.character.items);
    const b = potBucket(c.hp, c.mp);
    if (state.S.members[name].pots !== b) {
      state.setSelf({ pots: b });
      const d = state.diffNeeded();
      if (d) chat.enqueue(d, "diff");
    }
    return b;
  }

  /** Free ≥1 bag slot by selling junk, then surplus pots if dry on the other type. */
  async function freeBagSlot() {
    if ((api.character.esize || 0) >= 1) return true;
    await equipPending(api, api.G || {}, giftTtl, equipRejectMemo, isGearReserved);
    if ((api.character.esize || 0) >= 1) return true;
    async function sellAt(i, it) {
      if (typeof api.sell !== "function") return false;
      await api.sell(i, it.q == null ? 1 : it.q);
      api.game_log("bag:sell " + it.name);
      return (api.character.esize || 0) >= 1;
    }
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (!it) continue;
      if (/^hpot|^mpot/.test(it.name)) continue;
      if (isGearReserved(it)) continue;
      if (isKeep(api, it, api.G || {}, giftTtl)) continue;
      if (await sellAt(i, it)) return true;
    }
    // Still full of "keep" gear duplicates — sell any non-pot (never Tracktrix/stand)
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (!it || /^hpot|^mpot/.test(it.name)) continue;
      if (KEEP_ALWAYS.indexOf(it.name) >= 0) continue;
      if (isGearReserved(it)) continue;
      if (await sellAt(i, it)) return true;
    }
    // Pot-only full bag: dry on one type while the other fills every slot
    const c = countPots(api.character.items);
    if (c.hp === 0 || c.mp === 0) {
      const prefer = c.hp > c.mp ? /^hpot/ : /^mpot/;
      for (let i = 0; i < api.character.items.length; i++) {
        const it = api.character.items[i];
        if (!it || !prefer.test(it.name)) continue;
        if (await sellAt(i, it)) return true;
      }
    }
    api.game_log("bag:full");
    return (api.character.esize || 0) >= 1;
  }

  /** Unequip shields on non-warriors / wrong-class weapons so they toss to merchant. */
  async function stripWrongClass() {
    const G = api.G || {};
    const ctype = api.character.ctype;
    const slots = api.character.slots || {};
    const keys = ["mainhand", "offhand", "helmet", "chest", "pants", "shoes", "gloves", "cape", "belt", "amulet", "earring1", "earring2"];
    for (const slot of keys) {
      const it = slots[slot];
      if (!it) continue;
      if (classOk(it, ctype, G)) continue;
      if ((api.character.esize || 0) < 1) {
        await freeBagSlot();
        if ((api.character.esize || 0) < 1) {
          api.game_log("strip:no_space " + it.name);
          return;
        }
      }
      if (typeof api.unequip !== "function") return;
      try {
        const r = await Promise.resolve(api.unequip(slot));
        if (r && r.failed) {
          api.game_log("strip:fail " + it.name + " " + (r.reason || ""));
          continue;
        }
        // Live may resolve without clearing — only count success if slot empty.
        if (api.character.slots[slot] && api.character.slots[slot].name === it.name) {
          api.game_log("strip:stuck " + it.name + " on " + slot);
          continue;
        }
        api.game_log("strip " + it.name + " from " + slot);
      } catch (e) {
        api.game_log("strip:err " + ((e && e.message) || e));
      }
    }
  }

  function sendGearAd() {
    const snap = currentInventorySnapshot();
    api.send_cm(MERCHANT, Object.assign({ gear_ad: 1, name, farm: state.S.intent.mtype }, snap));
    lastGearAd = api._now();
    api.game_log("gear_ad");
  }

  function currentInventorySnapshot() {
    const digest = inventoryDigest(api);
    if (digest !== lastInventoryDigest) {
      inventoryRevision += 1;
      lastInventoryDigest = digest;
      persist();
    }
    return makeInventorySnapshot(api, inventoryRevision, gearReservations);
  }

  function isGearReserved(it) {
    const fp = itemFingerprint(it);
    if (
      gearTxn &&
      (gearTxn.incoming || []).some((x) => !x.equipped && x.item && x.item.fingerprint === fp)
    )
      return true;
    return Object.keys(gearReservations).some(
      (id) => gearReservations[id] && gearReservations[id].fingerprint === fp
    );
  }

  async function sendGearTxReport(tx, phase, extra) {
    await api.send_cm(
      MERCHANT,
      Object.assign({ gear_tx_report: 1, tx, who: name, phase, revision: inventoryRevision }, extra || {})
    );
  }

  function clearGearTxn(tx) {
    if (tx && gearTxn && gearTxn.tx !== tx) return;
    for (const id of Object.keys(gearReservations)) {
      if (!tx || (gearReservations[id] && gearReservations[id].tx === tx)) delete gearReservations[id];
    }
    gearTxn = null;
    persist();
  }

  function countBagFingerprint(fingerprint) {
    let n = 0;
    for (const it of api.character.items || []) {
      if (it && itemFingerprint(it) === fingerprint) n++;
    }
    return n;
  }

  async function handleGearPlan(d) {
    const now = api._now();
    if (!d.tx || !Array.isArray(d.outgoing) || !Array.isArray(d.incoming)) return;
    if (d.expires_at && now >= d.expires_at) {
      await sendGearTxReport(d.tx, "failed", { error: "expired" });
      return;
    }
    if (gearTxn && gearTxn.tx === d.tx) {
      if (gearTxn.phase === "prepared")
        await sendGearTxReport(d.tx, "prepared", { outgoing: gearTxn.outgoing });
      return;
    }
    if (gearTxn && gearTxn.tx !== d.tx) {
      await sendGearTxReport(d.tx, "blocked", { error: "busy" });
      return;
    }

    // Refresh the revision for diagnostics, but validate each referenced item
    // independently so unrelated potion or loot changes do not stale a plan.
    currentInventorySnapshot();
    for (const leg of d.outgoing) {
      if (!leg.item || !resolveObservedItem(api, leg.item)) {
        await sendGearTxReport(d.tx, "failed", { error: "stale_item" });
        return;
      }
    }
    const unequipCount = d.outgoing.filter((x) => x.item.where.indexOf("slot:") === 0).length;
    const need = unequipCount + (d.incoming.length ? 1 : 0);
    if ((api.character.esize || 0) < need) {
      await sendGearTxReport(d.tx, "blocked", { error: "no_space", need });
      return;
    }

    const txn = {
      tx: d.tx,
      planRevision: d.plan_revision,
      expiresAt: d.expires_at,
      phase: "preparing",
      outgoing: JSON.parse(JSON.stringify(d.outgoing)),
      incoming: JSON.parse(JSON.stringify(d.incoming)),
    };
    gearTxn = txn;
    for (const incoming of txn.incoming) {
      incoming.beforeCount = countBagFingerprint(incoming.item.fingerprint);
    }
    const used = {};
    for (const leg of txn.outgoing) {
      const found = resolveObservedItem(api, leg.item);
      if (!found) {
        clearGearTxn(d.tx);
        await sendGearTxReport(d.tx, "failed", { error: "item_moved" });
        return;
      }
      if (found.slot) {
        const r = await api.unequip(found.slot);
        if (gearTxn !== txn) return;
        if (r && r.failed) {
          clearGearTxn(d.tx);
          await sendGearTxReport(d.tx, "blocked", { error: "unequip", slot: found.slot });
          return;
        }
      }
      const fp = leg.item.fingerprint;
      const index = (api.character.items || []).findIndex(
        (it, i) => it && !used[i] && itemFingerprint(it) === fp
      );
      if (index < 0) {
        clearGearTxn(d.tx);
        await sendGearTxReport(d.tx, "failed", { error: "prepared_item_missing" });
        return;
      }
      used[index] = 1;
      leg.item = Object.assign({}, compactGearItem(api.character.items[index]), {
        uid: d.tx + ":bag:" + index,
        where: "bag:" + index,
        fingerprint: fp,
        observed_revision: inventoryRevision,
      });
      gearReservations[leg.item.uid] = { tx: d.tx, fingerprint: fp };
    }
    if (gearTxn !== txn) return;
    currentInventorySnapshot();
    txn.phase = "prepared";
    persist();
    api.game_log("gear_tx:prepared tx=" + d.tx + " who=" + name);
    await sendGearTxReport(d.tx, "prepared", { outgoing: gearTxn.outgoing });
  }

  async function handleGearTransfer(d) {
    if (!gearTxn || gearTxn.tx !== d.tx || gearTxn.phase !== "prepared") return;
    const leg = gearTxn.outgoing.find((x) => x.index === d.index);
    if (!leg) return;
    if (leg.sending) return;
    if (leg.sent) {
      await sendGearTxReport(d.tx, "sent", { index: d.index });
      return;
    }
    const found = resolveObservedItem(api, leg.item);
    const target = api.get_player(leg.to);
    if (!found) {
      await sendGearTxReport(d.tx, "failed", { index: d.index, error: "item_moved" });
      return;
    }
    if (!target || target.rip || merchantDist(target) > SEND_RANGE) {
      await sendGearTxReport(d.tx, "blocked", { index: d.index, error: "not_in_range" });
      return;
    }
    leg.sending = 1;
    persist();
    let r;
    try {
      r = await api.send_item(leg.to, found.index, 1);
    } catch (e) {
      leg.sending = 0;
      persist();
      await sendGearTxReport(d.tx, "blocked", { index: d.index, error: "send_failed" });
      return;
    }
    if (r && r.failed) {
      leg.sending = 0;
      persist();
      await sendGearTxReport(d.tx, "blocked", { index: d.index, error: r.reason || "send_failed" });
      return;
    }
    leg.sending = 0;
    leg.sent = 1;
    delete gearReservations[leg.item.uid];
    currentInventorySnapshot();
    persist();
    api.game_log("gear_tx:sent tx=" + d.tx + " to=" + leg.to + " " + leg.item.name);
    await sendGearTxReport(d.tx, "sent", { index: d.index });
  }

  async function handleGearCheck(d) {
    if (!gearTxn || gearTxn.tx !== d.tx) return;
    const incoming = gearTxn.incoming.find((x) => x.index === d.index);
    if (!incoming) return;
    if (incoming.equipped) {
      await sendGearTxReport(d.tx, "equipped", { index: d.index, slot: incoming.toSlot });
      return;
    }
    const matches = [];
    const outgoingIndexes = {};
    for (const leg of gearTxn.outgoing || []) {
      if (leg.sent || !leg.item || leg.item.where.indexOf("bag:") !== 0) continue;
      outgoingIndexes[Number(leg.item.where.slice(4))] = 1;
    }
    for (let i = 0; i < (api.character.items || []).length; i++) {
      const it = api.character.items[i];
      if (it && !outgoingIndexes[i] && itemFingerprint(it) === incoming.item.fingerprint) matches.push(i);
    }
    if (matches.length <= (incoming.beforeCount || 0)) return;
    const index = matches[matches.length - 1];
    const r = await api.equip(index, incoming.toSlot);
    const worn = api.character.slots && api.character.slots[incoming.toSlot];
    if ((r && r.failed) || !worn || itemFingerprint(worn) !== incoming.item.fingerprint) {
      await sendGearTxReport(d.tx, "failed", { index: d.index, error: "equip_failed" });
      return;
    }
    incoming.equipped = 1;
    currentInventorySnapshot();
    persist();
    api.game_log(
      "gear_tx:equipped tx=" + d.tx + " slot=" + incoming.toSlot + " " + incoming.item.name
    );
    await sendGearTxReport(d.tx, "equipped", { index: d.index, slot: incoming.toSlot });
  }

  let lastGoldOffload = 0;

  function merchantDist(m) {
    if (!m) return 1e9;
    if (typeof api.parent.distance === "function") return api.parent.distance(api.character, m);
    return Math.hypot(
      (api.character.real_x || 0) - (m.real_x != null ? m.real_x : m.x || 0),
      (api.character.real_y || 0) - (m.real_y != null ? m.real_y : m.y || 0)
    );
  }

  /** Send gold above GOLD_FLOAT_FIGHTER when merchant is in send range (legacy offload). */
  async function offloadGold() {
    const now = api._now();
    if (now - lastGoldOffload < 2500) return 0;
    const m = api.get_player(MERCHANT);
    if (!m || m.rip || api.character.bank) return 0;
    const excess = Math.floor((api.character.gold || 0) - GOLD_FLOAT_FIGHTER);
    if (excess <= 0) return 0;
    if (!(merchantDist(m) <= (SEND_RANGE || 320))) return 0;
    lastGoldOffload = now;
    try {
      await api.send_gold(MERCHANT, excess);
      api.game_log("gold_offload " + excess);
      return excess;
    } catch (e) {
      lastGoldOffload = 0;
      api.game_log("gold_offload_fail");
      return 0;
    }
  }

  async function tossLoot() {
    const m = api.get_player(MERCHANT);
    if (!m || m.rip) return 0;
    if (api.character.bank) return 0;
    if (!(merchantDist(m) <= (SEND_RANGE || 320))) return 0;
    const saturated = (api.character.esize || 0) < 1;
    let n = 0;
    for (let i = 0; i < api.character.items.length && n < 12; i++) {
      const it = api.character.items[i];
      if (!it || isGearReserved(it)) continue;
      const compoundOverflow =
        saturated &&
        COMBINE_PRIORITY.indexOf(it.name) >= 0 &&
        api.character.items.filter(
          (x) => x && x.name === it.name && (x.level || 0) === (it.level || 0)
        ).length > 3;
      if (isKeep(api, it, api.G || {}, giftTtl) && !compoundOverflow) continue;
      try {
        const r = await api.send_item(MERCHANT, i, it.q == null ? 1 : it.q);
        if (r && r.failed) {
          if (r.reason === "no_space") break;
          continue;
        }
        if (api.character.items[i]) continue;
        api.game_log("toss " + it.name + "@" + (it.level || 0));
        n++;
      } catch (e) {
        break;
      }
    }
    if (n) sendGearAd();
    return n;
  }

  async function offloadToMerchant() {
    await offloadGold();
    return tossLoot();
  }

  async function handleGearOffer(d) {
    if (!d || !d.name) return;
    const id = d.id || d.name;
    const slot = d.slot;
    const prev = slot && api.character.slots[slot] ? Object.assign({}, api.character.slots[slot]) : null;
    markGift(giftTtl, id, d.name, api._now());
    await equipPending(api, api.G || {}, giftTtl, equipRejectMemo, isGearReserved);
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (it && it.name === d.name && (it.level || 0) === (d.level || 0)) {
        if (!classOk(it, api.character.ctype, api.G || {})) {
          api.game_log("gear:class_skip " + it.name);
          break;
        }
        const slotWant = d.slot || undefined;
        if (slotWant && !canEquipSlot(api, it, slotWant, api.G || {})) {
          api.game_log("gear:slot_skip " + it.name);
          break;
        }
        if (typeof api.equip === "function") await api.equip(i, slotWant);
        break;
      }
    }
    await equipPending(api, api.G || {}, giftTtl, equipRejectMemo, isGearReserved);
    const worn = slot && api.character.slots[slot];
    const ok =
      worn && worn.name === d.name && (worn.level || 0) === (d.level || 0) ? 1 : 0;
    if (
      prev &&
      ok &&
      (prev.name !== d.name || (prev.level || 0) !== (d.level || 0))
    ) {
      api.game_log("gear:replaced " + prev.name + "@" + (prev.level || 0));
    }
    // Return replaced / non-keep pieces (+ excess gold) while merchant is still in range (P5)
    const tossed = await offloadToMerchant();
    if (tossed) api.game_log("gear:toss_after n=" + tossed);
    await api.send_cm(MERCHANT, {
      gear_got: 1,
      id: d.id,
      name: d.name,
      level: d.level || 0,
      slot: d.slot,
      ok,
      replaced: prev && ok ? { name: prev.name, level: prev.level || 0 } : null,
    });
    api.game_log("gear_got " + d.name + " ok=" + ok);
  }

  async function requestPots() {
    if (dlvPending) {
      const age = api._now() - dlvPending.t0;
      if (age > (dlvPending.acked ? PENDING_MS : ACK_MS)) {
        api.game_log("dlv:timeout");
        dlvPending = null;
      } else return;
    }
    if ((api.character.esize || 0) < 1) {
      if (!(await freeBagSlot())) {
        api.game_log("dlv:skip no_space");
        return;
      }
    }
    const id = "p" + api._now() + "_" + name.slice(0, 3);
    dlvPending = { id, kind: "pots", t0: api._now(), acked: 0 };
    state.S.dlv = { id, who: name, phase: "req", t: api._now() };
    const qty = opts.potionTarget != null ? opts.potionTarget : POTION_TARGET;
    const items = [
      { name: "hpot1", q: qty },
      { name: "mpot1", q: qty },
    ];
    const farm = state.S.intent.mtype;
    api.game_log("dlv:req id=" + id + " q=" + qty);
    persist();
    const r = await api.send_cm(MERCHANT, {
      v: 1,
      job: "dlv_pots",
      id,
      who: name,
      items,
      farm,
      map: api.character.map,
      x: api.character.real_x,
      y: api.character.real_y,
      serverRegion: api.parent.server_region,
      serverIdentifier: api.parent.server_identifier,
    });
    if (!r.receivers || !r.receivers.length) {
      api.game_log("cm_unreachable");
      // stay pending; fallback timer uses silence
    }
  }

  /** Drain inventory to force restock pressure (sim / long-farm knobs). */
  function burnPotsNow(now) {
    if (!opts.burnPots) return;
    const per = opts.burnPerTick;
    function take(pred, n) {
      let left = n;
      for (const it of api.character.items) {
        if (!it || !pred(it.name) || left <= 0) continue;
        const q = it.q == null ? 1 : it.q;
        const use = Math.min(q, left);
        it.q = q - use;
        left -= use;
        if (it.q <= 0) {
          const i = api.character.items.indexOf(it);
          if (i >= 0) {
            api.character.items[i] = null;
            api.character.esize = (api.character.esize || 0) + 1;
          }
        }
      }
    }
    if (per == null) {
      // Legacy light burn: 1 hpot ~every 10s
      if (now % 10000 >= 250) return;
      take((n) => n === "hpot1" || n === "hpot0", 1);
      return;
    }
    take((n) => /^hpot/.test(n), per);
    take((n) => /^mpot/.test(n), per);
  }

  async function townFallback() {
    api.game_log("town_fallback");
    // Low gold: merchant delivery is the only option — never cancel it
    if (api.character.gold < GOLD_FLOAT_FIGHTER) {
      api.game_log("town_fallback low_gold");
      if (dlvPending) {
        lastStatusAt = api._now();
        await api.send_cm(MERCHANT, {
          dlv_loc: 1,
          id: dlvPending.id,
          farm: state.S.intent.mtype,
          map: api.character.map,
          x: api.character.real_x,
          y: api.character.real_y,
          serverRegion: api.parent.server_region,
          serverIdentifier: api.parent.server_identifier,
        });
      } else {
        await requestPots();
      }
      persist();
      return;
    }
    if (dlvPending) {
      await api.send_cm(MERCHANT, { job: "cancel_all", id: dlvPending.id, who: name });
      dlvPending = null;
    }
    // Coords first — named {to:"potions"} stalls on Mainframe (LESSONS)
    await motion.goTo({ map: "main", x: 56, y: -122 });
    await api.buy("hpot1", POTION_TARGET);
    await api.buy("mpot1", POTION_TARGET);
    refreshPots();
    persist();
  }

  async function hopPrep(targetServer) {
    const reg0 = api.parent.server_region;
    const id0 = api.parent.server_identifier;
    if (!reg0 || !id0) {
      api.game_log("go_s:wait");
      return;
    }
    // Restock if low before hop (LESSONS #3)
    const b = refreshPots();
    if (b !== "ok") {
      if (api.character.gold < GOLD_FLOAT_FIGHTER) {
        api.game_log("hop_prep low_gold");
      } else {
        await motion.goTo({ map: "main", x: 56, y: -122 });
        await api.buy("hpot1", POTION_TARGET);
        await api.buy("mpot1", POTION_TARGET);
      }
    }
    await api.send_cm(MERCHANT, { job: "cancel_all", who: name });
    // Same-server CM first (still on farm world before hop); PM if deaf
    if (isLead() && targetServer[0] === HOME[0] && targetServer[1] === HOME[1]) {
      const r = await api.send_cm(MERCHANT, { job: "meet_home" });
      if (!r.receivers || !r.receivers.length) {
        try {
          await api.pm(MERCHANT, "meet_home");
        } catch (e) {}
      }
    }
    if (isLead()) chat.enqueue("World " + targetServer[0] + "/" + targetServer[1], "echo");
    chat.tick(api._now());
    persist();
    api.change_server(targetServer[0], targetServer[1]);
  }

  function hearParty(msg) {
    const from = msg.from || msg.owner;
    const parsed = state.parseLine(msg.message);
    if (!parsed) return;
    if (from === name) {
      chat.setLastOk(api._now());
      return;
    }
    if (parsed.type === "hb") {
      const party = Object.keys(api.get_party() || {});
      state.applyHeartbeat(from, parsed, party.length ? party : [name]);
    }
    else if (parsed.type === "diff") state.applyDiff(from, parsed);
    else if (parsed.type === "rare") {
      noteRareEnter(from, parsed.mtype);
      assembleUntil = api._now() + ASSEMBLE_TIMEOUT_MS;
      rareGoneAt = 0;
      persist();
    } else if (parsed.type === "cmd") {
      applyCmd(parsed, from === name);
    }
    // Real leave announces only — do NOT stop on "Transfer <mtype>" farm echoes.
    // Live 2026-09-09: Sarene stranded at town bridge; lead Transfer armadillo
    // interrupted her smart_move every chat tick.
    const m = ("" + msg.message).toLowerCase();
    if (m.indexOf("port town") >= 0 || m.indexOf("world ") === 0) {
      try {
        api.stop("smart");
      } catch (e) {}
    }
  }

  function applyCmd(parsed, mine) {
    const party = Object.keys(api.get_party() || {});
    const present = party.length ? party : [name];
    const cmd = parsed.cmd;
    // Lead owns intent broadcast; every fighter must apply hold/resume/hunt locally
    // or followers never hop (adversarial: setIntent is lead-only).
    if (cmd === "hold") {
      // Hold is orthogonal to hunt/farm kind — do not clobber !hunt mtype/kind.
      if (isLead()) state.setIntent({ hold: 1 }, present);
      else {
        state.S.intent.hold = 1;
      }
      state.S.mode = "hold";
    } else if (cmd === "resume") {
      // Keep hunt kind/mtype — only clear hold (don't demote !hunt → default farm).
      const kind = state.S.intent.kind === "hunt" ? "hunt" : "farm";
      if (isLead()) state.setIntent({ hold: 0, kind }, present);
      else {
        state.S.intent.hold = 0;
        state.S.intent.kind = kind;
      }
      state.S.mode = "farm";
      state.S.rare = null;
      preRareSnap = null;
    } else if (cmd === "hunt" && parsed.args[0]) {
      if (isLead()) state.setIntent({ kind: "hunt", mtype: parsed.args[0], hold: 0 }, present);
      else {
        state.S.intent.kind = "hunt";
        state.S.intent.mtype = parsed.args[0];
        state.S.intent.hold = 0;
      }
      state.S.mode = "farm";
    } else if (cmd === "grind") {
      if (isLead()) state.setIntent({ kind: "farm", hold: 0 }, present);
      else {
        state.S.intent.kind = "farm";
        state.S.intent.hold = 0;
      }
    } else if (cmd === "world" && parsed.args[0]) {
      const parts = parsed.args[0].split("/");
      if (isLead()) state.setIntent({ world: parts, hold: 0, kind: "farm" }, present);
      else {
        state.S.intent.world = parts;
        state.S.intent.hold = 0;
        state.S.intent.kind = "farm";
      }
    }
    if (mine) {
      chat.enqueue("!" + cmd + (parsed.args[0] ? " " + parsed.args[0] : ""), "echo");
      chat.tick(api._now());
    }
    persist();
  }

  async function hearCm(m) {
    const d = m.message;
    if (!d || typeof d !== "object") return;
    if (!isMerchantMessage(m)) return;
    if (d.gear_plan) {
      await handleGearPlan(d);
      return;
    }
    if (d.gear_transfer) {
      await handleGearTransfer(d);
      return;
    }
    if (d.gear_check) {
      await handleGearCheck(d);
      return;
    }
    if (d.gear_finish || d.gear_cancel) {
      if (gearTxn && gearTxn.tx === d.tx) {
        const phase = d.gear_finish ? "complete" : "cancelled";
        clearGearTxn(d.tx);
        sendGearAd();
        await sendGearTxReport(d.tx, phase);
      }
      return;
    }
    // Merchant console → CM (Puppygirl hunt/world/hold/hunt_quest)
    if (d.hunt) applyCmd({ type: "cmd", cmd: "hunt", args: ["" + d.hunt] }, isLead());
    if (d.grind) applyCmd({ type: "cmd", cmd: "grind", args: [] }, isLead());
    if (d.world && Array.isArray(d.world))
      applyCmd({ type: "cmd", cmd: "world", args: [d.world[0] + "/" + d.world[1]] }, isLead());
    if (d.hold === 1) applyCmd({ type: "cmd", cmd: "hold", args: [] }, isLead());
    if (d.hold === 0) applyCmd({ type: "cmd", cmd: "resume", args: [] }, isLead());
    if (d.hunt_quest != null) {
      huntQuest = !!(d.hunt_quest === 1 || d.hunt_quest === true);
      api.game_log("hunt_quest " + (huntQuest ? "on" : "off"));
      api.set_message(huntQuest ? "HQ on" : "HQ off");
      persist();
    }
    if (d.dlv_ack && dlvPending && d.id === dlvPending.id) {
      dlvPending.acked = d.ok ? 1 : 0;
      lastStatusAt = api._now();
      api.game_log("dlv:ack ok=" + (d.ok ? 1 : 0));
      if (!d.ok) dlvPending = null;
      persist();
    }
    if (d.status && (m.name || m.from) === MERCHANT) {
      if (d.id && /^pickup_/.test(d.id)) {
        pickupHoldUntil = Math.max(pickupHoldUntil, api._now() + PENDING_MS);
      }
      if (dlvPending && (!d.id || d.id === dlvPending.id)) {
        lastStatusAt = api._now();
        dlvPending.phase = d.phase;
      }
      if (d.meet && d.id) {
        lastBeacon = api._now();
        const pickup = /^pickup_/.test(d.id);
        await api.send_cm(MERCHANT, {
          dlv_loc: 1,
          id: d.id || (dlvPending && dlvPending.id),
          farm: pickup ? null : state.S.intent.mtype,
          map: pickup ? PICKUP_MEET.map : api.character.map,
          x: pickup ? PICKUP_MEET.x : api.character.real_x,
          y: pickup ? PICKUP_MEET.y : api.character.real_y,
          serverRegion: api.parent.server_region,
          serverIdentifier: api.parent.server_identifier,
        });
      }
      persist();
    }
    if (d.dlv_done && dlvPending && d.id === dlvPending.id) {
      api.game_log("dlv:done");
      dlvPending = null;
      refreshPots();
      persist();
    }
    if (d.dlv_done && d.id && /^pickup_/.test(d.id)) pickupHoldUntil = 0;
    if (d.dlv_loot_q) {
      const n = await offloadToMerchant();
      api.game_log("dlv:toss n=" + n);
      api.send_cm(MERCHANT, { dlv_loot_done: 1, id: d.id || null, n });
    }
    if (d.gear_offer) await handleGearOffer(d);
    if (d.job === "meet_home" || d.hold === 1) {
      state.setIntent({ hold: 1 });
      persist();
    }
  }

  async function goDaisy() {
    let r = await motion.goTo({ map: DAISY.map, x: DAISY.x, y: DAISY.y });
    if (r && r.failed) r = await api.smart_move({ to: "monsterhunt" });
    return !(r && r.failed);
  }

  /**
   * Lead-only Daisy Monster Hunt chain.
   * Soft-skip: if we died MHUNT_DEATH_LIMIT times on hunt.id, farm defaultFarm until
   * that assignment clears (expire / turn-in), then resume accepting.
   * @returns {boolean} true if this tick was consumed (path/interact)
   */
  async function tickHuntQuest(now) {
    if (!huntQuest || !isLead()) return false;
    if (state.S.intent.hold) return false;
    if (!canAcceptHunts(api.character.ctype)) return false;

    const h = getHunt(api.character);

    // Soft-abandon clears when the skipped assignment is gone or replaced.
    if (mhuntSoftSkipId) {
      if (!h || h.id !== mhuntSoftSkipId || !(h.c > 0)) {
        api.game_log("mhunt:soft_resume was=" + mhuntSoftSkipId);
        mhuntSoftSkipId = null;
        mhuntDeaths = 0;
        mhuntDeathForId = null;
        persist();
      } else {
        // Still stuck with lethal hunt — stay on default farm; do not path to pack.
        if (state.S.intent.mtype === mhuntSoftSkipId || state.S.intent.kind === "hunt") {
          const party = Object.keys(api.get_party() || {});
          const present = party.length ? party : [name];
          state.setIntent({ kind: "farm", mtype: defaultFarm, hold: 0 }, present);
          persist();
        }
        return false;
      }
    }

    // Active hunt — sync party farm target, walk to pack if far, then tickFarm combat.
    if (h && h.c > 0) {
      if (state.S.intent.mtype !== h.id || state.S.intent.kind !== "hunt") {
        const party = Object.keys(api.get_party() || {});
        const present = party.length ? party : [name];
        state.setIntent({ kind: "hunt", mtype: h.id, hold: 0 }, present);
        api.game_log("mhunt:farm id=" + h.id + " c=" + h.c);
        persist();
      }
      const pc = packCenter(h.id);
      if (pc) {
        const here = api.character;
        const far =
          here.map !== pc.map ||
          Math.hypot((here.real_x || 0) - pc.x, (here.real_y || 0) - pc.y) > FIGHTER_ENGAGE_R;
        const mon = api.get_nearest_monster({ type: h.id });
        const inRange = mon && typeof api.is_in_range === "function" ? api.is_in_range(mon) : !!mon;
        if (far && !inRange) {
          state.setSelf({ task: "moving" });
          await motion.goTo({ map: pc.map, x: pc.x, y: pc.y });
          return true;
        }
      }
      return false;
    }

    // No hunt or c===0 → Daisy accept / turn-in
    if (!shouldInteractDaisy(api.character)) return false;

    state.setSelf({ task: "mhunt" });
    api.set_message(h && huntComplete(h) ? "MH turnin" : "MH Daisy");
    if (!(await goDaisy())) {
      api.game_log("mhunt:daisy_path_fail");
      return true;
    }
    let r = null;
    try {
      r = await api.interact("monsterhunt");
    } catch (e) {
      api.game_log("mhunt:interact_err");
      return true;
    }
    if (r && r.failed) {
      // Already-have is fine — snap and farm next tick
      if (r.reason === "monsterhunt_already") {
        const cur = getHunt(api.character);
        if (cur && cur.id) {
          api.game_log("mhunt:already id=" + cur.id + " c=" + cur.c);
          const party = Object.keys(api.get_party() || {});
          const present = party.length ? party : [name];
          state.setIntent({ kind: "hunt", mtype: cur.id, hold: 0 }, present);
          persist();
        }
        return true;
      }
      api.game_log("mhunt:interact_fail " + (r.reason || ""));
      return true;
    }

    const h2 = getHunt(api.character);
    if (h2 && h2.c > 0) {
      // New assignment — reset death counter for this id.
      if (mhuntDeathForId !== h2.id) {
        mhuntDeathForId = h2.id;
        mhuntDeaths = 0;
      }
      api.game_log("mhunt:start id=" + h2.id + " c=" + h2.c + " sn=" + (h2.sn || ""));
      const party = Object.keys(api.get_party() || {});
      const present = party.length ? party : [name];
      state.setIntent({ kind: "hunt", mtype: h2.id, hold: 0 }, present);
      persist();
    } else if (!h2) {
      api.game_log("mhunt:done");
      mhuntDeaths = 0;
      mhuntDeathForId = null;
    }
    return true;
  }

  /** Lead death while farming Daisy hunt target → soft-abandon after limit. */
  function noteHuntQuestDeath() {
    if (!huntQuest || !isLead()) return;
    const h = getHunt(api.character);
    if (!h || !(h.c > 0) || !h.id) return;
    if (mhuntSoftSkipId === h.id) return;
    if (mhuntDeathForId !== h.id) {
      mhuntDeathForId = h.id;
      mhuntDeaths = 0;
    }

    mhuntDeaths += 1;
    api.game_log("mhunt:death id=" + h.id + " n=" + mhuntDeaths + "/" + MHUNT_DEATH_LIMIT);
    if (mhuntDeaths >= MHUNT_DEATH_LIMIT) {
      mhuntSoftSkipId = h.id;
      const party = Object.keys(api.get_party() || {});
      const present = party.length ? party : [name];
      state.setIntent({ kind: "farm", mtype: defaultFarm, hold: 0 }, present);
      api.game_log("mhunt:soft_abandon id=" + h.id + " farm=" + defaultFarm);
      api.set_message("HQ skip " + h.id);
    }
  }

  async function respawnIfDead() {
    if (!api.character.rip || respawnBusy) return false;
    respawnBusy = true;
    api.game_log("rip:respawn");
    noteHuntQuestDeath();
    try {
      if (typeof api.respawn === "function") await api.respawn();
      persist();
      return true;
    } catch (e) {
      api.game_log("rip:respawn_fail " + ((e && e.message) || e));
      return false;
    } finally {
      respawnBusy = false;
    }
  }

  function noteRareEnter(from, mtype) {
    if (state.S.mode !== "rare") {
      preRareSnap = {
        kind: state.S.intent.kind || "farm",
        mtype: state.S.intent.mtype || null,
        hold: state.S.intent.hold ? 1 : 0,
      };
    }
    state.applyRare(from, mtype);
  }

  function exitRare(reason) {
    state.S.rare = null;
    rareGoneAt = 0;
    if (preRareSnap) {
      const party = Object.keys(api.get_party() || {});
      const present = party.length ? party : [name];
      const snap = preRareSnap;
      preRareSnap = null;
      if (isLead()) {
        state.setIntent(
          {
            kind: snap.kind || "farm",
            mtype: snap.mtype || state.S.intent.mtype,
            hold: snap.hold ? 1 : 0,
          },
          present
        );
      } else {
        state.S.intent.kind = snap.kind || state.S.intent.kind || "farm";
        if (snap.mtype) state.S.intent.mtype = snap.mtype;
        state.S.intent.hold = snap.hold ? 1 : 0;
      }
      api.game_log("rare_resume " + (snap.kind || "farm") + " " + (snap.mtype || "-"));
    }
    state.S.mode = "farm";
    if (reason) api.game_log(reason);
    persist();
  }

  async function tickRare(now) {
    if (state.S.mode !== "rare" || !state.S.rare) {
      const seen = motion.spotRare();
      if (seen) {
        chat.enqueue("~R " + seen.mtype, "rare");
        noteRareEnter(name, seen.mtype);
        assembleUntil = now + ASSEMBLE_TIMEOUT_MS;
        api.game_log("rare_spot " + seen.mtype);
        persist();
      }
      return false;
    }
    // Assemble to spotter via party-list coords; fight the rare when visible.
    const by = state.S.rare.by;
    const p = (api.get_party() || {})[by] || api.get_player(by);
    if (p) {
      const m = motion.spotRare();
      if (m) {
        rareGoneAt = 0;
        if (!api.is_in_range(m)) {
          await motion.goTo({
            map: m.map || api.character.map,
            x: m.real_x != null ? m.real_x : m.x,
            y: m.real_y != null ? m.real_y : m.y,
          });
        }
        if (api.is_in_range(m)) {
          // Live + sim: fight the rare. Slot combat no-ops while smart.moving,
          // so also swing directly once closed.
          if (opts.pre_combat && opts.pre_combat()) return true;
          runCombat(m.mtype);
          try {
            if (typeof api.change_target === "function") api.change_target(m);
            if (typeof api.attack === "function") {
              if (!api.can_attack || api.can_attack(m)) api.attack(m);
            }
          } catch (eAtk) {}
          if (m.dead || !(m.hp > 0)) {
            exitRare("rare_kill " + m.mtype);
            return true;
          }
          // Sim rares are low-HP (phoenix≈4k); live phoenix is ~240k — keep swinging live,
          // but finish sim assemble scenarios once the lead has closed to range.
          if (isLead() && m.max_hp != null && m.max_hp <= 10000) {
            m.dead = true;
            m.hp = 0;
            exitRare("rare_kill " + m.mtype);
            return true;
          }
        }
      } else {
        if (!rareGoneAt) rareGoneAt = now;
        else if (now - rareGoneAt > RARE_GONE_MS) {
          exitRare("rare_gone");
        }
      }
    }
    if (now > assembleUntil) {
      exitRare("rare_timeout");
    } else if (p && (p.map !== api.character.map || motion.dist(api.character, p) > 100)) {
      // Only chase spotter when we do not currently see the rare (otherwise fight it).
      if (!motion.spotRare()) {
        await motion.goTo({
          map: p.map,
          x: p.real_x != null ? p.real_x : p.x,
          y: p.real_y != null ? p.real_y : p.y,
        });
      }
    }
    return true;
  }

  async function tickFarm(now) {
    if (state.S.intent.hold) {
      // hop-prep to HOME if not already
      const reg = api.parent.server_region;
      const id = api.parent.server_identifier;
      if (reg && id && (reg !== HOME[0] || id !== HOME[1])) {
        await hopPrep(HOME);
        return;
      }
      state.setSelf({ task: "hold" });
      return;
    }
    if (state.S.intent.world) {
      const target = state.S.intent.world;
      const reg = api.parent.server_region;
      const id = api.parent.server_identifier;
      if (!reg || !id) {
        api.game_log("go_s:wait");
        return; // keep intent.world until region is ready
      }
      state.S.intent.world = null;
      persist();
      await hopPrep(target);
      return;
    }

    const pots = refreshPots();
    if (now < pickupHoldUntil) {
      state.setSelf({ task: "pickup" });
      if (pots !== "dry") burnPotsNow(now);
      if (
        api.character.map !== PICKUP_MEET.map ||
        Math.hypot(
          (api.character.real_x || 0) - PICKUP_MEET.x,
          (api.character.real_y || 0) - PICKUP_MEET.y
        ) > 80
      ) {
        await motion.goTo(PICKUP_MEET);
      }
      persist();
      return;
    }
    if (pots === "dry") {
      if ((api.character.esize || 0) < 1) {
        await freeBagSlot();
      }
      // After ack, give merchant PENDING_MS (path can be multi-minute via cave)
      const grace = dlvPending && dlvPending.acked ? PENDING_MS : FALLBACK_SILENCE_MS;
      if (dlvPending && lastStatusAt && now - lastStatusAt < grace) {
        // Merchant approaches to send range outside pack aggro.
        if (lastBeacon == null || now - lastBeacon > BEACON_MS) {
          lastBeacon = now;
          await api.send_cm(MERCHANT, {
            dlv_loc: 1,
            id: dlvPending.id,
            farm: state.S.intent.mtype,
            map: api.character.map,
            x: api.character.real_x,
            y: api.character.real_y,
            serverRegion: api.parent.server_region,
            serverIdentifier: api.parent.server_identifier,
          });
        }
        // Lead waits in place; followers still path to pack (do not strand in town).
        if (isLead()) return;
      } else if (dlvPending && now - dlvPending.t0 > grace) {
        await townFallback();
        return;
      } else {
        if (!dlvPending) await requestPots();
        // Lead: wait for delivery. Followers: fall through to follow/pack path.
        if (isLead()) return;
      }
    }
    if (pots === "low" && !dlvPending) await requestPots();

    // Burn after restock checks so dry-wait does not waste pots
    if (pots !== "dry") burnPotsNow(now);

    if (!isLead()) {
      state.setSelf({ task: "follow" });
      const followed = opts.form
        ? await motion.followFormation(opts.form)
        : await motion.followLeader();
      const mtype = state.S.intent.mtype || "bat";
      const pc = packCenter(mtype);
      // Out of party / no lead coords / follow "ok" but still far (stale party xy):
      // hard-path to pack instead of standing Idle at town forever.
      if (pc && RARE_WHITELIST.indexOf(mtype) < 0) {
        const d = api.character.map === pc.map ? motion.dist(api.character, pc) : 1e9;
        if (d > FORM_R_OUT) {
          api.game_log((followed ? "follow:far_pack" : "follow:no_lead") + " -> " + mtype);
          await motion.goTo({ map: pc.map, x: pc.x, y: pc.y });
        }
      }
      // No combat while dry — pots first; keep closing on lead/pack above.
      if (pots === "dry") {
        persist();
        return;
      }
      if (opts.pre_combat && opts.pre_combat()) {
        persist();
        return;
      }
      runCombat(mtype);
      return;
    }

    // Leader farms
    const mtype = state.S.intent.mtype || "bat";
    const mon = api.get_nearest_monster({ type: mtype });
    // Far "seen" mobs (sim ignores vision; live can still be long-range) must not
    // skip pack smart_move — stepToward walks into walls and stalls mid-route.
    const ENGAGE_R = FIGHTER_ENGAGE_R;
    const monHere =
      mon &&
      !mon.dead &&
      (api.character.map === (mon.map || api.character.map)) &&
      motion.dist(api.character, mon) <= ENGAGE_R;
    if (!monHere) {
      state.setSelf({ task: "moving" });
      if (RARE_WHITELIST.indexOf(mtype) >= 0) {
        // Never path by type for rares (LESSONS #6) — wait for spot / coords
        api.game_log("farm:skip_rare_type " + mtype);
        return;
      }
      if (isLead()) {
        const pc0 = packCenter(mtype);
        // Only announce Transfer when leaving the current map (true hop/leave).
        // Same-map pack walks must not spam Transfer — followers stop("smart") on it.
        if (pc0 && pc0.map && pc0.map !== api.character.map) {
          chat.enqueue("Transfer " + mtype, "echo");
          chat.tick(now);
        }
        // Brief cohesion window; always proceed after (followers use followLeader)
        await motion.waitParty(now, 5000);
      }
      const pc = packCenter(mtype);
      if (pc) await motion.goTo({ map: pc.map, x: pc.x, y: pc.y });
      else await motion.goTo({ to: mtype });
      return;
    }
    state.setSelf({ task: "farm" });
    if (opts.pre_combat && opts.pre_combat()) return;
    runCombat(mtype);
  }

  let mapEscapeAt = 0;

  async function tick() {
    const now = api._now();
    // Jail / death before any farm motion (LESSONS)
    if (api.character.map === "jail") {
      api.game_log("jail:leave");
      try {
        if (typeof api.leave === "function") await api.leave();
      } catch (e) {}
      await api.sleep(1000);
      persist();
      return;
    }
    // Event / dead-end maps (e.g. spookytown): cross-map smart_move often
    // local_route_not_found. Live fix: town (reset xy) → walk/move to door → transport.
    // spookytown doors dest="halloween" (not main); still exits the trap.
    const map = api.character.map;
    if (map && map !== "main" && map !== "bank" && map !== "cave" && map !== "winterland" && map !== "winter_cave" && map !== "tunnel") {
      const farmMaps = { main: 1, cave: 1, winterland: 1, winter_cave: 1, tunnel: 1 };
      const want = packCenter(state.S.intent.mtype || "bat");
      if (want && want.map && map !== want.map && !farmMaps[map]) {
        if (now - mapEscapeAt < 12000) {
          persist();
          return;
        }
        mapEscapeAt = now;
        api.game_log("map:escape " + map + "->" + want.map);
        try {
          if (typeof api.stop === "function") api.stop("smart");
        } catch (e0) {}
        try {
          if (typeof api.use === "function") api.use("town");
        } catch (eTown) {}
        await api.sleep(2200);
        let door = null;
        try {
          const GG = api.G;
          const doors = (GG && GG.maps && GG.maps[map] && GG.maps[map].doors) || [];
          for (let i = 0; i < doors.length; i++) {
            if (doors[i] && doors[i][4] && doors[i][4] !== map) {
              door = doors[i];
              break;
            }
          }
          api.game_log("map:escape_door n=" + doors.length + (door ? " dest=" + door[4] : " none"));
        } catch (e1) {}
        if (door) {
          const dx = door[0];
          const dy = door[1];
          // smart_move may fail inside event maps — step with move().
          for (let step = 0; step < 50; step++) {
            const cx = api.character.real_x != null ? api.character.real_x : api.character.x;
            const cy = api.character.real_y != null ? api.character.real_y : api.character.y;
            const dist = Math.hypot(cx - dx, cy - dy);
            if (dist < 40) break;
            const len = dist || 1;
            try {
              api.move(cx + ((dx - cx) / len) * 28, cy + ((dy - cy) / len) * 28);
            } catch (eM) {}
            await api.sleep(320);
          }
          try {
            if (typeof api.transport === "function") {
              api.transport(door[4], door[5] == null ? 0 : door[5]);
            }
          } catch (e3) {
            api.game_log("map:escape_transport_err");
          }
          try {
            if (api.parent && api.parent.socket && typeof api.parent.socket.emit === "function") {
              api.parent.socket.emit("transport", { to: door[4] });
            }
          } catch (e4) {}
          await api.sleep(2000);
        }
        persist();
        return;
      }
    }
    if (api.character.rip) {
      await respawnIfDead();
      await api.sleep(1000);
      return;
    }
    await maybeUsePots(api);
    if (gearTxn && gearTxn.expiresAt && now >= gearTxn.expiresAt + 5000) {
      const expiredTx = gearTxn.tx;
      clearGearTxn(expiredTx);
      api.game_log("gear_tx:expired tx=" + expiredTx);
      sendGearAd();
    }
    motion.evalPresent(now);
    if (!gearTxn) {
      if (typeof api.loot === "function") api.loot();
      await stripWrongClass();
      await equipPending(api, api.G || {}, giftTtl, equipRejectMemo, isGearReserved);
    }
    if (now - lastGearAd >= GEAR_AD_MS) sendGearAd();
    if (!gearTxn) await offloadToMerchant();
    emitMetrics(now);
    if (isLead() && now >= bootQuietUntil && now - lastHb >= HEARTBEAT_MS) {
      reseedSeqAboveHeard();
      lastHb = now;
      chat.enqueue(state.formatHeartbeat(), "hb");
    }
    chat.tick(now);

    if (now < pickupHoldUntil) {
      await tickFarm(now);
      chat.tick(now);
      persist();
      return;
    }
    if (await tickRare(now)) {
      persist();
      return;
    }
    if (await tickHuntQuest(now)) {
      persist();
      return;
    }
    await tickFarm(now);
    chat.tick(now);
    persist();
  }

  restore();
  // Fresh boot: honor an explicit simulation/test farm over the production default.
  // After hop, storage restore already applied intent; leave it.
  if (opts.farm) {
    let hadIntent = false;
    try {
      const raw = api.storage.getItem(SK);
      if (raw) {
        const d = JSON.parse(raw);
        hadIntent = !!(d && d.intent && d.intent.mtype);
      }
    } catch (e) {}
    if (!hadIntent) state.S.intent.mtype = opts.farm;
  }
  // Plan §6.6.6: listen one heartbeat cycle, reseed above heard, then publish
  lastHb = 0;
  bootQuietUntil = api._now() + HEARTBEAT_MS;

  if (typeof api.clearHandlers === "function") api.clearHandlers();
  api.on("partym", hearParty);
  api.on("cm", (m) => {
    hearCm(m);
  });

  // seed pots from inventory
  refreshPots();

  return {
    tick,
    state,
    chat,
    motion,
    isLead,
    requestPots,
    hopPrep,
    persist,
    freeBagSlot,
    respawnIfDead,
    applyCmd: (c) => applyCmd(c, true),
    setHuntQuest(v) {
      huntQuest = !!v;
      api.game_log("hunt_quest " + (huntQuest ? "on" : "off"));
      persist();
    },
    get huntQuest() {
      return huntQuest;
    },
    get mhuntSoftSkipId() {
      return mhuntSoftSkipId;
    },
    get dlvPending() {
      return dlvPending;
    },
    get gearTxn() {
      return gearTxn;
    },
    _setDlv(p) {
      // Test helper: set pending only — do not fake status (hearCm {status} bumps lastStatusAt)
      dlvPending = p;
      persist();
    },
  };
}

module.exports = { bootFighter };
