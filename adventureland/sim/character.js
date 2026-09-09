"use strict";

const { dist, isBlocked, VISION_PX, SEND_ITEM_RANGE, LOOT_RANGE, packCenter, NPC, FARM_XY } = require("./world");
const { findPath } = require("./path");
const { createStorage } = require("./storage");
const knobs = require("./knobs");
const {
  DAISY_RANGE,
  HUNT_DURATION_MS,
  DEFAULT_HUNT_COUNT,
  formatHuntSn,
  canAcceptHunts,
} = require("../src/monsterhunt");

const WALK_PX_PER_S = knobs.WALK_PX_PER_S;
const CROSS_MAP_BASE_MS = knobs.CROSS_MAP_BASE_MS;
const TOWN_MS = knobs.TOWN_MS;
const RECONNECT_MS = knobs.RECONNECT_MS;
const SERVER_REGION_DELAY_MS = knobs.SERVER_REGION_DELAY_MS;
const PATH_SAMPLE_MS = knobs.PATH_SAMPLE_MS;

function makeCharState(over) {
  return Object.assign(
    {
      name: "Hero",
      ctype: "warrior",
      level: 40,
      hp: 2000,
      max_hp: 2000,
      mp: 400,
      max_mp: 400,
      gold: 5000,
      map: "main",
      rip: false,
      esize: 20,
      range: 40,
      attack: 95,
      target: null,
      real_x: 0,
      real_y: 0,
      x: 0,
      y: 0,
      items: new Array(42).fill(null),
      slots: {},
      q: {},
      s: {},
      ping: 40,
      party: null, // set of names, or null
      target: null,
      angle: 0,
      bank: null,
      _bank: null,
      stand: false,
      connected: true,
      reconnectUntil: 0,
      serverRegionReadyAt: 0,
    },
    over
  );
}

/**
 * One simulated character bound to a WorldServer.
 * Heap fields reset on change_server; storage survives.
 */
