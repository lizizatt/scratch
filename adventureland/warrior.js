load_code("fighter_core");
function combat(mtype) {
  if (character.rip || is_moving(character)) return;
  var cap = farm_ovr ? 1e9 : att_cap(), lead = get_player(LEADER), t = null, i, p, n = 0, cx = 0, cy = 0, dx, dy, d, id, peel = null;
  if (!is_lead && lead && lead.target) { t = get_monster(lead.target) || parent.entities[lead.target]; if (!farmable(t)) { set_message("Assist"); return; } }
  else {
    t = get_targeted_monster();
    if (!farmable(t) || (mtype && t.mtype !== mtype)) t = get_nearest_monster({ type: mtype, max_att: cap, no_target: true }) || get_nearest_monster({ type: mtype, max_att: cap });
  }
  if (!farmable(t)) return;
  change_target(t); set_message("Hunt " + t.mtype);
  if (ready("taunt")) {
    if (t.target && t.target !== character.name && in_arr(t.target, PARTY)) use_skill("taunt", t);
    else {
      for (id in parent.entities) {
        p = parent.entities[id];
        if (!p || p.type !== "monster" || !farmable(p) || !p.target || p.target === character.name || !in_arr(p.target, PARTY) || parent.distance(character, p) > 200) continue;
        peel = p; break;
      }
      if (peel) use_skill("taunt", peel);
    }
  }
  if (!is_in_range(t)) { if (ready("charge")) use_skill("charge", t); move(character.real_x + (t.real_x - character.real_x) / 2, character.real_y + (t.real_y - character.real_y) / 2); return; }
  for (i = 0; i < PARTY.length; i++) { p = get_player(PARTY[i]); if (p && !p.rip && p.name !== character.name) { cx += p.real_x; cy += p.real_y; n++; } }
  if (n) {
    dx = t.real_x - cx / n; dy = t.real_y - cy / n; d = Math.sqrt(dx * dx + dy * dy) || 1;
    cx = t.real_x + dx / d * 30; cy = t.real_y + dy / d * 30;
    if (parent.distance(character, { real_x: cx, real_y: cy }) > 20) { move(cx, cy); return; }
  }
  if (character.mp / character.max_mp >= 0.75 && ready("cleave")) use_skill("cleave");
  if (can_attack(t)) attack(t);
}
boot_fighter({ combat: combat, ding_line: "Ding! Hah.", do_invite: true });
