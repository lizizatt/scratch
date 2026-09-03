var FREE = 5, busy = false, PLAN_OK = false, CYCLE_MS = 300000, cycle_at = 0;
var FIGHTERS = ["Jazwyn", "Sarene", "Zarook"], HOME = ["US", "II"];
var HOLD = [["armorring", 1]], STOCK = [], GOLD_FLOAT = 100000, PONTY_MAX = 1.25, COMBINE_MAX = 5;
try {
  load_code("merchant_plan"); load_code("merchant_ponty"); load_code("merchant_ops"); load_code("merchant_craft"); load_code("merchant_combine");
  if (typeof run_acquire === "function" && typeof run_craft === "function" && typeof buy_leaf === "function") PLAN_OK = true; else throw 1;
} catch (e) { game_log("plan load fail"); set_message("No plan"); }
function go_home() { if (parent.server_region === HOME[0] && parent.server_identifier === HOME[1]) return false; try { change_server(HOME[0], HOME[1]); } catch (e) {} return true; }
function is_pot(it) { return it && (it.name.indexOf("hpot") === 0 || it.name.indexOf("mpot") === 0); }
function stand_i() { return locate_item("stand0"); }
function open_stand() { var s = stand_i(); if (s >= 0) try { parent.open_merchant(s); } catch (e) {} }
function close_stand() { try { parent.close_merchant(); } catch (e) {} }
function tell(on) {
  var i, msg = "hold:" + (on ? 1 : 0), data = { hold: on ? 1 : 0 };
  for (i = 0; i < FIGHTERS.length; i++) try { pm(FIGHTERS[i], msg); } catch (e) {}
  try { send_cm(FIGHTERS, data); } catch (e) {}
}
function hold() { tell(1); set_message("Hold"); game_log("Hold sent"); }
function resume() { tell(0); set_message("Stand"); game_log("Resume sent"); }
function next_trade() { for (var s = 1; s <= 16; s++) if (!character.slots["trade" + s]) return s; return -1; }
function list_sale() {
  for (var i = 0, slot, it, g; i < character.items.length; i++) {
    it = character.items[i];
    if (!it || it.price != null || is_pot(it) || it.name === "stand0" || it.l) continue;
    if (typeof held_set === "function" && held_set()[it.name]) continue;
    g = G.items[it.name]; if (!g || g.e) continue;
    slot = next_trade(); if (slot < 0) return;
    try { trade(i, slot, Math.max(1, Math.floor((g.g || 20) * 1.5)), it.q || 1); } catch (e) {}
  }
}
function empty_sale() {
  close_stand();
  for (var s = 1; s <= 16; s++) if (character.slots["trade" + s]) try { unequip("trade" + s); } catch (e) {}
}
function use_pots() {
  if (safeties && mssince(last_potion) < min(200, character.ping * 3) || is_on_cooldown("use_hp")) return;
  var skill = character.hp / character.max_hp < 0.5 ? "use_hp" : character.mp / character.max_mp < 0.5 ? "use_mp" : null;
  if (skill) { last_potion = new Date(); use_skill(skill); }
}
function mluck_near() {
  var d = G.skills.mluck || {};
  if ((d.level && character.level < d.level) || character.mp < (d.mp || 0) || !can_use("mluck")) return;
  for (var id in parent.entities) {
    var p = parent.entities[id];
    if (!p || p.type !== "character" || p.rip || (p.s && p.s.mluck && p.s.mluck.f === character.name)) continue;
    if (parent.distance(character, p) > (d.range || 320)) continue;
    use_skill("mluck", p); return;
  }
}
async function run_cycle() {
  var n, i;
  set_message("Empty"); empty_sale();
  set_message("Bank");
  if (!(await go_npc("bank"))) return;
  if (typeof snap_bank === "function") snap_bank(); await sleep(400);
  if (typeof ponty_miss === "object") for (i in ponty_miss) delete ponty_miss[i];
  for (n = 0; n < 30; n++) {
    set_message("Buy"); await run_acquire();
    set_message("Craft"); await run_craft();
    if (typeof hold_done === "function" && hold_done()) break;
  }
  set_message("Combine"); if (typeof run_combine === "function") await run_combine();
  set_message("Stock"); await stock_store();
  set_message("Stand");
}
async function logistics() {
  if (busy || character.rip) return;
  if (!PLAN_OK) { set_message("No plan"); return; }
  if (go_home()) return;
  if (character.map === "jail") { await leave(); return; }
  if (cycle_at && Date.now() - cycle_at < (CYCLE_MS || 300000)) return;
  busy = true;
  try { await run_cycle(); cycle_at = Date.now(); } catch (e) { game_log("cycle fail"); }
  busy = false;
}
try { performance_trick(); } catch (e) {}
setInterval(function () { use_pots(); if (!smart.moving) mluck_near(); }, 250);
setInterval(logistics, 10000); logistics();
