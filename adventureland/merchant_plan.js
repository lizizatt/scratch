function vg(n) { return (G.items[n] && G.items[n].g) || 0; }
function rank_val(it) {
  if (!it || !it.name) return 0;
  var vendor = vg(it.name), v = vendor;
  try { if (typeof item_value === "function") v = Math.max(vendor, item_value(it) || 0); } catch (e) {}
  return v > 0 ? v : vendor;
}
function keep_combine(it) {
  var g = it && G.items[it.name];
  return !!(g && g.compound && (it.level || 0) < (COMBINE_MAX || 5));
}
function sale_price(it) {
  if (!it || !it.name) return 1;
  var vendor = vg(it.name), v = rank_val(it), mult = SALE_MULT != null ? SALE_MULT : 0.95;
  if (!(vendor > 0)) vendor = 20;
  if (!(v > 0)) v = vendor;
  return Math.max(1, Math.floor(vendor * mult), Math.floor(v * mult));
}
function lv(it) { return (it && it.level) || 0; }
function skip_it(it) { return !it || is_pot(it) || it.name === "stand0" || it.l; }
function cscroll(name, level) {
  var g = G.items[name], grades = (g && g.grades) || [2], gl = 0, i;
  for (i = 0; i < grades.length; i++) if ((level || 0) >= grades[i]) gl = i + 1;
  return gl <= 0 ? "cscroll0" : gl === 1 ? "cscroll1" : "cscroll2";
}
function bom_add(bom, name, level, qty) {
  var k = name + "@" + (level || 0), i;
  for (i = 0; i < bom.length; i++) if (bom[i].k === k) { bom[i].qty += qty; return; }
  bom.push({ k: k, name: name, level: level || 0, qty: qty });
}
function plan_item(name, level, stack) {
  level = level || 0;
  var key = name + "@" + level, rec, tree, bom, ops, i, ing, q, n, need, p, t;
  stack = stack || {};
  if (stack[key]) return { failed: true, reason: "cycle", tree: { name: name, level: level } };
  stack[key] = 1;
  if (level > 0) {
    if (!(G.items[name] && G.items[name].compound))
      return { tree: { name: name, level: level, via: "ponty" }, bom: [{ k: key, name: name, level: level, qty: 1 }], ops: [{ op: "ponty", name: name, level: level }] };
    p = plan_item(name, level - 1, Object.assign({}, stack));
    if (p.failed) return p;
    bom = []; ops = [];
    for (t = 0; t < 3; t++) { p.bom.forEach(function (b) { bom_add(bom, b.name, b.level, b.qty); }); ops = ops.concat(p.ops); }
    bom_add(bom, cscroll(name, level - 1), 0, 1);
    ops.push({ op: "compound", name: name, from: level - 1, to: level });
    return { tree: { name: name, level: level, via: "compound", kids: [p.tree, p.tree, p.tree] }, bom: bom, ops: ops };
  }
  rec = (G.craft || {})[name];
  if (rec && rec.items) {
    tree = { name: name, level: 0, via: "craft", kids: [] }; bom = []; ops = [];
    for (i = 0; i < rec.items.length; i++) {
      ing = rec.items[i]; q = ing[0]; n = ing[1]; need = ing[2] || 0;
      p = plan_item(n, need, Object.assign({}, stack));
      if (p.failed) return p;
      for (t = 0; t < q; t++) tree.kids.push(p.tree);
      p.bom.forEach(function (b) { bom_add(bom, b.name, b.level, b.qty * q); });
      for (t = 0; t < q; t++) ops = ops.concat(p.ops);
    }
    ops.push({ op: "craft", name: name, npc: rec.quest || "craft" });
    return { tree: tree, bom: bom, ops: ops };
  }
  return { tree: { name: name, level: 0, via: "ponty" }, bom: [{ k: key, name: name, level: 0, qty: 1 }], ops: [{ op: "ponty", name: name, level: 0 }] };
}
function snap_bank() {
  var b = {}, p;
  if (!character.bank) return;
  for (p in character.bank) b[p] = character.bank[p] && character.bank[p].slice ? character.bank[p].slice() : character.bank[p];
  character._bank = b;
}
function bank_obj() { return character.bank || character._bank; }
function idx() {
  var out = [], i, pack, bag, s, it, bank;
  snap_bank();
  for (i = 0; i < character.items.length; i++) if ((it = character.items[i]) && !skip_it(it)) out.push({ name: it.name, level: lv(it), qty: it.q || 1, where: "bag", loc: i });
  bank = bank_obj();
  if (bank) for (pack in bank) {
    if (("" + pack).indexOf("items") !== 0) continue;
    bag = bank[pack]; if (!bag) continue;
    for (i = 0; i < bag.length; i++) if ((it = bag[i]) && !skip_it(it)) out.push({ name: it.name, level: lv(it), qty: it.q || 1, where: "bank", loc: [pack, i] });
  }
  for (s = 1; s <= 16; s++) if ((it = character.slots["trade" + s]) && !skip_it(it)) out.push({ name: it.name, level: lv(it), qty: it.q || 1, where: "sale", loc: s });
  for (s in character.slots) {
    if (("" + s).indexOf("trade") === 0) continue;
    if ((it = character.slots[s]) && !skip_it(it)) out.push({ name: it.name, level: lv(it), qty: it.q || 1, where: "gear", loc: s });
  }
  return out;
}
function cnt(name, level, where) {
  var n = 0, a = idx(), i;
  for (i = 0; i < a.length; i++) if (a[i].name === name && a[i].level === (level || 0) && (!where || a[i].where === where)) n += a[i].qty;
  return n;
}
function held_set() {
  var s = {}, i, p, j, list = HOLD || [];
  for (i = 0; i < list.length; i++) {
    s[list[i][0]] = 1;
    p = plan_item(list[i][0], 0);
    if (p && p.bom) for (j = 0; j < p.bom.length; j++) s[p.bom[j].name] = 1;
  }
  return s;
}
function ponty_fair(it) {
  if (!it || !it.name) return 0;
  var fair = (typeof item_value === "function") ? item_value(it) : vg(it.name);
  return fair * ((G.items[it.name] && G.items[it.name].cash) ? 3 : 2);
}
function pick_ponty(items, name, level) {
  var best = null, i, it, price, want = { name: name, level: level || 0 }, cap = ponty_fair(want) * (PONTY_MAX || 1.25);
  items = items || [];
  for (i = 0; i < items.length; i++) {
    it = items[i];
    if (!it || it.name !== name || lv(it) !== (level || 0)) continue;
    price = it.price != null ? it.price : ponty_fair(it);
    if (price > cap) continue;
    if (!best || price < best.price) best = { rid: it.rid, price: price };
  }
  return best;
}
