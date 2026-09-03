async function buy_scroll(name) {
  var spend = character.gold - (GOLD_FLOAT || 0), cost = vg(name);
  if (!(spend > 0) || !(cost > 0) || spend < cost) return "fail";
  if (!(await go_npc("upgrade"))) return "fail";
  try { await buy_with_gold(name, 1); return "bought"; } catch (e) { game_log("scroll buy fail"); return "fail"; }
}
async function combine_step() {
  var a = idx(), cand = [], seen = {}, i, name, lv0, e, three, sc, sci;
  for (i = 0; i < a.length; i++) {
    name = a[i].name; lv0 = a[i].level || 0;
    if (seen[name + "@" + lv0] || !(G.items[name] && G.items[name].compound) || lv0 >= (COMBINE_MAX || 5)) continue;
    seen[name + "@" + lv0] = 1;
    if (cnt(name, lv0) >= 3) cand.push({ name: name, level: lv0 });
  }
  cand.sort(function (x, y) { return y.level - x.level; });
  for (i = 0; i < cand.length; i++) {
    name = cand[i].name; lv0 = cand[i].level;
    if (cnt(name, lv0, "bag") < 3) {
      e = find_ent(name, lv0); if (!e || e.where === "bag") return null;
      return await move_ent(e, "bag");
    }
    three = bag_three(name, lv0); sc = cscroll(name, lv0); sci = locate_item(sc);
    if (!three) return null;
    if (sci < 0) return await buy_scroll(sc);
    if (!(await go_npc("upgrade"))) return "fail";
    try { await compound(three[0], three[1], three[2], sci); await wait_q("compound"); return "ok"; } catch (err) { return "fail"; }
  }
  return null;
}
async function run_combine() {
  var n, r;
  for (n = 0; n < 24; n++) { r = await combine_step(); if (!r || r === "fail") return; }
}
