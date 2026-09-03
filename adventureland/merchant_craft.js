async function try_buy(name, level) {
  var p = plan_item(name, level), i, op, rec, ing, q, n, need, e, froms = {}, keys, f, r, sc, sci;
  if (!p || p.failed) return null;
  for (i = 0; i < p.ops.length; i++) {
    op = p.ops[i];
    if (op.op !== "craft") continue;
    rec = (G.craft || {})[op.name]; if (!rec) continue;
    for (q = 0; q < rec.items.length; q++) {
      ing = rec.items[q]; n = ing[1]; need = ing[2] || 0;
      if (cnt(n, need) < ing[0]) {
        if ((e = find_ent(n, need)) && e.where !== "bag") return await move_ent(e, "bag");
        if ((await buy_leaf(n, need)) === "bought") return "bought";
      }
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
      if (sci < 0 && (r = await buy_leaf(sc, 0)) === "bought") return r;
    } else if (f === 0 && cnt(op.name, 1) < 3 && (r = await buy_leaf(op.name, 0)) === "bought") return r;
  }
  for (i = 0; i < p.ops.length; i++) {
    op = p.ops[i];
    if (op.op === "ponty" && cnt(op.name, op.level || 0) < 1) {
      if ((e = find_ent(op.name, op.level || 0)) && e.where !== "bag") return await move_ent(e, "bag");
      if ((r = await buy_leaf(op.name, op.level || 0)) === "bought") return r;
    }
  }
  return null;
}
async function try_craft(name, level) {
  var p = plan_item(name, level), i, op, three, sc, sci, rec, ing, ok, q, n, need, e;
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
      if (ok) {
        if ((character.gold - (GOLD_FLOAT || 0)) < ((rec && rec.cost) || 0)) return "fail";
        if (!(await go_npc(op.npc === "mcollector" ? "mcollector" : "craftsman"))) return "fail";
        try { await auto_craft(op.name); await wait_q("craft"); return "crafted"; } catch (err) { return "fail"; }
      }
      if (rec) for (q = 0; q < rec.items.length; q++) {
        ing = rec.items[q]; n = ing[1]; need = ing[2] || 0;
        if (cnt(n, need, "bag") < ing[0] && (e = find_ent(n, need)) && e.where !== "bag") return await move_ent(e, "bag");
      }
    }
  }
  for (i = 0; i < p.ops.length; i++) {
    op = p.ops[i];
    if (op.op !== "compound") continue;
    if (cnt(op.name, op.from) >= 3 && (e = find_ent(op.name, op.from)) && e.where !== "bag") return await move_ent(e, "bag");
    sc = cscroll(op.name, op.from); if (locate_item(sc) < 0 && (e = find_ent(sc, 0)) && e.where !== "bag") return await move_ent(e, "bag");
  }
  return null;
}
async function try_plan(name, level) {
  var r = await try_craft(name, level);
  if (r) return r;
  return await try_buy(name, level);
}
async function craft_one(name, qty) {
  var n, r, e;
  for (n = 0; n < 40; n++) {
    if (cnt(name, 0, "bank") >= qty) return "have";
    e = find_ent(name, 0, "bag");
    if (e) { r = await move_ent(e, "bank"); if (r === "have" || r === "moved") continue; }
    r = await try_craft(name, 0);
    if (!r || r === "fail") return r || "fail";
  }
  return "fail";
}
async function run_craft() {
  var i, list = (HOLD || []).slice().sort(function (a, b) { return vg(a[0]) - vg(b[0]); });
  for (i = 0; i < list.length; i++) await craft_one(list[i][0], list[i][1]);
}
