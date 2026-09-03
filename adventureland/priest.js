var ATTACK_MODE = true, POTION_TARGET = 500, POTION_MIN = 40, MAX_ATTACK_RATIO = 0.28;
var LEADER = "Jazwyn", TANK = "Jazwyn", MERCHANT = "puppygirl", PARTY = ["Jazwyn", "Sarene", "Zarook"];
var LADDER = [[1, "goo"], [8, "bee"], [12, "crab"], [16, "snake"], [20, "armadillo"], [24, "arcticbee"], [28, "porcupine"], [32, "croc"], [34, "tortoise"], [36, "bat"], [42, "spider"], [48, "scorpion"], [54, "boar"], [60, "bigbird"], [66, "gscorpion"], [72, "wolf"], [78, "dryad"]];
var busy = false, farm = null, last_lv = character.level;
var HOME = ["US", "II"], FARM = ["US", "III"], HK = "hold_" + character.name, rally = false, hold_done = false;
function ls(v) { try { if (v == null) return localStorage.getItem(HK) === "1"; localStorage.setItem(HK, v ? "1" : "0"); } catch (e) { return false; } }
var hold = !!ls(), last_pots_say = new Date(0), last_summon = new Date(0), last_gold = new Date(0), seen = {};
function go_s(s) { if (parent.server_region === s[0] && parent.server_identifier === s[1]) return false; try { change_server(s[0], s[1]); } catch (e) {} return true; }
function pot(kind) { return kind === "hp" ? (character.level >= 30 ? "hpot1" : "hpot0") : (character.level >= 30 ? "mpot1" : "mpot0"); }
function bump(n, lv, hp) { var s = seen[n] || (seen[n] = { l: 0, h: 0 }); if (lv > s.l) s.l = lv; if (hp > s.h) s.h = hp; return s; }
function att_cap() { return Math.max(8, Math.floor(bump(character.name, character.level, character.max_hp).h * MAX_ATTACK_RATIO)); }
function price(name) { return (G.items[name] && G.items[name].g) || 20; }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function is_pot(it) { return it && (it.name.indexOf("hpot") === 0 || it.name.indexOf("mpot") === 0); }
function member(n) { return n === character.name ? character : ((get_party() || {})[n] || get_player(n)); }
function desired() {
  var lvl = 99, hp = character.max_hp, i, j, d, pickm, p, cap, n, s;
  bump(character.name, character.level, character.max_hp);
  for (i = 0; i < PARTY.length; i++) {
    n = PARTY[i]; p = member(n);
    if (p && !p.rip && p.level >= 1) bump(n, p.level, p.max_hp || 0);
    s = seen[n]; if (s && s.l && s.l < lvl) { lvl = s.l; hp = s.h || hp; }
  }
  if (lvl === 99) lvl = character.level;
  lvl = Math.min(lvl, 90); pickm = LADDER[0][1]; cap = Math.max(8, Math.floor(hp * MAX_ATTACK_RATIO));
  for (i = 0; i < LADDER.length; i++) if (lvl >= LADDER[i][0]) pickm = LADDER[i][1];
  if (G.monsters[pickm] && G.monsters[pickm].attack > cap) {
    for (j = LADDER.length - 1; j >= 0; j--) {
      d = G.monsters[LADDER[j][1]];
      if (d && d.attack <= cap && lvl >= LADDER[j][0]) return LADDER[j][1];
    }
    return "goo";
  }
  return pickm;
}
function is_keep(it) { return !it || is_pot(it); }
function restock_cost() { var hp = pot("hp"), mp = pot("mp"); return Math.max(0, POTION_TARGET - quantity(hp)) * price(hp) + Math.max(0, POTION_TARGET - quantity(mp)) * price(mp); }
function low_pots() { return quantity(pot("hp")) < POTION_MIN || quantity(pot("mp")) < POTION_MIN; }
function needs_pots() { var c = restock_cost(); return low_pots() && c > 0 && character.gold >= c; }
function needs_vendor() { return character.esize === 0 || needs_pots(); }
function bank_dump() { if (character.map !== "bank") return; for (var i = 0, it; i < character.items.length; i++) if ((it = character.items[i]) && !is_pot(it)) try { bank_store(i); } catch (e) {} }
function find_merch() { var m = get_player(MERCHANT), id, p; if (m) return m; for (id in parent.entities) { p = parent.entities[id]; if (p && p.type === "character" && p.name && ("" + p.name).toLowerCase() === MERCHANT.toLowerCase()) return p; } return null; }
async function offload() { var m = find_merch(), g, d; if (mssince(last_gold) < 2500 || !m || m.rip || character.bank || (g = Math.floor(character.gold - 1000)) <= 0 || (d = parent.distance(character, m)) > 320) return; last_gold = new Date(); try { await send_gold(m.name, g); } catch (e) { last_gold = new Date(0); game_log("Gold fail:" + ((e && e.reason) || e)); } }
function use_pots() {
  if (safeties && mssince(last_potion) < min(200, character.ping * 3) || is_on_cooldown("use_hp")) return;
  var skill = character.hp / character.max_hp < 0.5 ? "use_hp" : character.mp / character.max_mp < 0.5 ? "use_mp" : null;
  if (skill) { last_potion = new Date(); use_skill(skill); }
}
function ding() {
  if (character.level <= last_lv) return;
  last_lv = character.level; party_say("Ding! Bless.");
  var e = []; for (var n in G.skills) if (G.skills[n].emote) e.push(n); if (e.length) use_skill(e[Math.floor(Math.random() * e.length)]);
}
function on_party_invite(name) { if (in_arr(name, PARTY)) accept_party_invite(name); }
function on_magiport(name) { if (in_arr(name, PARTY)) accept_magiport(name); }
async function buy_pots() {
  var hp = pot("hp"), mp = pot("mp"), hb = Math.max(0, POTION_TARGET - quantity(hp)), mb = Math.max(0, POTION_TARGET - quantity(mp));
  if ((!hb && !mb) || character.gold < hb * price(hp) + mb * price(mp)) return;
  if (hb) try { await buy(hp, hb); } catch (e) {}
  if (mb) try { await buy(mp, mb); } catch (e) {}
}
async function restock(to) {
  if (!in_arr(character.map, ["main", "halloween", "winterland", "winter_inn", "winter_cave", "bank"])) { use("town"); await sleep(2000); }
  if (to !== "upgrade") {
    if (hold) party_say("Hold: banking");
    if ((await smart_move({ to: "bank" }) || {}).failed) return;
    bank_dump(); await sleep(400);
  }
  if ((await smart_move({ to: to || "potions" }) || {}).failed) return;
  if (to !== "upgrade") { if (hold) party_say("Hold: buying pots"); await buy_pots(); }
}
async function hang_hold() { if (character.bank || character.map === "bank") { if (!smart.moving) await smart_move({ to: "potions" }); return; } await offload(); }
function hear_cmd(m) {
  if (!m) return;
  var from = ("" + (m.name || m.from || "")).toLowerCase(), d = m.message != null ? m.message : m.data, v = null;
  if (from !== MERCHANT.toLowerCase()) return;
  if (typeof d === "string") { if (d.indexOf("hold:1") >= 0) v = 1; else if (d.indexOf("hold:0") >= 0) v = 0; else try { d = JSON.parse(d); } catch (e) { return; } }
  if (v == null && d && d.hold != null) v = d.hold;
  if (v == 1) { hold = true; hold_done = false; ls(1); party_say("Hold: restocking"); try { stop("smart"); } catch (e) {} go_s(HOME); }
  else if (v == 0) { var was = hold; hold = false; hold_done = false; ls(0); if (was) party_say("Resuming"); go_s(FARM); }
}
async function follow_lead() {
  var p = (get_party() || {})[LEADER];
  if (p && (character.map !== p.map || parent.distance(character, p) > 80) && !smart.moving)
    await smart_move({ map: p.map, x: p.x, y: p.y });
}
async function go_farm(mtype) {
  mtype = mtype || desired(); if (!mtype) return;
  if (mssince(last_summon) > 15000) { party_say("I need a summon!"); last_summon = new Date(); }
  set_message("To " + mtype); if ((await smart_move({ to: mtype }) || {}).failed) { use("town"); await sleep(2000); await smart_move({ to: mtype }); }
}
function priest_tick() {
  if (busy || smart.moving || character.mp < character.max_mp * 0.25) return false;
  var hurt = 0, lowest = null, i, m, dead = null;
  for (i = 0; i < PARTY.length; i++) {
    m = PARTY[i] === character.name ? character : get_player(PARTY[i]);
    if (!m) continue;
    if (m.rip) { if (!dead) dead = m; continue; }
    if (m.hp < m.max_hp * 0.8) hurt++;
    if (m.hp < m.max_hp * 0.7 && (!lowest || m.hp / m.max_hp < lowest.hp / lowest.max_hp)) lowest = m;
  }
  if (dead && locate_item("essenceoflife") !== -1 && ready("revive") && parent.distance(character, dead) <= character.range)
    { set_message("Revive"); use_skill("revive", dead); return true; }
  if ((hurt >= 2 || (lowest && lowest.hp < lowest.max_hp * 0.35)) && ready("partyheal")) { set_message("PHeal"); use_skill("partyheal"); return true; }
  if (lowest && can_heal(lowest)) { set_message("Heal"); heal(lowest); return true; }
  return false;
}
function farmable(t) { return t && !t.dead && t.mtype && t.mtype.indexOf("target") < 0 && !(G.monsters[t.mtype] || {}).unlist; }
function ready(s) { var d = G.skills[s] || {}; return can_use(s) && character.mp >= (d.mp || 0) && (!d.level || character.level >= d.level); }
function combat() {
  if (character.rip || is_moving(character)) return;
  var lead = get_player(LEADER), tank = get_player(TANK), t = null, w, dx, dy, d;
  if (lead && lead.target) t = get_monster(lead.target) || parent.entities[lead.target];
  if (!farmable(t) && tank && tank.target) t = get_monster(tank.target) || parent.entities[tank.target];
  if (!farmable(t)) { set_message("Idle"); return; }
  change_target(t); set_message("Hunt " + t.mtype);
  w = tank;
  if (w && w.name !== character.name) {
    dx = character.real_x - w.real_x; dy = character.real_y - w.real_y; d = Math.sqrt(dx * dx + dy * dy);
    if (d < 70) {
      if (d < 8) { dx = w.real_x - t.real_x; dy = w.real_y - t.real_y; d = Math.sqrt(dx * dx + dy * dy) || 1; }
      move(w.real_x + dx / d * 90, w.real_y + dy / d * 90); return;
    }
  }
  if (!is_in_range(t)) { move(character.real_x + (t.real_x - character.real_x) / 2, character.real_y + (t.real_y - character.real_y) / 2); return; }
  if (character.mp / character.max_mp >= 0.7 && ready("curse")) use_skill("curse", t);
  if (can_attack(t)) attack(t);
}
function handle_death() { party_say(pick(["Ow.", "Down!", "Not today."])); setTimeout(respawn, 15000); return true; }
async function logistics() {
  if (busy || character.rip) return;
  busy = true;
  try {
    if (character.map === "jail") { party_say("Jail. Ugh."); await leave(); busy = false; return; }
    offload();
    if (hold) {
      if (go_s(HOME)) { }
      else if (!hold_done) { set_message("Hold"); await restock("potions"); if (hold) { hold_done = true; party_say("Hold: ready"); await hang_hold(); } }
      else { set_message("Hold"); await hang_hold(); }
    } else if (go_s(FARM)) { }
    else {
      if (character.hp < character.max_hp * 0.2 && quantity(pot("hp")) === 0) rally = "potions";
      if (needs_vendor() || rally) {
        if (needs_vendor() && mssince(last_pots_say) > 20000) { party_say("I need some potions!"); last_pots_say = new Date(); }
        set_message("Vendor"); await restock(rally === "upgrade" ? "upgrade" : "potions"); rally = false;
      } else {
        farm = desired();
        if (!get_nearest_monster({ type: farm, max_att: att_cap() }) && !smart.moving) await go_farm(farm);
        else { set_message("Follow"); await follow_lead(); }
      }
    }
  } catch (e) {}
  busy = false;
}
try { performance_trick(); } catch (e) {}
function hear(d) {
  if (!d.from || d.from === character.name) return;
  var m = ("" + d.message).toLowerCase();
  if (m.indexOf("ding") >= 0) party_say(pick(["Gratz!", "Yes!", "Proud of you."]));
  if (!in_arr(d.from, PARTY)) return;
  if (m.indexOf("potion") >= 0) { party_say(pick(["Ok!", "On my way!", "Coming!"])); rally = "potions"; }
  else if (m.indexOf("upgrade") >= 0) { party_say(pick(["Ok!", "On my way!", "Coming!"])); rally = "upgrade"; }
}
character.on("partym", hear);
character.on("cm", hear_cmd);
character.on("pm", hear_cmd);
setInterval(function () {
  ding(); use_pots(); loot(); offload();
  if (character.rip) return;
  if (hold && hold_done && !smart.moving) hang_hold();
  if (hold && !hold_done && !busy) logistics();
  if (priest_tick()) return;
  if (hold || !ATTACK_MODE || busy || smart.moving) return;
  combat();
}, 250);
setInterval(logistics, 2500); logistics();
