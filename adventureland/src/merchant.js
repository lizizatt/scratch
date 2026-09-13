"use strict";

const {
  FIGHTERS,
  LEADER_ORDER,
  HOME,
  JOB_MS,
  POTION_TARGET,
  ECON_BAG_RESERVE,
  ECON_BANK_RESERVE,
  XYN_BAG_RESERVE,
  OBSOLETE_POTIONS,
  EMERGENCY_SLOT_ITEMS,
  PICKUP_MEET,
  GOLD_FLOAT_FIGHTER,
  GOLD_FLOAT_MERCHANT,
  COMBINE_PRIORITY,
  MIN_UPGRADE_CHANCE,
  SEND_RANGE,
  BEACON_MS,
  EXCHANGE_ITEMS,
  VENDOR_NPC,
  VENDOR_NPC_LOW_LEVEL,
  VENDOR_NPC_MAX_LEVEL,
  EMERGENCY_VENDOR_NPC,
  STALL_SELL,
  GEAR_TARGETS,
  KEEP_ALWAYS,
  PONTY_WANT,
  PONTY_MULT,
  CRAFT_TARGETS,
  GEAR_AD_MS,
  HUNTER_PLAN,
  HUNTER_UPGRADE_MIN_CHANCE,
} = require("./constants");
const { maybeUsePots } = require("./potions");
const {
  isSellJunk,
  isGearPiece,
  isGearTargetName,
  planGifts,
  pickUpgradeIndex,
  scrollFor,
  upgradeChance,
  isRiskUpgrade,
  isHunterUpgrade,
  canUpgradeItem,
  upgradeScrollFor,
  upgradeReady,
  eligibleUpgrade,
  candidateSlots,
} = require("./gear");
const { planCompounds, cscrollFor } = require("./bank_clean_plan");
const {
  merchantAvoidGoTo,
  merchantAvoidListMonsters,
  shouldEngageAvoid,
} = require("./merchant_avoid");
const {
  avoidFailPolicy,
  meetApproachPoint,
  meetFarmAt,
  meetResolveDelivery,
  meetTransitBlockers,
  meetTransitBlockerFilter,
} = require("./merchant_meet");
const { packCenter } = require("./packs");
const { cmSender, isFighterName } = require("./gear_coordination");

/**
 * Merchant logistics under Jazwyn command.
 * Idle on farm world; hops only for meet_home / to reach fighters.
 * When idle: vendor junk → Xyn exchange → stall surplus → Ponty → craft/upgrade/combine/gift.
 */
