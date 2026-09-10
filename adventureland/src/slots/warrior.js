load_code("v2_lib");
load_code("v2_fighter");
function skillWeaponReady(skill) {
  var req = typeof G !== "undefined" && G.skills && G.skills[skill] && G.skills[skill].wtype;
  if (!req || !req.length) return true;
  var main = character.slots && character.slots.mainhand;
  var wtype = main && G.items && G.items[main.name] && G.items[main.name].wtype;
  return req.indexOf(wtype) >= 0;
}
function combat(mtype, dyn) {
  if (character.rip || (typeof is_moving === "function" && is_moving(character))) return;
  if (typeof smart !== "undefined" && smart.moving) return;
  dyn = dyn || {};
  // v2_start_fighter's runCombat() passes the live succession leader here —
  // fall back to static LEADER_ORDER[0] only if called without dyn (e.g. console).
  var leadName = dyn.leadName || (typeof LEADER_ORDER !== "undefined" ? LEADER_ORDER[0] : "Jazwyn");
  var lead = get_player(leadName);
  var t = null;
  var isLead = dyn.isLead != null ? dyn.isLead : character.name === leadName || !(get_party() || {})[leadName];
  if (!isLead && lead && lead.target) {
    t = get_monster(lead.target) || parent.entities[lead.target];
  } else {
    t = get_targeted_monster();
    if (!t || (mtype && t.mtype !== mtype)) t = get_nearest_monster({ type: mtype, no_target: true }) || get_nearest_monster({ type: mtype });
  }
  if (!t || t.type !== "monster") return;
  change_target(t);
  set_message("Hunt " + t.mtype);
  if (!is_in_range(t)) {
    if (typeof use_skill === "function") try { use_skill("charge", t); } catch (e) {}
    move(character.real_x + (t.real_x - character.real_x) / 2, character.real_y + (t.real_y - character.real_y) / 2);
    return;
  }
  if (character.mp / character.max_mp >= 0.75 && skillWeaponReady("cleave")) {
    try { use_skill("cleave"); } catch (e) {}
  }
  if (can_attack(t)) attack(t);
}
v2_start_fighter({ combat: combat, doInvite: true });
