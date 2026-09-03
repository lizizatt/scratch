"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function baseG() {
  return {
    monsters: {
      goo: { attack: 5, xp: 100, unlist: false },
      bee: { attack: 16, xp: 400, unlist: false },
      crab: { attack: 24, xp: 500, unlist: false },
      snake: { attack: 24, xp: 960, unlist: false },
      armadillo: { attack: 20, xp: 1720, unlist: false },
      arcticbee: { attack: 64, xp: 1800, unlist: false },
      porcupine: { attack: 16, xp: 3200, unlist: false },
      croc: { attack: 48, xp: 3600, unlist: false },
      bat: { attack: 50, xp: 8000, unlist: false },
      tortoise: { attack: 36, xp: 5200, unlist: false },
      spider: { attack: 80, xp: 12000, unlist: false },
      scorpion: { attack: 100, xp: 20000, unlist: false },
      boar: { attack: 240, xp: 10800, unlist: false },
      bigbird: { attack: 480, xp: 30000, unlist: false },
      gscorpion: { attack: 120, xp: 48000, unlist: false },
      wolf: { attack: 480, xp: 48800, unlist: false },
      dryad: { attack: 400, xp: 60000, unlist: false },
      mole: { attack: 480, xp: 8000, unlist: false },
      target: { attack: 0, xp: 1000, unlist: true, stationary: true },
      target_a500: { attack: 0, xp: 1000, unlist: true }
    },
    items: {
      hpot0: { g: 20, type: "pot" },
      hpot1: { g: 100, type: "pot" },
      mpot0: { g: 20, type: "pot" },
      mpot1: { g: 100, type: "pot" },
      helmet: { g: 1200, type: "helmet", upgrade: true },
      coat: { g: 2400, type: "chest", upgrade: true },
      pants: { g: 1600, type: "pants", upgrade: true },
      shoes: { g: 800, type: "shoes", upgrade: true },
      gloves: { g: 800, type: "gloves", upgrade: true },
      blade: { g: 2400, type: "weapon", wtype: "short_sword", upgrade: true },
      staff: { g: 2400, type: "weapon", wtype: "staff", upgrade: true },
      wand: { g: 2400, type: "weapon", wtype: "wand", upgrade: true },
      bow: { g: 2400, type: "weapon", wtype: "bow", upgrade: true },
      scroll0: { g: 1000 },
      scroll1: { g: 40000 },
      gem0: { g: 10000, type: "gem" },
      tracker: { g: 1 },
      stand0: { g: 40000 },
      cscroll0: { g: 800 },
      essenceoflife: { g: 100 }
    },
    skills: {
      hearts: { emote: true },
      drop_coin: { emote: true },
      taunt: { mp: 40, cooldown: 3000 },
      charge: { mp: 0, cooldown: 40000 },
      cleave: { mp: 720, cooldown: 1200, level: 52 },
      curse: { mp: 400, cooldown: 5000 },
      burst: { mp: 0, cooldown: 6000 },
      magiport: { mp: 900, cooldown: 0 },
      partyheal: { mp: 400, cooldown: 200 },
      revive: { mp: 500, cooldown: 200 },
      mluck: { mp: 10, cooldown: 100, level: 40, range: 320 }
    }
  };
}

function makeCharacter(over) {
  return Object.assign({
    name: "Sarene",
    ctype: "warrior",
    level: 1,
    hp: 320,
    max_hp: 320,
    mp: 80,
    max_mp: 80,
    gold: 5000,
    map: "main",
    rip: false,
    esize: 12,
    range: 40,
    real_x: 0,
    real_y: 0,
    x: 0,
    y: 0,
    items: new Array(42).fill(null),
    slots: {},
    q: {},
    ping: 40
  }, over);
}

