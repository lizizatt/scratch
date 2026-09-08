"use strict";

const { dist, isBlocked, VISION_PX, SEND_ITEM_RANGE, packCenter, NPC, FARM_XY } = require("./world");
const { findPath } = require("./path");
const { createStorage } = require("./storage");
const knobs = require("./knobs");

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
      real_x: 0,
      real_y: 0,
      x: 0,
      y: 0,
      items: new Array(42).fill(null),
      slots: {},
      q: {},
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
      const price = (world.G.items[name] && world.G.items[name].g) || 20;
      const cost = price * q;
      if (c.gold < cost) return { failed: true, reason: "gold" };
      c.gold -= cost;
      const i = c.items.findIndex((x) => !x);
      if (i >= 0) {
        c.items[i] = { name, q };
        c.esize = Math.max(0, (c.esize || 1) - 1);
      }
      log.bought.push({ name, q });
      return { num: i };
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

    async bank_store(i) {
      if (c.map !== "bank") return;
      if (!c.bank) c.bank = { gold: 0, items0: new Array(42).fill(null) };
      const it = c.items[i];
      if (!it) return;
      const bag = c.bank.items0;
      const j = bag.findIndex((x) => !x);
      if (j < 0) return;
      bag[j] = it;
      c.items[i] = null;
      c.esize = (c.esize || 0) + 1;
    },

    sleep(ms) {
      // Sleep must advance immediately (waitParty loops); travel uses oweTime via smart_move.
      world.clock.advance(ms);
      return Promise.resolve();
    },

    /** Test helpers */
    _injectSmartFail(mode) {
      smart.failInject = mode;
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