function bootMerchant(api, opts) {
  opts = opts || {};
  if (!api._now) api._now = () => (opts.now ? opts.now() : Date.now());
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
  if (
    store.gearTx ||
    store.gearAwaitRevisions ||
    store.gearAwaitAds ||
    store.gearPlanFailures ||
    store.gearPlanAfter ||
    store.gearPlanRevision
  ) {
    delete store.gearTx;
    delete store.gearAwaitRevisions;
    delete store.gearAwaitAds;
    delete store.gearPlanFailures;
    delete store.gearPlanAfter;
    delete store.gearPlanRevision;
    saveQ(store);
  }
  let busy = false;
  let hunterPreparing = false;
  const gearAds = {};
  let gearAdSeq = 0;
  let giftBusy = false;
  let lastParkFailAt = null;
  const PARK_FAIL_BACKOFF_MS = 15000;
  // A failed attempt may retry after one second, but a completed inventory
  // sweep is authoritative for three minutes.
  let lastPontyAttemptAt = null;
  let lastPontySweepAt = null;
  const PONTY_RETRY_MS = 1000;
  const PONTY_SWEEP_MS = 180000;
  // Single vault-exit point — matches live Cue banker's plaza doorway. Was
  // hand-copied as a bare literal in 3 places (retreatPlaza / leaveBankToPlaza
  // / gear-pull delivery step); one constant + leaveBankToPlaza() now owns it.
  const PLAZA = { map: "main", x: 40, y: -20 };
  const STALL_CLEARANCE = 32;
  const STALL_SPOT_STEP = 40;
  const STALL_SPOT_RADIUS = 4;
  /** Once-only gear:upgrade_skip logs per name@level (burn-in 60s spam). */
  const upgradeSkipLogAt = {};
  let bankHintPrimed = false;
  const metrics = { t0: 0, gold0: 0, emitCount: 0 };
  let stallBagDigest = null;
  let stallBagStableAt = api._now();
  let lastXynNoSpaceAt = null;
  let lastNeedSpaceAt = null;
  let lastCombineNoSpaceAt = null;
  const COMBINE_NO_SPACE_BACKOFF_MS = 15000;
  const stallSlotBlockedUntil = {};
  const STALL_SLOT_RESYNC_MS = 180000;

  function logUpgradeSkip(name, level, chance) {
    // Once per name@level forever — 60s re-logs still flooded burn-in while stall locked park.
    const key = name + "@" + (level || 0);
    if (upgradeSkipLogAt[key] != null) return;
    upgradeSkipLogAt[key] = api._now ? api._now() : Date.now();
    api.game_log("gear:upgrade_skip chance=" + Number(chance).toFixed(2));
  }

  /** Live AL nulls character.bank off the bank map; keep _bank snapshot for idle planning. */
  function snapBank() {
    if (!api.character.bank) return;
    try {
      api.character._bank = JSON.parse(JSON.stringify(api.character.bank));
    } catch (e) {
      api.character._bank = api.character.bank;
    }
  }

  function bankFreeSlots() {
    const bank = api.character.bank || api.character._bank;
    if (!bank) return null;
    let free = 0;
    for (const p of Object.keys(bank)) {
      if (p === "gold" || !Array.isArray(bank[p])) continue;
      for (const it of bank[p]) if (!it) free++;
    }
    return free;
  }

  function capacityConstrained() {
    const bankFree = bankFreeSlots();
    return (
      (api.character.esize || 0) < ECON_BAG_RESERVE ||
      (bankFree != null && bankFree < ECON_BANK_RESERVE)
    );
  }

  async function primeBankHint(force) {
    if (api.character._bank || api.character.bank) {
      bankHintPrimed = true;
      return true;
    }
    if (bankHintPrimed) return false;
    // Never walk bank / closeStand just to hint — that tears down a bag-only stall.
    // A saturated persisted stand is the exception: without a vault snapshot,
    // higher-value bank stock can never replace its weakest listings.
    if (api.character.stand && !force) return false;
    api.game_log("bank:prime");
    if (!(await ensureAtBank())) {
      api.game_log("bank:prime_fail");
      // Do not set bankHintPrimed — retry next idle tick (path/mount can be transient).
      return false;
    }
    snapBank();
    await leaveBankToPlaza();
    bankHintPrimed = true;
    api.game_log(
      "bank:prime_ok packs=" +
        (api.character._bank
          ? Object.keys(api.character._bank).filter((k) => k !== "gold").length
          : 0)
    );
    return !!api.character._bank;
  }

  function emitMetrics() {
    const now = api._now ? api._now() : Date.now();
    if (!metrics.t0) {
      metrics.t0 = now;
      metrics.gold0 = api.character.gold || 0;
      return;
    }
    const due = Math.floor((now - metrics.t0) / 60000);
    if (due <= metrics.emitCount) return;
    metrics.emitCount = due;
    const mins = Math.max(1 / 60, (now - metrics.t0) / 60000);
    const gpm = ((api.character.gold || 0) - metrics.gold0) / mins;
    api.game_log("metrics kpm=0 gpm=" + Math.round(gpm));
  }

  function enqueue(job) {
    if (hunterPreparing && !job.hunter) return false;
    const queueLimit = job.hunter ? Math.max(8, HUNTER_PLAN.length) : 8;
    if (store.q.length >= queueLimit) {
      api.game_log("dlv:queue_full");
      return false;
    }
    if (store.q.some((j) => j.id === job.id)) return true;
    job.t0 = api._now ? api._now() : Date.now();
    if (job.locAt == null && job.map != null && job.x != null && job.y != null) {
      job.locAt = job.t0;
    }
    store.q.push(job);
    saveQ(store);
    return true;
  }

  function hunterUpgradeStopped(it) {
    const stopped = store.hunterUpgradeStop || {};
    return it && stopped[it.name] === (it.level || 0);
  }

  function hunterUpgradeAdItems(who) {
    const ad = gearAds[who];
    if (!gearAdFresh(ad, api._now())) return [];
    const targets = new Set(Object.values(GEAR_TARGETS[who] || {}));
    const out = [];
    for (const it of ad.bag || []) {
      if (
        it &&
        targets.has(it.name) &&
        isHunterUpgrade(it) &&
        !it.l &&
        !hunterUpgradeStopped(it)
      ) {
        out.push({ name: it.name, level: it.level || 0 });
      }
    }
    for (const slot of Object.keys(ad.slots || {})) {
      const it = ad.slots[slot];
      if (
        it &&
        targets.has(it.name) &&
        isHunterUpgrade(it) &&
        !it.l &&
        !hunterUpgradeStopped(it)
      ) {
        out.push({ name: it.name, level: it.level || 0 });
      }
    }
    return out;
  }

  function enqueueHunterUpgradePickup() {
    const now = api._now();
    for (const who of FIGHTERS) {
      const items = hunterUpgradeAdItems(who);
      if (!items.length) continue;
      const ad = gearAds[who];
      const id = "pickup_hunter_" + who + "_" + (ad.revision || 0);
      if (
        (store.active && store.active.id === id) ||
        store.q.some((job) => job.id === id)
      ) {
        continue;
      }
      if (
        enqueue({
          id,
          kind: "hunter_upgrade",
          who,
          items: [],
          hunterItems: items,
          pickupCount: items.length,
          farm: null,
          map: PICKUP_MEET.map,
          x: PICKUP_MEET.x,
          y: PICKUP_MEET.y,
          serverRegion: ad.server_region || api.parent.server_region,
          serverIdentifier: ad.server_identifier || api.parent.server_identifier,
          locAt: now,
        })
      ) {
        api.game_log("hunter:upgrade_pickup " + who + " n=" + items.length);
      }
      return true;
    }
    return false;
  }

  function enqueueProgressionUpgradePickup() {
    const now = api._now();
    for (const who of FIGHTERS) {
      const items = progressionAdItems(who);
      if (!items.length) continue;
      const ad = gearAds[who];
      const id = "pickup_progress_" + who + "_" + (ad.revision || 0);
      if (
        (store.active && store.active.id === id) ||
        store.q.some((job) => job.id === id)
      ) {
        continue;
      }
      if (
        enqueue({
          id,
          kind: "progression_upgrade",
          who,
          items: [],
          upgradeItems: items,
          pickupCount: items.length,
          farm: null,
          map: PICKUP_MEET.map,
          x: PICKUP_MEET.x,
          y: PICKUP_MEET.y,
          serverRegion: ad.server_region || api.parent.server_region,
          serverIdentifier: ad.server_identifier || api.parent.server_identifier,
          locAt: now,
        })
      ) {
        api.game_log("gear:progress_pickup " + who + " n=" + items.length);
      }
      return true;
    }
    return false;
  }

  function enqueueSaturationPickup() {
    const now = api._now ? api._now() : Date.now();
    for (const who of FIGHTERS) {
      const ad = gearAds[who];
      if (!ad || (ad.esize || 0) > 0 || now - (ad._t || 0) > GEAR_AD_MS * 2) continue;
      const groups = {};
      for (const it of ad.bag || []) {
        if (!it || COMBINE_PRIORITY.indexOf(it.name) < 0) continue;
        const key = it.name + "@" + (it.level || 0);
        groups[key] = (groups[key] || 0) + 1;
      }
      if (!Object.keys(groups).some((key) => groups[key] > 3)) continue;
      const id = "pickup_" + who + "_" + (ad.revision || 0);
      if (
        (store.active && store.active.id === id) ||
        store.q.some((job) => job.id === id)
      )
        continue;
      const potTotals = { hpot1: 0, mpot1: 0 };
      for (const it of ad.bag || []) {
        if (it && potTotals[it.name] != null) potTotals[it.name] += it.q == null ? 1 : it.q;
      }
      const items = Object.keys(potTotals)
        .filter((name) => potTotals[name] < POTION_TARGET)
        .map((name) => ({ name, q: POTION_TARGET - potTotals[name] }));
      if (
        enqueue({
          id,
          kind: items.length ? "dlv_pots" : "dlv_gear",
          who,
          items,
          farm: null,
          map: PICKUP_MEET.map,
          x: PICKUP_MEET.x,
          y: PICKUP_MEET.y,
          serverRegion: ad.server_region || api.parent.server_region,
          serverIdentifier: ad.server_identifier || api.parent.server_identifier,
          locAt: now,
        })
      ) {
        api.game_log("dlv:pickup " + who);
      }
      return;
    }
  }

  function closeStandIfOpen() {
    // api.close_stand() already falls back to parent.close_merchant internally
    // (both live al_api.js and sim character.js define it unconditionally).
    if (api.character.stand && typeof api.close_stand === "function") api.close_stand();
  }

  /**
   * Shared NPC travel: primary smart_move destination, then a coordinate fallback
   * (Mainframe `{to:"x"}` NPC lookups occasionally miss; explicit coords always land).
   * Closes the stand first — trade slots must be vacated before walking off.
   * Optional failTag logs+returns false on failure; otherwise callers check the result.
   */
  async function goNpc(primary, fallback, failTag) {
    closeStandIfOpen();
    let r = await api.smart_move(primary);
    if (r && r.failed && fallback) r = await api.smart_move(fallback);
    const ok = !(r && r.failed);
    if (!ok && failTag) api.game_log(failTag);
    return ok;
  }

  function playerDist(t) {
    if (!t) return 1e9;
    if (api.parent && typeof api.parent.distance === "function") {
      return api.parent.distance(api.character, t);
    }
    return Math.hypot(
      (api.character.real_x || 0) - (t.real_x != null ? t.real_x : t.x || 0),
      (api.character.real_y || 0) - (t.real_y != null ? t.real_y : t.y || 0)
    );
  }

  async function retreatPlaza() {
    closeStandIfOpen();
    // Live 2026-09-09: after winter_cave dlv, retreatPlaza no-op'd off main → rip:respawn loop.
    // Town out of interiors/farms first, then walk plaza.
    if (api.character.map !== "main" && api.character.map !== "bank") {
      try {
        if (typeof api.use === "function") api.use("town");
      } catch (e) {}
      if (typeof api.sleep === "function") await api.sleep(2200);
      api.game_log("dlv:retreat_town");
    }
    if (api.character.map === "bank" || api.character.map === "main") {
      const r = await api.smart_move(PLAZA);
      if (r && r.failed) api.game_log("dlv:retreat_fail");
      else api.game_log("dlv:retreat");
    }
  }

  /**
   * Field travel: dodge non-pack movers on the route; pack approach stays smart_move
   * (safeMeet geometry). Avoid-fail near pack → retreat; else smart_move fallback.
   */
  async function fieldMove(dest, moveOpts) {
    closeStandIfOpen();
    if (!dest) return { failed: true, reason: "no_dest" };
    if (dest.to && packCenter(dest.to)) return api.smart_move(dest);
    moveOpts = moveOpts || {};
    const farm = moveOpts.farm;
    const mobs = meetTransitBlockers(api, farm);
    // Far hostiles in list-vision must not engage avoid — town corners trap until fail timeout.
    if (!shouldEngageAvoid(api.character, mobs)) {
      return api.smart_move(dest);
    }
    api.game_log(
      "avoid:go " + (dest.map || api.character.map) + " " + Math.round(dest.x) + "," + Math.round(dest.y)
    );
    const r = await merchantAvoidGoTo(api, dest, {
      blockers: () => merchantAvoidListMonsters(api).filter(meetTransitBlockerFilter(api, farm)),
      canMoveTo: (x, y) => api.can_move_to(x, y),
      maxSteps: 100,
      tickMs: 200,
    });
    if (r && r.failed) {
      api.game_log("avoid:fail " + (r.reason || "?"));
      const sx = api.character.real_x != null ? api.character.real_x : api.character.x;
      const sy = api.character.real_y != null ? api.character.real_y : api.character.y;
      const policy = avoidFailPolicy(farm, api.character.map, sx, sy, dest);
      if (policy === "retreat") {
        api.game_log("avoid:near_pack_abort");
        await retreatPlaza();
        return { failed: true, reason: "avoid_near_pack" };
      }
      return api.smart_move(dest);
    }
    if (r && r.dodges) api.game_log("avoid:ok dodges=" + r.dodges);
    return r || { success: true };
  }

  /** Close to SEND_RANGE via meetApproachPoint — never smart_move onto pack center. */
  async function ensureSendRange(who, opts) {
    opts = opts || {};
    const farm = opts.farm;
    const limit = SEND_RANGE || 320;
    closeStandIfOpen();
    for (let attempt = 0; attempt < 3; attempt++) {
      closeStandIfOpen();
      let t = api.get_player(who);
      if (!t) {
        const p = (api.get_party() || {})[who];
        if (p && p.map) {
          const stub = {
            map: p.map,
            real_x: p.real_x != null ? p.real_x : p.x,
            real_y: p.real_y != null ? p.real_y : p.y,
            x: p.real_x != null ? p.real_x : p.x,
            y: p.real_y != null ? p.real_y : p.y,
          };
          const dest = meetApproachPoint(stub, farm, SEND_RANGE);
          const r0 = await fieldMove(dest, { farm });
          if (r0 && r0.failed) {
            api.game_log("dlv:approach_fail");
            return null;
          }
          t = api.get_player(who);
        }
      }
      if (!t) {
        api.game_log("dlv:no_vision");
        return null;
      }
      const d = playerDist(t);
      if (d <= limit) return t;
      const dest = meetApproachPoint(t, farm, SEND_RANGE);
      api.game_log("dlv:approach dist=" + Math.floor(d) + " -> " + dest.x + "," + dest.y);
      const r = await fieldMove(dest, { farm });
      if (r && r.failed) {
        api.game_log("dlv:approach_fail");
        return null;
      }
    }
    const t = api.get_player(who);
    if (t && playerDist(t) <= limit) return t;
    api.game_log("dlv:far");
    return null;
  }

  async function hearCm(m) {
    const d = m.message;
    if (!d || typeof d !== "object") return;
    const sender = cmSender(m);
    if (!isFighterName(sender)) return;
    if (d.gear_ad && d.name) {
      if (d.name !== sender) return;
      const prev = gearAds[d.name];
      if (
        d.revision != null &&
        prev &&
        prev.revision != null &&
        Number(d.revision) < Number(prev.revision)
      )
        return;
      d._t = api._now ? api._now() : Date.now();
      d._seq = ++gearAdSeq;
      gearAds[d.name] = d;
      return;
    }
    if (d.gear_got) {
      if (
        d.ok &&
        store.progressionWinners &&
        store.progressionWinners[d.name] === (d.level || 0)
      ) {
        delete store.progressionWinners[d.name];
        saveQ(store);
      }
      api.game_log("gear_got from=" + sender + " ok=" + (d.ok ? 1 : 0));
      return;
    }
    if (d.dlv_loot_done) {
      api.game_log("dlv:loot_done n=" + (d.n || 0));
      return;
    }
    if (d.job === "cancel_all") {
      if (d.who && d.who !== sender) return;
      const matches = (job) => (d.id ? job.id === d.id : job.who === d.who);
      store.q = store.q.filter((job) => !matches(job));
      if (store.active && matches(store.active)) store.active = null;
      saveQ(store);
      api.game_log("dlv:cancel");
      return;
    }
    if (d.job === "dlv_pots" || d.job === "dlv_gear") {
      if (d.who !== sender) return;
      const farm = meetFarmAt(d.farm, d.map, d.x, d.y);
      if (farm && d.farm && farm !== d.farm) {
        api.game_log("dlv:retarget " + d.farm + "->" + farm);
      }
      const ok = enqueue({
        id: d.id,
        kind: d.job,
        who: d.who,
        items: d.items,
        farm,
        map: d.map,
        x: d.x,
        y: d.y,
        serverRegion: d.serverRegion || api.parent.server_region,
        serverIdentifier: d.serverIdentifier || api.parent.server_identifier,
        locAt: api._now ? api._now() : Date.now(),
        gear: d.gear,
      });
      await api.send_cm(d.who, { dlv_ack: 1, id: d.id, ok: ok ? 1 : 0, reason: ok ? null : "queue" });
      return;
    }
    if (d.dlv_loc && d.id) {
      const jobs = (store.active ? [store.active] : []).concat(store.q);
      const job = jobs.find((j) => j.id === d.id);
      if (!job || sender !== job.who) return;
      const oldFarm = job.farm;
      const oldMap = job.map;
      const oldX = job.x;
      const oldY = job.y;
      job.map = d.map;
      job.x = d.x;
      job.y = d.y;
      job.serverRegion = d.serverRegion || job.serverRegion;
      job.serverIdentifier = d.serverIdentifier || job.serverIdentifier;
      job.locAt = api._now ? api._now() : Date.now();
      job.locSeq = (job.locSeq || 0) + 1;
      const reportedFarm = d.farm && packCenter(d.farm) ? d.farm : null;
      job.farm = reportedFarm || meetFarmAt(oldFarm, d.map, d.x, d.y);
      job.farmConfirmed = !!reportedFarm;
      const changedFarm = job.farm && oldFarm && job.farm !== oldFarm;
      if (changedFarm) {
        api.game_log("dlv:retarget " + oldFarm + "->" + job.farm);
      }
      const moved =
        oldMap !== d.map ||
        oldX == null ||
        oldY == null ||
        Math.hypot(oldX - d.x, oldY - d.y) > SEND_RANGE;
      if (store.active === job && (changedFarm || moved)) {
        if (typeof api.stop === "function") api.stop("smart");
        job.reroutePending = 1;
        api.game_log("dlv:reroute");
      }
      saveQ(store);
      return;
    }
    // Location beacons update the job above, but meetResolveDelivery always
    // converts pack coordinates to a safe staging point.
    if (d.job === "meet_home") {
      enqueue({ id: "hold_" + (api._now ? api._now() : Date.now()), kind: "meet_home", who: "party" });
    }
  }

  async function ensureDeliveryWorld(job) {
    const reg = api.parent.server_region;
    const id = api.parent.server_identifier;
    if (!reg || !id) return false;
    const targetRegion = (job && job.serverRegion) || reg;
    const targetIdentifier = (job && job.serverIdentifier) || id;
    if (reg === targetRegion && id === targetIdentifier) return true;
    api.change_server(targetRegion, targetIdentifier);
    return false;
  }

  function bagQty(name) {
    let n = 0;
    for (const it of api.character.items || []) {
      if (it && it.name === name) n += it.q == null ? 1 : it.q;
    }
    return n;
  }

  async function buyPots(items, reserve, tag) {
    reserve = reserve || 0;
    tag = tag || "dlv";
    closeStandIfOpen();
    const dest = { map: "main", x: 56, y: -122 };
    const nearVendor = () =>
      api.character.map === dest.map &&
      Math.hypot(api.character.real_x - dest.x, api.character.real_y - dest.y) < 40;

    if (!nearVendor()) {
      const r = await api.smart_move(dest);
      if (r && r.failed) {
        api.game_log(tag + ":vendor_path_fail");
        return false;
      }
    }
    if (!nearVendor() && Math.hypot(api.character.real_x - dest.x, api.character.real_y - dest.y) > 60) {
      api.game_log(tag + ":vendor_far");
      return false;
    }
    for (const it of items || []) {
      const need = (it.q || POTION_TARGET) + reserve;
      const have = bagQty(it.name);
      const buyQ = need - have;
      if (buyQ <= 0) {
        api.game_log(tag + ":have " + it.name + " " + have);
        continue;
      }
      // Existing potion stacks can absorb a refill even when the bag is full.
      if (have <= 0 && (api.character.esize || 0) < 1) {
        api.game_log(tag + ":no_space");
        return false;
      }
      const price = (api.G.items[it.name] && api.G.items[it.name].g) || 20;
      if ((api.character.gold || 0) - price * buyQ < GOLD_FLOAT_MERCHANT) {
        api.game_log(tag + ":buy_float");
        return "float";
      }
      await api.buy(it.name, buyQ);
      const after = bagQty(it.name);
      if (after <= have) {
        api.game_log(tag + ":buy_fail " + it.name);
        return false;
      }
      api.game_log(tag + ":buy " + it.name + " " + buyQ);
    }
    return true;
  }

  /** Gold required to buy remaining pots while keeping GOLD_FLOAT_MERCHANT. */
  function potBuyNeedGold(items, reserve) {
    reserve = reserve || 0;
    let cost = 0;
    for (const it of items || []) {
      const need = (it.q || POTION_TARGET) + reserve;
      const have = bagQty(it.name);
      const buyQ = need - have;
      if (buyQ <= 0) continue;
      const price = (api.G.items[it.name] && api.G.items[it.name].g) || 20;
      cost += price * buyQ;
    }
    return GOLD_FLOAT_MERCHANT + cost;
  }

  /** Keep Puppygirl's own emergency potion stacks at the party target. */
  async function restockSelfPots() {
    const wants = [
      { name: "hpot1", q: POTION_TARGET },
      { name: "mpot1", q: POTION_TARGET },
    ];
    if (wants.every((it) => bagQty(it.name) >= it.q)) return false;
    // Do not leave a nearby fighter (or spam buy_float) when the merchant
    // cannot yet afford the refill while preserving her gold float.
    if ((api.character.gold || 0) < potBuyNeedGold(wants, 0)) return false;
    return (await buyPots(wants, 0, "selfpot")) === true;
  }

  /**
   * Approach fighter so they can gold_offload, wait for enough gold, return to vendor.
   * Resolves broke-merchant + rich-fighter deadlock (buy_float before meet).
   */
  async function scoopGoldForBuy(job, needGold) {
    api.game_log("dlv:scoop_gold need=" + needGold);
    // Merchant is not in the combat party — get_party() has no fighter xy.
    // Walk to the delivery meet (job beacon / pack-safe) before ensureSendRange.
    const meet = meetResolveDelivery(api, job, SEND_RANGE);
    if (meet) {
      api.game_log(
        "dlv:scoop_meet " + meet.map + " " + Math.round(meet.x) + "," + Math.round(meet.y)
      );
      const r = await fieldMove(meet, { farm: job.farm });
      if (r && r.failed) {
        api.game_log("dlv:scoop_fail");
        return false;
      }
    }
    const t = await ensureSendRange(job.who, { farm: job.farm });
    if (!t) {
      api.game_log("dlv:scoop_fail");
      return false;
    }
    const t0 = api._now ? api._now() : Date.now();
    while ((api.character.gold || 0) < needGold && (api._now ? api._now() : Date.now()) - t0 < 25000) {
      // Ask fighter to offload now (live: their next tick; sim: peerTick runs them).
      try {
        await api.send_cm(job.who, { dlv_loot_q: 1, id: job.id || null });
      } catch (e) {}
      if (typeof opts.peerTick === "function") await opts.peerTick();
      else await api.sleep(500);
    }
    api.game_log("dlv:scoop_got gold=" + (api.character.gold || 0));
    const vendor = { map: "main", x: 56, y: -122 };
    await api.smart_move(vendor);
    return (api.character.gold || 0) >= needGold;
  }

  /** §5D: leave town with ≥3 free slots for fighter take-backs. */
  async function ensureTakeBackSlots(need, keep) {
    need = need == null ? 3 : need;
    while ((api.character.esize || 0) < need && bagParkables(keep, { skipUpgrades: false }).length) {
      const before = bagParkables(keep, { skipUpgrades: false }).length;
      await parkToBank(keep, { skipUpgrades: false });
      if (bagParkables(keep, { skipUpgrades: false }).length >= before) break;
    }
    if ((api.character.esize || 0) < need) {
      try {
        await tryCombineOne();
        await tryVendorNpc();
        if ((api.character.esize || 0) < need) await tryStallOne();
      } catch (e) {
        api.game_log("dlv:space_err " + ((e && e.message) || e));
      }
    }
    if ((api.character.esize || 0) < need) {
      const now = api._now();
      if (lastNeedSpaceAt == null || now - lastNeedSpaceAt >= 5000) {
        lastNeedSpaceAt = now;
        api.game_log("dlv:need_space esize=" + (api.character.esize || 0));
      }
      return false;
    }
    return true;
  }

  function bagParkables(keep, opts) {
    opts = opts || {};
    const out = [];
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (!it) continue;
      if (/^hpot|^mpot/.test(it.name)) continue;
      if (it.name === "stand0") continue;
      if (KEEP_ALWAYS.indexOf(it.name) >= 0) continue;
      if (/^(?:c?scroll[0-2]|offering(?:p|x)?)$/.test(it.name)) continue;
      if (EXCHANGE_ITEMS.indexOf(it.name) >= 0) continue;
      if (isVendorNpcItem(it)) continue;
      if (isGearTargetName(it.name)) continue;
      // Listed / reserved for merchant stand — never park.
      if (it.price != null) continue;
      // NPC-vendor junk in idle; do not park VENDOR_NPC names here (re-bank linger).
      if (isSellJunk(it, api.G)) continue;
      if (
        keep &&
        it.name === keep.name &&
        (it.level || 0) === (keep.level || 0)
      ) {
        continue;
      }
      if (progressionItemEligible(it) || progressionWinner(it)) continue;
      if (opts.onlyBelowGate) {
        if (
          !(
            eligibleUpgrade(it, api.G) &&
            !isRiskUpgrade(it) &&
            upgradeChance(it) < MIN_UPGRADE_CHANCE
          )
        ) {
          continue;
        }
        out.push(i);
        continue;
      }
      // Idle / pre-dequeue park skips all scroll0-upgrade candidates so tryUpgradeOne
      // can log skip or upgrade. After that, idleEcon force-parks below-gate pieces.
      if (opts.skipUpgrades !== false && eligibleUpgrade(it, api.G)) continue;
      // Everything not needed for immediate merchant work belongs in the vault.
      out.push(i);
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
        out.push({ name: it.name, level: it.level || 0, pack, i, q: it.q, l: it.l, p: it.p });
      }
    }
    return out;
  }

  /** Bag + bank rows for gift planning (reclaimed trade gear sits in bag). */
  function listGiftables() {
    const out = [];
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (!it) continue;
      out.push({ name: it.name, level: it.level || 0, pack: "bag", i, q: it.q });
    }
    return out.concat(listBankItems());
  }

  function bagQuantity(itemName) {
    let n = 0;
    for (const it of api.character.items || []) {
      if (it && it.name === itemName) n += it.q == null ? 1 : it.q;
    }
    return n;
  }

  function bankQuantity(itemName) {
    return listBankItems()
      .filter((x) => x.name === itemName)
      .reduce((n, x) => n + (x.q == null ? 1 : x.q), 0);
  }

  function adHasItem(ad, itemName) {
    if (!ad) return false;
    for (const slot of Object.keys(ad.slots || {})) {
      if (ad.slots[slot] && ad.slots[slot].name === itemName) return true;
    }
    return (ad.bag || []).some((x) => x && x.name === itemName);
  }

  function merchantOwned(itemName) {
    const bag = (api.character.items || []).find((x) => x && x.name === itemName);
    if (bag) return { name: itemName, level: bag.level || 0 };
    const bank = listBankItems().find((x) => x.name === itemName);
    return bank ? { name: itemName, level: bank.level || 0 } : null;
  }

  function validateHunterPlan() {
    const tokens = api.G && api.G.tokens && api.G.tokens.monstertoken;
    for (const step of HUNTER_PLAN || []) {
      const def = api.G && api.G.items && api.G.items[step.name];
      const ctype = gearAds[step.who] && gearAds[step.who].ctype;
      if (
        !def ||
        !tokens ||
        Number(tokens[step.name]) !== step.cost ||
        !Array.isArray(def.class) ||
        def.class.indexOf(ctype) < 0 ||
        candidateSlots({ name: step.name }, api.G).indexOf(step.slot) < 0
      ) {
        return { failed: true, reason: "catalog", item: step.name };
      }
    }
    return { success: true };
  }

  async function prepareTokenStack(need) {
    let bankTokens = listBankItems().filter((x) => x.name === "monstertoken");
    let anchor = bankTokens.sort((a, b) => (b.q || 1) - (a.q || 1))[0];
    if (!anchor) {
      const first = (api.character.items || []).findIndex(
        (x) => x && x.name === "monstertoken"
      );
      if (first < 0) return false;
      const r = await storeBagItemToBank(first);
      if (r && r.failed) return false;
      snapBank();
      bankTokens = listBankItems().filter((x) => x.name === "monstertoken");
      anchor = bankTokens[0];
    }
    for (let i = 0; i < (api.character.items || []).length; i++) {
      const it = api.character.items[i];
      if (!it || it.name !== "monstertoken") continue;
      const r = await api.bank_store(i, anchor.pack);
      if (r && r.failed) return false;
      snapBank();
    }
    bankTokens = listBankItems()
      .filter((x) => x.name === "monstertoken")
      .sort((a, b) => (b.q || 1) - (a.q || 1));
    const stack = bankTokens.find((x) => (x.q == null ? 1 : x.q) >= need);
    if (!stack || (api.character.esize || 0) < 1) return false;
    const r = await api.bank_retrieve(stack.pack, stack.i);
    if (r && r.failed) return false;
    return (api.character.items || []).some(
      (x) => x && x.name === "monstertoken" && (x.q == null ? 1 : x.q) >= need
    );
  }

  /**
   * Explicit operator action for the approved Hunter manifest. It is
   * all-or-nothing before the first exchange, then restart-safe by ownership:
   * already-owned target pieces are never purchased again.
   */
  async function startHunterPlan(fromTick) {
    if (!fromTick && (busy || store.active || store.q.length)) {
      if (!store.hunterRequested) api.game_log("hunter:requested");
      store.hunterRequested = 1;
      saveQ(store);
      return { success: true, requested: true };
    }
    if (!fromTick) busy = true;
    hunterPreparing = true;
    try {
      const now = api._now ? api._now() : Date.now();
      for (const who of FIGHTERS) {
        if (!gearAdFresh(gearAds[who], now)) {
          api.game_log("hunter:blocked stale_ad " + who);
          return { failed: true, reason: "stale_ad", who };
        }
      }
      const valid = validateHunterPlan();
      if (valid.failed) {
        api.game_log("hunter:blocked catalog " + valid.item);
        return valid;
      }
      for (const step of HUNTER_PLAN) {
        for (const who of FIGHTERS) {
          if (who !== step.who && adHasItem(gearAds[who], step.name)) {
            api.game_log("hunter:blocked wrong_owner " + step.name + " " + who);
            return { failed: true, reason: "wrong_owner", item: step.name, who };
          }
        }
      }

      closeStandIfOpen();
      if (!(await ensureAtBank())) return { failed: true, reason: "bank" };
      snapBank();
      const missing = HUNTER_PLAN.filter(
        (step) => !adHasItem(gearAds[step.who], step.name) && !merchantOwned(step.name)
      );
      const cost = missing.reduce((n, step) => n + step.cost, 0);
      const tokens = bagQuantity("monstertoken") + bankQuantity("monstertoken");
      api.game_log("hunter:verify tokens=" + tokens + " cost=" + cost + " missing=" + missing.length);
      if (tokens < cost) {
        await leaveBankToPlaza();
        return { failed: true, reason: "tokens", have: tokens, need: cost };
      }
      if (cost > 0 && !(await prepareTokenStack(cost))) {
        await leaveBankToPlaza();
        return { failed: true, reason: "token_pull" };
      }
      if ((api.character.esize || 0) < missing.length) {
        api.game_log("hunter:blocked no_space need=" + missing.length);
        await leaveBankToPlaza();
        return { failed: true, reason: "no_space", need: missing.length };
      }
      await leaveBankToPlaza();
      if (missing.length) {
        if (!(await goNpc({ to: "monsterhunter" }, { map: "main", x: 126, y: -413 }, "hunter:path_fail"))) {
          return { failed: true, reason: "path" };
        }
      }
      for (const step of missing) {
        const beforeItem = bagQuantity(step.name);
        const beforeTokens = bagQuantity("monstertoken");
        let r = await api.exchange_buy("monstertoken", step.name);
        const waitUntil = (api._now ? api._now() : Date.now()) + 5000;
        while (
          (bagQuantity(step.name) <= beforeItem ||
            bagQuantity("monstertoken") !== beforeTokens - step.cost) &&
          (api._now ? api._now() : Date.now()) < waitUntil
        ) {
          if (typeof api.sleep !== "function") break;
          await api.sleep(250);
        }
        if (r && r.failed && bagQuantity(step.name) <= beforeItem) {
          api.game_log("hunter:buy_fail " + step.name + " " + (r.reason || ""));
          return { failed: true, reason: "buy", item: step.name };
        }
        if (
          bagQuantity(step.name) <= beforeItem ||
          bagQuantity("monstertoken") !== beforeTokens - step.cost
        ) {
          api.game_log("hunter:buy_unverified " + step.name);
          return { failed: true, reason: "buy_unverified", item: step.name };
        }
        api.game_log("hunter:buy " + step.name + " cost=" + step.cost);
      }

      let queued = 0;
      for (const step of HUNTER_PLAN) {
        if (adHasItem(gearAds[step.who], step.name)) continue;
        const owned = merchantOwned(step.name);
        if (!owned) {
          api.game_log("hunter:blocked missing " + step.name);
          return { failed: true, reason: "missing", item: step.name };
        }
        const ad = gearAds[step.who];
        const ok = enqueue({
          id: "hunter_" + step.name,
          kind: "dlv_gear",
          who: step.who,
          gear: { name: step.name, level: owned.level, slot: step.slot },
          farm: meetFarmAt(ad.farm, ad.map, ad.x, ad.y) || "bat",
          map: ad.map,
          x: ad.x,
          y: ad.y,
          serverRegion: ad.server_region,
          serverIdentifier: ad.server_identifier,
          items: [],
          hunter: 1,
        });
        if (ok) queued++;
        else api.game_log("hunter:queue_fail " + step.name);
      }
      saveQ(store);
      api.set_message("Hunter queued");
      api.game_log("hunter:queued n=" + queued + " spent=" + cost);
      return { success: true, queued, spent: cost, tokens: bagQuantity("monstertoken") };
    } finally {
      hunterPreparing = false;
      if (!fromTick) busy = false;
    }
  }

  async function ensureAtBank() {
    closeStandIfOpen();
    if (api.character.map === "bank" && api.character.bank) {
      snapBank();
      return true;
    }
    // Vault coords (not {to:"bank"}) — matches live Cue banker; single attempt so
    // path_fail inject tests stay one-shot.
    const r = await api.smart_move({ map: "bank", x: 0, y: -37 });
    if (r && r.failed) {
      api.game_log("bank:path_fail");
      return false;
    }
    // Live mount only — never treat _bank snapshot as mounted (blocks wait after prime).
    const t0 = api._now ? api._now() : Date.now();
    while (!api.character.bank && (api._now ? api._now() : Date.now()) - t0 < 4000) {
      await api.sleep(200);
    }
    if (!api.character.bank) {
      api.game_log("bank:not_mounted");
      return false;
    }
    snapBank();
    return true;
  }

  async function storeBagItemToBank(i) {
    // Mainframe: bare bank_store(i) often rejects "invalid"; explicit pack works.
    const bank = api.character.bank || api.character._bank;
    if (bank) {
      const packs = Object.keys(bank).filter((p) => p !== "gold" && Array.isArray(bank[p]));
      for (const p of packs) {
        if (!bank[p].some((x) => !x)) continue;
        const r = await api.bank_store(i, p, -1);
        if (!api.character.items[i]) return r && !r.failed ? r : { success: true, pack: p };
        if (r && r.failed && r.reason === "bank_full") continue;
        if (r && !r.failed) return r;
      }
    }
    return api.bank_store(i);
  }

  async function parkToBank(keep, opts) {
    opts = opts || {};
    // Never tear down an open stall to park — that re-banks listed sell junk (live 2026-09-09).
    if (api.character.stand) return true;
    const idxs = bagParkables(keep, opts);
    if (!idxs.length) return true;
    const now = api._now ? api._now() : Date.now();
    if (lastParkFailAt != null && now - lastParkFailAt < PARK_FAIL_BACKOFF_MS) return false;
    if (!(await ensureAtBank())) {
      lastParkFailAt = now;
      return false;
    }
    let stored = 0;
    let lastReason = null;
    for (const i of idxs) {
      const it = api.character.items[i];
      if (!it) continue;
      const nm = it.name;
      const lv = it.level || 0;
      const r = await storeBagItemToBank(i);
      if (!api.character.items[i]) {
        stored++;
        api.game_log("bank:store " + nm + "@" + lv);
      } else {
        lastReason = (r && r.reason) || "store_fail";
      }
    }
    let ok = bagParkables(keep, opts).length === 0;
    if (bagParkables(keep, opts).length && stored === 0) {
      api.game_log("bank:store_fail " + (lastReason || "unknown"));
      const bank = api.character.bank || api.character._bank;
      let free = 0;
      if (bank) {
        for (const p of Object.keys(bank)) {
          if (p === "gold" || !Array.isArray(bank[p])) continue;
          for (const x of bank[p]) if (!x) free++;
        }
      }
      if (free <= 0) api.game_log("bank:full");
      lastParkFailAt = api._now ? api._now() : Date.now();
      ok = false;
    }
    // Always leave vault after a park attempt — silent bank linger otherwise.
    await leaveBankToPlaza();
    return ok;
  }

  async function ensureGearInBag(gear) {
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (it && it.name === gear.name && (it.level || 0) === (gear.level || 0)) return i;
    }
    if (!(await ensureAtBank())) return -1;
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
    const gifts = planGifts(listGiftables(), ads, api.G);
    if (!gifts.length) return false;
    const g = gifts[0];
    const worn = gearAds[g.who] && gearAds[g.who].slots && gearAds[g.who].slots[g.slot];
    const progression = !!(
      worn &&
      worn.name === g.it.name &&
      (g.it.level || 0) > (worn.level || 0)
    );

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
        gear: {
          name: g.it.name,
          level: g.it.level || 0,
          slot: g.slot,
          progression,
        },
        farm: "bat",
        items: [],
      });
      return true;
    } finally {
      giftBusy = false;
    }
  }

  function gearAdFresh(ad, now) {
    return (
      ad &&
      ad.inventory_ad === 1 &&
      ad.v === 2 &&
      ad.revision != null &&
      ad._t != null &&
      now - ad._t <= Math.max(GEAR_AD_MS * 3, 60000)
    );
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
    const gifts = planGifts(listGiftables(), { [job.who]: ad }, api.G).filter((g) => g.who === job.who);
    if (!gifts.length) return false;
    const g = gifts[0];
    api.game_log("gear:plan " + g.it.name + "@" + (g.it.level || 0) + "->" + g.who);
    const bagI = await ensureGearInBag(g.it);
    if (bagI < 0) {
      api.game_log("gear:pull_fail " + g.it.name);
      return false;
    }
    const worn = ad.slots[g.slot];
    job.gear = {
      name: g.it.name,
      level: g.it.level || 0,
      slot: g.slot,
      progression: !!(
        worn &&
        worn.name === g.it.name &&
        (g.it.level || 0) > (worn.level || 0)
      ),
    };
    job.pulled = 1;
    api.game_log(
      "gear:batch id=" + job.id + " " + job.gear.name + "@" + (job.gear.level || 0) + "->" + job.who
    );
    return true;
  }

  function countSellJunk(items) {
    let n = 0;
    for (const it of items || []) {
      if (isVendorNpcItem(it)) n++;
    }
    return n;
  }

  function countSellJunkBank(bank) {
    let n = 0;
    if (!bank) return 0;
    for (const pack of Object.keys(bank)) {
      if (pack === "gold") continue;
      const bag = bank[pack];
      if (!Array.isArray(bag)) continue;
      n += countSellJunk(bag);
    }
    return n;
  }

  async function leaveBankToPlaza() {
    if (api.character.map !== "bank") return true;
    snapBank();
    const r = await api.smart_move(PLAZA);
    if (r && r.failed) {
      api.game_log("bank:exit_fail");
      return false;
    }
    return true;
  }

  function isVendorNpcItem(it) {
    return (
      !!it &&
      (OBSOLETE_POTIONS.indexOf(it.name) >= 0 ||
        EMERGENCY_VENDOR_NPC.indexOf(it.name) >= 0 ||
        VENDOR_NPC.indexOf(it.name) >= 0 ||
        (VENDOR_NPC_LOW_LEVEL.indexOf(it.name) >= 0 &&
          (it.level || 0) <= VENDOR_NPC_MAX_LEVEL))
    );
  }

  async function freeEmergencySlot() {
    const i = api.character.items.findIndex(
      (it) => it && EMERGENCY_SLOT_ITEMS.indexOf(it.name) >= 0
    );
    if (i < 0 || !(await goNpc({ map: "main", x: 56, y: -122 }, null))) return false;
    const it = api.character.items[i];
    const sold = await api.sell(i, it.q == null ? 1 : it.q);
    const freed = !(sold && sold.failed) && (api.character.esize || 0) >= 1;
    if (freed) api.game_log("bank:material_sacrifice " + it.name);
    return freed;
  }

  function isTradeReclaimItem(it) {
    if (!it) return false;
    if (progressionItemEligible(it)) return true;
    if (isVendorNpcItem(it)) return true;
    if (isGearTargetName(it.name) && !stallRule(it.name)) return true;
    return false;
  }

  function stallRule(name) {
    return (STALL_SELL || []).find((x) => x.name === name) || null;
  }

  function stallCopies(rule, mode) {
    const copies = [];
    const canUseLevel = (level) =>
      mode === "upgrade"
        ? rule.upgradeTo != null && level < rule.upgradeTo
        : (rule.minLevel == null || level >= rule.minLevel) &&
          (rule.maxLevel == null || level <= rule.maxLevel);
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (it && it.name === rule.name) {
        const level = it.level || 0;
        copies.push({
          rule,
          i,
          level,
          sellable:
            !it.l &&
            !it.p &&
            canUseLevel(level),
        });
      }
    }
    for (const bank of listBankItems()) {
      if (bank.name === rule.name) {
        const level = bank.level || 0;
        copies.push({
          rule,
          bank,
          level,
          sellable:
            !bank.l &&
            !bank.p &&
            canUseLevel(level),
        });
      }
    }
    if (mode !== "upgrade") {
      const slots = api.character.slots || {};
      for (let s = 1; s <= 16; s++) {
        const it = slots["trade" + s];
        if (it && it.name === rule.name) {
          copies.push({ level: it.level || 0, sellable: false });
        }
      }
    }
    const now = api._now();
    for (const who of FIGHTERS) {
      const ad = gearAds[who];
      if (!gearAdFresh(ad, now)) continue;
      for (const it of ad.bag || []) {
        if (it && it.name === rule.name) copies.push({ level: it.level || 0, sellable: false });
      }
      for (const slot of Object.keys(ad.slots || {})) {
        const it = ad.slots[slot];
        if (it && it.name === rule.name) copies.push({ level: it.level || 0, sellable: false });
      }
    }
    copies.sort((a, b) => b.level - a.level || Number(a.sellable) - Number(b.sellable));
    return copies.slice(rule.keep || 0).filter((x) => x.sellable);
  }

  function stallReserveReady(rule) {
    if (!(rule.keep > 0)) return true;
    const owners = [];
    for (const who of FIGHTERS) {
      const targets = GEAR_TARGETS[who] || {};
      if (Object.keys(targets).some((slot) => targets[slot] === rule.name)) owners.push(who);
    }
    const required = owners.length ? owners : FIGHTERS;
    return required.every((who) => gearAdFresh(gearAds[who], api._now()));
  }

  function stallPrice(it, rule) {
    const base = ((api.G.items && api.G.items[it.name]) || {}).g || 100;
    const upgraded = base * 1.2 * Math.pow(2, it.level || 0);
    return Math.max(rule.floor || 0, Math.ceil(upgraded / 100) * 100);
  }

  function stallGiftReserveKeys() {
    const ads = {};
    for (const who of FIGHTERS) {
      const ad = gearAds[who];
      if (ad && ad.slots) ads[who] = Object.assign({}, ad, { esize: Math.max(1, ad.esize || 0) });
    }
    const keys = new Set();
    for (const gift of planGifts(listGiftables(), ads, api.G)) {
      const e = gift.e;
      if (e && e.pack != null && e.i != null) keys.add(e.pack + ":" + e.i);
    }
    return keys;
  }

  function progressionBaselines() {
    const levels = {};
    const now = api._now();
    for (const who of FIGHTERS) {
      const ad = gearAds[who];
      if (!gearAdFresh(ad, now)) continue;
      for (const slot of Object.keys(ad.slots || {})) {
        const it = ad.slots[slot];
        if (!canUpgradeItem(it, api.G)) continue;
        const level = it.level || 0;
        if (levels[it.name] == null || level < levels[it.name]) levels[it.name] = level;
      }
    }
    return levels;
  }

  function progressionStopped(it) {
    const stopped = store.progressionUpgradeStop || {};
    return it && stopped[it.name] === (it.level || 0);
  }

  function progressionWinner(it) {
    const winners = store.progressionWinners || {};
    return it && winners[it.name] === (it.level || 0);
  }

  function progressionItemEligible(it) {
    if (!it) return false;
    const baseline = progressionBaselines()[it.name];
    return (
      baseline != null &&
      (it.level || 0) <= baseline &&
      canUpgradeItem(it, api.G) &&
      !progressionStopped(it)
    );
  }

  function progressionUpgradeRows() {
    const baselines = progressionBaselines();
    const giftReserve = stallGiftReserveKeys();
    const rows = [];
    for (let i = 0; i < (api.character.items || []).length; i++) {
      const it = api.character.items[i];
      if (!it) continue;
      rows.push({ name: it.name, level: it.level || 0, i, l: it.l });
    }
    rows.push(...listBankItems());
    const best = {};
    for (const row of rows) {
      const key = row.i != null && row.pack == null ? "bag:" + row.i : row.pack + ":" + row.i;
      const baseline = baselines[row.name];
      const it = { name: row.name, level: row.level || 0, l: row.l };
      if (
        baseline == null ||
        (row.level || 0) > baseline ||
        !canUpgradeItem(it, api.G) ||
        progressionStopped(it) ||
        giftReserve.has(key)
      ) {
        continue;
      }
      const prior = best[row.name];
      if (
        !prior ||
        (row.level || 0) > prior.level ||
        ((row.level || 0) === prior.level && row.pack == null && prior.pack != null)
      ) {
        best[row.name] = Object.assign({ key, baseline }, row);
      }
    }
    return Object.values(best);
  }

  function progressionUpgradeKeys() {
    return new Set(progressionUpgradeRows().map((row) => row.key));
  }

  function progressionAdItems(who) {
    const ad = gearAds[who];
    if (!gearAdFresh(ad, api._now())) return [];
    const baselines = progressionBaselines();
    return (ad.bag || [])
      .filter((it) => {
        const level = it && (it.level || 0);
        return !!(
          it &&
          baselines[it.name] != null &&
          level <= baselines[it.name] &&
          canUpgradeItem(it, api.G) &&
          !progressionStopped(it)
        );
      })
      .map((it) => ({ name: it.name, level: it.level || 0 }));
  }

  function riskUpgradeKeys() {
    const keys = new Set();
    const now = api._now();
    if (!FIGHTERS.every((who) => gearAdFresh(gearAds[who], now))) return keys;
    const giftReserve = stallGiftReserveKeys();
    for (const rule of STALL_SELL || []) {
      if (!rule.upgradeTo || !stallReserveReady(rule)) continue;
      for (const choice of stallCopies(rule, "upgrade")) {
        const key = choice.i != null ? "bag:" + choice.i : choice.bank.pack + ":" + choice.bank.i;
        if (!giftReserve.has(key)) keys.add(key);
      }
    }
    return keys;
  }

  function stallCandidate(preferBag, reserveStable) {
    const candidates = [];
    const giftReserve = stallGiftReserveKeys();
    const progressReserve = progressionUpgradeKeys();
    for (const rule of STALL_SELL || []) {
      if (rule.keep > 0 && !reserveStable) continue;
      if (!stallReserveReady(rule)) continue;
      let choices = stallCopies(rule);
      if (preferBag) choices = choices.filter((x) => x.i != null);
      choices = choices.filter((x) => {
        const key = x.i != null ? "bag:" + x.i : x.bank && x.bank.pack + ":" + x.bank.i;
        const it = { name: x.rule.name, level: x.level || 0 };
        return !giftReserve.has(key) && !progressReserve.has(key) && !progressionWinner(it);
      });
      candidates.push(...choices);
    }
    candidates.sort((a, b) => {
      const ap = stallPrice({ name: a.rule.name, level: a.level }, a.rule);
      const bp = stallPrice({ name: b.rule.name, level: b.level }, b.rule);
      return bp - ap || b.level - a.level || (a.i == null ? 1 : -1);
    });
    return candidates[0] || null;
  }

  function weakestListedStall() {
    const listed = [];
    for (let s = 1; s <= 16; s++) {
      const it = api.character.slots["trade" + s];
      const rule = it && stallRule(it.name);
      if (!rule) continue;
      listed.push({ slot: s, it, rule, price: stallPrice(it, rule) });
    }
    listed.sort((a, b) => a.price - b.price || (a.it.level || 0) - (b.it.level || 0));
    return listed[0] || null;
  }

  function unreadyRiskListing() {
    const slots = api.character.slots || {};
    for (let s = 1; s <= 16; s++) {
      const it = slots["trade" + s];
      const rule = it && stallRule(it.name);
      if (rule && rule.upgradeTo && (it.level || 0) < rule.upgradeTo) {
        return { slot: s, it };
      }
    }
    return null;
  }

  function stallBagStable() {
    const digest = JSON.stringify(
      (api.character.items || []).map((it) =>
        it && stallRule(it.name) ? [it.name, it.level || 0, it.l || null, it.p || null] : null
      )
    );
    if (digest !== stallBagDigest) {
      stallBagDigest = digest;
      stallBagStableAt = api._now();
      return false;
    }
    return api._now() - stallBagStableAt >= 3000;
  }

  function visibleStalls() {
    const entities = api.parent && api.parent.entities;
    const values = Array.isArray(entities) ? entities : Object.values(entities || {});
    return values.filter(
      (e) =>
        e &&
        e !== api.character &&
        e.name !== api.character.name &&
        (!e.map || e.map === api.character.map) &&
        e.stand &&
        !e.rip
    );
  }

  function mapNpcPositions() {
    const map = api.G && api.G.maps && api.G.maps[api.character.map];
    const out = [];
    const add = (position) => {
      if (Array.isArray(position) && position[0] != null && position[1] != null) {
        out.push({ x: position[0], y: position[1] });
      }
    };
    for (const npc of ((map && map.npcs) || []).concat((map && map.seasonal_npcs) || [])) {
      if (!npc) continue;
      add(npc.position);
      for (const position of npc.positions || []) add(position);
    }
    return out;
  }

  function stallSpotClear(x, y) {
    const stallsClear = visibleStalls().every((e) => {
      const ex = e.real_x != null ? e.real_x : e.x;
      const ey = e.real_y != null ? e.real_y : e.y;
      return ex == null || ey == null || Math.hypot(x - ex, y - ey) >= STALL_CLEARANCE;
    });
    return (
      stallsClear &&
      mapNpcPositions().every((npc) => Math.hypot(x - npc.x, y - npc.y) >= STALL_CLEARANCE)
    );
  }

  function stallSpots() {
    const out = [];
    for (let ring = 0; ring <= STALL_SPOT_RADIUS; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          out.push({
            map: PLAZA.map,
            x: PLAZA.x + dx * STALL_SPOT_STEP,
            y: PLAZA.y + dy * STALL_SPOT_STEP,
          });
        }
      }
    }
    return out;
  }

  async function ensureStallClearance() {
    const cx = api.character.real_x != null ? api.character.real_x : api.character.x;
    const cy = api.character.real_y != null ? api.character.real_y : api.character.y;
    if (api.character.map === PLAZA.map && stallSpotClear(cx, cy)) return true;
    closeStandIfOpen();
    for (const spot of stallSpots()) {
      if (!stallSpotClear(spot.x, spot.y)) continue;
      if (typeof api.can_move_to === "function" && !api.can_move_to(spot.x, spot.y)) continue;
      const r = await api.smart_move(spot);
      if (r && r.failed) continue;
      const x = api.character.real_x != null ? api.character.real_x : api.character.x;
      const y = api.character.real_y != null ? api.character.real_y : api.character.y;
      if (!stallSpotClear(x, y)) continue;
      api.game_log("stall:space " + Math.round(x) + "," + Math.round(y));
      return true;
    }
    api.game_log("stall:space_blocked");
    return false;
  }

  async function openStandAndSync() {
    if (!(await ensureStallClearance())) return false;
    if (!api.character.stand) api.open_stand();
    // Live restores persisted trade slots incrementally. Seeing the first slot
    // does not mean the remaining slots are ready for occupancy checks.
    if (typeof api.sleep === "function") await api.sleep(3000);
    return true;
  }

  /** List one reserve-safe surplus item per idle pass. */
  async function tryStallOne() {
    const unready = unreadyRiskListing();
    if (unready && (api.character.esize || 0) > 0) {
      if (!(await openStandAndSync())) return false;
      const r = await Promise.resolve(api.unequip("trade" + unready.slot));
      if (r && r.failed) {
        api.game_log("stall:risk_reclaim_fail " + (r.reason || ""));
        return false;
      }
      api.game_log("stall:risk_reclaim " + unready.it.name + "@" + (unready.it.level || 0));
      return true;
    }
    const reserveStable = stallBagStable();
    let cand = stallCandidate((api.character.esize || 0) < 1, reserveStable);
    if (!cand) return false;
    if (!(await openStandAndSync())) return false;
    let tradeSlot = 0;
    for (let s = 1; s <= 16; s++) {
      if (
        !api.character.slots["trade" + s] &&
        (stallSlotBlockedUntil[s] || 0) <= api._now()
      ) {
        tradeSlot = s;
        break;
      }
    }
    let replaced = null;
    if (!tradeSlot) {
      const weakest = weakestListedStall();
      const candidatePrice = stallPrice({ name: cand.rule.name, level: cand.level }, cand.rule);
      if (
        (api.character.esize || 0) < (cand.i == null ? 2 : 1) ||
        !weakest ||
        candidatePrice <= weakest.price
      ) {
        return false;
      }
      const r = await Promise.resolve(api.unequip("trade" + weakest.slot));
      if (r && r.failed) {
        api.game_log("stall:rotate_unequip_fail " + (r.reason || ""));
        return false;
      }
      // The local slot clears before Adventure Land persists the delisting.
      if (typeof api.sleep === "function") await api.sleep(2000);
      if (api.character.slots["trade" + weakest.slot]) {
        api.game_log("stall:rotate_slot_stuck trade" + weakest.slot);
        return false;
      }
      tradeSlot = weakest.slot;
      replaced = weakest.it;
    }
    if (cand.i == null) {
      closeStandIfOpen();
      if ((api.character.esize || 0) < 1 || !(await ensureAtBank())) return false;
      const r = await api.bank_retrieve(cand.bank.pack, cand.bank.i);
      if (r && r.failed) {
        api.game_log("stall:retrieve_fail " + cand.rule.name);
        return false;
      }
      await leaveBankToPlaza();
      cand = stallCandidate(false, true);
      if (!cand || cand.i == null) return false;
      if (!(await openStandAndSync())) return false;
    }
    if (api.character.slots["trade" + tradeSlot]) return false;
    const it = api.character.items[cand.i];
    if (!it || it.name !== cand.rule.name) return false;
    const price = stallPrice(it, cand.rule);
    const r = await api.trade(cand.i, tradeSlot, price, it.q == null ? 1 : it.q);
    if (r && r.failed) {
      if (r.reason === "cant_equip") {
        // A reopened stand can expose a locally empty trade slot before its
        // persisted listing arrives. Force a fresh restore so we do not keep
        // retrieving and retrying stock against that occupied server slot.
        stallSlotBlockedUntil[tradeSlot] = api._now() + STALL_SLOT_RESYNC_MS;
        closeStandIfOpen();
        if (typeof api.sleep === "function") await api.sleep(1000);
        if (!(await openStandAndSync())) return false;
        api.game_log("stall:slot_resync trade" + tradeSlot);
        return false;
      }
      api.game_log("stall:list_fail " + it.name + " " + (r.reason || ""));
      return false;
    }
    delete stallSlotBlockedUntil[tradeSlot];
    if (replaced) {
      api.game_log(
        "stall:rotate " +
          replaced.name +
          "@" +
          (replaced.level || 0) +
          " -> " +
          it.name +
          "@" +
          (it.level || 0)
      );
    }
    api.game_log("stall:list " + it.name + "@" + (it.level || 0) + " price=" + price);
    return true;
  }

  /** Pull listed stall junk / goal gear into bag (stand must be open for trade unequip). */
  async function reclaimTradeJunk() {
    const slots = api.character.slots || {};
    const junkSlots = [];
    for (let s = 1; s <= 16; s++) {
      const it = slots["trade" + s];
      if (isTradeReclaimItem(it)) junkSlots.push(s);
    }
    if (!junkSlots.length) return 0;
    if (!api.character.stand && !(await openStandAndSync())) return 0;
    let n = 0;
    for (const s of junkSlots) {
      if ((api.character.esize || 0) < 1) break;
      if (typeof api.unequip !== "function") break;
      const before = api.character.slots["trade" + s];
      if (!before) continue;
      const r = await Promise.resolve(api.unequip("trade" + s));
      if (r && r.failed) {
        api.game_log("vendor:unequip_fail trade" + s + " " + (r.reason || ""));
        continue;
      }
      if (!api.character.slots["trade" + s]) {
        api.game_log("vendor:reclaim " + before.name);
        n++;
      }
    }
    return n;
  }

  /**
   * NPC-vendor cheap junk (former stall whitelist). Clears trade slots first,
   * pulls from bank, sells at potions merchant via sell().
   */
  async function tryVendorNpc() {
    if (typeof api.sell !== "function") return false;
    await reclaimTradeJunk();

    function findBagJunk() {
      const protectedKeys = progressionUpgradeKeys();
      return api.character.items.findIndex(
        (x, slot) =>
          isVendorNpcItem(x) &&
          !progressionWinner(x) &&
          !protectedKeys.has("bag:" + slot)
      );
    }

    let i = findBagJunk();
    if (i < 0) {
      const hint = api.character.bank || api.character._bank;
      let protectedKeys = progressionUpgradeKeys();
      let any = listBankItems().some(
        (e) =>
          isVendorNpcItem(e) &&
          !progressionWinner(e) &&
          !protectedKeys.has(e.pack + ":" + e.i)
      );
      if (!any && hint) {
        for (const p of Object.keys(hint)) {
          if (p === "gold" || !Array.isArray(hint[p])) continue;
          if (
            hint[p].some(
              (x, slot) =>
                isVendorNpcItem(x) &&
                !progressionWinner(x) &&
                !protectedKeys.has(p + ":" + slot)
            )
          ) {
            any = true;
            break;
          }
        }
      }
      if (!any) return false;
      closeStandIfOpen();
      if ((api.character.esize || 0) < 1) {
        await parkToBank(null, { skipUpgrades: false });
        if ((api.character.esize || 0) < 1) return false;
      }
      if (!(await ensureAtBank())) return false;
      protectedKeys = progressionUpgradeKeys();
      const hit = listBankItems()
        .filter(
          (e) =>
            isVendorNpcItem(e) &&
            !progressionWinner(e) &&
            !protectedKeys.has(e.pack + ":" + e.i)
        )
        .sort((a, b) => {
          const order = OBSOLETE_POTIONS.concat(
            EMERGENCY_VENDOR_NPC,
            VENDOR_NPC,
            VENDOR_NPC_LOW_LEVEL
          );
          const ia = order.indexOf(a.name);
          const ib = order.indexOf(b.name);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        })[0];
      if (!hit) {
        api.game_log("vendor:no_junk_live");
        await leaveBankToPlaza();
        return false;
      }
      const pull = await api.bank_retrieve(hit.pack, hit.i);
      if (pull && pull.failed) {
        api.game_log("vendor:retrieve_fail " + (pull.reason || ""));
        await leaveBankToPlaza();
        return false;
      }
      api.game_log("vendor:pull " + hit.name);
      await leaveBankToPlaza();
      i = findBagJunk();
    }
    if (i < 0) return false;

    if (!(await goNpc({ map: "main", x: 56, y: -122 }, null, "vendor:path_fail"))) {
      return false;
    }

    let sold = 0;
    for (let n = 0; n < 24; n++) {
      i = findBagJunk();
      if (i < 0) break;
      const it = api.character.items[i];
      const nm = it.name;
      const q = it.q == null ? 1 : it.q;
      try {
        const r = await api.sell(i, q);
        if (r && r.failed) {
          api.game_log("vendor:fail " + nm + " " + (r.reason || ""));
          break;
        }
        api.game_log("vendor:sell " + nm + " x" + q);
        sold++;
      } catch (e) {
        api.game_log("vendor:fail " + nm);
        break;
      }
    }
    return sold > 0;
  }

  function spendableGold() {
    return (api.character.gold || 0) - GOLD_FLOAT_MERCHANT;
  }

  function ownedGearList() {
    const out = [];
    for (const it of api.character.items || []) {
      if (it && isGearPiece(it, api.G)) out.push({ name: it.name, level: it.level || 0 });
    }
    for (const e of listBankItems()) {
      if (isGearPiece({ name: e.name, level: e.level || 0 }, api.G)) {
        out.push({ name: e.name, level: e.level || 0 });
      }
    }
    return out;
  }

  async function goUpgradeNpc() {
    return goNpc({ map: "main", x: -207, y: -220 }, { to: "upgrade" });
  }

  /** Exchange one gem0 / anniversarygift with Xyn (idle bank clean). */
  async function tryExchangeOne() {
    if (typeof api.exchange !== "function") return false;
    const names = EXCHANGE_ITEMS;

    function findBagSlot() {
      let best = -1;
      let bestTurns = Infinity;
      for (let i = 0; i < api.character.items.length; i++) {
        const it = api.character.items[i];
        if (!it || names.indexOf(it.name) < 0) continue;
        const need = ((api.G.items && api.G.items[it.name]) || {}).e || 1;
        const q = it.q == null ? 1 : it.q;
        if (q < need) continue;
        const turns = Math.ceil(q / need);
        if (turns < bestTurns) {
          best = i;
          bestTurns = turns;
        }
      }
      return best;
    }

    function bankHasExchange() {
      const hint = api.character.bank || api.character._bank;
      if (!hint) return false;
      for (const p of Object.keys(hint)) {
        if (p === "gold" || !Array.isArray(hint[p])) continue;
        if (hint[p].some((x) => x && names.indexOf(x.name) >= 0)) return true;
      }
      return false;
    }

    let i = findBagSlot();
    if (i < 0) {
      if (!bankHasExchange() && !listBankItems().some((e) => names.indexOf(e.name) >= 0)) {
        return false;
      }
      closeStandIfOpen();
      if ((api.character.esize || 0) < 1) {
        await parkToBank(null, { skipUpgrades: false });
        if ((api.character.esize || 0) < 1) return false;
      }
      if (!(await ensureAtBank())) return false;
      const hit = listBankItems().find((e) => names.indexOf(e.name) >= 0);
      if (!hit) {
        await leaveBankToPlaza();
        return false;
      }
      const bankNeed = ((api.G.items && api.G.items[hit.name]) || {}).e || 1;
      const bankHeld = hit.q == null ? 1 : hit.q;
      if (bankHeld > bankNeed && (api.character.esize || 0) <= XYN_BAG_RESERVE) {
        await leaveBankToPlaza();
        return false;
      }
      const rr = await api.bank_retrieve(hit.pack, hit.i);
      if (rr && rr.failed) {
        api.game_log("xyn:retrieve_fail");
        await leaveBankToPlaza();
        return false;
      }
      await leaveBankToPlaza();
      i = findBagSlot();
    }
    if (i < 0) return false;

    const nm = api.character.items[i].name;
    const needed = ((api.G.items && api.G.items[nm]) || {}).e || 1;
    const held = api.character.items[i].q == null ? 1 : api.character.items[i].q;
    if (held > needed && (api.character.esize || 0) <= XYN_BAG_RESERVE) {
      const now = api._now();
      if (lastXynNoSpaceAt == null || now - lastXynNoSpaceAt >= 15000) {
        api.game_log("xyn:capacity_hold " + nm);
        lastXynNoSpaceAt = now;
      }
      return false;
    }
    if (!(await goNpc({ to: "exchange" }, { map: "main", x: -25, y: -478 }, "xyn:path_fail"))) {
      return false;
    }
    i = findBagSlot();
    if (i < 0) {
      i = api.character.items.findIndex((x) => x && x.name === nm);
    }
    if (i < 0) return false;
    const r = await api.exchange(i);
    if (r && r.failed) {
      api.game_log("xyn:fail " + nm + " " + ((r && r.reason) || ""));
      return false;
    }
    api.game_log("xyn:exchange " + nm);
    return true;
  }

  function pontyHave(name) {
    let n = 0;
    for (const it of api.character.items || []) {
      if (it && it.name === name) n += it.q == null ? 1 : it.q;
    }
    for (const e of listBankItems()) {
      if (e.name === name) n += e.q == null ? 1 : 1;
    }
    for (const who of FIGHTERS) {
      const ad = gearAds[who];
      if (!ad || !ad.slots) continue;
      for (const slot of Object.keys(ad.slots)) {
        const w = ad.slots[slot];
        if (w && w.name === name) n += 1;
      }
    }
    return n;
  }

  function pontyNeed(name) {
    let want = 0;
    for (const w of PONTY_WANT || []) {
      if (Array.isArray(w) ? w[0] === name : w === name) {
        want = Array.isArray(w) ? w[1] || 1 : 1;
        break;
      }
    }
    return want > 0 ? Math.max(0, want - pontyHave(name)) : 0;
  }

  function pontyFair(it) {
    const base = (api.G.items[it.name] && api.G.items[it.name].g) || 1000;
    const lv = it.level || 0;
    return Math.floor(base * (1 + 0.12 * lv));
  }

  /** One Ponty secondhand buy toward PONTY_WANT / empty earring·cape targets. */
  async function tryPontyBuy() {
    if (typeof api.get_secondhands !== "function" || typeof api.buy_secondhand !== "function") {
      return false;
    }
    if (!(PONTY_WANT || []).length) return false;
    const spend = spendableGold();
    if (!(spend > 0)) return false;
    const now = api._now ? api._now() : Date.now();
    if (lastPontySweepAt != null && now - lastPontySweepAt < PONTY_SWEEP_MS) return false;
    if (lastPontyAttemptAt != null && now - lastPontyAttemptAt < PONTY_RETRY_MS) return false;
    lastPontyAttemptAt = now;
    if ((api.character.esize || 0) < 1) {
      await parkToBank(null, { skipUpgrades: false });
      if ((api.character.esize || 0) < 1) return false;
    }
    if (!(await goNpc({ to: "secondhands" }, { map: "main", x: 106, y: -47 }, "ponty:path_fail"))) {
      return false;
    }
    let listed;
    try {
      listed = await api.get_secondhands();
    } catch (e) {
      api.game_log("ponty:list_fail");
      return false;
    }
    lastPontySweepAt = api._now ? api._now() : Date.now();
    const items = (listed && listed.items) || [];
    api.game_log("ponty:list " + items.length);
    let best = null;
    for (const it of items) {
      if (!it || !it.rid) continue;
      const need = pontyNeed(it.name);
      if (!(need > 0)) continue;
      const price = it.price != null ? it.price : pontyFair(it);
      const cap = pontyFair(it) * (PONTY_MULT || 1.25);
      if (price > cap || price > spend) continue;
      if (!best || price < best.price) best = { rid: it.rid, price, name: it.name };
    }
    if (!best) {
      api.game_log("ponty:none");
      return false;
    }
    try {
      const r = await api.buy_secondhand(best.rid);
      if (r && r.failed) {
        api.game_log("ponty:fail " + best.name + " " + (r.reason || ""));
        return false;
      }
      api.game_log("ponty:buy " + best.name + " @" + best.price);
      return true;
    } catch (e) {
      api.game_log("ponty:fail " + best.name);
      return false;
    }
  }

  function craftHave(name) {
    let n = 0;
    for (const it of api.character.items || []) {
      if (it && it.name === name) n += it.q == null ? 1 : it.q;
    }
    for (const e of listBankItems()) {
      if (e.name === name) n += e.q == null ? 1 : 1;
    }
    const slots = api.character.slots || {};
    for (const k of Object.keys(slots)) {
      const w = slots[k];
      if (w && w.name === name) n += 1;
    }
    return n;
  }

  function craftIngCount(name, level) {
    const wantLv = level || 0;
    let n = 0;
    for (const it of api.character.items || []) {
      if (!it || it.name !== name) continue;
      if ((it.level || 0) !== wantLv) continue;
      n += it.q == null ? 1 : it.q;
    }
    for (const e of listBankItems()) {
      if (e.name !== name) continue;
      if ((e.level || 0) !== wantLv) continue;
      n += e.q == null ? 1 : 1;
    }
    return n;
  }

  function craftVendorBuyable(name) {
    return name === "staff" || name === "blade";
  }

  /** Idle: trade gathered orb materials at Cole, then craft missing tools at Leo. */
  async function tryCraftOne() {
    if (typeof api.auto_craft !== "function") return false;
    const recipes = (api.G && api.G.craft) || {};
    const targets = CRAFT_TARGETS || [];
    for (const name of targets) {
      const rec = recipes[name];
      if (!rec || !Array.isArray(rec.items)) continue;
      // Orbs feed a 3:1 compound chain; tools only need one owned copy.
      if (name !== "orbg" && craftHave(name) >= 1) continue;
      const tag = rec.quest ? "collector" : "craft";

      const buys = [];
      let blocked = false;
      for (const ing of rec.items) {
        const need = ing[0] || 1;
        const nm = ing[1];
        const lv = ing[2] || 0;
        const have = craftIngCount(nm, lv);
        if (have >= need) continue;
        const short = need - have;
        if (craftVendorBuyable(nm) && lv === 0) {
          const price = (api.G.items[nm] && api.G.items[nm].g) || 0;
          buys.push({ name: nm, q: short, price });
        } else {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      const craftCost = rec.cost || 0;
      const buyCost = buys.reduce((s, b) => s + b.price * b.q, 0);
      if (spendableGold() < buyCost + craftCost) {
        api.game_log(tag + ":gold " + name);
        continue;
      }

      // Pull bank mats (silk / leftover weapons) into bag.
      for (const ing of rec.items) {
        const need = ing[0] || 1;
        const nm = ing[1];
        const lv = ing[2] || 0;
        let bagN = 0;
        for (const it of api.character.items || []) {
          if (it && it.name === nm && (it.level || 0) === lv) bagN += it.q == null ? 1 : it.q;
        }
        while (bagN < need) {
          const hit = listBankItems().find((e) => e.name === nm && (e.level || 0) === lv);
          if (!hit) break;
          if ((api.character.esize || 0) < 1) {
            await parkToBank(null, { skipUpgrades: false });
            if ((api.character.esize || 0) < 1) break;
          }
          if (!(await ensureAtBank())) break;
          const rr = await api.bank_retrieve(hit.pack, hit.i);
          if (rr && rr.failed) break;
          bagN++;
        }
      }
      if (api.character.map === "bank") await leaveBankToPlaza();

      // Buy missing vendor weapons at Gabriel (basics).
      if (buys.length) {
        if (!(await goNpc({ to: "basics" }, { map: "main", x: -89, y: -165 }, "craft:vendor_path_fail"))) {
          return false;
        }
        for (const b of buys) {
          for (let k = 0; k < b.q; k++) {
            if ((api.character.esize || 0) < 1) {
              await parkToBank(null, { skipUpgrades: false });
              if ((api.character.esize || 0) < 1) {
                api.game_log("craft:no_space");
                return false;
              }
              await goNpc({ to: "basics" }, { map: "main", x: -89, y: -165 });
            }
            const br = await api.buy(b.name, 1);
            if (br && br.failed) {
              api.game_log("craft:buy_fail " + b.name);
              return false;
            }
            api.game_log("craft:buy " + b.name);
          }
        }
      }

      // Re-check bag ingredients after buys/retrieves.
      for (const ing of rec.items) {
        const need = ing[0] || 1;
        const nm = ing[1];
        const lv = ing[2] || 0;
        let bagN = 0;
        for (const it of api.character.items || []) {
          if (it && it.name === nm && (it.level || 0) === lv) bagN += it.q == null ? 1 : it.q;
        }
        if (bagN < need) {
          api.game_log("craft:missing " + nm);
          return false;
        }
      }
      // A consumed singleton ingredient frees the output slot. Stacked
      // materials do not, so make room before asking the server to craft.
      const consumesSlot = rec.items.some((ing) => {
        const need = ing[0] || 1;
        const nm = ing[1];
        const lv = ing[2] || 0;
        return (api.character.items || []).some((it) => {
          if (!it || it.name !== nm || (it.level || 0) !== lv) return false;
          return (it.q == null ? 1 : it.q) <= need;
        });
      });
      if ((api.character.esize || 0) < 1 && !consumesSlot) {
        await parkToBank(null, { skipUpgrades: false });
        if ((api.character.esize || 0) < 1) {
          api.game_log(tag + ":no_space");
          return false;
        }
      }

      const npc = rec.quest || "craftsman";
      const fallback = rec.quest === "mcollector"
        ? { map: "main", x: 81, y: -283 }
        : { map: "main", x: 92, y: 670 };
      if (!(await goNpc({ to: npc }, fallback, tag + ":path_fail"))) {
        return false;
      }
      try {
        const r = await api.auto_craft(name);
        if (r && r.failed) {
          api.game_log(tag + ":fail " + name + " " + (r.reason || ""));
          return false;
        }
        api.game_log(tag + ":ok " + name);
        return true;
      } catch (e) {
        api.game_log(tag + ":fail " + name);
        return false;
      }
    }
    return false;
  }

  /** One conservative upgrade, or one explicitly configured surplus liquidation risk. */
  async function tryUpgradeOne() {
    let riskKeys = riskUpgradeKeys();
    let progressKeys = progressionUpgradeKeys();
    const progressionBagIndex = () => {
      let best = -1;
      let bestLevel = -1;
      for (let slot = 0; slot < (api.character.items || []).length; slot++) {
        const it = api.character.items[slot];
        if (
          !it ||
          !progressKeys.has("bag:" + slot) ||
          !canUpgradeItem(it, api.G)
        ) {
          continue;
        }
        if ((it.level || 0) > bestLevel) {
          best = slot;
          bestLevel = it.level || 0;
        }
      }
      return best;
    };
    const allowBag = (it, slot) =>
      !progressionWinner(it) &&
      (!isRiskUpgrade(it) || riskKeys.has("bag:" + slot)) &&
      (!isHunterUpgrade(it) || !hunterUpgradeStopped(it));
    const pickWorkIndex = () => {
      const progression = progressionBagIndex();
      return progression >= 0
        ? progression
        : pickUpgradeIndex(api.character.items, api.G, allowBag);
    };
    let i = pickWorkIndex();
    if (i < 0) {
      // Bag has only below-gate pieces: log once per piece key, then leave for park.
      // Silent while stall locks parkToBank — otherwise burn-in spammed every minute.
      const low = (api.character.items || []).findIndex(
        (it, slot) =>
          eligibleUpgrade(it, api.G) &&
          !isRiskUpgrade(it) &&
          upgradeChance(it) < MIN_UPGRADE_CHANCE &&
          allowBag(it, slot)
      );
      if (low >= 0) {
        if (!api.character.stand) {
          const it = api.character.items[low];
          logUpgradeSkip(it.name, it.level || 0, upgradeChance(it));
        }
        return false;
      }
      // Bank: only pull pieces we would actually upgrade. Never skip-spam on bank junk.
      const progressionHit = progressionUpgradeRows().find((e) => e.pack != null);
      const bankHit = progressionHit || listBankItems().find((e) => {
        const it = { name: e.name, level: e.level || 0 };
        return upgradeReady(it, api.G) &&
          !progressionWinner(it) &&
          (!isHunterUpgrade(it) || !hunterUpgradeStopped(it)) &&
          (!isRiskUpgrade(it) || riskKeys.has(e.pack + ":" + e.i));
      });
      if (!bankHit) return false;
      if ((api.character.esize || 0) < 1) await parkToBank();
      if (!(await ensureAtBank())) return false;
      while ((api.character.esize || 0) > ECON_BAG_RESERVE) {
        if (progressionHit) {
          const liveProgressionHit = progressionUpgradeRows().find((e) => e.pack != null);
          if (!liveProgressionHit) break;
          const pulled = await api.bank_retrieve(liveProgressionHit.pack, liveProgressionHit.i);
          if (pulled && pulled.failed) return false;
          break;
        }
        const currentRiskKeys = riskUpgradeKeys();
        const hit = listBankItems().find((e) => {
          if (e.name !== bankHit.name) return false;
          const it = { name: e.name, level: e.level || 0 };
          return upgradeReady(it, api.G) &&
            !progressionWinner(it) &&
            (!isHunterUpgrade(it) || !hunterUpgradeStopped(it)) &&
            (!isRiskUpgrade(it) || currentRiskKeys.has(e.pack + ":" + e.i));
        });
        if (!hit) break;
        const pulled = await api.bank_retrieve(hit.pack, hit.i);
        if (pulled && pulled.failed) break;
      }
      await leaveBankToPlaza();
      riskKeys = riskUpgradeKeys();
      progressKeys = progressionUpgradeKeys();
      i = pickWorkIndex();
      if (i < 0) return false;
    }
    const it = api.character.items[i];
    let progression = progressKeys.has("bag:" + i);
    const scn = progression ? upgradeScrollFor(it, api.G) : scrollFor(it, api.G);
    if (!scn) return false;
    let risky = isRiskUpgrade(it);
    let hunter = isHunterUpgrade(it);
    const chance = upgradeChance(it);
    if (!progression && !hunter && !risky && chance < MIN_UPGRADE_CHANCE) {
      logUpgradeSkip(it.name, it.level || 0, chance);
      return false;
    }
    let sci = api.character.items.findIndex((x) => x && x.name === scn);
    if (sci < 0) {
      const price = (api.G.items[scn] && api.G.items[scn].g) || 1000;
      if (spendableGold() < price) {
        api.game_log("gear:scroll_gold");
        return false;
      }
      if ((api.character.esize || 0) < 1) {
        await parkToBank(it);
        if ((api.character.esize || 0) < 1) return false;
        riskKeys = riskUpgradeKeys();
        i = pickUpgradeIndex(api.character.items, api.G, allowBag);
        if (i < 0) return false;
      }
      if (!(await goUpgradeNpc())) {
        api.game_log("gear:upgrade_path_fail");
        return false;
      }
      const batchSize = progression
        ? 1
        : api.character.items.filter((x, slot) => {
            if (!x || scrollFor(x, api.G) !== scn) return false;
            return upgradeReady(x, api.G) && allowBag(x, slot);
          }).length;
      const batchCap = scn === "scroll0" ? batchSize : Math.min(batchSize, 2);
      const scrollQty = Math.max(1, Math.min(batchCap, Math.floor(spendableGold() / price)));
      const br = await api.buy(scn, scrollQty);
      if (br && br.failed) {
        api.game_log("gear:scroll_buy_fail");
        return false;
      }
      api.game_log("gear:buy " + scn);
      sci = api.character.items.findIndex((x) => x && x.name === scn);
      riskKeys = riskUpgradeKeys();
      progressKeys = progressionUpgradeKeys();
      i = pickWorkIndex();
      if (sci < 0 || i < 0) return false;
      progression = progressKeys.has("bag:" + i);
      const finalScroll = progression
        ? upgradeScrollFor(api.character.items[i], api.G)
        : scrollFor(api.character.items[i], api.G);
      if (finalScroll !== scn) return false;
    }
    risky = isRiskUpgrade(api.character.items[i]);
    hunter = isHunterUpgrade(api.character.items[i]);
    progression = progressKeys.has("bag:" + i);
    if (typeof api.upgrade !== "function") return false;
    if (!(await goUpgradeNpc())) {
      api.game_log("gear:upgrade_path_fail");
      return false;
    }
    try {
      const preview = await api.upgrade(i, sci, null, true);
      if (
        !preview ||
        preview.chance == null ||
        preview.chance <= 0 ||
        (!progression && hunter && preview.chance < HUNTER_UPGRADE_MIN_CHANCE) ||
        (!progression && !hunter && !risky && preview.chance < MIN_UPGRADE_CHANCE)
      ) {
        const cur = api.character.items[i];
        if (progression && cur && (!preview || !preview.chance || preview.chance <= 0)) {
          store.progressionUpgradeStop = store.progressionUpgradeStop || {};
          store.progressionUpgradeStop[cur.name] = cur.level || 0;
          saveQ(store);
          api.game_log("gear:progress_cap " + cur.name + "@" + (cur.level || 0));
          return false;
        }
        if (!progression && hunter && cur) {
          store.hunterUpgradeStop = store.hunterUpgradeStop || {};
          store.hunterUpgradeStop[cur.name] = cur.level || 0;
          saveQ(store);
          api.game_log(
            "gear:hunter_ready " +
              cur.name +
              "@" +
              (cur.level || 0) +
              " chance=" +
              Number(preview.chance || 0).toFixed(3)
          );
          return false;
        }
        logUpgradeSkip(
          (cur && cur.name) || "?",
          (cur && cur.level) || 0,
          (preview && preview.chance) || 0
        );
        return false;
      }
    } catch (e) {
      api.game_log("gear:upgrade_preview_fail");
      return false;
    }
    riskKeys = riskUpgradeKeys();
    progressKeys = progressionUpgradeKeys();
    i = pickWorkIndex();
    sci = api.character.items.findIndex((x) => x && x.name === scn);
    if (i < 0 || sci < 0) return false;
    progression = progressKeys.has("bag:" + i);
    const finalScroll = progression
      ? upgradeScrollFor(api.character.items[i], api.G)
      : scrollFor(api.character.items[i], api.G);
    if (finalScroll !== scn) return false;
    risky = isRiskUpgrade(api.character.items[i]);
    hunter = isHunterUpgrade(api.character.items[i]);
    const before = api.character.items[i];
    const nm = before.name;
    const lv0 = before.level || 0;
    try {
      const r = await api.upgrade(i, sci);
      if (r && r.failed) {
        if (progression && r.reason === "max_level") {
          store.progressionUpgradeStop = store.progressionUpgradeStop || {};
          store.progressionUpgradeStop[nm] = lv0;
          saveQ(store);
          api.game_log("gear:progress_cap " + nm + "@" + lv0);
          return false;
        }
        if (progression && r.reason === "destroyed") {
          api.game_log("gear:progress_destroyed " + nm + "@" + lv0);
          return true;
        }
        if (hunter && r.reason === "destroyed") {
          api.game_log("gear:hunter_destroyed " + nm + "@" + lv0);
          return true;
        }
        if (risky && r.reason === "destroyed") {
          api.game_log("gear:risk_destroyed " + nm + "@" + lv0);
          return true;
        }
        api.game_log("gear:upgrade_fail " + nm + "@" + lv0);
        return false;
      }
      const after = api.character.items[i];
      const lv1 = after && after.name === nm ? after.level || 0 : -1;
      if (progression && lv1 < 0) {
        api.game_log("gear:progress_destroyed " + nm + "@" + lv0);
        return true;
      }
      if (hunter && lv1 < 0) {
        api.game_log("gear:hunter_destroyed " + nm + "@" + lv0);
        return true;
      }
      if (risky && lv1 < 0) {
        api.game_log("gear:risk_destroyed " + nm + "@" + lv0);
        return true;
      }
      api.game_log("gear:upgrade " + nm + "@" + lv0 + "->" + lv1);
      if (progression) {
        store.progressionWinners = store.progressionWinners || {};
        store.progressionWinners[nm] = lv1;
        saveQ(store);
        api.game_log("gear:progress " + nm + "@" + lv0 + "->" + lv1);
      }
      return true;
    } catch (e) {
      api.game_log("gear:upgrade_fail " + nm);
      return false;
    }
  }

  /** One compound from bag/bank triples (idle bank clean). */
  async function tryCombineOne() {
    if (typeof api.compound !== "function") return false;
    const now = api._now ? api._now() : Date.now();
    if (
      lastCombineNoSpaceAt != null &&
      now - lastCombineNoSpaceAt < COMBINE_NO_SPACE_BACKOFF_MS
    ) {
      return false;
    }
    const bags = [api.character.items || []];
    const bankHint = api.character.bank || api.character._bank;
    if (bankHint) {
      for (const p of Object.keys(bankHint)) {
        if (p !== "gold" && Array.isArray(bankHint[p])) bags.push(bankHint[p]);
      }
    }
    let cand = planCompounds(bags, api.G, COMBINE_PRIORITY);
    if (!cand.length) return false;
    // Under the logistics reserve, prefer an executable local triple. A
    // bank-first target needs three retrieval slots and can otherwise block
    // local compaction even when the bag already contains a complete triple.
    if ((api.character.esize || 0) < ECON_BAG_RESERVE) {
      const local = planCompounds([api.character.items || []], api.G, COMBINE_PRIORITY);
      const ready = local.find((x) => {
        const scroll = cscrollFor(x.name, x.level, api.G);
        return api.character.items.some((it) => it && it.name === scroll);
      });
      if (ready) cand = [ready];
      else if (local.length) cand = local;
    }
    const target = cand[0];
    closeStandIfOpen();

    function bagThree() {
      const idxs = [];
      for (let i = 0; i < api.character.items.length; i++) {
        const it = api.character.items[i];
        if (it && it.name === target.name && (it.level || 0) === target.level) idxs.push(i);
      }
      return idxs.length >= 3 ? idxs.slice(0, 3) : null;
    }

    let three = bagThree();
    if (!three) {
      if (!(await ensureAtBank())) return false;
      while ((api.character.esize || 0) > 0) {
        const hit = listBankItems().find(
          (e) => e.name === target.name && (e.level || 0) === target.level
        );
        if (!hit) break;
        if (bagThree() && (api.character.esize || 0) <= ECON_BAG_RESERVE) break;
        const pulled = await api.bank_retrieve(hit.pack, hit.i);
        if (pulled && pulled.failed) break;
      }
      three = bagThree();
      await leaveBankToPlaza();
      if (!three) {
        api.game_log("bank:combine_pull_fail " + target.name + "@" + target.level);
        return false;
      }
    }

    const scn = cscrollFor(target.name, target.level, api.G);
    let sci = api.character.items.findIndex((x) => x && x.name === scn);
    if (sci < 0) {
      const price = (api.G.items[scn] && api.G.items[scn].g) || 800;
      if (spendableGold() < price) {
        api.game_log("bank:cscroll_gold");
        return false;
      }
      if ((api.character.esize || 0) < 1) {
        let freed = false;
        for (let i = 0; i < api.character.items.length; i++) {
          if (!isSellJunk(api.character.items[i], api.G)) continue;
          if (!(await goNpc({ map: "main", x: 56, y: -122 }, null))) break;
          const sold = await api.sell(i);
          freed = !(sold && sold.failed);
          break;
        }
        if (!freed) {
          freed = await freeEmergencySlot();
        }
        if (!freed) {
          const groups = {};
          for (let i = 0; i < api.character.items.length; i++) {
            const it = api.character.items[i];
            if (!it || COMBINE_PRIORITY.indexOf(it.name) < 0) continue;
            const key = it.name + "@" + (it.level || 0);
            if (!groups[key]) groups[key] = { indexes: [], priority: COMBINE_PRIORITY.indexOf(it.name) };
            groups[key].indexes.push(i);
          }
          const excess = Object.keys(groups)
            .map((key) => groups[key])
            .filter((g) => g.indexes.length >= 4)
            .sort((a, b) => {
              const ar = a.indexes.length % 3 ? 0 : 1;
              const br = b.indexes.length % 3 ? 0 : 1;
              return ar - br || b.priority - a.priority;
            })[0];
          if (excess && (await goNpc({ map: "main", x: 56, y: -122 }, null))) {
            const it = api.character.items[excess.indexes[0]];
            const sold = await api.sell(excess.indexes[0], 1);
            freed = !(sold && sold.failed) && (api.character.esize || 0) >= 1;
            if (freed) api.game_log("bank:compound_sacrifice " + it.name + "@" + (it.level || 0));
          }
        }
        if (!freed || (api.character.esize || 0) < 1) {
          lastCombineNoSpaceAt = api._now ? api._now() : Date.now();
          api.game_log("bank:combine_no_space");
          return false;
        }
        three = bagThree();
        if (!three) return false;
      }
      if (!(await goUpgradeNpc())) {
        api.game_log("bank:combine_path_fail");
        return false;
      }
      const batchSize = Math.floor(
        api.character.items.filter(
          (x) => x && x.name === target.name && (x.level || 0) === target.level
        ).length / 3
      );
      const scrollQty = Math.max(1, Math.min(batchSize, Math.floor(spendableGold() / price)));
      const br = await api.buy(scn, scrollQty);
      if (br && br.failed) {
        api.game_log("bank:cscroll_buy_fail");
        return false;
      }
      api.game_log("bank:buy " + scn);
      sci = api.character.items.findIndex((x) => x && x.name === scn);
      three = bagThree();
      if (sci < 0 || !three) return false;
    }

    if (!(await goUpgradeNpc())) {
      api.game_log("bank:combine_path_fail");
      return false;
    }
    three = bagThree();
    sci = api.character.items.findIndex((x) => x && x.name === scn);
    if (!three || sci < 0) return false;
    try {
      const r = await api.compound(three[0], three[1], three[2], sci);
      if (r && r.failed) {
        api.game_log("bank:compound_fail " + target.name + "@" + target.level);
        return false;
      }
      api.game_log("bank:compound " + target.name + "@" + target.level);
      lastCombineNoSpaceAt = null;
      return true;
    } catch (e) {
      api.game_log("bank:compound_fail " + target.name);
      return false;
    }
  }

  async function idleEcon() {
    const fighterNearby = FIGHTERS.some((who) => playerDist(api.get_player(who)) <= SEND_RANGE);
    if (api.character.stand && fighterNearby) closeStandIfOpen();
    const px = api.character.real_x != null ? api.character.real_x : api.character.x;
    const py = api.character.real_y != null ? api.character.real_y : api.character.y;
    if (api.character.stand && !stallSpotClear(px, py)) {
      closeStandIfOpen();
      api.game_log("stall:space_relocate");
    }
    // Live has no _bank until we visit once — without this, vendor/gift are blind on main.
    const fullPersistedStand =
      api.character.stand &&
      Array.from({ length: 16 }, (_, i) => api.character.slots["trade" + (i + 1)]).every(Boolean);
    await primeBankHint(fullPersistedStand);
    // Keep the merchant's own emergency supply full before spending idle time
    // on optional economy work.
    await restockSelfPots();
    // Drain Xyn inputs before other economy work. Exact-size exchanges free
    // their own slot; stacked inputs yield until one emergency slot remains.
    try {
      if (await tryExchangeOne()) return;
    } catch (e) {
      api.game_log("xyn:err " + ((e && e.message) || e));
    }
    // Turn one safe duplicate into a challenger before liquidation can consume it.
    if (progressionUpgradeKeys().size && (await tryUpgradeOne())) return;
    // NPC-vendor cheap junk after any immediately safe Xyn turn-in.
    try {
      if (await tryVendorNpc()) return;
    } catch (e) {
      api.game_log("vendor:err " + ((e && e.message) || e));
    }
    // Compression and liquidation outrank slot-expanding exchanges whenever
    // either the bag or vault has fallen below its logistics reserve.
    if (capacityConstrained()) {
      try {
        if (await tryCombineOne()) return;
      } catch (e) {
        api.game_log("bank:combine_err " + ((e && e.message) || e));
      }
      if (await tryUpgradeOne()) return;
      try {
        if (await tryStallOne()) return;
      } catch (e) {
        api.game_log("stall:err " + ((e && e.message) || e));
      }
      // A full bag plus a full stand cannot prime the bank, retrieve junk, or
      // list another item. Sacrifice a designated low-value stack to break the
      // cycle; the next tick can close the stand and resume bank cleanup.
      if ((api.character.esize || 0) < 1 && (await freeEmergencySlot())) return;
      if (bagParkables(null, { skipUpgrades: false }).length) {
        await parkToBank(null, { skipUpgrades: false });
      }
      return;
    }
    try {
      if (await tryStallOne()) return;
    } catch (e) {
      api.game_log("stall:err " + ((e && e.message) || e));
    }
    // Ponty — fill earring/cape/sshield quotas under fair cap.
    try {
      if (await tryPontyBuy()) return;
    } catch (e) {
      api.game_log("ponty:err " + ((e && e.message) || e));
    }
    // Craft tools (pickaxe / fishing rod) when silk + gold allow.
    try {
      if (await tryCraftOne()) return;
    } catch (e) {
      api.game_log("craft:err " + ((e && e.message) || e));
    }
    // Buy/upgrade/combine before parking so bank clean progresses while idle.
    if (await tryUpgradeOne()) return;
    try {
      if (await tryCombineOne()) return;
    } catch (e) {
      api.game_log("bank:combine_err " + ((e && e.message) || e));
    }
    // After skip/upgrade attempt, bank below-gate gear (sell junk reserved for tryVendorNpc).
    if (bagParkables(null, { skipUpgrades: false }).length) {
      await parkToBank(null, { skipUpgrades: false });
      return;
    }
    if (await tryPlanGearGift()) return;
    if (
      !fighterNearby &&
      !api.character.stand &&
      (await openStandAndSync())
    ) {
      return;
    }
  }

  async function abortDelivery(job, reason) {
    api.game_log("dlv:abort_" + reason + " id=" + (job && job.id));
    try {
      if (job && job.who) await api.send_cm(job.who, { dlv_done: 1, id: job.id, ok: 0, reason });
    } catch (e) {}
    store.active = null;
    saveQ(store);
    await retreatPlaza();
  }

  /** Overnight burn-in: empty_send loop left merchant parked on pack with a full bag. */
  async function noteEmptySend(job) {
    api.game_log("dlv:empty_send");
    job.emptyFails = (job.emptyFails || 0) + 1;
    await retreatPlaza();
    if (job.emptyFails >= 5) {
      await abortDelivery(job, "empty");
      return true;
    }
    return false;
  }

  async function refreshDeliveryLocation(job, phase) {
    const now = api._now ? api._now() : Date.now();
    if (job.locProbeSeq != null && (job.locSeq || 0) !== job.locProbeSeq) {
      job.locProbeAt = null;
      job.locProbeSeq = null;
      saveQ(store);
      return true;
    }
    if (job.locProbeAt != null && now - job.locProbeAt < BEACON_MS) return false;
    const beforeSeq = job.locSeq || 0;
    job.locProbeAt = now;
    job.locProbeSeq = beforeSeq;
    saveQ(store);
    await api.send_cm(job.who, {
      status: 1,
      id: job.id,
      phase: phase || "enroute",
      meet: 1,
      map: api.character.map,
      x: api.character.real_x,
      y: api.character.real_y,
    });
    await api.sleep(250);
    const refreshed = (job.locSeq || 0) !== beforeSeq;
    if (refreshed) {
      job.locProbeAt = null;
      job.locProbeSeq = null;
      saveQ(store);
    }
    return refreshed;
  }

  function logAwaitLocation(job) {
    const now = api._now ? api._now() : Date.now();
    if (job.awaitLocLogAt == null || now - job.awaitLocLogAt >= BEACON_MS) {
      job.awaitLocLogAt = now;
      api.game_log("dlv:await_loc");
      saveQ(store);
    }
  }

  async function deliverActive() {
    const job = store.active;
    if (!job) return;
    if ((api._now ? api._now() : Date.now()) - (job.activeAt || job.t0) > JOB_MS) {
      api.game_log("dlv:job_ttl");
      store.active = null;
      saveQ(store);
      await retreatPlaza();
      return;
    }

    closeStandIfOpen();
    if (job.gear) {
      const hasGear = (api.character.items || []).some(
        (it) =>
          it &&
          it.name === job.gear.name &&
          (it.level || 0) === (job.gear.level || 0)
      );
      if (!hasGear && (await ensureGearInBag(job.gear)) < 0) {
        await abortDelivery(job, "gear_missing");
        return;
      }
    }
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
    if (!(await ensureDeliveryWorld(job))) return;
    if (!job.routeConfirmed) {
      if (!(await refreshDeliveryLocation(job, "preflight"))) {
        logAwaitLocation(job);
        return;
      }
      job.routeConfirmed = 1;
      saveQ(store);
    }
    if (job.reroutePending) {
      job.reroutePending = null;
      saveQ(store);
      await retreatPlaza();
      return;
    }

    if (job.kind === "dlv_pots" && !job.bought) {
      // Buy the delivery quantity plus Puppygirl's personal reserve; the send
      // loop below transfers only the requested amount.
      let ok = await buyPots(job.items, POTION_TARGET);
      // Fighter survival wins when current gold can fund the delivery but not
      // both delivery and a brand-new merchant reserve. Refill self when idle.
      if (ok === "float") ok = await buyPots(job.items, 0);
      if (ok === true) {
        job.bought = 1;
        saveQ(store);
      } else if (ok === "float") {
        const now = api._now ? api._now() : Date.now();
        if (!job.scoopUntil || now >= job.scoopUntil) {
          const got = await scoopGoldForBuy(job, potBuyNeedGold(job.items, 0));
          // Retry sooner after a failed scoop (no_vision / path); longer after a try.
          job.scoopUntil = now + (got ? 45000 : 8000);
          saveQ(store);
        }
      }
      if (!job.bought) return;
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
      if (!(await leaveBankToPlaza())) return;
    }

    if (
      (job.kind === "hunter_upgrade" || job.kind === "progression_upgrade") &&
      !job.pickupDone
    ) {
      const requestedItems =
        job.kind === "hunter_upgrade" ? job.hunterItems || [] : job.upgradeItems || [];
      const requested = new Set(
        requestedItems.map((x) => x.name + "@" + (x.level || 0))
      );
      const held = (api.character.items || []).filter(
        (it) => it && requested.has(it.name + "@" + (it.level || 0))
      ).length;
      if (requested.size && held > 0) {
        job.pickupDone = 1;
        if (gearAds[job.who]) gearAds[job.who]._t = 0;
        store.active = null;
        saveQ(store);
        api.game_log(
          (job.kind === "hunter_upgrade" ? "hunter:upgrade_received " : "gear:progress_received ") +
            job.who +
            " n=" +
            held +
            " delayed=1"
        );
        await api.send_cm(job.who, { dlv_done: 1, id: job.id, ok: 1 });
        await retreatPlaza();
        return;
      }
    }

    const takeBackNeed =
      job.kind === "hunter_upgrade" || job.kind === "progression_upgrade"
        ? Math.max(3, (job.pickupCount || 0) + 1)
        : 3;
    if (!(await ensureTakeBackSlots(takeBackNeed, job.gear && job.pulled ? job.gear : null))) return;

    let meet = meetResolveDelivery(api, job, SEND_RANGE);
    const locateAt = api._now ? api._now() : Date.now();
    const staleLocation = job.locAt == null || locateAt - job.locAt > BEACON_MS * 2;
    if (staleLocation) {
      if (!(await refreshDeliveryLocation(job, "enroute"))) {
        logAwaitLocation(job);
        return;
      }
      meet = meetResolveDelivery(api, job, SEND_RANGE);
    } else {
      await api.send_cm(job.who, {
        status: 1,
        id: job.id,
        phase: "enroute",
        meet: 1,
        map: meet ? meet.map : api.character.map,
        x: meet ? meet.x : api.character.real_x,
        y: meet ? meet.y : api.character.real_y,
      });
    }

    const routeFarm = job.farm;
    if (meet) {
      api.game_log("dlv:meet " + meet.map + " " + Math.round(meet.x) + "," + Math.round(meet.y));
      const r = await fieldMove(meet, { farm: job.farm });
      if (r && r.failed) {
        api.game_log("dlv:path_fail");
        await api.send_cm(job.who, { nack: "path", id: job.id });
        return;
      }
    }

    // A route can take long enough for the party to switch packs. Reconfirm
    // after arrival before treating lost vision as an empty delivery.
    if (!api.get_player(job.who) && (await refreshDeliveryLocation(job, "arrived"))) {
      if (job.reroutePending) return;
      const revised = meetResolveDelivery(api, job, SEND_RANGE);
      if (
        revised &&
        (!meet ||
          job.farm !== routeFarm ||
          revised.map !== meet.map ||
          Math.hypot(revised.x - meet.x, revised.y - meet.y) > SEND_RANGE)
      ) {
        return;
      }
    } else if (!api.get_player(job.who)) {
      logAwaitLocation(job);
      return;
    }

    // Approach to send range outside pack; fighter stays farming.
    let t = await ensureSendRange(job.who, { farm: job.farm });
    if (!t) {
      if (job.kind === "dlv_pots") await noteEmptySend(job);
      else await retreatPlaza();
      return;
    }

    if (
      (job.kind === "hunter_upgrade" || job.kind === "progression_upgrade") &&
      !job.pickupDone
    ) {
      const requestedItems =
        job.kind === "hunter_upgrade" ? job.hunterItems || [] : job.upgradeItems || [];
      const names = new Set(requestedItems.map((x) => x.name + "@" + (x.level || 0)));
      const countHeld = () =>
        (api.character.items || []).filter(
          (it) => it && names.has(it.name + "@" + (it.level || 0))
        ).length;
      const before = countHeld();
      const expected = names.size;
      await api.send_cm(job.who, {
        dlv_loot_q: 1,
        id: job.id,
        hunter_upgrade: job.kind === "hunter_upgrade" ? 1 : 0,
        progression_upgrade: job.kind === "progression_upgrade" ? 1 : 0,
        upgrade_items: requestedItems,
        hunter_items: job.hunterItems || [],
      });
      for (let n = 0; n < 12 && countHeld() < expected; n++) {
        if (typeof opts.peerTick === "function") await opts.peerTick();
        else await api.sleep(250);
      }
      const held = countHeld();
      const remaining =
        job.kind === "hunter_upgrade"
          ? hunterUpgradeAdItems(job.who)
          : progressionAdItems(job.who);
      if (held < 1 && remaining.length) {
        api.game_log(
          (job.kind === "hunter_upgrade" ? "hunter:upgrade_wait " : "gear:progress_wait ") +
            job.who
        );
        return;
      }
      job.pickupDone = 1;
      if (gearAds[job.who]) gearAds[job.who]._t = 0;
      store.active = null;
      saveQ(store);
      api.game_log(
        (job.kind === "hunter_upgrade" ? "hunter:upgrade_received " : "gear:progress_received ") +
          job.who +
          " n=" +
          held +
          (before ? " preheld=" + before : "")
      );
      await api.send_cm(job.who, { dlv_done: 1, id: job.id, ok: 1 });
      await retreatPlaza();
      return;
    }

    // Allow fighter gold_offload ticks while in range (merchant stays funded).
    {
      const waitUntil = (api._now ? api._now() : Date.now()) + 3500;
      while ((api._now ? api._now() : Date.now()) < waitUntil) {
        const f = api.get_player(job.who) || t;
        if (!f || (f.gold || 0) <= GOLD_FLOAT_FIGHTER + 500) break;
        try {
          await api.send_cm(job.who, { dlv_loot_q: 1, id: job.id || null });
        } catch (e) {}
        if (typeof opts.peerTick === "function") await opts.peerTick();
        else await api.sleep(400);
      }
    }

    t = api.get_player(job.who) || t;
    if ((t.gold || 0) < GOLD_FLOAT_FIGHTER) {
      try {
        api.send_gold(job.who, GOLD_FLOAT_FIGHTER - (t.gold || 0));
        api.game_log("gold_topup");
      } catch (e) {}
    }

    let sentPots = 0;
    const sendNeed = {};
    for (const want of job.items || []) {
      if (!want || (want.name !== "hpot1" && want.name !== "mpot1")) continue;
      sendNeed[want.name] = (sendNeed[want.name] || 0) + (want.q || POTION_TARGET);
    }
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (!it) continue;
      if (it.name !== "hpot1" && it.name !== "mpot1") continue;
      const sendQ = Math.min(it.q == null ? 1 : it.q, sendNeed[it.name] || 0);
      if (sendQ <= 0) continue;
      try {
        // Refresh range right before each send — fighter may still be pathing.
        if (playerDist(api.get_player(job.who) || t) > (SEND_RANGE || 320)) {
          t = await ensureSendRange(job.who, { farm: job.farm });
          if (!t) break;
        }
        closeStandIfOpen();
        const sr = await api.send_item(job.who, i, sendQ);
        if (sr && sr.failed) {
          api.game_log("dlv:send_fail " + it.name + (sr.reason ? " " + sr.reason : ""));
          if (sr.reason === "distance" || sr.reason === "stand_open") {
            t = await ensureSendRange(job.who, { farm: job.farm });
            if (!t) break;
            i--; // retry same slot
            continue;
          }
          continue;
        }
        api.game_log("dlv:send " + it.name + " id=" + job.id);
        sendNeed[it.name] -= sendQ;
        sentPots++;
      } catch (e) {
        api.game_log("dlv:send_fail " + it.name);
      }
    }

    if (job.kind === "dlv_pots" && sentPots === 0) {
      await noteEmptySend(job);
      return;
    }

    if (job.gear) {
      t = await ensureSendRange(job.who, { farm: job.farm });
      if (!t) {
        api.game_log("dlv:gear_far");
        return;
      }
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
            progression: !!job.gear.progression,
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
    // Leave pack staging immediately — lingering gets aggroed.
    await retreatPlaza();
    // Bank fighter take-backs / replaced gear (may be upgrade-eligible — force park).
    if (bagParkables(null, { skipUpgrades: false }).length) {
      await parkToBank(null, { skipUpgrades: false });
    }
  }

  async function tick() {
    if (!api._now) api._now = () => (opts.now ? opts.now() : Date.now());
    if (busy) return;
    busy = true;
    try {
      // Live: merchant dies on pack during dlv — respawn, abort job, retreat (2026-09-09).
      if (api.character.rip) {
        api.game_log("rip:respawn");
        try {
          if (typeof api.respawn === "function") await api.respawn();
        } catch (e) {}
        if (typeof api.sleep === "function") await api.sleep(1000);
        if (store.active && (store.active.kind === "dlv_pots" || store.active.kind === "dlv_gear")) {
          const j = store.active;
          api.game_log("dlv:rip_abort id=" + j.id);
          try {
            await api.send_cm(j.who, { dlv_done: 1, id: j.id, ok: 0, reason: "rip" });
          } catch (e) {}
          store.active = null;
          saveQ(store);
        }
        await retreatPlaza();
        return;
      }
      await maybeUsePots(api);
      if (
        store.hunterRequested &&
        !store.active &&
        !store.q.length &&
        api._now() >= (store.hunterRetryAt || 0)
      ) {
        const result = await startHunterPlan(true);
        if (
          result.success ||
          ["tokens", "catalog", "wrong_owner", "no_space"].indexOf(result.reason) >= 0
        ) {
          store.hunterRequested = null;
        } else {
          store.hunterRetryAt = api._now() + 5000;
        }
        saveQ(store);
        return;
      }
      // Snapshot vault before any stall/park so live-blind main can see sell junk.
      await primeBankHint();
      // Park tossed gear before next delivery (sell junk reserved for tryVendorNpc).
      // Bank below-gate upgrades when idle (no stand lock for junk listing).
      const xynSoon =
        (api.character.items || []).some((it) => it && EXCHANGE_ITEMS.indexOf(it.name) >= 0) ||
        listBankItems().some((it) => EXCHANGE_ITEMS.indexOf(it.name) >= 0);
      if (!store.active && !api.character.stand && !xynSoon) {
        const junkSoon =
          countSellJunk(api.character.items) +
            countSellJunkBank(api.character.bank || api.character._bank) >
          0;
        if (!store.q.length && junkSoon) {
          if (await tryVendorNpc()) return;
          if ((api.character.esize || 0) < 1 && (await freeEmergencySlot())) return;
          // A full bag cannot retrieve bank junk. Compact one local triple only
          // to bootstrap a slot, then the next tick returns to vendoring first.
          if ((api.character.esize || 0) < 1 && (await tryCombineOne())) return;
        }
        if (junkSoon && bagParkables(null, { onlyBelowGate: true }).length) {
          await parkToBank(null, { onlyBelowGate: true });
        }
        if (bagParkables().length) {
          const cleared = await parkToBank();
          if (!cleared && bagParkables().length) {
            const n = api._now ? api._now() : Date.now();
            if (lastParkFailAt == null || n - lastParkFailAt >= PARK_FAIL_BACKOFF_MS - 50) {
              api.game_log("bank:park_stuck");
            }
          }
        }
      }
      // Stall only from idleEcon when truly idle — opening here caused flash open→close on dequeue.
      if (!store.active && !store.q.length) {
        if (!enqueueHunterUpgradePickup() && !enqueueProgressionUpgradePickup()) {
          enqueueSaturationPickup();
        }
      }
      if (!store.active && store.q.length) {
        store.active = store.q.shift();
        store.active.activeAt = api._now();
        saveQ(store);
        api.game_log("dlv:active " + store.active.kind + " -> " + store.active.who);
      }
      if (store.active) await deliverActive();
      else await idleEcon();
      emitMetrics();
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

  /** First present non-rip fighter in LEADER_ORDER (merchant may see party on same server). */
  function fighterLead() {
    const party = api.get_party() || {};
    const present = Object.keys(party).filter(
      (n) => FIGHTERS.indexOf(n) >= 0 && !(party[n] && party[n].rip)
    );
    for (const n of LEADER_ORDER) {
      if (present.indexOf(n) >= 0) return n;
    }
    return present[0] || LEADER_ORDER[0];
  }

  function cmFighters(payload) {
    for (const n of FIGHTERS) {
      try {
        api.send_cm(n, payload);
      } catch (e) {}
    }
  }

  /** Retry CM once after a beat — live saw first hunt_quest fan-out miss all fighters. */
  function cmFightersReliable(payload, tag) {
    cmFighters(payload);
    const again = function () {
      try {
        cmFighters(payload);
        if (tag) api.game_log(tag + ":cm_retry");
      } catch (e) {}
    };
    if (typeof api.setTimeout === "function") api.setTimeout(again, 800);
    else if (typeof setTimeout === "function") setTimeout(again, 800);
  }

  function hunt(mob) {
    const k = ("" + (mob || "")).toLowerCase().replace(/[^a-z0-9_]/g, "");
    const ban = ["spider", "scorpion", "bigbird"];
    if (!k) return;
    if (ban.indexOf(k) >= 0) {
      api.set_message("Skip " + k);
      api.game_log("Hunt skipped " + k);
      return;
    }
    // Fan-out like hold — lead applies setIntent; works under succession / cross-server.
    cmFighters({ hunt: k });
    api.set_message("Hunt " + k);
    api.game_log("Hunt " + k + " lead~" + fighterLead());
  }
  /** Daisy Monster Hunt chain on/off — party lead runs accept→farm→turn-in. */
  function hunt_quest(on) {
    const en =
      on === undefined || on === null
        ? true
        : !(on === 0 || on === false || on === "0" || on === "off" || on === "false");
    // Fan-out + retry — live 2026-09-09: first hunt_quest CM missed all fighters.
    cmFightersReliable({ hunt_quest: en ? 1 : 0 }, "hunt_quest");
    api.set_message(en ? "HQ on" : "HQ off");
    api.game_log("hunt_quest " + (en ? "on" : "off"));
  }
  function grind() {
    cmFighters({ grind: 1 });
    api.set_message("Grind");
    api.game_log("Grind sent lead~" + fighterLead());
  }
  function hold() {
    cmFighters({ hold: 1 });
    enqueue({ id: "hold_" + (api._now ? api._now() : Date.now()), kind: "meet_home", who: "party" });
    api.set_message("Hold");
    api.game_log("Hold sent");
  }
  function resume() {
    cmFighters({ hold: 0 });
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
    cmFighters({ world: s });
    api.set_message("W " + s[0] + "/" + s[1]);
    api.game_log("World " + s[0] + "/" + s[1] + " lead~" + fighterLead());
  }

  return {
    tick,
    usePots: () => maybeUsePots(api),
    enqueue,
    hunt,
    hunt_quest,
    grind,
    hold,
    resume,
    world,
    startHunterPlan,
    fighterLead,
    avoidFailPolicy,
    get store() {
      return store;
    },
    get gearAds() {
      return gearAds;
    },
  };
}

module.exports = { bootMerchant, avoidFailPolicy };
