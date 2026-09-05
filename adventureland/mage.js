load_code("fighter_core");
function combat() {
  if (character.rip || is_moving(character)) return;
  var lead = get_player(LEADER), t = null, w, dx, dy, d;
  if (lead && lead.target) t = get_monster(lead.target) || parent.entities[lead.target];
  if (!farmable(t)) { set_message("Idle"); return; }
  change_target(t); set_message("Hunt " + t.mtype);
  w = get_player(TANK);
  if (w && w.name !== character.name && parent.distance(character, w) < 8) {
    dx = w.real_x - t.real_x; dy = w.real_y - t.real_y; d = Math.sqrt(dx * dx + dy * dy) || 1;
    move(w.real_x + dx / d * 20, w.real_y + dy / d * 20); return;
  }
  if (!is_in_range(t)) { move(character.real_x + (t.real_x - character.real_x) / 2, character.real_y + (t.real_y - character.real_y) / 2); return; }
  if (can_attack(t)) attack(t);
}
boot_fighter({ combat: combat, ding_line: "Ding! Spark.", form: { dx: -45, dy: 55, face: 1 } });
