load_code("v2_lib");
load_code("v2_fighter");
function combat(mtype) {
  if (character.rip || (typeof is_moving === "function" && is_moving(character))) return;
  if (typeof smart !== "undefined" && smart.moving) return;
  var leadName = typeof LEADER_ORDER !== "undefined" ? LEADER_ORDER[0] : "Jazwyn";
  var lead = get_player(leadName);
  var t = null;
  // Solo / acting lead: pick pack mobs. Assist only when party tank is present.
  var soloLead = character.name === leadName || !(get_party() || {})[leadName];
  if (!soloLead && lead && lead.target) {
    t = get_monster(lead.target) || parent.entities[lead.target];
  } else {
    t = get_targeted_monster();
    if (!t || (mtype && t.mtype !== mtype)) {
      t = get_nearest_monster({ type: mtype, no_target: true }) || get_nearest_monster({ type: mtype });
    }
  }
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
v2_start_fighter({ combat: combat, form: FORM_MAGE });