function createCharacter(world, over) {
  const storage = createStorage(over && over._storage);
  if (over && over._storage) delete over._storage;
  const c = makeCharState(over);
  const smart = { moving: false, map: null, x: null, y: null, failInject: null };
  /** When true, bare bank_store(i) rejects like Mainframe (`invalid`); pack required. */
  let bankStoreBareInvalid = false;
  const log = {
    game: [],
    said: [],
    pm: [],
    cm: [],
    moved: [],
    path: [],
    server: [],
    sent: [],
    gold: [],
    bought: [],
    skills: [],
    equipped: [],
    looted: [],
    traded: [],
    retrieved: [],
  };
  let heapAlive = true;

  function serverKey() {
    return world.region + "/" + world.ident;
  }

  function place(map, x, y) {
    c.map = map;
    c.real_x = x;
    c.x = x;
    c.real_y = y;
    c.y = y;
    if (map !== "bank") {
      if (c.bank) c._bank = c.bank;
      c.bank = null;
    } else if (!c.bank) {
      c.bank = c._bank || { gold: 0, items0: new Array(42).fill(null) };
    }
  }

  function travelMs(from, to) {
    if (from.map !== to.map) {
      return CROSS_MAP_BASE_MS + Math.floor(dist(from, to));
    }
    return Math.max(200, Math.floor((dist(from, to) / WALK_PX_PER_S) * 1000));
  }

  function advanceTime(ms) {
    if (typeof world.oweTime === "function") world.oweTime(ms);
    else world.clock.advance(ms);
  }

  const api = {
    character: c,
    smart,
    log,
    storage,
    G: world.G,
    parent: {
      get entities() {
        return world.entitiesOn(serverKey(), c.map);
      },
      get party() {
        return world.partyOf(c.name);
      },
      get server_region() {
        if (world.clock.now() < c.serverRegionReadyAt) return null;
        return world.region;
      },
      get server_identifier() {
        if (world.clock.now() < c.serverRegionReadyAt) return null;
        return world.ident;
      },
      distance: dist,
      open_merchant() {
        c.stand = true;
      },
      close_merchant() {
        c.stand = false;
      },
    },

    game_log(m) {
      log.game.push({ t: world.clock.now(), m: "" + m });
    },
    set_message(m) {
      c._msg = m;
    },

    party_say(message) {
      const r = world.comms.trySay({ name: c.name, message, code: true, kind: "party" });
      if (!r.ok) {
        log.game.push({ t: world.clock.now(), m: "You can't chat this fast." });
        return r;
      }
      log.said.push(message);
      world.broadcastParty(c.name, message);
      return r;
    },

    pm(to, message) {
      const r = world.comms.trySay({ name: c.name, message, code: true, kind: "pm" });
      if (!r.ok) {
        log.game.push({ t: world.clock.now(), m: "You can't chat this fast." });
        return r;
      }
      log.pm.push({ to, message });
      world.deliverPm(c.name, to, message);
      return r;
    },

    async send_cm(to, message) {
      world.comms.bumpCall(c.name);
      const names = Array.isArray(to) ? to : [to];
      const receivers = [];
      for (const n of names) {
        if (world.deliverCm(c.name, n, message)) receivers.push(n);
      }
      const clk = world.clock;
      clk._evt = (clk._evt || 0) + 1;
      log.cm.push({ t: clk.now(), i: clk._evt, to: names, message, receivers });
      return { receivers, locals: [] };
    },

    get_player(name) {
      if (name === c.name) return c;
      const e = world.entity(serverKey(), name);
      if (!e || e.map !== c.map) return null;
      if (dist(c, e) > VISION_PX) return null;
      return e;
    },

    get_party() {
      return world.partyOf(c.name);
    },

    get_nearest_monster(args) {
      args = args || {};
      let best = null,
        bestD = 1e9;
      const ents = world.entitiesOn(serverKey(), c.map);
      for (const id of Object.keys(ents)) {
        const e = ents[id];
        if (!e || e.type !== "monster" || e.dead) continue;
        if (args.type && e.mtype !== args.type) continue;
        if (args.max_att != null && e.attack > args.max_att) continue;
        const d = dist(c, e);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      return best;
    },

    is_in_range(t) {
      return !!t && dist(c, t) <= c.range;
    },
    is_moving() {
      return !!smart.moving;
    },
    can_use() {
      return true;
    },
    is_on_cooldown() {
      return false;
    },

    change_target(t) {
      c.target = t && (t.id || t.name) ? t.id || t.name : null;
    },
    get_targeted_monster() {
      if (!c.target) return null;
      return api.get_monster(c.target);
    },
    get_monster(id) {
      if (!id) return null;
      const ents = world.entitiesOn(serverKey(), c.map);
      const e = ents[id];
      if (e && e.type === "monster" && !e.dead) return e;
      return null;
    },
    can_attack(t) {
      if (!t || t.dead || t.type !== "monster") return false;
      if (!api.is_in_range(t)) return false;
      const gap = (world.G && world.G.attackMs) || knobs.ATTACK_MS || 800;
      return world.clock.now() - (c._lastAttackAt || 0) >= gap;
    },
    attack(t) {
      if (!api.can_attack(t)) return Promise.resolve({ failed: true });
      c._lastAttackAt = world.clock.now();
      c.target = t.id;
      const dmg = c.attack || (c.ctype === "mage" ? 110 : c.ctype === "priest" ? 70 : 95);
      t.hp = Math.max(0, (t.hp != null ? t.hp : t.max_hp || 200) - dmg);
      t.target = c.name;
      log.skills.push("attack:" + t.id);
      api.game_log("hit " + t.mtype + " -" + dmg + " hp=" + t.hp);
      if (t.hp <= 0) {
        t.dead = true;
        t.hp = 0;
        const respawnMs = (world.G && world.G.respawnMs) || knobs.RESPAWN_MS || 10000;
        t.respawnAt = world.clock.now() + respawnMs;
        api.game_log("kill " + t.mtype + " id=" + t.id);
        // Monster hunt: only eligible kills on the issuing server decrement c.
        if (c.s && c.s.monsterhunt) {
          const h = c.s.monsterhunt;
          const sn = formatHuntSn(world.region, world.ident);
          if (h.c > 0 && h.id === t.mtype && h.sn === sn) {
            h.c -= 1;
            api.game_log("mhunt:kill " + t.mtype + " c=" + h.c);
          }
        }
        if (typeof world.nextKillDrops === "function" && typeof world.spawnChest === "function") {
          const drops = world.nextKillDrops(t.mtype);
          if (drops && drops.length) {
            world.spawnChest(serverKey(), c.map, { x: t.real_x || t.x, y: t.real_y || t.y }, drops);
            api.game_log("drop " + drops.map((d) => d.name + (d.level != null ? "@" + d.level : "")).join(","));
          }
        }
      }
      return Promise.resolve({ success: true, damage: dmg });
    },

    loot() {
      const ents = world.entitiesOn(serverKey(), c.map);
      let n = 0;
      for (const id of Object.keys(ents)) {
        const e = ents[id];
        if (!e || e.type !== "chest" || !e.items || !e.items.length) continue;
        if (dist(c, e) > LOOT_RANGE) continue;
        while (e.items.length && (c.esize || 0) >= 1) {
          const piece = e.items.shift();
          if (piece.q != null) {
            const stack = c.items.findIndex((x) => x && x.name === piece.name && x.q != null);
            if (stack >= 0) {
              c.items[stack].q += piece.q;
              log.looted.push(piece);
              api.game_log("loot " + piece.name);
              n++;
              continue;
            }
          }
          const slot = c.items.findIndex((x) => !x);
          if (slot < 0) break;
          c.items[slot] = piece;
          c.esize = Math.max(0, (c.esize || 1) - 1);
          log.looted.push(piece);
          api.game_log("loot " + piece.name + (piece.level != null ? "@" + piece.level : ""));
          n++;
        }
        if (!e.items.length && typeof world.removeChest === "function") {
          world.removeChest(serverKey(), c.map, id);
        }
      }
      return n;
    },

    equip(i, slot) {
      const it = c.items[i];
      if (!it) return Promise.resolve({ failed: true, reason: "no_item" });
      const def = (world.G && world.G.items && world.G.items[it.name]) || {};
      if (def.wtype && slot === "mainhand") {
        const w = def.wtype;
        const ctype = c.ctype || "warrior";
        const ok =
          ctype === "warrior"
            ? ["sword", "short_sword", "wblade", "basher", "axe", "mace", "spear"].indexOf(w) >= 0
            : ctype === "mage" || ctype === "priest"
              ? ["staff", "great_staff", "wand"].indexOf(w) >= 0
              : false;
        if (!ok) return Promise.resolve({ failed: true, reason: "wrong_class" });
      }
      const prev = slot ? c.slots[slot] : null;
      if (slot) {
        c.slots[slot] = { name: it.name, level: it.level || 0 };
        c.items[i] = prev || null;
        if (!prev) c.esize = (c.esize || 0) + 1;
        log.equipped.push({ i, slot, name: it.name, level: it.level || 0 });
        api.game_log("equip " + it.name + " +" + (it.level || 0) + " -> " + slot);
      }
      return Promise.resolve({ success: true });
    },

    unequip(slot) {
      const it = c.slots[slot];
      if (!it) return Promise.resolve({ failed: true });
      if (("" + slot).indexOf("trade") === 0 && !c.stand) {
        return Promise.resolve({ failed: true, reason: "stand_closed" });
      }
      const i = c.items.findIndex((x) => !x);
      if (i < 0) return Promise.resolve({ failed: true, reason: "full" });
      c.slots[slot] = null;
      c.items[i] = it;
      c.esize = Math.max(0, (c.esize || 1) - 1);
      return Promise.resolve({ success: true });
    },

    async bank_retrieve(pack, i) {
      if (c.map !== "bank") return { failed: true, reason: "not_bank" };
      if (!c.bank) c.bank = c._bank || { gold: 0, items0: new Array(42).fill(null) };
      const bag = c.bank[pack] || c.bank.items0;
      if (!bag || !bag[i]) return { failed: true, reason: "empty" };
      if ((c.esize || 0) < 1) return { failed: true, reason: "no_space" };
      const it = bag[i];
      bag[i] = null;
      const slot = c.items.findIndex((x) => !x);
      c.items[slot] = it;
      c.esize = Math.max(0, (c.esize || 1) - 1);
      log.retrieved.push({ pack, i, name: it.name, level: it.level || 0 });
      api.game_log("bank_retrieve " + it.name + "@" + (it.level || 0));
      return { success: true };
    },

    open_stand() {
      c.stand = true;
      // Live: prior-session listings can reappear on open while client slots looked empty.
      if (c._tradeGhost) {
        for (const k of Object.keys(c._tradeGhost)) {
          if (!c.slots[k]) c.slots[k] = Object.assign({}, c._tradeGhost[k]);
        }
      }
      api.game_log("stand:open");
    },
    close_stand() {
      c.stand = false;
      api.game_log("stand:close");
    },

    /** List bag slot on merchant stand. Official: trade(num, trade_slot, price, quantity). */
    trade(slot, tradeSlot, price, quantity) {
      if (!c.stand) return { failed: true, reason: "stand_closed" };
      if (arguments.length < 3 || price == null) return { failed: true, reason: "bad_args" };
      const it = c.items[slot];
      if (!it) return { failed: true, reason: "no_item" };
      let dest = null;
      if (tradeSlot != null) {
        const n = parseInt(("" + tradeSlot).replace(/^trade/, ""), 10);
        if (!(n >= 1 && n <= 16)) return { failed: true, reason: "bad_trade_slot" };
        const k = "trade" + n;
        // Live spelling: slot_occuppied
        if (c.slots[k]) return { failed: true, reason: "slot_occuppied" };
        dest = k;
      } else {
        for (let t = 1; t <= 16; t++) {
          const k = "trade" + t;
          if (!c.slots[k]) {
            dest = k;
            break;
          }
        }
      }
      if (!dest) return { failed: true, reason: "no_trade_slot" };
      const q = quantity == null ? it.q || 1 : quantity;
      c.slots[dest] = Object.assign({}, it, { price: price || 1, q });
      if (it.q && q < it.q) {
        it.q -= q;
      } else {
        c.items[slot] = null;
        c.esize = (c.esize || 0) + 1;
      }
      log.traded.push({ slot: dest, name: it.name, price: price || 1 });
      api.game_log("stall:list " + it.name + " @" + (price || 1));
      return { success: true, slot: dest };
    },

    move(x, y) {
      if (isBlocked(c.map, x, y, world.G)) return false;
      place(c.map, x, y);
      log.moved.push({ x, y, t: world.clock.now() });
      return true;
    },

    can_move_to(x, y) {
      return !isBlocked(c.map, x, y, world.G);
    },

    use(skill) {
      log.skills.push("use:" + skill);
      if (skill === "town") {
        place("main", 0, 0);
        advanceTime(TOWN_MS);
      }
    },

    async leave() {
      if (c.map === "jail") place("main", 0, 0);
    },

    async respawn() {
      c.rip = false;
      c.hp = c.max_hp;
      place(c.map, c.real_x, c.real_y);
    },

    stop(what) {
      if (!what || what === "smart") smart.moving = false;
    },

    async smart_move(dest) {
      if (smart.failInject === "reject") {
        smart.failInject = null;
        throw { reason: "failed", failed: true };
      }
      if (smart.failInject === "fail") {
        smart.failInject = null;
        return { failed: true, reason: "injected" };
      }
      if (c.stand) return { failed: true, reason: "stand_open" };

      let map = c.map,
        x = c.real_x,
        y = c.real_y;
      if (dest && dest.to === "potions") {
        map = NPC.potions.map;
        x = NPC.potions.x;
        y = NPC.potions.y;
      } else if (dest && dest.to === "upgrade") {
        map = NPC.upgrade.map;
        x = NPC.upgrade.x;
        y = NPC.upgrade.y;
      } else if (dest && (dest.to === "monsterhunt" || dest.to === "daisy" || dest.to === "monsterhunter")) {
        map = NPC.monsterhunt.map;
        x = NPC.monsterhunt.x;
        y = NPC.monsterhunt.y;
      } else if (dest && dest.to === "bank") {
        map = NPC.bank.map;
        x = NPC.bank.x;
        y = NPC.bank.y;
      } else if (dest && dest.to && FARM_XY[dest.to]) {
        const p = FARM_XY[dest.to];
        map = p.map;
        x = p.x;
        y = p.y;
      } else if (dest && dest.to === "phoenix") {
        // No fixed spawn — always fails (LESSONS #6)
        return { failed: true, reason: "no_path" };
      } else if (dest && (dest.x != null || dest.y != null)) {
        map = dest.map || c.map;
        x = dest.x != null ? dest.x : c.real_x;
        y = dest.y != null ? dest.y : c.real_y;
      } else if (dest && dest.map) {
        const sp = world.G.maps[dest.map] && world.G.maps[dest.map].spawns[0];
        map = dest.map;
        x = sp ? sp[0] : 0;
        y = sp ? sp[1] : 0;
      }

      if (isBlocked(map, x, y, world.G)) {
        return { failed: true, reason: "blocked" };
      }

      const from = { map: c.map, x: c.real_x, y: c.real_y };
      const waypoints = findPath(from, { map, x, y }, map, world.G);
      if (!waypoints || !waypoints.length) {
        return { failed: true, reason: "no_path" };
      }

      smart.moving = true;
      smart.map = map;
      smart.x = x;
      smart.y = y;
      log.moved.push(dest);

      if (smart.failInject === "stall") {
        smart.failInject = null;
        return { failed: true, reason: "stalled" };
      }

      for (const wp of waypoints) {
        const legFrom = { map: c.map, x: c.real_x, y: c.real_y };
        const legTo = { map: wp.map, x: wp.x, y: wp.y };
        const ms = travelMs(legFrom, legTo);
        log.path.push({
          from: legFrom,
          to: legTo,
          dist: dist(legFrom, legTo) + (legTo.map !== legFrom.map ? 2500 : 0),
          ms,
          door: !!wp.door,
        });

        // Multi-waypoint / cross-map: slice + clock.advance so Sim Viz can scrub.
        // Single direct leg: owe time for single clock owner (tickAll drains).
        const scrub = waypoints.length > 1 || legTo.map !== legFrom.map;
        const slices = scrub ? Math.max(1, Math.ceil(ms / PATH_SAMPLE_MS)) : 1;
        if (slices === 1) {
          advanceTime(ms);
          if (!smart.moving) return { failed: true, reason: "interrupted" };
          place(legTo.map, legTo.x, legTo.y);
        } else {
          const sliceMs = Math.floor(ms / slices);
          for (let i = 1; i <= slices; i++) {
            if (!smart.moving) return { failed: true, reason: "interrupted" };
            const cross = legTo.map !== legFrom.map;
            if (cross) {
              // Door transit: stay on from-map until the last slice, then land
              world.clock.advance(sliceMs);
              if (i === slices) place(legTo.map, legTo.x, legTo.y);
            } else {
              const t = i / slices;
              const ix = legFrom.x + (legTo.x - legFrom.x) * t;
              const iy = legFrom.y + (legTo.y - legFrom.y) * t;
              world.clock.advance(sliceMs);
              if (i === slices) place(legTo.map, legTo.x, legTo.y);
              else place(legFrom.map, ix, iy);
            }
          }
        }
      }

      if (!smart.moving) return { failed: true, reason: "interrupted" };
      place(map, x, y);
      smart.moving = false;
      return { success: true, waypoints };
    },

    change_server(region, ident) {
      const clk = world.clock;
      clk._evt = (clk._evt || 0) + 1;
      const hop = [region, ident];
      hop.t = clk.now();
      hop.i = clk._evt;
      log.server.push(hop);
      // Persist storage; wipe heap-like flags
      const persisted = storage._dump();
      world.changeServer(c.name, region, ident, {
        reconnectMs: RECONNECT_MS,
        regionDelayMs: SERVER_REGION_DELAY_MS,
        storage: persisted,
      });
    },

    async buy(name, q) {
      q = q == null ? 1 : q;
      const def = world.G.items[name] || {};
      const price = def.g || 20;
      const cost = price * q;
      if (c.gold < cost) return { failed: true, reason: "gold" };
      // Stack scrolls / pots
      if (!def.upgrade && (def.g != null || /^scroll|^hpot|^mpot|^cscroll/.test(name))) {
        const stack = c.items.findIndex((x) => x && x.name === name && x.q != null);
        if (stack >= 0) {
          c.gold -= cost;
          c.items[stack].q = (c.items[stack].q || 0) + q;
          log.bought.push({ name, q });
          return { num: stack };
        }
      }
      const i = c.items.findIndex((x) => !x);
      if (i < 0) return { failed: true, reason: "no_space" };
      c.gold -= cost;
      if (def.upgrade) {
        c.items[i] = { name, level: 0 };
      } else {
        c.items[i] = { name, q };
      }
      c.esize = Math.max(0, (c.esize || 1) - 1);
      log.bought.push({ name, q });
      return { num: i };
    },

    /**
     * AL-shaped upgrade(itemSlot, scrollSlot, offering, calculate?).
     * Deterministic: succeed iff preview chance ≥ 0.9; else destroy on real call.
     */
    async upgrade(itemI, scrollI, offering, calculate) {
      const it = c.items[itemI];
      const sc = c.items[scrollI];
      if (!it || !sc || !/^scroll\d$/.test(sc.name)) return { failed: true, reason: "args" };
      const lv = it.level || 0;
      const chance = Math.max(0.5, 1 - lv * 0.08);
      if (calculate) return { chance, level: lv };
      // consume scroll
      const sq = sc.q == null ? 1 : sc.q;
      if (sq <= 1) {
        c.items[scrollI] = null;
        c.esize = (c.esize || 0) + 1;
      } else {
        sc.q = sq - 1;
      }
      log.skills.push("upgrade:" + it.name + "@" + lv);
      if (chance < 0.9) {
        c.items[itemI] = null;
        c.esize = (c.esize || 0) + 1;
        return { failed: true, reason: "destroyed", chance };
      }
      it.level = lv + 1;
      return { success: true, level: it.level, chance };
    },

    /** AL-shaped compound(a,b,c,scroll): merge three same name@level → +1. Always succeeds in sim. */
    async compound(a, b, cSlot, scrollI) {
      const ia = c.items[a];
      const ib = c.items[b];
      const ic = c.items[cSlot];
      const sc = c.items[scrollI];
      if (!ia || !ib || !ic || !sc) return { failed: true, reason: "args" };
      if (!/^cscroll\d$/.test(sc.name)) return { failed: true, reason: "scroll" };
      const nm = ia.name;
      const lv = ia.level || 0;
      if (ib.name !== nm || ic.name !== nm) return { failed: true, reason: "mismatch" };
      if ((ib.level || 0) !== lv || (ic.level || 0) !== lv) return { failed: true, reason: "level" };
      const def = world.G.items[nm] || {};
      if (!def.compound) return { failed: true, reason: "not_compound" };
      const sq = sc.q == null ? 1 : sc.q;
      if (sq <= 1) {
        c.items[scrollI] = null;
        c.esize = (c.esize || 0) + 1;
      } else {
        sc.q = sq - 1;
      }
      c.items[b] = null;
      c.items[cSlot] = null;
      c.esize = (c.esize || 0) + 2;
      ia.level = lv + 1;
      log.skills.push("compound:" + nm + "@" + lv);
      return { success: true, level: ia.level };
    },

    async sell(slot, q) {
      const it = c.items[slot];
      if (!it) return { failed: true, reason: "no_item" };
      const have = it.q == null ? 1 : it.q;
      const qty = q == null ? have : Math.min(q, have);
      const price = (world.G.items[it.name] && world.G.items[it.name].g) || 1;
      c.gold += Math.floor(price * 0.6) * qty;
      const left = have - qty;
      c.items[slot] = left > 0 ? Object.assign({}, it, { q: left }) : null;
      if (left <= 0) c.esize = (c.esize || 0) + 1;
      log.bought.push({ sell: it.name, q: qty }); // reuse bought log channel lightly
      return { success: true };
    },

    async send_item(name, i, q) {
      const it = c.items[i];
      const t = world.entity(serverKey(), name);
      if (!it) return { failed: true, reason: "no_item" };
      if (!t) return { failed: true, reason: "no_target" };
      if (c.stand) return { failed: true, reason: "stand_open" };
      if (t.map !== c.map) return { failed: true, reason: "map" };
      if (dist(c, t) > SEND_ITEM_RANGE) return { failed: true, reason: "distance" };
      if ((t.esize || 0) < 1) return { failed: true, reason: "no_space" };
      const qty = q == null ? 1 : q;
      const have = it.q == null ? 1 : it.q;
      const left = have - qty;
      const piece = left > 0 ? Object.assign({}, it, { q: qty }) : it;
      c.items[i] = left > 0 ? Object.assign({}, it, { q: left }) : null;
      if (left <= 0) c.esize = (c.esize || 0) + 1;
      const slot = t.items.findIndex((x) => !x);
      t.items[slot] = piece;
      t.esize = Math.max(0, (t.esize || 1) - 1);
      log.sent.push({ name, item: piece.name, q: qty });
      return { success: true };
    },

    send_gold(name, amount) {
      const t = world.entity(serverKey(), name);
      if (!t || t.map !== c.map || dist(c, t) > SEND_ITEM_RANGE) {
        log.gold.push({ name, amount: 0, fail: true });
        return;
      }
      const a = Math.min(amount, c.gold);
      c.gold -= a;
      t.gold = (t.gold || 0) + a;
      log.gold.push({ name, amount: a });
    },

    async bank_store(i, pack, pack_num) {
      if (c.map !== "bank") return { failed: true, reason: "not_bank" };
      if (!c.bank) c.bank = { gold: 0, items0: new Array(42).fill(null) };
      const it = c.items[i];
      if (!it) return { failed: true, reason: "no_item" };
      // Live Mainframe: bank_store(i) often rejects reason "invalid"; pack+(-1) works.
      if (bankStoreBareInvalid && pack == null) {
        return { failed: true, reason: "invalid" };
      }
      let bag = pack && c.bank[pack] ? c.bank[pack] : null;
      if (!bag) {
        // Prefer first pack with a free slot (mirrors live al_api pack pick).
        for (const p of Object.keys(c.bank)) {
          if (p === "gold" || !Array.isArray(c.bank[p])) continue;
          if (c.bank[p].some((x) => !x)) {
            bag = c.bank[p];
            pack = p;
            break;
          }
        }
      }
      if (!bag) bag = c.bank.items0;
      // Stack quantity items onto matching bank stacks first (frogt, pots, etc.)
      if (it.q != null) {
        const stackI = bag.findIndex(
          (x) =>
            x &&
            x.name === it.name &&
            (x.level || 0) === (it.level || 0) &&
            x.q != null
        );
        if (stackI >= 0) {
          bag[stackI].q = (bag[stackI].q || 0) + it.q;
          c.items[i] = null;
          c.esize = (c.esize || 0) + 1;
          return { success: true, pack };
        }
      }
      let j = pack_num != null && pack_num >= 0 ? pack_num : bag.findIndex((x) => !x);
      if (j < 0 || bag[j]) {
        j = bag.findIndex((x) => !x);
      }
      if (j < 0) return { failed: true, reason: "bank_full" };
      bag[j] = it;
      c.items[i] = null;
      c.esize = (c.esize || 0) + 1;
      return { success: true, pack, slot: j };
    },

    sleep(ms) {
      // Sleep must advance immediately (waitParty loops); travel uses oweTime via smart_move.
      world.clock.advance(ms);
      return Promise.resolve();
    },

    /**
     * Official: interact("monsterhunt") near Daisy — start or turn in.
     * Docs: merchants cannot accept; refuse while hunt.c > 0; reward only on turn-in.
     */
    async interact(name) {
      if (name !== "monsterhunt") return { failed: true, reason: "invalid" };
      if (!c.s) c.s = {};
      if (c.map !== NPC.monsterhunt.map || dist(c, NPC.monsterhunt) > DAISY_RANGE) {
        return { failed: true, reason: "distance" };
      }
      if (!canAcceptHunts(c.ctype)) {
        return { failed: true, reason: "merchant" };
      }
      // Expire timed hunts
      if (c.s.monsterhunt && c.s.monsterhunt.expiresAt != null && world.clock.now() >= c.s.monsterhunt.expiresAt) {
        delete c.s.monsterhunt;
        api.game_log("mhunt:expired");
      }
      const hunt = c.s.monsterhunt;
      if (hunt && hunt.c > 0) {
        return { failed: true, reason: "in_progress" };
      }
      if (hunt && hunt.c === 0) {
        delete c.s.monsterhunt;
        const slot = c.items.findIndex((x) => !x);
        if (slot < 0) {
          // Still clear hunt — token grant needs space; leave incomplete token for tests to see
          api.game_log("mhunt:turnin_nospace");
          return { failed: true, reason: "no_space" };
        }
        const stack = c.items.findIndex((x) => x && x.name === "monstertoken" && x.q != null);
        if (stack >= 0) c.items[stack].q += 1;
        else {
          c.items[slot] = { name: "monstertoken", q: 1 };
          c.esize = Math.max(0, (c.esize || 1) - 1);
        }
        api.game_log("mhunt:token");
        return { success: true, completed: true };
      }
      // Accept
      let assign = null;
      if (typeof world.nextMonsterHunt === "function") assign = world.nextMonsterHunt(c);
      else if (Array.isArray(world.monsterHuntQueue) && world.monsterHuntQueue.length) {
        assign = world.monsterHuntQueue.shift();
      }
      if (!assign) assign = { id: "goo", c: DEFAULT_HUNT_COUNT };
      if (typeof assign === "string") assign = { id: assign, c: DEFAULT_HUNT_COUNT };
      const sn = formatHuntSn(world.region, world.ident);
      if (!sn) return { failed: true, reason: "no_server" };
      const now = world.clock.now();
      c.s.monsterhunt = {
        id: assign.id,
        c: assign.c != null ? assign.c : DEFAULT_HUNT_COUNT,
        sn,
        ms: HUNT_DURATION_MS,
        expiresAt: now + HUNT_DURATION_MS,
      };
      api.game_log("mhunt:accept id=" + c.s.monsterhunt.id + " c=" + c.s.monsterhunt.c);
      return { success: true, started: true };
    },

    /** Test helpers */
    _injectSmartFail(mode) {
      smart.failInject = mode;
    },
    /** Reproduce Mainframe bare bank_store(i) → reason invalid. */
    _injectBankStoreBareInvalid(on) {
      bankStoreBareInvalid = !!on;
    },
    _heapAlive() {
      return heapAlive;
    },
    _wipeHeap() {
      heapAlive = false;
    },
    _restoreHeap() {
      heapAlive = true;
    },
  };

  return api;
}

module.exports = {
  createCharacter,
  makeCharState,
  WALK_PX_PER_S,
  RECONNECT_MS,
  SERVER_REGION_DELAY_MS,
  TOWN_MS,
};
