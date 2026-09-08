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
    upgrade: typeof upgrade === "function" ? upgrade : async function () {},
    compound: typeof compound === "function" ? compound : async function () {},
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
    async bank_store(i) {
      if (typeof bank_store === "function") return bank_store(i);
      throw { reason: "no_bank_store" };
    },
    async bank_retrieve(pack, i) {
      if (typeof bank_retrieve === "function") return bank_retrieve(pack, i);
      throw { reason: "no_bank_retrieve" };
    },
    async equip(i, slot) {
      if (typeof equip === "function") return equip(i, slot);
      throw { reason: "no_equip" };
    },
    async upgrade(itemI, scrollI, offering, calculate) {
      if (typeof upgrade === "function") return upgrade(itemI, scrollI, offering, calculate);
      throw { reason: "no_upgrade" };
    },
    async compound(a, b, cSlot, scrollI) {
      if (typeof compound === "function") return compound(a, b, cSlot, scrollI);
      throw { reason: "no_compound" };
    },
    trade(i, price) {
      if (typeof trade === "function") return trade(i, price);
    },
    open_stand() {
      try {
        if (typeof open_stand === "function") open_stand();
      } catch (e) {}
    },
    close_stand() {
      try {
        if (typeof close_stand === "function") close_stand();
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
    async respawn() {
      return g.respawn();
    },
    async leave() {
      return g.leave();
    },
    on(ev, fn) {
      const ch = typeof character !== "undefined" ? character : g.character;
      if (!ch || !ch.on) return;
      if (ev === "cm") {
        ch.on("cm", function (m) {
          if (m && m.message == null && m.data != null) {
            m = Object.assign({}, m, { message: m.data });
          }
          fn(m);
        });
      } else if (ev === "partym") ch.on("partym", fn);
      else if (ev === "pm") ch.on("pm", fn);
    },
    clearHandlers() {},
  };
  return api;
}

module.exports = { createAlApi };
