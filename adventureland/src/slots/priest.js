load_code("v2_lib");
load_code("v2_fighter");
function pre_combat() {
  if (typeof smart !== "undefined" && smart.moving) return false;
  if (character.mp < character.max_mp * 0.2) return false;
  var hurt = 0, lowest = null, i, m, dead = null, party = ["Jazwyn", "Sarene", "Zarook"];
  for (i = 0; i < party.length; i++) {
    m = party[i] === character.name ? character : get_player(party[i]);
    if (!m) continue;
    if (m.rip) { if (!dead) dead = m; continue; }
    if (m.hp < m.max_hp * 0.8) hurt++;
    if (m.hp < m.max_hp * 0.7 && (!lowest || m.hp / m.max_hp < lowest.hp / lowest.max_hp)) lowest = m;
  }
  if (dead && typeof locate_item === "function" && locate_item("essenceoflife") !== -1) {
    try { use_skill("revive", dead); set_message("Revive"); return true; } catch (e) {}
  }
  if (hurt >= 2 || (lowest && lowest.hp < lowest.max_hp * 0.35)) {
    try { use_skill("partyheal"); set_message("PHeal"); return true; } catch (e) {}
  }
  if (lowest && typeof can_heal === "function" && can_heal(lowest)) {
    heal(lowest);
    set_message("Heal");
    return true;
  }
  return false;
}
function combat(mtype) {
  if (character.rip || (typeof is_moving === "function" && is_moving(character))) return;
  if (typeof smart !== "undefined" && smart.moving) return;
  var lead = get_player("Jazwyn"), tank = get_player("Jazwyn"), t = null;
  if (lead && lead.target) t = get_monster(lead.target) || parent.entities[lead.target];
  if ((!t || t.type !== "monster") && tank && tank.target) t = get_monster(tank.target) || parent.entities[tank.target];
  if (!t || t.type !== "monster") { set_message("Idle"); return; }
  change_target(t);
  set_message("Hunt " + t.mtype);
  if (!is_in_range(t)) {
    move(character.real_x + (t.real_x - character.real_x) / 2, character.real_y + (t.real_y - character.real_y) / 2);
    return;
  }
  if (character.mp / character.max_mp >= 0.7) try { use_skill("curse", t); } catch (e) {}
  if (can_attack(t)) attack(t);
}
v2_start_fighter({ combat: combat, pre_combat: pre_combat });
