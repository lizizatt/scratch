async function go_npc(to) {
  var r;
  if (typeof ensure_stand === "function") await ensure_stand(false); else close_stand();
  if (to === "bank" && character.map === "bank") return true;
  return !!(r = await smart_move({ to: to })) && !r.failed;
}
async function move_ent(e, dest) {
  if (e.where === dest) return "have";
  if (e.where === "gear") {
    if (!character.slots[e.loc]) return "fail";
    try { await unequip(e.loc); } catch (err) { game_log("unequip fail"); return "fail"; }
    if (character.slots[e.loc]) return "fail";
    if (dest === "bag") return "moved";
    e = find_ent(e.name, e.level, "bag");
    if (!e) return "fail";
    return await move_ent(e, dest);
  }
  if (e.where === "sale") {
    if (!character.slots["trade" + e.loc]) return "fail";
    if (typeof ensure_stand === "function") await ensure_stand(true); else open_stand();
    try { await unequip("trade" + e.loc); } catch (err) { game_log("unequip fail"); return "fail"; }
    return character.slots["trade" + e.loc] ? "fail" : "moved";
  }
  if (e.where === "bank" && dest === "bag") {
    if (!(bank_obj() && bank_obj()[e.loc[0]] && bank_obj()[e.loc[0]][e.loc[1]])) return "fail";
    if (!(await go_npc("bank"))) return "fail";
    try { await bank_retrieve(e.loc[0], e.loc[1]); } catch (err) { game_log("retrieve fail"); return "fail"; }
    snap_bank(); return (bank_obj()[e.loc[0]] && bank_obj()[e.loc[0]][e.loc[1]]) ? "fail" : "moved";
  }
  if (e.where === "bag" && dest === "bank") {
    if (!character.items[e.loc]) return "fail";
    if (!(await go_npc("bank"))) return "fail";
    try { await bank_store(e.loc); } catch (err) { game_log("store fail"); return "fail"; }
    snap_bank(); return character.items[e.loc] ? "fail" : "moved";
  }
  if (e.where === "bag" && dest === "sale") {
    var slot = next_trade(), it, q;
    if (slot < 0 || !character.items[e.loc]) return "fail";
    it = character.items[e.loc]; q = it.q || 1;
    if (typeof ensure_stand === "function") await ensure_stand(true); else open_stand();
    try { await trade(e.loc, slot, sale_price(it), q); } catch (err) { game_log("trade fail"); return "fail"; }
    return character.items[e.loc] ? "fail" : "moved";
  }
  if (e.where === "bank" && dest === "sale") {
    var name = e.name, level = e.level;
    if ((await move_ent(e, "bag")) === "fail") return "fail";
    e = find_ent(name, level, "bag");
    if (!e) { await strip_gear(); e = find_ent(name, level, "bag"); }
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
async function strip_gear() {
  var s;
  for (s in character.slots) {
    if (!character.slots[s] || ("" + s).indexOf("trade") === 0) continue;
    try { await unequip(s); } catch (e) {}
  }
}
function bank_sellable(bad) {
  var i, a = idx(), best = null, skip = held_set(), key, it, val, bestv = -1, bank;
  bank = bank_obj();
  for (i = 0; i < a.length; i++) {
    if (a[i].where !== "bank") continue;
    if (skip[a[i].name]) continue;
    key = a[i].loc[0] + ":" + a[i].loc[1];
    if (bad && bad[key]) continue;
    it = bank && bank[a[i].loc[0]] && bank[a[i].loc[0]][a[i].loc[1]];
    if (skip_it(it || a[i]) || keep_combine(it || a[i])) continue;
    val = rank_val(it || a[i]);
    if (!best || val > bestv) { best = a[i]; bestv = val; }
  }
  return best;
}
async function park_bag() {
  var i, it, pass, left, fail = 0;
  if (!(await go_npc("bank"))) { game_log("park no bank"); return false; }
  for (pass = 0; pass < 2; pass++) {
    if (pass) await strip_gear();
    for (i = 0; i < character.items.length; i++) {
      it = character.items[i];
      if (!it || is_pot(it) || it.name === "stand0" || it.l) continue;
      try { await bank_store(i); } catch (e) { fail = 1; }
    }
  }
  snap_bank();
  left = 0;
  for (i = 0; i < character.items.length; i++) {
    it = character.items[i];
    if (it && !is_pot(it) && it.name !== "stand0" && !it.l) left++;
  }
  if (left) { game_log("park left " + left); return false; }
  if (fail) game_log("park store fail");
  return true;
}
async function ensure_bag(n) {
  n = n || 1;
  if ((character.esize || 0) >= n) return true;
  if (!(await park_bag())) return false;
  if ((character.esize || 0) >= n) return true;
  await strip_gear();
  if (!(await park_bag())) return false;
  if ((character.esize || 0) >= n) return true;
  game_log("ensure_bag fail");
  return false;
}
async function restock_sale() {
  var n, src, r, bad = {}, key, bagged = 0;
  if (typeof ensure_stand === "function") await ensure_stand(false); else close_stand();
  for (n = 0; n < 32 && bagged < 16; n++) {
    if ((character.esize || 0) <= 0) break;
    src = bank_sellable(bad); if (!src) break;
    r = await move_ent(src, "bag");
    if (r === "fail") {
      key = src.loc[0] + ":" + src.loc[1];
      bad[key] = 1;
      continue;
    }
    bagged++;
  }
  if (bagged) await list_sale();
}
async function stock_store() {
  if (typeof ensure_stand === "function") await ensure_stand(false); else close_stand();
  if (!(await go_npc("bank"))) { game_log("stock no bank"); return false; }
  if (!(await park_bag())) return false;
  if (!(await empty_sale())) { await park_bag(); if (!(await empty_sale())) { game_log("stock empty fail"); return false; } }
  if (!sale_clear()) { game_log("sale not clear"); return false; }
  if (!(await park_bag())) return false;
  await restock_sale();
  if (typeof ensure_stand === "function") await ensure_stand(false); else close_stand();
  if ((await smart_move({ map: "main", x: 40, y: -20 }) || {}).failed) { game_log("plaza fail"); return false; }
  await list_sale();
  return true;
}
