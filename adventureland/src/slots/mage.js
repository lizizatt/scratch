load_code("v2_lib");
load_code("v2_fighter");
function combat(mtype) {
  if (character.rip || (typeof is_moving === "function" && is_moving(character))) return;
  if (typeof smart !== "undefined" && smart.moving) return;
  var lead = get_player("Jazwyn");
  var t = null;
  if (lead && lead.target) t = get_monster(lead.target) || parent.entities[lead.target];
  if (!t || t.type !== "monster") {
    set_message("Idle");
    return;
  }
  change_target(t);
  set_message("Hunt " + t.mtype);
  if (!is_in_range(t)) {
    move(character.real_x + (t.real_x - character.real_x) / 2, character.real_y + (t.real_y - character.real_y) / 2);
    return;
  }
  if (can_attack(t)) attack(t);
}
v2_start_fighter({ combat: combat });
