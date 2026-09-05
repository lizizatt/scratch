var busy = false, PLAN_OK = false, CYCLE_MS = 300000, cycle_at = 0;
var FIGHTERS = ["Jazwyn", "Sarene", "Zarook"], HOME = ["US", "III"];
var HOLD = [["armorring", 1], ["vitring", 9], ["fireblade", 1], ["blade", 2], ["essenceoffire", 2], ["staff", 2], ["ringsj", 6], ["hpbelt", 3], ["hpamulet", 3], ["wbook0", 1], ["sshield", 1], ["shield", 2]], SELL = ["strearring", "intearring", "dexearring", "vitearring", "stramulet", "intamulet", "dexamulet", "rednose", "shoes", "gloves", "pants", "coat", "helmet", "wattire", "wcap", "wshoes", "wgloves"], GOLD_FLOAT = 100000, COMBINE_MAX = 5, SALE_MULT = 0.95;
try {
  load_code("merchant_ops"); load_code("gear_ops");
  if (typeof stock_store !== "function" || typeof park_bag !== "function") throw 1;
} catch (e) { game_log("plan load fail"); set_message("No plan"); }
async function buy_scroll(name) {
  var spend = character.gold - (GOLD_FLOAT || 0), cost = vg(name);
  if (!(spend > 0) || !(cost > 0) || spend < cost) return "fail";
  if (!(await go_npc("upgrade"))) return "fail";
  try { await buy_with_gold(name, 1); return "bought"; } catch (e) { game_log("scroll buy fail"); return "fail"; }
}
async function pull_combine(name, level) {
  var need, e, r;
  need = 3 - cnt(name, level, "bag");
  if (need <= 0) return "have";
  if (typeof ensure_bag === "function" && !(await ensure_bag(need))) return "fail";
  while (cnt(name, level, "bag") < 3) {
    e = find_ent(name, level, "bank") || find_ent(name, level, "sale") || find_ent(name, level, "gear");
    if (!e) return "fail";
    r = await move_ent(e, "bag");
    if (r === "fail") return "fail";
  }
  return "have";
}
function prio_i(name) {
  var p = typeof COMBINE_PRIORITY !== "undefined" ? COMBINE_PRIORITY : null, i;
  if (!p) return 99;
  i = p.indexOf(name); return i < 0 ? 99 : i;
}
async function combine_step() {
  var a = idx(), cand = [], seen = {}, i, name, lv0, three, sc, sci, r;
  for (i = 0; i < a.length; i++) {
    name = a[i].name; lv0 = a[i].level || 0;
    if (seen[name + "@" + lv0] || !(G.items[name] && G.items[name].compound) || lv0 >= (COMBINE_MAX || 5)) continue;
    seen[name + "@" + lv0] = 1;
    if (cnt(name, lv0) >= 3) cand.push({ name: name, level: lv0 });
  }
  cand.sort(function (x, y) { var px = prio_i(x.name), py = prio_i(y.name); return px !== py ? px - py : y.level - x.level; });
  for (i = 0; i < cand.length; i++) {
    name = cand[i].name; lv0 = cand[i].level;
    r = await pull_combine(name, lv0);
    if (r !== "have") continue;
    three = bag_three(name, lv0); sc = cscroll(name, lv0); sci = locate_item(sc);
    if (!three) continue;
    if (sci < 0) {
      r = await buy_scroll(sc);
      if (r !== "bought") continue;
      sci = locate_item(sc);
      if (sci < 0) continue;
      three = bag_three(name, lv0);
      if (!three) continue;
    }
    if (!(await go_npc("upgrade"))) return "fail";
    try { await compound(three[0], three[1], three[2], sci); await wait_q("compound"); return "ok"; } catch (err) { return "fail"; }
  }
  return null;
}
async function run_combine() {
  var n, r;
  for (n = 0; n < 24; n++) {
    if (typeof dlv_has_work === "function" && dlv_has_work()) return "dlv";
    r = await combine_step();
    if (r === "ok") continue;
    return;
  }
}
PLAN_OK = typeof stock_store === "function" && typeof park_bag === "function" && typeof run_combine === "function" && typeof buy_scroll === "function";
if (!PLAN_OK) { game_log("plan load fail"); set_message("No plan"); }
function go_home() { if (!parent.server_region || !parent.server_identifier) return false; if (parent.server_region === HOME[0] && parent.server_identifier === HOME[1]) return false; try { change_server(HOME[0], HOME[1]); } catch (e) {} return true; }
function is_pot(it) { return it && (it.name.indexOf("hpot") === 0 || it.name.indexOf("mpot") === 0); }
function stand_i() { return locate_item("stand0"); }
function open_stand() { var s = stand_i(); if (s >= 0) try { parent.open_merchant(s); } catch (e) {} }
function close_stand() { try { parent.close_merchant(); } catch (e) {} }
async function ensure_stand(on) { if (!!character.stand === !!on) return; if (on) open_stand(); else close_stand(); await sleep(200); }
function tell(on) { try { send_cm(FIGHTERS, { hold: on ? 1 : 0 }); } catch (e) {} }
function hold() { tell(1); set_message("Hold"); game_log("Hold sent"); }
function resume() { tell(0); set_message("Stand"); game_log("Resume sent"); }
function hunt(mob) { var k = ("" + (mob || "")).toLowerCase().replace(/[^a-z0-9_]/g, ""), ban = ["spider", "scorpion", "bigbird"]; if (!k) return; if (ban.indexOf(k) >= 0) { set_message("Skip " + k); game_log("Hunt skipped " + k); return; } try { send_cm("Jazwyn", { hunt: k }); } catch (e) {} set_message("Hunt " + k); game_log("Hunt " + k); }
function grind() { try { send_cm("Jazwyn", { grind: 1 }); } catch (e) {} set_message("Grind"); game_log("Grind sent"); }
function parse_world(raw) { var p = ("" + (raw || "")).trim().replace(/[!/,]+/g, " ").replace(/\s+/g, " ").toUpperCase().split(" ").filter(Boolean); if (p[0] === "WORLD") p = p.slice(1); if (p.length === 1 && /^(I|II|III|IV|V|PVP)$/.test(p[0])) return ["US", p[0]]; if (p.length >= 2 && /^(US|EU|ASIA)$/.test(p[0]) && /^[A-Z0-9]+$/.test(p[1])) return [p[0], p[1]]; return null; }
function world(spec) { var s = parse_world(spec); if (!s) { game_log("World bad"); return; } HOME = s; try { send_cm("Jazwyn", { world: s }); } catch (e) {} set_message("W " + s[0] + "/" + s[1]); game_log("World " + s[0] + "/" + s[1]); }
function next_trade() { for (var s = 1; s <= 16; s++) if (!character.slots["trade" + s]) return s; return -1; }
function sale_clear() { for (var s = 1; s <= 16; s++) if (character.slots["trade" + s]) return false; return true; }
async function list_sale() {
  var cand = [], i, it, g, slot;
  await ensure_stand(true);
  for (i = 0; i < character.items.length; i++) {
    it = character.items[i];
    if (!it || it.price != null || is_pot(it) || it.name === "stand0" || it.l) continue;
    if (typeof sell_ok === "function" && !sell_ok(it)) continue;
    if ((typeof hold_item === "function" && hold_item(it)) || (typeof keep_combine === "function" && keep_combine(it))) continue;
    g = G.items[it.name]; if (!g) continue;
    cand.push({ i: i, name: it.name, g: typeof rank_val === "function" ? rank_val(it) : (g.g || 20), q: it.q || 1 });
  }
  cand.sort(function (a, b) { return b.g - a.g; });
  for (i = 0; i < cand.length; i++) {
    it = character.items[cand[i].i];
    if (!it || it.name !== cand[i].name) continue;
    slot = next_trade(); if (slot < 0) return;
    try { await trade(cand[i].i, slot, sale_price(it), cand[i].q); } catch (e) { game_log("list fail"); }
  }
}
async function empty_sale() {
  var s, n;
  for (n = 0; n < 4; n++) {
    await ensure_stand(true);
    for (s = 1; s <= 16; s++) {
      if (!character.slots["trade" + s]) continue;
      if ((character.esize || 0) <= 0 && typeof ensure_bag === "function") {
        if (!(await ensure_bag(1))) { game_log("empty bag full"); return sale_clear(); }
        await ensure_stand(true);
      }
      try { await unequip("trade" + s); } catch (e) { game_log("unequip fail"); }
    }
    if (sale_clear()) return true;
    if (typeof park_bag === "function") await park_bag();
    await sleep(250);
  }
  return sale_clear();
}
function use_pots(){try{if(is_on_cooldown("use_hp"))return;var skill=character.hp/character.max_hp<0.5?"use_hp":character.mp/character.max_mp<0.5?"use_mp":null;if(skill)use_skill(skill)}catch(e){}}
function mluck_near() {
  var d = G.skills.mluck || {}, id, p;
  if ((d.level && character.level < d.level) || character.mp < (d.mp || 0) || !can_use("mluck")) return;
  for (id in parent.entities) {
    p = parent.entities[id];
    if (!p || p.type !== "character" || p.rip || (p.s && p.s.mluck && p.s.mluck.f === character.name)) continue;
    if (parent.distance(character, p) > (d.range || 320)) continue;
    use_skill("mluck", p); return;
  }
}
async function run_econ() {
  var steps = [["Combine", typeof run_combine === "function" && run_combine], ["Upgrade", typeof upgrade_one === "function" && upgrade_one], ["Ponty", typeof ponty_buy === "function" && ponty_buy]], i, r;
  for (i = 0; i < steps.length; i++) {
    if (steps[i][1]) { set_message(steps[i][0]); r = await steps[i][1](); if (r === "dlv") return "dlv"; }
    if (typeof dlv_has_work === "function" && dlv_has_work()) return "dlv";
  }
  set_message("Stock");
  if (!(await stock_store())) game_log("stock soft");
  return true;
}
async function run_cycle() {
  set_message("Bank"); close_stand();
  if (!(await go_npc("bank"))) return false;
  if (typeof park_bag === "function" && !(await park_bag())) game_log("park fail");
  if (typeof snap_bank === "function") snap_bank(); await sleep(400); return await run_econ();
}
async function drain_dlv() {
  var r; while (typeof dlv_has_work === "function" && dlv_has_work()) { r = await deliver_tick(); if (r === "busy" || r === "empty" || r === "hop") break; }
}
async function logistics() {
  var ok;
  if (busy || character.rip) return;
  if (!PLAN_OK) { set_message("No plan"); return; }
  if (character.map === "jail") { await leave(); return; }
  if ((character.map === "winter_inn" || character.map === "winter_cave") && typeof ensure_main === "function") { await ensure_main(); return; }
  busy = true;
  try {
    await drain_dlv();
    if ((typeof dlv_has_work === "function" && dlv_has_work()) || go_home() || (cycle_at && Date.now() - cycle_at < (CYCLE_MS || 300000))) { busy = false; return; }
    ok = await run_cycle();
    if (ok === "dlv") { await drain_dlv(); set_message("Dlv"); }
    else if (ok === true) { cycle_at = Date.now(); set_message("Stand"); }
    else { game_log("cycle fail"); cycle_at = Date.now() - (CYCLE_MS || 300000) + 60000; set_message("Stand"); }
  } catch (e) { game_log("cycle fail"); }
  busy = false;
}
try { performance_trick(); } catch (e) {}
setInterval(function () { use_pots(); if (!smart.moving) mluck_near(); }, 250);
setInterval(logistics, 10000); logistics();
