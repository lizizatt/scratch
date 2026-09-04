load_code("fighter_core");
function pre_combat() {
  if (smart.moving || character.mp < character.max_mp * 0.25) return false;
  var hurt = 0, lowest = null, i, m, dead = null;
  for (i = 0; i < PARTY.length; i++) {
    m = PARTY[i] === character.name ? character : get_player(PARTY[i]);
    if (!m) continue;
    if (m.rip) { if (!dead) dead = m; continue; }
    if (m.hp < m.max_hp * 0.8) hurt++;
    if (m.hp < m.max_hp * 0.7 && (!lowest || m.hp / m.max_hp < lowest.hp / lowest.max_hp)) lowest = m;
  }
  if (dead && locate_item("essenceoflife") !== -1 && ready("revive") && parent.distance(character, dead) <= character.range)
    { set_message("Revive"); use_skill("revive", dead); return true; }
  if ((hurt >= 2 || (lowest && lowest.hp < lowest.max_hp * 0.35)) && ready("partyheal")) { set_message("PHeal"); use_skill("partyheal"); return true; }
  if (lowest && can_heal(lowest)) { set_message("Heal"); heal(lowest); return true; }
  return false;
}
function combat() {
  if (character.rip || is_moving(character)) return;
  var lead = get_player(LEADER), tank = get_player(TANK), t = null, w, dx, dy, d;
  if (lead && lead.target) t = get_monster(lead.target) || parent.entities[lead.target];
  if (!farmable(t) && tank && tank.target) t = get_monster(tank.target) || parent.entities[tank.target];
  if (!farmable(t)) { set_message("Idle"); return; }
  change_target(t); set_message("Hunt " + t.mtype);
  w = tank;
  if (w && w.name !== character.name && parent.distance(character, w) < 8) {
    dx = w.real_x - t.real_x; dy = w.real_y - t.real_y; d = Math.sqrt(dx * dx + dy * dy) || 1;
    move(w.real_x + dx / d * 20, w.real_y + dy / d * 20); return;
  }
  if (!is_in_range(t)) { move(character.real_x + (t.real_x - character.real_x) / 2, character.real_y + (t.real_y - character.real_y) / 2); return; }
  if (character.mp / character.max_mp >= 0.7 && ready("curse")) use_skill("curse", t);
  if (can_attack(t)) attack(t);
}
boot_fighter({ combat: combat, pre_combat: pre_combat, ding_line: "Ding! Bless.", form: { dx: 45, dy: 55, face: 1 } });
