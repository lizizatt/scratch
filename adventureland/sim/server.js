"use strict";

const { createClock } = require("./clock");
const { createComms } = require("./comms");
const { baseG, dist, VISION_PX } = require("./world");
const { createCharacter, RECONNECT_MS, SERVER_REGION_DELAY_MS } = require("./character");

/**
 * Multi-character Adventure Land sim.
 * Characters on different server keys cannot CM; party is per-server.
 */
function createWorld(opts) {
  opts = opts || {};
  const clock = opts.clock || createClock();
  const G = opts.G || baseG();
  const comms = createComms(clock);

  /** serverKey -> Map(name -> character state object) */
  const servers = new Map();
  /** name -> { api, region, ident, cmHandlers, partyHandlers } */
  const roster = new Map();
  /** serverKey -> Set of party leader names / party membership maps */
  const parties = new Map(); // serverKey -> { [memberName]: { map, x, y, real_x, real_y, rip, level } }

  function sk(region, ident) {
    return region + "/" + ident;
  }

  function ensureServer(key) {
    if (!servers.has(key)) servers.set(key, new Map());
    return servers.get(key);
  }

  function register(api, region, ident) {
    const key = sk(region, ident);
    ensureServer(key).set(api.character.name, api.character);
    roster.set(api.character.name, {
      api,
      region,
      ident,
      cmHandlers: [],
      partyHandlers: [],
      pmHandlers: [],
    });
    return api;
  }

  function spawn(over, region, ident) {
    region = region || "US";
    ident = ident || "III";
    // Temporary world binding for character constructor
    const self = {
      G,
      clock,
      comms,
      region,
      ident,
      entitiesOn(serverKey, map) {
        const m = servers.get(serverKey) || new Map();
        const out = {};
        for (const [n, ch] of m) {
          if (ch.map === map) out[n] = ch;
        }
        Object.assign(out, monstersOn(serverKey, map));
        Object.assign(out, chestsOn(serverKey, map));
        return out;
      },
      spawnChest,
      removeChest,
      nextKillDrops,
      entity(serverKey, name) {
        const m = servers.get(serverKey);
        return (m && m.get(name)) || null;
      },
      partyOf(name) {
        const r = roster.get(name);
        if (!r) return {};
        const key = sk(r.region, r.ident);
        return parties.get(key) || {};
      },
      broadcastParty(from, message) {
        const r = roster.get(from);
        if (!r) return;
        const key = sk(r.region, r.ident);
        const party = parties.get(key) || {};
        for (const member of Object.keys(party)) {
          const mr = roster.get(member);
          if (!mr) continue;
          for (const h of mr.partyHandlers) h({ from, message, owner: from });
        }
      },
      deliverCm(from, to, message) {
        const fr = roster.get(from);
        const tr = roster.get(to);
        if (!fr || !tr) return false;
        if (fr.region !== tr.region || fr.ident !== tr.ident) return false;
        if (!tr.api.character.connected) return false;
        for (const h of tr.cmHandlers) h({ name: from, from, message });
        return true;
      },
      deliverPm(from, to, message) {
        const tr = roster.get(to);
        if (!tr || !tr.api.character.connected) return false;
        for (const h of tr.pmHandlers) h({ name: from, from, message });
        return true;
      },
      changeServer(name, region, ident, info) {
        const r = roster.get(name);
        if (!r) return;
        const oldKey = sk(r.region, r.ident);
        const oldMap = servers.get(oldKey);
        if (oldMap) oldMap.delete(name);
        // Leave party on old server
        const op = parties.get(oldKey);
        if (op) delete op[name];

        r.region = region;
        r.ident = ident;
        self.region = region; // only used during spawn; per-char region is on roster
        // Patch character's world view: recreate binding is heavy; update roster + reinsert
        const ch = r.api.character;
        ch.connected = false;
        ch.reconnectUntil = clock.now() + (info.reconnectMs || RECONNECT_MS);
        ch.serverRegionReadyAt = ch.reconnectUntil + (info.regionDelayMs || SERVER_REGION_DELAY_MS);
        // Advance clock through reconnect for sync tests? Caller decides.
        // Place on new server at spawn 0 when reconnect completes — handled by tick.
        ch._pendingServer = { region, ident, storage: info.storage };
        ensureServer(sk(region, ident));
      },
    };

    const name = (over && over.name) || "Hero";
    let boundName = name;
    const worldProxy = {
      get G() {
        return G;
      },
      get clock() {
        return clock;
      },
      get comms() {
        return comms;
      },
      get region() {
        const r = roster.get(boundName);
        return r ? r.region : region;
      },
      get ident() {
        const r = roster.get(boundName);
        return r ? r.ident : ident;
      },
      entitiesOn: self.entitiesOn,
      entity: self.entity,
      partyOf: self.partyOf,
      broadcastParty: self.broadcastParty,
      deliverCm: self.deliverCm,
      deliverPm: self.deliverPm,
      changeServer: self.changeServer,
      spawnChest: self.spawnChest,
      removeChest: self.removeChest,
      nextKillDrops: self.nextKillDrops,
      oweTime(ms) {
        oweTime(ms);
      },
    };

    // Pre-register stub so region getters work during init
    roster.set(boundName, { api: null, region, ident, cmHandlers: [], partyHandlers: [], pmHandlers: [] });
    const api = createCharacter(worldProxy, over);
    boundName = api.character.name;
    if (boundName !== name) {
      roster.delete(name);
      roster.set(boundName, { api: null, region, ident, cmHandlers: [], partyHandlers: [], pmHandlers: [] });
    }
    const entry = roster.get(boundName);
    entry.api = api;
    ensureServer(sk(region, ident)).set(boundName, api.character);

    api.on = function (ev, fn) {
      const r = roster.get(api.character.name);
      if (ev === "cm") r.cmHandlers.push(fn);
      else if (ev === "partym") r.partyHandlers.push(fn);
      else if (ev === "pm") r.pmHandlers.push(fn);
    };
    api.clearHandlers = function () {
      const r = roster.get(api.character.name);
      if (!r) return;
      r.cmHandlers = [];
      r.partyHandlers = [];
      r.pmHandlers = [];
    };

    return api;
  }

  /** monster id -> entity, keyed lightly per map */
  const monsterBags = new Map(); // serverKey|map -> { id: entity }
  /** ground chests after kills */
  const chestBags = new Map(); // serverKey|map -> { id: chest }
  let killSeq = 0;

  function monstersOn(serverKey, map) {
    const k = serverKey + "|" + map;
    return monsterBags.get(k) || {};
  }

  function chestsOn(serverKey, map) {
    const k = serverKey + "|" + map;
    return chestBags.get(k) || {};
  }

  function spawnChest(serverKey, map, xy, items, id) {
    const k = serverKey + "|" + map;
    if (!chestBags.has(k)) chestBags.set(k, {});
    const bag = chestBags.get(k);
    const cid = id || "chest_" + Object.keys(bag).length + "_" + clock.now();
    bag[cid] = {
      id: cid,
      type: "chest",
      map,
      real_x: xy.x,
      real_y: xy.y,
      x: xy.x,
      y: xy.y,
      items: (items || []).map((it) => Object.assign({}, it)),
    };
    return bag[cid];
  }

  function removeChest(serverKey, map, id) {
    const bag = chestsOn(serverKey, map);
    if (bag[id]) delete bag[id];
  }

  function nextKillDrops(mtype) {
    const { dropsForKill } = require("./world");
    killSeq += 1;
    return dropsForKill(mtype, killSeq);
  }

  function spawnMonster(serverKey, map, mtype, xy, id) {
    const k = serverKey + "|" + map;
    if (!monsterBags.has(k)) monsterBags.set(k, {});
    const bag = monsterBags.get(k);
    const mid = id || mtype + "_" + Object.keys(bag).length;
    const g = G.monsters[mtype] || { attack: 10 };
    // Farmable packs die in a few swings so viz shows kill cycles
    const maxHp = g.hp || (mtype === "phoenix" ? 4000 : 280);
    bag[mid] = {
      id: mid,
      type: "monster",
      mtype,
      map,
      real_x: xy.x,
      real_y: xy.y,
      x: xy.x,
      y: xy.y,
      attack: g.attack,
      dead: false,
      hp: maxHp,
      max_hp: maxHp,
      respawnAt: 0,
    };
    return bag[mid];
  }

  /** Respawn dead pack mobs; call from world.advance. */
  function tickMonsters() {
    const now = clock.now();
    for (const bag of monsterBags.values()) {
      for (const id of Object.keys(bag)) {
        const m = bag[id];
        if (!m || !m.dead || !m.respawnAt || now < m.respawnAt) continue;
        m.dead = false;
        m.hp = m.max_hp;
        m.target = null;
        m.respawnAt = 0;
        // Small jitter so respawns "pop" nearby rather than exact corpse xy
        const jx = ((Math.abs(hashStr(id + now)) % 70) - 35);
        const jy = ((Math.abs(hashStr(id + "y" + now)) % 70) - 35);
        m.real_x = (m._homeX != null ? m._homeX : m.real_x) + jx;
        m.real_y = (m._homeY != null ? m._homeY : m.real_y) + jy;
        m.x = m.real_x;
        m.y = m.real_y;
      }
    }
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  function spawnPack(serverKey, map, mtype, center, count) {
    count = count == null ? 5 : count;
    const out = [];
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2;
      const rad = 40 + (i % 3) * 25;
      const xy = {
        x: Math.round(center.x + Math.cos(ang) * rad),
        y: Math.round(center.y + Math.sin(ang) * rad),
      };
      const m = spawnMonster(serverKey, map, mtype, xy, mtype + "_p" + i);
      m._homeX = center.x;
      m._homeY = center.y;
      out.push(m);
    }
    return out;
  }

  function formParty(serverKey, members) {
    const p = {};
    for (const name of members) {
      const r = roster.get(name);
      if (!r) continue;
      const ch = r.api.character;
      p[name] = {
        map: ch.map,
        x: ch.x,
        y: ch.y,
        real_x: ch.real_x,
        real_y: ch.real_y,
        rip: !!ch.rip,
        level: ch.level,
      };
    }
    parties.set(serverKey, p);
    return p;
  }

  function refreshPartyCoords(serverKey) {
    const p = parties.get(serverKey);
    if (!p) return;
    for (const name of Object.keys(p)) {
      const r = roster.get(name);
      if (!r) continue;
      const ch = r.api.character;
      p[name].map = ch.map;
      p[name].x = ch.x;
      p[name].y = ch.y;
      p[name].real_x = ch.real_x;
      p[name].real_y = ch.real_y;
      p[name].rip = !!ch.rip;
    }
  }

  /** Complete pending reconnects whose timer has elapsed. */
  function tickReconnects() {
    for (const [name, r] of roster) {
      const ch = r.api.character;
      if (!ch.connected && ch._pendingServer && clock.now() >= ch.reconnectUntil) {
        const ps = ch._pendingServer;
        ch._pendingServer = null;
        ch.connected = true;
        r.region = ps.region;
        r.ident = ps.ident;
        const key = sk(ps.region, ps.ident);
        ensureServer(key).set(name, ch);
        const map = ch.map || "main";
        const sp = (G.maps[map] && G.maps[map].spawns && G.maps[map].spawns[0]) || [0, 0];
        ch.map = map;
        ch.real_x = sp[0];
        ch.x = sp[0];
        ch.real_y = sp[1];
        ch.y = sp[1];
        // Heap wipe: drop CODE handlers; reload callback reboots controller from storage
        r.cmHandlers = [];
        r.partyHandlers = [];
        r.pmHandlers = [];
        ch._heapGen = (ch._heapGen || 0) + 1;
        if (typeof r.onReload === "function") {
          try {
            r.onReload(r.api);
          } catch (e) {
            ch._reloadErr = String(e && e.message ? e.message : e);
          }
        }
      }
    }
  }

  let owedMs = 0;
  function oweTime(ms) {
    owedMs += Math.max(0, ms | 0);
  }
  function drainOwedTime() {
    const n = owedMs;
    owedMs = 0;
    if (n > 0) clock.advance(n);
    return n;
  }

  clock.onAdvance(() => {
    tickReconnects();
    tickMonsters();
  });

  return {
    clock,
    G,
    comms,
    spawn,
    spawnMonster,
    spawnPack,
    spawnChest,
    removeChest,
    nextKillDrops,
    tickMonsters,
    getKillSeq() {
      return killSeq;
    },
    formParty,
    refreshPartyCoords,
    tickReconnects,
    oweTime,
    drainOwedTime,
    getOwedMs() {
      return owedMs;
    },
    setOnReload(name, fn) {
      const r = roster.get(name);
      if (r) r.onReload = fn;
    },
    inviteAll(serverKey, members) {
      return formParty(serverKey, members);
    },
    roster,
    serverKey: sk,
    get(name) {
      const r = roster.get(name);
      return r && r.api;
    },
    where(name) {
      const r = roster.get(name);
      if (!r) return null;
      return { region: r.region, ident: r.ident, key: sk(r.region, r.ident) };
    },
    advance(ms) {
      clock.advance(ms);
      for (const key of parties.keys()) refreshPartyCoords(key);
    },
    VISION_PX,
    dist,
  };
}

module.exports = { createWorld };
