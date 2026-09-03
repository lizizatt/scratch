async function go_npc(to) {
  var r; close_stand();
  if (to === "bank" && character.map === "bank") return true;
  return !!(r = await smart_move({ to: to })) && !r.failed;
}
async function move_ent(e, dest) {
  if (e.where === dest) return "have";
  if (e.where === "sale") {
    if (!character.slots["trade" + e.loc]) return "fail";
    close_stand();
    try { await unequip("trade" + e.loc); } catch (err) { return "fail"; }
    return character.slots["trade" + e.loc] ? "fail" : "moved";
  }
  if (e.where === "bank" && dest === "bag") {
    if (!(bank_obj() && bank_obj()[e.loc[0]] && bank_obj()[e.loc[0]][e.loc[1]])) return "fail";
    if (!(await go_npc("bank"))) return "fail";
    try { await bank_retrieve(e.loc[0], e.loc[1]); } catch (err) { return "fail"; }
    snap_bank(); return (bank_obj()[e.loc[0]] && bank_obj()[e.loc[0]][e.loc[1]]) ? "fail" : "moved";
  }
  if (e.where === "bag" && dest === "bank") {
    if (!character.items[e.loc]) return "fail";
    if (!(await go_npc("bank"))) return "fail";
    try { await bank_store(e.loc); } catch (err) { return "fail"; }
    snap_bank(); return character.items[e.loc] ? "fail" : "moved";
  }
  if (e.where === "bag" && dest === "sale") {
    var slot = next_trade(); if (slot < 0 || !character.items[e.loc]) return "fail";
    try { await trade(e.loc, slot, Math.max(1, Math.floor(vg(e.name) * 1.5)), 1); } catch (err) { return "fail"; }
    return character.items[e.loc] ? "fail" : "moved";
  }
  if (e.where === "bank" && dest === "sale") {
    if ((await move_ent(e, "bag")) === "fail") return "fail";
    e = find_ent(e.name, e.level, "bag");
    if (!e) return "fail";
    return await move_ent(e, "sale");
  }
  return "fail";
}
function find_ent(name, level, where) {
  var a = idx(), i;
  for (i = 0; i < a.length; i++) if (a[i].name === name && a[i].level === (level || 0) && (!where || a[i].where === where)) return a[i];
  return null;
}
function bag_three(name, level) {
  var slots = [], i, it;
  for (i = 0; i < character.items.length && slots.length < 3; i++) {
    it = character.items[i];
    if (it && it.name === name && lv(it) === (level || 0)) slots.push(i);
  }
  return slots.length === 3 ? slots : null;
}
async function wait_q(k) { var n; for (n = 0; n < 200 && character.q && character.q[k]; n++) await sleep(250); }
async function acquire_step(name, qty, dest, level) {
  var e;
  level = level || 0;
  if (cnt(name, level, dest) >= qty) return "have";
  e = find_ent(name, level);
  if (e && e.where !== dest) return await move_ent(e, dest);
  e = await try_buy(name, level);
  if (e) return e;
  e = await buy_leaf(name, level);
  return e === "bought" ? e : "fail";
}
async function acquire(name, qty, dest) {
  var n, r = "ok";
  for (n = 0; n < 40; n++) { r = await acquire_step(name, qty, dest, 0); if (r === "have" || r === "fail") return r; }
  return "fail";
}
function bank_sellable() {
  var i, a = idx(), best = null, skip = held_set();
  for (i = 0; i < a.length; i++) {
    if (a[i].where !== "bank") continue;
    if (skip[a[i].name]) continue;
    if (!best || vg(a[i].name) > vg(best.name)) best = a[i];
  }
  return best;
}
async function park_bag() {
  var i, it, skip = held_set();
  if (!(await go_npc("bank"))) return false;
  for (i = 0; i < character.items.length; i++) {
    it = character.items[i];
    if (!it || is_pot(it) || it.name === "stand0" || it.l || skip[it.name]) continue;
    try { await bank_store(i); } catch (e) {}
  }
  snap_bank();
  return true;
}
async function restock_sale() {
  var n, src;
  for (n = 0; n < 16; n++) {
    if (next_trade() < 0) return;
    src = bank_sellable(); if (!src) return;
    if ((await move_ent(src, "sale")) === "fail") return;
  }
}
async function run_acquire() {
  var i, list;
  list = (HOLD || []).slice().sort(function (a, b) { return vg(a[0]) - vg(b[0]); });
  for (i = 0; i < list.length; i++) await acquire(list[i][0], list[i][1], "bank");
  list = (STOCK || []).slice().sort(function (a, b) { return vg(a[0]) - vg(b[0]); });
  for (i = 0; i < list.length; i++) await acquire(list[i][0], list[i][1], "bag");
}
function hold_done() {
  var i, list = HOLD || [];
  for (i = 0; i < list.length; i++) if (cnt(list[i][0], 0, "bank") < list[i][1]) return false;
  return true;
}
async function stock_store() {
  if (!(await go_npc("bank"))) return false;
  await park_bag();
  await empty_sale();
  await park_bag();
  await restock_sale();
  close_stand();
  if ((await smart_move({ map: "main", x: 40, y: -20 }) || {}).failed) return false;
  open_stand(); await list_sale();
  return true;
}
async function run_econ() {
  var n;
  if (typeof ponty_miss === "object") for (n in ponty_miss) delete ponty_miss[n];
  for (n = 0; n < 30; n++) {
    await run_acquire();
    await run_craft();
    if (hold_done()) break;
  }
  if (typeof run_combine === "function") await run_combine();
  await stock_store();
}
