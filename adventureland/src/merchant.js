"use strict";

const {
  FIGHTERS,
  LEADER_ORDER,
  FARM,
  HOME,
  JOB_MS,
  POTION_TARGET,
  GOLD_FLOAT_FIGHTER,
  GOLD_FLOAT_MERCHANT,
  COMBINE_PRIORITY,
  MIN_UPGRADE_CHANCE,
  SEND_RANGE,
  EXCHANGE_ITEMS,
  VENDOR_NPC,
  GEAR_TARGETS,
  PONTY_WANT,
  PONTY_MULT,
  CRAFT_TARGETS,
} = require("./constants");
const {
  isSellJunk,
  isGearPiece,
  isGearTargetName,
  planGifts,
  pickUpgradeIndex,
  scrollFor,
  upgradeChance,
  planVendorBuy,
  eligibleUpgrade,
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
  meetResolveDelivery,
  meetTransitBlockers,
  meetTransitBlockerFilter,
} = require("./merchant_meet");

/**
 * Merchant logistics under Jazwyn command.
 * Idle on farm world; hops only for meet_home / to reach fighters.
 * When idle: vendor junk → Xyn exchange → Ponty → craft tools → upgrade/combine/park/gift.
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
  let giftBusy = false;
  let lastParkFailAt = null;
  const PARK_FAIL_BACKOFF_MS = 15000;
  /** Once-only gear:upgrade_skip logs per name@level (burn-in 60s spam). */
  const upgradeSkipLogAt = {};
  let bankHintPrimed = false;
  const metrics = { t0: 0, gold0: 0, emitCount: 0 };

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

  async function primeBankHint() {
    if (api.character._bank || api.character.bank) {
      bankHintPrimed = true;
      return true;
    }
    if (bankHintPrimed) return false;
    // Never walk bank / closeStand just to hint — that tears down a bag-only stall.
    if (api.character.stand) return false;
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
      const r = await api.smart_move({ map: "main", x: 40, y: -20 });
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
    // Ignore dlv_loc pack beacons — merchant uses safeMeet / meetResolveDelivery.
    // Overwriting job xy with fighter pack coords pulled Puppygirl into aggro.
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
      const price = (api.G.items[it.name] && api.G.items[it.name].g) || 20;
      if ((api.character.gold || 0) - price * buyQ < GOLD_FLOAT_MERCHANT) {
        api.game_log("dlv:buy_float");
        return "float";
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

  /** Gold required to buy remaining pots while keeping GOLD_FLOAT_MERCHANT. */
  function potBuyNeedGold(items) {
    let cost = 0;
    for (const it of items || []) {
      const need = it.q || POTION_TARGET;
      let have = 0;
      for (const bag of api.character.items || []) {
        if (bag && bag.name === it.name) have += bag.q == null ? 1 : bag.q;
      }
      const buyQ = need - have;
      if (buyQ <= 0) continue;
      const price = (api.G.items[it.name] && api.G.items[it.name].g) || 20;
      cost += price * buyQ;
    }
    return GOLD_FLOAT_MERCHANT + cost;
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
      api.game_log("dlv:need_space esize=" + (api.character.esize || 0));
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
      if (EXCHANGE_ITEMS.indexOf(it.name) >= 0) continue;
      if (isVendorNpcName(it.name)) continue;
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
      if (opts.onlyBelowGate) {
        if (!(eligibleUpgrade(it, api.G) && upgradeChance(it) < MIN_UPGRADE_CHANCE)) continue;
        out.push(i);
        continue;
      }
      // Idle / pre-dequeue park skips all scroll0-upgrade candidates so tryUpgradeOne
      // can log skip or upgrade. After that, idleEcon force-parks below-gate pieces.
      if (opts.skipUpgrades !== false && eligibleUpgrade(it, api.G)) continue;
      // Compound accessories must park even if G.type is missing on a blind tick.
      const combineName = COMBINE_PRIORITY.indexOf(it.name) >= 0;
      if (isSellJunk(it, api.G) || isGearPiece(it, api.G) || combineName) out.push(i);
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
    const gifts = planGifts(listGiftables(), { [job.who]: ad }, api.G).filter((g) => g.who === job.who);
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

  function countSellJunk(items) {
    let n = 0;
    for (const it of items || []) {
      if (it && isVendorNpcName(it.name)) n++;
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
    const plaza = { map: "main", x: 40, y: -20 };
    const r = await api.smart_move(plaza);
    if (r && r.failed) {
      api.game_log("bank:exit_fail");
      return false;
    }
    return true;
  }

  function isVendorNpcName(name) {
    return VENDOR_NPC.indexOf(name) >= 0;
  }

  function isTradeReclaimName(name) {
    if (!name) return false;
    if (isVendorNpcName(name)) return true;
    if (isGearTargetName(name)) return true;
    return false;
  }

  /** Pull listed stall junk / goal gear into bag (stand must be open for trade unequip). */
  async function reclaimTradeJunk() {
    const slots = api.character.slots || {};
    const junkSlots = [];
    for (let s = 1; s <= 16; s++) {
      const it = slots["trade" + s];
      if (it && isTradeReclaimName(it.name)) junkSlots.push(s);
    }
    if (!junkSlots.length) return 0;
    if (!api.character.stand) {
      if (typeof api.open_stand === "function") api.open_stand();
      else if (api.parent && api.parent.open_merchant) api.parent.open_merchant();
      if (typeof api.sleep === "function") await api.sleep(150);
    }
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
      return api.character.items.findIndex((x) => x && isVendorNpcName(x.name));
    }

    let i = findBagJunk();
    if (i < 0) {
      const hint = api.character.bank || api.character._bank;
      let any = listBankItems().some((e) => isVendorNpcName(e.name));
      if (!any && hint) {
        for (const p of Object.keys(hint)) {
          if (p === "gold" || !Array.isArray(hint[p])) continue;
          if (hint[p].some((x) => x && isVendorNpcName(x.name))) {
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
      const hit = listBankItems()
        .filter((e) => isVendorNpcName(e.name))
        .sort((a, b) => {
          const ia = VENDOR_NPC.indexOf(a.name);
          const ib = VENDOR_NPC.indexOf(b.name);
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

  function hasUpgradeableOwned() {
    if (pickUpgradeIndex(api.character.items, api.G) >= 0) return true;
    return listBankItems().some((e) => {
      const it = { name: e.name, level: e.level || 0 };
      return eligibleUpgrade(it, api.G) && upgradeChance(it) >= MIN_UPGRADE_CHANCE;
    });
  }

  /** Exchange one gem0 / anniversarygift with Xyn (idle bank clean). */
  async function tryExchangeOne() {
    if (typeof api.exchange !== "function") return false;
    const names = EXCHANGE_ITEMS;

    function findBagSlot() {
      for (let i = 0; i < api.character.items.length; i++) {
        const it = api.character.items[i];
        if (!it || names.indexOf(it.name) < 0) continue;
        const need = ((api.G.items && api.G.items[it.name]) || {}).e || 1;
        const q = it.q == null ? 1 : it.q;
        if (q >= need) return i;
      }
      return -1;
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

  /** Idle: craft one pickaxe / fishing rod (`rod`) at Leo when mats+gold allow. */
  async function tryCraftOne() {
    if (typeof api.auto_craft !== "function") return false;
    const recipes = (api.G && api.G.craft) || {};
    const targets = CRAFT_TARGETS || [];
    for (const name of targets) {
      const rec = recipes[name];
      if (!rec || !Array.isArray(rec.items)) continue;
      if (craftHave(name) >= 1) continue;

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
        api.game_log("craft:gold " + name);
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
      if ((api.character.esize || 0) < 1) {
        await parkToBank(null, { skipUpgrades: false });
        if ((api.character.esize || 0) < 1) {
          api.game_log("craft:no_space");
          return false;
        }
      }

      if (!(await goNpc({ to: "craftsman" }, { map: "main", x: 92, y: 670 }, "craft:path_fail"))) {
        return false;
      }
      try {
        const r = await api.auto_craft(name);
        if (r && r.failed) {
          api.game_log("craft:fail " + name + " " + (r.reason || ""));
          return false;
        }
        api.game_log("craft:ok " + name);
        return true;
      } catch (e) {
        api.game_log("craft:fail " + name);
        return false;
      }
    }
    return false;
  }

  /** Buy one vendor base piece for an advertised empty/weak slot (no bank cover). */
  async function tryBuyVendorBase() {
    if (hasUpgradeableOwned()) return false;
    const ads = {};
    for (const who of FIGHTERS) {
      if (gearAds[who] && gearAds[who].slots) ads[who] = gearAds[who];
    }
    if (!Object.keys(ads).length) return false;
    const plan = planVendorBuy(ads, ownedGearList(), api.G);
    if (!plan) return false;
    const price = (api.G.items[plan.name] && api.G.items[plan.name].g) || 800;
    const scrollPrice = (api.G.items.scroll0 && api.G.items.scroll0.g) || 1000;
    const haveScroll = (api.character.items || []).some((x) => x && x.name === "scroll0");
    const need = price + (haveScroll ? 0 : scrollPrice);
    if (spendableGold() < need) {
      api.game_log("gear:buy_gold");
      return false;
    }
    if ((api.character.esize || 0) < 1) {
      await parkToBank();
      if ((api.character.esize || 0) < 1) return false;
    }
    if (!(await goNpc({ map: "main", x: 56, y: -122 }, null, "gear:vendor_path_fail"))) {
      return false;
    }
    const bought = await api.buy(plan.name, 1);
    if (bought && bought.failed) {
      api.game_log("gear:buy_fail " + plan.name);
      return false;
    }
    api.game_log("gear:buy " + plan.name + "@0 for " + plan.who);
    return true;
  }

  /** One conservative scroll0 upgrade (chance ≥ MIN, max +5, allowlist). */
  async function tryUpgradeOne() {
    let i = pickUpgradeIndex(api.character.items, api.G);
    if (i < 0) {
      // Bag has only below-gate pieces: log once per piece key, then leave for park.
      // Silent while stall locks parkToBank — otherwise burn-in spammed every minute.
      const low = (api.character.items || []).findIndex(
        (it) => eligibleUpgrade(it, api.G) && upgradeChance(it) < MIN_UPGRADE_CHANCE
      );
      if (low >= 0) {
        if (!api.character.stand) {
          const it = api.character.items[low];
          logUpgradeSkip(it.name, it.level || 0, upgradeChance(it));
        }
        return false;
      }
      // Bank: only pull pieces we would actually upgrade. Never skip-spam on bank junk.
      const bankHit = listBankItems().find((e) => {
        const it = { name: e.name, level: e.level || 0 };
        return eligibleUpgrade(it, api.G) && upgradeChance(it) >= MIN_UPGRADE_CHANCE;
      });
      if (!bankHit) return false;
      if ((api.character.esize || 0) < 1) await parkToBank();
      const bagI = await ensureGearInBag({ name: bankHit.name, level: bankHit.level || 0 });
      if (bagI < 0) return false;
      i = pickUpgradeIndex(api.character.items, api.G);
      if (i < 0) return false;
    }
    const it = api.character.items[i];
    const scn = scrollFor(it, api.G);
    if (!scn) return false;
    const chance = upgradeChance(it);
    if (chance < MIN_UPGRADE_CHANCE) {
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
        i = pickUpgradeIndex(api.character.items, api.G);
        if (i < 0) return false;
      }
      if (!(await goUpgradeNpc())) {
        api.game_log("gear:upgrade_path_fail");
        return false;
      }
      const br = await api.buy(scn, 1);
      if (br && br.failed) {
        api.game_log("gear:scroll_buy_fail");
        return false;
      }
      api.game_log("gear:buy " + scn);
      sci = api.character.items.findIndex((x) => x && x.name === scn);
      i = pickUpgradeIndex(api.character.items, api.G);
      if (sci < 0 || i < 0) return false;
    }
    if (typeof api.upgrade !== "function") return false;
    if (!(await goUpgradeNpc())) {
      api.game_log("gear:upgrade_path_fail");
      return false;
    }
    try {
      const preview = await api.upgrade(i, sci, null, true);
      if (!preview || preview.chance == null || preview.chance < MIN_UPGRADE_CHANCE) {
        const cur = api.character.items[i];
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
    i = pickUpgradeIndex(api.character.items, api.G);
    sci = api.character.items.findIndex((x) => x && x.name === scn);
    if (i < 0 || sci < 0) return false;
    const before = api.character.items[i];
    const nm = before.name;
    const lv0 = before.level || 0;
    try {
      const r = await api.upgrade(i, sci);
      if (r && r.failed) {
        api.game_log("gear:upgrade_fail " + nm + "@" + lv0);
        return false;
      }
      const after = api.character.items[i];
      const lv1 = after && after.name === nm ? after.level || 0 : -1;
      api.game_log("gear:upgrade " + nm + "@" + lv0 + "->" + lv1);
      return true;
    } catch (e) {
      api.game_log("gear:upgrade_fail " + nm);
      return false;
    }
  }

  /** One compound from bag/bank triples (idle bank clean). */
  async function tryCombineOne() {
    if (typeof api.compound !== "function") return false;
    const bags = [api.character.items || []];
    const bankHint = api.character.bank || api.character._bank;
    if (bankHint) {
      for (const p of Object.keys(bankHint)) {
        if (p !== "gold" && Array.isArray(bankHint[p])) bags.push(bankHint[p]);
      }
    }
    const cand = planCompounds(bags, api.G, COMBINE_PRIORITY);
    if (!cand.length) return false;
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
      while (!bagThree() && (api.character.esize || 0) > 0) {
        const hit = listBankItems().find(
          (e) => e.name === target.name && (e.level || 0) === target.level
        );
        if (!hit) break;
        await api.bank_retrieve(hit.pack, hit.i);
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
          await api.sell(i);
          freed = true;
          break;
        }
        if (!freed || (api.character.esize || 0) < 1) {
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
      const br = await api.buy(scn, 1);
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
      return true;
    } catch (e) {
      api.game_log("bank:compound_fail " + target.name);
      return false;
    }
  }

  async function idleEcon() {
    await ensureFarmWorld();
    // Live has no _bank until we visit once — without this, vendor/gift are blind on main.
    await primeBankHint();
    // NPC-vendor cheap junk first (reclaim trade slots) before Xyn burns idle ticks.
    try {
      if (await tryVendorNpc()) return;
    } catch (e) {
      api.game_log("vendor:err " + ((e && e.message) || e));
    }
    // Xyn exchange — one gem0 / anniversarygift per idle pass.
    try {
      if (await tryExchangeOne()) return;
    } catch (e) {
      api.game_log("xyn:err " + ((e && e.message) || e));
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
    if (await tryBuyVendorBase()) return;
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

  async function deliverActive() {
    const job = store.active;
    if (!job) return;
    if ((api._now ? api._now() : Date.now()) - job.t0 > JOB_MS) {
      api.game_log("dlv:job_ttl");
      store.active = null;
      saveQ(store);
      await retreatPlaza();
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
      if (ok === true) {
        job.bought = 1;
        saveQ(store);
      } else if (ok === "float") {
        const now = api._now ? api._now() : Date.now();
        if (!job.scoopUntil || now >= job.scoopUntil) {
          const got = await scoopGoldForBuy(job, potBuyNeedGold(job.items));
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
      const out = await api.smart_move({ map: "main", x: 40, y: -20 });
      if (out && out.failed) {
        api.game_log("dlv:bank_exit_fail");
        return;
      }
    }

    if (!(await ensureTakeBackSlots(3, job.gear && job.pulled ? job.gear : null))) return;

    const meet = meetResolveDelivery(api, job, SEND_RANGE);
    await api.send_cm(job.who, {
      status: 1,
      id: job.id,
      phase: "enroute",
      meet: 1,
      map: meet ? meet.map : api.character.map,
      x: meet ? meet.x : api.character.real_x,
      y: meet ? meet.y : api.character.real_y,
    });

    if (meet) {
      api.game_log("dlv:meet " + meet.map + " " + Math.round(meet.x) + "," + Math.round(meet.y));
      const r = await fieldMove(meet, { farm: job.farm });
      if (r && r.failed) {
        api.game_log("dlv:path_fail");
        await api.send_cm(job.who, { nack: "path", id: job.id });
        return;
      }
    }

    // Approach to send range outside pack; fighter stays farming.
    let t = await ensureSendRange(job.who, { farm: job.farm });
    if (!t) {
      if (job.kind === "dlv_pots") await noteEmptySend(job);
      else await retreatPlaza();
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
    for (let i = 0; i < api.character.items.length; i++) {
      const it = api.character.items[i];
      if (!it) continue;
      if (it.name !== "hpot1" && it.name !== "mpot1") continue;
      try {
        // Refresh range right before each send — fighter may still be pathing.
        if (playerDist(api.get_player(job.who) || t) > (SEND_RANGE || 320)) {
          t = await ensureSendRange(job.who, { farm: job.farm });
          if (!t) break;
        }
        closeStandIfOpen();
        const sr = await api.send_item(job.who, i, it.q == null ? 1 : it.q);
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
      // Snapshot vault before any stall/park so live-blind main can see sell junk.
      await primeBankHint();
      // Park tossed gear before next delivery (sell junk reserved for tryVendorNpc).
      // Bank below-gate upgrades when idle (no stand lock for junk listing).
      if (!store.active && !api.character.stand) {
        const junkSoon =
          countSellJunk(api.character.items) +
            countSellJunkBank(api.character.bank || api.character._bank) >
          0;
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
      if (!store.active && store.q.length) {
        store.active = store.q.shift();
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
    enqueue,
    hunt,
    hunt_quest,
    grind,
    hold,
    resume,
    world,
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
