"use strict";

/**
 * Adventure Land browser API → V2 bootFighter/bootMerchant api shape.
 * Used only in live slots (not in node sim tests).
 * Captures globals at create time so method names don't shadow/recurse.
 */
function createAlApi() {
  const g = {
    character: typeof character !== "undefined" ? character : null,
    smart: typeof smart !== "undefined" ? smart : { moving: false },
    G: typeof G !== "undefined" ? G : {},
    parent: typeof parent !== "undefined" ? parent : {},
    party_say: typeof party_say === "function" ? party_say : null,
    pm: typeof pm === "function" ? pm : null,
    say: typeof say === "function" ? say : null,
    send_cm: typeof send_cm === "function" ? send_cm : null,
    game_log: typeof game_log === "function" ? game_log : function () {},
    set_message: typeof set_message === "function" ? set_message : function () {},
    get_player: typeof get_player === "function" ? get_player : function () {
      return null;
    },
    get_party: typeof get_party === "function" ? get_party : function () {
      return {};
    },
    get_nearest_monster: typeof get_nearest_monster === "function" ? get_nearest_monster : function () {
      return null;
    },
    is_in_range: typeof is_in_range === "function" ? is_in_range : function () {
      return false;
    },
    is_on_cooldown: typeof is_on_cooldown === "function" ? is_on_cooldown : function () {
      return false;
    },
    use_skill: typeof use_skill === "function" ? use_skill : function () {},
    can_move_to: typeof can_move_to === "function" ? can_move_to : function () {
      return true;
    },
    stop: typeof stop === "function" ? stop : function () {},
    smart_move: typeof smart_move === "function" ? smart_move : async function () {},
    change_server: typeof change_server === "function" ? change_server : function () {},
    buy: typeof buy === "function" ? buy : async function () {},
    sell: typeof sell === "function" ? sell : async function () {},
    send_item: typeof send_item === "function" ? send_item : async function () {},
    send_gold: typeof send_gold === "function" ? send_gold : function () {},
    bank_store: typeof bank_store === "function" ? bank_store : async function () {},
    bank_retrieve: typeof bank_retrieve === "function" ? bank_retrieve : async function () {},
    equip: typeof equip === "function" ? equip : async function () {},
    unequip: typeof unequip === "function" ? unequip : async function () {},
    upgrade: typeof upgrade === "function" ? upgrade : async function () {},
    compound: typeof compound === "function" ? compound : async function () {},
    exchange: typeof exchange === "function" ? exchange : async function () {},
    exchange_buy: typeof exchange_buy === "function" ? exchange_buy : async function () {},
    get_secondhands: typeof get_secondhands === "function" ? get_secondhands : async function () {
      return { success: true, items: [] };
    },
    buy_secondhand: typeof buy_secondhand === "function" ? buy_secondhand : async function () {
      return { failed: true, reason: "no_buy_secondhand" };
    },
    auto_craft: typeof auto_craft === "function" ? auto_craft : async function () {
      return { failed: true, reason: "no_auto_craft" };
    },
    trade: typeof trade === "function" ? trade : function () {},
    open_stand: typeof open_stand === "function" ? open_stand : function () {},
    close_stand: typeof close_stand === "function" ? close_stand : function () {},
    use: typeof use === "function" ? use : function () {},
    use_skill: typeof use_skill === "function" ? use_skill : function () {},
    attack: typeof attack === "function" ? attack : function () {},
    heal: typeof heal === "function" ? heal : function () {},
    can_attack: typeof can_attack === "function" ? can_attack : function () {
      return false;
    },
    can_heal: typeof can_heal === "function" ? can_heal : function () {
      return false;
    },
    change_target: typeof change_target === "function" ? change_target : function () {},
    move: typeof move === "function" ? move : function () {},
    loot: typeof loot === "function" ? loot : function () {},
    send_party_invite: typeof send_party_invite === "function" ? send_party_invite : function () {},
    accept_party_invite: typeof accept_party_invite === "function" ? accept_party_invite : function () {},
    sleep: typeof sleep === "function" ? sleep : async function (ms) {
      return new Promise(function (r) {
        setTimeout(r, ms);
      });
    },
    interact: typeof interact === "function" ? interact : null,
    respawn: typeof respawn === "function" ? respawn : function () {},
    leave: typeof leave === "function" ? leave : async function () {},
  };

  const api = {
    get character() {
      return typeof character !== "undefined" ? character : g.character;
    },
    get smart() {
      return typeof smart !== "undefined" ? smart : g.smart;
    },
    get G() {
      return typeof G !== "undefined" ? G : g.G;
    },
    get parent() {
      return typeof parent !== "undefined" ? parent : g.parent;
    },
    storage: typeof localStorage !== "undefined" ? localStorage : { getItem() { return null; }, setItem() {} },
    log: { game: [], said: [], cm: [], server: [] },
    _now: () => Date.now(),
    game_log(m) {
      try {
        g.game_log(m);
      } catch (e) {}
    },
    set_message(m) {
      try {
        g.set_message(m);
      } catch (e) {}
    },
    party_say(m) {
      try {
        if (!g.party_say) return { ok: false, reason: "no_party_say" };
        const r = g.party_say(m);
        if (r && (r.failed || r.ok === false)) return { ok: false, reason: r.reason || "failed" };
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: (e && e.reason) || e };
      }
    },
    pm(to, m) {
      try {
        if (g.pm) {
          const r = g.pm(to, m);
          if (r && (r.failed || r.ok === false)) return { ok: false, reason: r.reason || "failed" };
          return { ok: true };
        }
        if (g.say) {
          g.say(m, to);
          return { ok: true };
        }
        return { ok: false, reason: "no_pm" };
      } catch (e) {
        return { ok: false, reason: (e && e.reason) || e };
      }
    },
    async send_cm(to, message) {
      try {
        if (!g.send_cm) return { receivers: [] };
        const r = await g.send_cm(to, message);
        if (r && Array.isArray(r.receivers)) return { receivers: r.receivers };
        if (Array.isArray(r)) return { receivers: r };
        // Some AL builds resolve void on success — treat as delivered locally
        if (r == null) return { receivers: Array.isArray(to) ? to.slice() : [to] };
        return { receivers: [] };
      } catch (e) {
        return { receivers: [] };
      }
    },
    get_player(name) {
      return g.get_player(name);
    },
    get_party() {
      return g.get_party();
    },
    get_nearest_monster(q) {
      return g.get_nearest_monster(q);
    },
    is_in_range(e) {
      return g.is_in_range(e);
    },
    is_on_cooldown(skill) {
      return g.is_on_cooldown(skill);
    },
    can_move_to(x, y) {
      return g.can_move_to(x, y);
    },
    stop(what) {
      try {
        g.stop(what);
      } catch (e) {}
    },
    async smart_move(dest) {
      try {
        const r = await g.smart_move(dest);
        if (r && (r.failed || r.ok === false)) return r;
        return r;
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    change_server(r, i) {
      g.change_server(r, i);
    },
    async buy(name, q) {
      return g.buy(name, q);
    },
    async sell(slot, q) {
      return g.sell(slot, q);
    },
    async send_item(name, i, q) {
      return g.send_item(name, i, q);
    },
    send_gold(name, amount) {
      return g.send_gold(name, amount);
    },
    async bank_store(i, pack, pack_num) {
      try {
        if (typeof g.bank_store !== "function") return { failed: true, reason: "no_bank_store" };
        // Bare bank_store(i) often rejects reason "invalid" on Mainframe even with free
        // slots; specifying a pack with an empty slot works (live probe 2026-09-09).
        // Picking *which* pack has room is the caller's job (merchant.storeBagItemToBank
        // already does that pack-scan) -- this is a thin passthrough, not a second copy
        // of that selection logic.
        if (pack && pack_num == null) return await g.bank_store(i, pack);
        if (pack) return await g.bank_store(i, pack, pack_num);
        return await g.bank_store(i);
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    async bank_retrieve(pack, i) {
      try {
        if (typeof g.bank_retrieve !== "function") return { failed: true, reason: "no_bank_retrieve" };
        return await g.bank_retrieve(pack, i);
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    async equip(i, slot) {
      try {
        if (typeof equip !== "function") return { failed: true, reason: "no_equip" };
        return await equip(i, slot);
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    async unequip(slot) {
      try {
        if (typeof unequip !== "function") return { failed: true, reason: "no_unequip" };
        return await unequip(slot);
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    async upgrade(itemI, scrollI, offering, calculate) {
      try {
        if (typeof upgrade !== "function") return { failed: true, reason: "no_upgrade" };
        return await upgrade(itemI, scrollI, offering, calculate);
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    async compound(a, b, cSlot, scrollI) {
      try {
        if (typeof compound !== "function") return { failed: true, reason: "no_compound" };
        return await compound(a, b, cSlot, scrollI);
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    async exchange(item_num) {
      try {
        if (typeof exchange !== "function") return { failed: true, reason: "no_exchange" };
        return await exchange(item_num);
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    async exchange_buy(token, name) {
      try {
        if (typeof g.exchange_buy !== "function") return { failed: true, reason: "no_exchange_buy" };
        return await g.exchange_buy(token, name);
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    async get_secondhands(timeout_ms) {
      try {
        if (typeof g.get_secondhands !== "function") return { failed: true, reason: "no_get_secondhands" };
        return await g.get_secondhands(timeout_ms);
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    async buy_secondhand(rid, timeout_ms) {
      try {
        if (typeof g.buy_secondhand !== "function") return { failed: true, reason: "no_buy_secondhand" };
        return await g.buy_secondhand(rid, timeout_ms);
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    async auto_craft(name) {
      try {
        if (typeof auto_craft === "function") return await auto_craft(name);
        if (typeof g.auto_craft === "function") return await g.auto_craft(name);
        return { failed: true, reason: "no_auto_craft" };
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    async trade(i, tradeSlot, price, quantity) {
      try {
        if (typeof trade !== "function") return { failed: true, reason: "no_trade" };
        // Official: trade(num, trade_slot, price, quantity). Reject 2-arg trade(i, price).
        if (arguments.length < 3 || tradeSlot == null || price == null) {
          return { failed: true, reason: "bad_args" };
        }
        return await trade(i, tradeSlot, price, quantity == null ? 1 : quantity);
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    open_stand() {
      try {
        if (typeof open_stand === "function") open_stand();
        else if (g.parent && typeof g.parent.open_merchant === "function") {
          const items = g.character && g.character.items;
          let si = -1;
          if (items) for (let i = 0; i < items.length; i++) if (items[i] && items[i].name === "stand0") si = i;
          if (si >= 0) g.parent.open_merchant(si);
        }
      } catch (e) {}
    },
    close_stand() {
      try {
        if (typeof close_stand === "function") close_stand();
        else if (g.parent && typeof g.parent.close_merchant === "function") g.parent.close_merchant();
      } catch (e) {}
    },
    use(skill) {
      return g.use(skill);
    },
    use_skill(skill, target) {
      return g.use_skill(skill, target);
    },
    attack(t) {
      return g.attack(t);
    },
    heal(t) {
      return g.heal(t);
    },
    can_attack(t) {
      return g.can_attack(t);
    },
    can_heal(t) {
      return g.can_heal(t);
    },
    change_target(t) {
      return g.change_target(t);
    },
    move(x, y) {
      return g.move(x, y);
    },
    loot() {
      try {
        g.loot();
      } catch (e) {}
    },
    send_party_invite(n) {
      return g.send_party_invite(n);
    },
    accept_party_invite(n) {
      return g.accept_party_invite(n);
    },
    async sleep(ms) {
      return g.sleep(ms);
    },
    async interact(name, timeout_ms) {
      try {
        if (typeof interact === "function") return await interact(name, timeout_ms);
        if (typeof g.interact === "function") return await g.interact(name, timeout_ms);
        return { failed: true, reason: "no_interact" };
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    async respawn() {
      return g.respawn();
    },
    async leave() {
      return g.leave();
    },
    transport(map, spawn) {
      try {
        if (typeof transport === "function") return transport(map, spawn);
        if (typeof g.transport === "function") return g.transport(map, spawn);
        return { failed: true, reason: "no_transport" };
      } catch (e) {
        return { failed: true, reason: (e && e.reason) || (e && e.message) || e };
      }
    },
    on(ev, fn) {
      const ch = typeof character !== "undefined" ? character : g.character;
      if (!ch || !ch.on) return;
      const hkey = "__al_api_handlers_" + (ch.name || "unknown");
      if (typeof globalThis !== "undefined") {
        if (!globalThis[hkey]) globalThis[hkey] = { cm: [], partym: [], pm: [] };
      }
      if (ev === "cm") {
        const wrapper = function (m) {
          if (m && m.message == null && m.data != null) {
            m = Object.assign({}, m, { message: m.data });
          }
          fn(m);
        };
        if (typeof globalThis !== "undefined") globalThis[hkey].cm.push(wrapper);
        ch.on("cm", wrapper);
      } else if (ev === "partym") {
        if (typeof globalThis !== "undefined") globalThis[hkey].partym.push(fn);
        ch.on("partym", fn);
      } else if (ev === "pm") {
        if (typeof globalThis !== "undefined") globalThis[hkey].pm.push(fn);
        ch.on("pm", fn);
      }
    },
    clearHandlers() {
      const ch = typeof character !== "undefined" ? character : g.character;
      if (!ch) return;
      const hkey = "__al_api_handlers_" + (ch.name || "unknown");
      const bucket = typeof globalThis !== "undefined" ? globalThis[hkey] : null;
      if (!bucket || typeof ch.removeListener !== "function") return;
      for (let i = 0; i < bucket.cm.length; i++) ch.removeListener("cm", bucket.cm[i]);
      for (let i = 0; i < bucket.partym.length; i++) ch.removeListener("partym", bucket.partym[i]);
      for (let i = 0; i < bucket.pm.length; i++) ch.removeListener("pm", bucket.pm[i]);
      bucket.cm = [];
      bucket.partym = [];
      bucket.pm = [];
    },
  };
  return api;
}

module.exports = { createAlApi };
