async function go_npc(to) {
  var r; close_stand();
  if (to === "bank" && character.map === "bank") return true;
  return !!(r = await smart_move({ to: to })) && !r.failed;
}
async function move_ent(e, dest) {
  if (e.where === dest) return "have";
  if (e.where === "sale") {
    if (!character.slots["trade" + e.loc]) return "fail";
    close_stand(); unequip("trade" + e.loc); return character.slots["trade" + e.loc] ? "fail" : "moved";
  }
  if (e.where === "bank" && dest === "bag") {
    if (!(bank_obj() && bank_obj()[e.loc[0]] && bank_obj()[e.loc[0]][e.loc[1]])) return "fail";
    if (!(await go_npc("bank"))) return "fail";
    try { bank_retrieve(e.loc[0], e.loc[1]); } catch (err) { return "fail"; }
    snap_bank(); return (bank_obj()[e.loc[0]] && bank_obj()[e.loc[0]][e.loc[1]]) ? "fail" : "moved";
  }
  if (e.where === "bag" && dest === "bank") {
    if (!character.items[e.loc]) return "fail";
    if (!(await go_npc("bank"))) return "fail";
    try { bank_store(e.loc); } catch (err) { return "fail"; }
    snap_bank(); return character.items[e.loc] ? "fail" : "moved";
  }
  if (e.where === "bag" && dest === "sale") {
    var slot = next_trade(); if (slot < 0 || !character.items[e.loc]) return "fail";
    try { trade(e.loc, slot, Math.max(1, Math.floor(vg(e.name) * 1.5)), 1); } catch (err) { return "fail"; }
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
async function buy_leaf(name, level) {
  var spend = character.gold - (GOLD_FLOAT || 0), list, items, it, i;
  if (spend <= 0) return "fail";
  if ((name.indexOf("cscroll") === 0 || name.indexOf("scroll") === 0) && spend >= vg(name)) {
    try { if (!(await go_npc("upgrade"))) return "fail"; await buy_with_gold(name, 1); return "bought"; } catch (e) {}
  }
  if (!(await go_npc("secondhands"))) return "fail";
  try { list = await get_secondhands(); } catch (e) { return "fail"; }
  items = (list && list.items) || list || [];
  for (i = 0; i < 16; i++) {
    it = pick_ponty(items, name, level);
    if (!it || !it.rid || it.price > spend) return "fail";
    try { await buy_secondhand(it.rid); return "bought"; } catch (e) {
      items = items.filter(function (x) { return x && String(x.rid) !== String(it.rid); });
    }
  }
  return "fail";
}
async function wait_q(k) { var n; for (n = 0; n < 200 && character.q && character.q[k]; n++) await sleep(250); }
async function try_plan(name, level) {
  var p = plan_item(name, level), i, op, three, sc, sci, rec, ing, ok, q, n, need, e, froms = {}, keys, f;
  if (!p || p.failed) return null;
  for (i = 0; i < p.ops.length; i++) {
    op = p.ops[i];
    if (op.op === "compound") {
      three = bag_three(op.name, op.from); sc = cscroll(op.name, op.from); sci = locate_item(sc);
      if (three && sci >= 0) {
        if (!(await go_npc("upgrade"))) return "fail";
        try { await compound(three[0], three[1], three[2], sci); await wait_q("compound"); return "crafted"; } catch (err) { return "fail"; }
      }
    }
    if (op.op === "craft") {
      rec = (G.craft || {})[op.name]; ok = rec;
      if (rec) for (q = 0; q < rec.items.length; q++) { ing = rec.items[q]; n = ing[1]; need = ing[2] || 0; if (cnt(n, need, "bag") < ing[0]) ok = false; }
      if (ok) { if ((character.gold - (GOLD_FLOAT || 0)) < ((rec && rec.cost) || 0)) return "fail"; if (!(await go_npc(op.npc === "mcollector" ? "mcollector" : "craftsman"))) return "fail"; try { await auto_craft(op.name); await wait_q("craft"); return "crafted"; } catch (err) { return "fail"; } }
    }
  }
  for (i = 0; i < p.ops.length; i++) {
    op = p.ops[i];
    if (op.op !== "craft") continue;
    rec = (G.craft || {})[op.name];
    if (!rec) continue;
    for (q = 0; q < rec.items.length; q++) {
      ing = rec.items[q]; n = ing[1]; need = ing[2] || 0;
      if (cnt(n, need) < ing[0]) {
        if ((e = find_ent(n, need)) && e.where !== "bag") return await move_ent(e, "bag");
        if ((await buy_leaf(n, need)) === "bought") return "bought";
      }
      if (cnt(n, need, "bag") < ing[0] && (e = find_ent(n, need)) && e.where !== "bag") return await move_ent(e, "bag");
    }
  }
  for (i = 0; i < p.ops.length; i++) if (p.ops[i].op === "compound") froms[p.ops[i].name + "@" + p.ops[i].from] = p.ops[i];
  keys = Object.keys(froms);
  keys.sort(function (a, b) { return froms[b].from - froms[a].from; });
  for (i = 0; i < keys.length; i++) {
    op = froms[keys[i]]; f = op.from; sc = cscroll(op.name, op.from); sci = locate_item(sc);
    if (cnt(op.name, froms[keys[0]].to) >= 1) continue;
    if (cnt(op.name, op.from) >= 3) {
      if ((e = find_ent(op.name, op.from)) && e.where !== "bag") return await move_ent(e, "bag");
      if (sci < 0 && (e = find_ent(sc, 0)) && e.where !== "bag") return await move_ent(e, "bag");
      if (sci < 0) return await buy_leaf(sc, 0);
    } else if (f === 0 && cnt(op.name, 1) < 3) return await buy_leaf(op.name, 0);
  }
  for (i = 0; i < p.ops.length; i++) {
    op = p.ops[i];
    if (op.op === "ponty" && cnt(op.name, op.level || 0) < 1) {
      if ((e = find_ent(op.name, op.level || 0)) && e.where !== "bag") return await move_ent(e, "bag");
      return await buy_leaf(op.name, op.level || 0);
    }
  }
  return null;
}
async function acquire_step(name, qty, dest, level) {
  var e;
  level = level || 0;
  if (cnt(name, level, dest) >= qty) return "have";
  e = find_ent(name, level);
  if (e && e.where !== dest) return await move_ent(e, dest);
  e = await buy_leaf(name, level);
  if (e === "bought") return e;
  e = await try_plan(name, level);
  return e || "fail";
}
async function acquire(name, qty, dest) {
  var n, r = "ok";
  for (n = 0; n < 40; n++) { r = await acquire_step(name, qty, dest, 0); if (r === "have" || r === "fail") return r; }
  return "fail";
}
function bank_sellable() {
  var hold = {}, i, list = HOLD || [], a = idx(), best = null, skip = held_set();
  for (i = 0; i < list.length; i++) hold[list[i][0]] = (hold[list[i][0]] || 0) + list[i][1];
  for (i = 0; i < a.length; i++) {
    if (a[i].where !== "bank") continue;
    if ((hold[a[i].name] || 0) > 0) { hold[a[i].name]--; continue; }
    if (skip[a[i].name] && !(HOLD || []).some(function (h) { return h[0] === a[i].name; })) continue;
    if (!best || vg(a[i].name) > vg(best.name)) best = a[i];
  }
  return best;
}
function cheapest_sale() {
  var a = idx(), i, best = null, skip = held_set();
  for (i = 0; i < a.length; i++) if (a[i].where === "sale" && !skip[a[i].name] && (!best || vg(a[i].name) < vg(best.name))) best = a[i];
  return best;
}
async function restock_sale() {
  var n, src, cheap, slot;
  for (n = 0; n < 16; n++) {
    src = bank_sellable(); if (!src) return;
    if (src.where === "bank" && (character.esize || 0) <= FREE) return;
    slot = next_trade();
    cheap = cheapest_sale();
    if (slot < 0) {
      if (!cheap || vg(src.name) <= vg(cheap.name)) return;
      close_stand(); unequip("trade" + cheap.loc);
    }
    if ((await move_ent(src, "sale")) === "fail") return;
  }
}
async function run_econ() {
  var i, r = "have", list = (HOLD || []).slice().sort(function (a, b) { return vg(a[0]) - vg(b[0]); });
  for (i = 0; i < list.length; i++) { r = await acquire(list[i][0], list[i][1], "bank"); if (r === "fail") break; }
  if (r !== "fail") for (list = (STOCK || []).slice().sort(function (a, b) { return vg(a[0]) - vg(b[0]); }), i = 0; i < list.length; i++) { r = await acquire(list[i][0], list[i][1], "sale"); if (r === "fail") break; }
  if (typeof run_combine === "function") await run_combine();
  await restock_sale();
}