function makeEnv(charOver) {
  const G = baseG();
  const storageSeed = (charOver && charOver._storage) || {};
  if (charOver && Object.prototype.hasOwnProperty.call(charOver, "_storage")) delete charOver._storage;
  if (charOver && charOver._server) {
    var srv = charOver._server;
    delete charOver._server;
  }
  const character = makeCharacter(charOver);
  const smart = { moving: false };
  const log = { said: [], global: [], bought: [], sold: [], attacked: [], healed: [], moved: [], skills: [], equipped: [], unequipped: [], upgraded: [], invited: [], accepted: [], merchant: [], sent: [], gold: [], traded: [], stored: [], retrieved: [], sendFail: [], bankFail: [], server: [] };
  const parent = {
    entities: {},
    server_region: (srv && srv[0]) || "US",
    server_identifier: (srv && srv[1]) || "III",
    distance: (a, b) => {
      const ax = a.real_x != null ? a.real_x : a.x;
      const ay = a.real_y != null ? a.real_y : a.y;
      const bx = b.real_x != null ? b.real_x : b.x;
      const by = b.real_y != null ? b.real_y : b.y;
      const dx = ax - bx, dy = ay - by;
      return Math.sqrt(dx * dx + dy * dy);
    },
    party: {},
    open_merchant: (slot) => { log.merchant.push({ open: slot }); character.stand = true; },
    close_merchant: () => { log.merchant.push({ close: true }); character.stand = false; }
  };
  const store = Object.assign({}, storageSeed);
  const localStorage = {
    getItem: (k) => (store[k] == null ? null : String(store[k])),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _store: store
  };
  const chatHandlers = [];
  const charEv = {};
  character.on = (ev, fn) => { (charEv[ev] = charEv[ev] || []).push(fn); };

  function quantity(name) {
    let q = 0;
    for (const it of character.items) {
      if (it && it.name === name) q += it.q || 1;
    }
    return q;
  }
  function locate_item(name) {
    for (let i = 0; i < character.items.length; i++) {
      if (character.items[i] && character.items[i].name === name) return i;
    }
    return -1;
  }

  const env = {
    character, G, smart, parent, log, localStorage,
    ATTACK_MODE: true,
    safeties: true,
    last_potion: new Date(0),
    console,
    Date, Math, Array, Object, String, Number, Error,
    parseInt, isNaN, setTimeout, clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    performance_trick: () => {},
    game: { on: (ev, fn) => { if (ev === "chat") chatHandlers.push(fn); } },
    emitChat(from, message) {
      const d = { from, owner: from, message };
      (charEv.partym || []).forEach((fn) => fn(d));
      chatHandlers.forEach((fn) => fn(d));
    },
    emitCm(from, data) {
      const payload = { name: from, message: data, local: true };
      (charEv.cm || []).forEach((fn) => fn(payload));
      if (typeof env.on_cm === "function") env.on_cm(from, data);
    },
    emitPm(from, message) {
      const payload = { from, message };
      (charEv.pm || []).forEach((fn) => fn(payload));
    },
    in_arr: (v, arr) => Array.isArray(arr) && arr.indexOf(v) >= 0,
    quantity, locate_item,
    item_grade: (it) => (it && (it.level || 0) >= 7 ? 1 : 0),
    mssince: (t) => Date.now() - (t instanceof Date ? t.getTime() : t),
    min: Math.min, max: Math.max,
    sleep: (ms) => Promise.resolve(ms),
    stop: () => { smart.moving = false; },
    say: (m) => log.global.push(m),
    party_say: (m) => log.said.push(m),
    pm: (name, message) => { log.pm = log.pm || []; log.pm.push({ name, message }); },
    send_cm: async (name, data) => {
      log.cm = log.cm || [];
      const names = Array.isArray(name) ? name : [name];
      names.forEach((n) => log.cm.push({ name: n, data }));
      return { receivers: names, locals: names };
    },
    game_log: (m) => { log.game = log.game || []; log.game.push(m); },
    buy: async (name, q) => { log.bought.push({ name, q: q || 1 }); const i = character.items.findIndex((x) => !x); if (i >= 0) character.items[i] = { name, q: q || 1 }; character.gold -= (G.items[name] && G.items[name].g || 20) * (q || 1); return { num: i }; },
    sell: (i, q) => { log.sold.push({ i, q }); character.items[i] = null; },
    trade: (i, slot, gold, q) => {
      const key = "trade" + slot;
      if (character.slots[key]) { log.tradeFail = log.tradeFail || []; log.tradeFail.push({ i, slot, reason: "slot_occuppied" }); return; }
      const it = character.items[i];
      if (!it) return;
      character.slots[key] = Object.assign({}, it, { price: gold, q: q || 1 });
      character.items[i] = null;
      log.traded.push({ i, slot, gold, q: q || 1 });
    },
    bank_store: (i) => {
      if (character.map !== "bank") { log.bankFail.push({ i, reason: "not_bank" }); return; }
      const it = character.items[i];
      if (!it) return;
      log.stored.push({ i, item: it.name, q: it.q || 1 });
      character.items[i] = null;
      character.esize = (character.esize || 0) + 1;
    },
    bank_retrieve: (pack, i) => {
      if (character.map !== "bank") { log.bankFail.push({ pack, i, reason: "not_bank" }); return; }
      const bag = character.bank && character.bank[pack];
      if (!bag || !bag[i]) return;
      if ((character.esize || 0) <= 0) { log.bankFail.push({ pack, i, reason: "full" }); return; }
      const slot = character.items.findIndex((x) => !x);
      if (slot < 0) { log.bankFail.push({ pack, i, reason: "full" }); return; }
      const it = bag[i];
      bag[i] = null;
      character.items[slot] = it;
      character.esize = (character.esize || 0) - 1;
      log.retrieved.push({ pack, i, item: it.name, q: it.q || 1 });
    },
    send_item: (name, i, q) => {
      const it = character.items[i];
      const t = name === character.name ? character : parent.entities[name];
      if (!it) return;
      if (!t) { log.sendFail.push({ kind: "item", name, reason: "no_target" }); return; }
      if (t.map && t.map !== character.map) { log.sendFail.push({ kind: "item", name, reason: "map" }); return; }
      if (parent.distance(character, t) > 400) { log.sendFail.push({ kind: "item", name, reason: "distance" }); return; }
      if (t.esize === 0) { log.sendFail.push({ kind: "item", name, reason: "no_space" }); return; }
      log.sent.push({ name, item: it.name, q: q || 1, i });
      const left = (it.q || 1) - (q || 1);
      character.items[i] = left > 0 ? Object.assign({}, it, { q: left }) : null;
    },
    send_gold: (name, amount) => {
      const t = (name && name.name) ? name : (name === character.name ? character : parent.entities[name]);
      const n = (name && name.name) ? name.name : name;
      if (!t) { log.sendFail.push({ kind: "gold", name: n, reason: "no_target" }); return; }
      if (t.map && t.map !== character.map) { log.sendFail.push({ kind: "gold", name: n, reason: "map" }); return; }
      if (parent.distance(character, t) > 400) { log.sendFail.push({ kind: "gold", name: n, reason: "distance" }); return; }
      const a = Math.min(amount, character.gold);
      if (a <= 0) return;
      character.gold -= a;
      log.gold.push({ name: n, amount: a });
    },
    attack: (t) => log.attacked.push(t),
    heal: (t) => log.healed.push(t && t.name),
    move: (x, y) => log.moved.push({ x, y }),
    use_skill: (s, t) => { log.skills.push(s); log.skillArgs = log.skillArgs || []; log.skillArgs.push({ name: s, target: t && (t.name || t.id || t) }); },
    use: (s) => log.skills.push("use:" + s),
    loot: () => {},
    change_target: (t) => { character.target = t && t.id; },
    set_message: (m) => { env.lastMessage = m; },
    respawn: () => {},
    leave: async () => { character.map = "main"; },
    change_server: (region, name) => {
      log.server.push([region, name]);
      parent.server_region = region;
      parent.server_identifier = name;
    },
    smart_move: async (dest) => {
      log.moved.push(dest);
      if (dest && dest.to === "potions") { character.map = "main"; character.real_x = 56; character.real_y = -122; character.bank = null; }
      if (dest && dest.to === "upgrade") { character.map = "main"; character.real_x = -204; character.real_y = -129; character.bank = null; }
      if (dest && dest.to === "bank") {
        character.map = "bank"; character.real_x = 0; character.real_y = 0;
        if (!character.bank) character.bank = { gold: 0, items0: new Array(42).fill(null) };
      }
      if (dest && dest.to === "goo") { character.map = "main"; character.real_x = 0; character.real_y = 0; character.bank = null; }
      if (dest && (dest.x != null || dest.y != null)) {
        if (dest.map) character.map = dest.map;
        if (dest.map && dest.map !== "bank") character.bank = null;
        if (dest.x != null) { character.real_x = dest.x; character.x = dest.x; }
        if (dest.y != null) { character.real_y = dest.y; character.y = dest.y; }
      } else if (dest && dest.map) {
        character.map = dest.map;
        if (dest.map !== "bank") character.bank = null;
      }
      if (typeof dest === "string" && parent.entities[dest]) {
        const p = parent.entities[dest];
        character.map = p.map || character.map;
        character.real_x = p.real_x != null ? p.real_x : p.x;
        character.real_y = p.real_y != null ? p.real_y : p.y;
      }
      return { success: true };
    },
    get_party: () => parent.party,
    get_player: (name) => {
      if (name === character.name) return character;
      return parent.entities[name] || null;
    },
    get_monster: (id) => parent.entities[id] && parent.entities[id].type === "monster" ? parent.entities[id] : null,
    get_targeted_monster: () => {
      const id = character.target;
      return id ? parent.entities[id] : null;
    },
    get_nearest_monster: (args) => {
      args = args || {};
      let best = null, bestD = 1e9;
      for (const id of Object.keys(parent.entities)) {
        const e = parent.entities[id];
        if (!e || e.type !== "monster" || e.dead) continue;
        if (args.type && e.mtype !== args.type) continue;
        if (args.max_att != null && e.attack > args.max_att) continue;
        if (args.no_target && e.target && e.target !== character.name) continue;
        const d = parent.distance(character, e);
        if (d < bestD) { bestD = d; best = e; }
      }
      return best;
    },
    is_in_range: (t) => parent.distance(character, t) <= character.range,
    can_attack: (t) => !!t && !t.dead,
    can_heal: (t) => !!t && t.type !== "monster" && parent.distance(character, t) <= character.range,
    can_use: () => true,
    is_on_cooldown: () => false,
    is_moving: (e) => !!(e && (e.moving || (e.me && smart.moving))),
    send_party_invite: (n) => log.invited.push(n),
    send_party_request: (n) => { log.requested = log.requested || []; log.requested.push(n); },
    accept_party_invite: (n) => log.accepted.push(n),
    accept_party_request: (n) => { log.acceptedReq = log.acceptedReq || []; log.acceptedReq.push(n); },
    accept_magiport: (n) => { log.magiport = log.magiport || []; log.magiport.push(n); },
    equip: async (n) => { log.equipped.push(n); },
    unequip: (slot) => { log.unequipped.push(slot); const it = character.slots[slot]; character.slots[slot] = null; if (it) { const i = character.items.findIndex((x) => !x); if (i >= 0) character.items[i] = it; } },
    upgrade: async (item, scroll) => { log.upgraded.push({ item, scroll }); const it = character.items[item]; if (it) it.level = (it.level || 0) + 1; },
    is_character_local: () => true
  };
  env.global = env;
  return env;
}

function loadScript(filename, charOver) {
  const env = makeEnv(charOver);
  let src = fs.readFileSync(path.join(ROOT, filename), "utf8");
  src = src
    .replace(/\ntry \{ performance_trick\(\); \} catch \(e\) \{\}\n/, "\n")
    .replace(/\nsetInterval\(function \(\) \{[\s\S]*?\}, 250\);\n/, "\n")
    .replace(/\nsetInterval\(loop, 500\);\s*$/, "\n")
    .replace(/\nsetInterval\(logistics, 2500\); logistics\(\);\s*$/, "\n");
  vm.createContext(env);
  vm.runInContext(src, env, { filename });
  return env;
}

module.exports = { baseG, makeCharacter, makeEnv, loadScript, ROOT };
