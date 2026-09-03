var MAX_LEVEL = 5, MIN_GOLD = 8000, SCROLL_BUY = 10, CTYPE = "mage";
var WTYPES = ["staff", "great_staff", "wand"];
var ARMOR = ["helmet", "chest", "pants", "shoes", "gloves", "cape", "shield"];
var BASICS = [
  ["mainhand", "staff"], ["helmet", "helmet"], ["chest", "coat"],
  ["pants", "pants"], ["shoes", "shoes"], ["gloves", "gloves"]
];
var SLOTS = ["mainhand", "offhand", "helmet", "chest", "pants", "shoes", "gloves", "cape", "belt"];
var busy = false, stripped = false, done = false, bought = {};

function def(it) { return it && G.items[it.name]; }
function is_gear(it) {
  var g = def(it);
  if (!it || !g || !g.upgrade || it.l) return false;
  if (g.wtype) return in_arr(g.wtype, WTYPES);
  return in_arr(g.type, ARMOR);
}
function scroll_name(it) { return "scroll" + item_grade(it); }
function price(name) { return (G.items[name] && G.items[name].g) || 1000; }
function owned(name) {
  if (quantity(name) > 0) return true;
  for (var i = 0; i < SLOTS.length; i++) {
    var s = character.slots[SLOTS[i]];
    if (s && s.name === name) return true;
  }
  return false;
}
function has_piece(slot, name) {
  var s = character.slots[slot], g, it, i;
  if (s && s.name === name) return true;
  if (s && is_gear(s) && slot === "mainhand") return true;
  if (owned(name)) return true;
  for (i = 0; i < character.items.length; i++) {
    it = character.items[i]; g = def(it);
    if (!is_gear(it)) continue;
    if (slot === "mainhand" && g.wtype) return true;
    if (g.type && G.items[name] && g.type === G.items[name].type) return true;
  }
  return false;
}
function find_upgrade() {
  var best = -1, lvl = 99, i, it, lv;
  for (i = 0; i < character.items.length; i++) {
    it = character.items[i];
    if (!is_gear(it)) continue;
    lv = it.level || 0;
    if (lv < MAX_LEVEL && lv < lvl) { lvl = lv; best = i; }
  }
  return best;
}
async function buy_basics() {
  for (var i = 0; i < BASICS.length; i++) {
    var slot = BASICS[i][0], name = BASICS[i][1];
    if (bought[name] || has_piece(slot, name)) continue;
    if (character.gold < price(name) + MIN_GOLD) continue;
    try { await buy(name); bought[name] = true; } catch (e) {}
    await sleep(200);
  }
}
async function ensure_scroll(name) {
  var n = locate_item(name);
  if (n !== -1) return n;
  if (character.gold < price(name) * SCROLL_BUY + MIN_GOLD) return -1;
  try { await buy(name, SCROLL_BUY); } catch (e) { return -1; }
  await sleep(200);
  return locate_item(name);
}
async function strip() {
  for (var i = 0; i < SLOTS.length; i++) {
    if (character.slots[SLOTS[i]]) { unequip(SLOTS[i]); await sleep(150); }
  }
}
async function wear() {
  for (var i = 0; i < character.items.length; i++) {
    if (!is_gear(character.items[i])) continue;
    try { await equip(i); } catch (e) {}
    await sleep(120);
  }
}
async function go_bench() {
  if (character.map !== "main") { use("town"); await sleep(2000); }
  await smart_move({ to: "upgrade" });
}
async function tick() {
  if (done) { set_message("Gear done"); return; }
  if (character.ctype !== CTYPE) { set_message("Wrong class"); done = true; return; }
  if (character.rip) { setTimeout(respawn, 15000); return; }
  if (character.gold < MIN_GOLD) { set_message("Need gold"); return; }
  set_message("Upgrade");
  await go_bench();
  await buy_basics();
  if (!stripped) { await strip(); stripped = true; }
  var num = find_upgrade();
  if (num < 0) {
    await wear(); stripped = false; done = true; set_message("Gear done"); return;
  }
  var it = character.items[num];
  var sn = await ensure_scroll(scroll_name(it));
  if (sn < 0) { set_message("No scrolls"); return; }
  set_message((it.name || "item") + " +" + (it.level || 0));
  try { await upgrade(num, sn); } catch (e) { game_log("upgrade failed", "#CF575F"); }
  while (character.q && character.q.upgrade) await sleep(80);
}
async function loop() {
  if (busy) return;
  busy = true;
  try { await tick(); } catch (e) {}
  busy = false;
}
try { performance_trick(); } catch (e) {}
setInterval(loop, 500);
