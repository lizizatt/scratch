load_code("v2_lib");
load_code("v2_fighter");
function pre_combat(api) {
  return priestPreCombat(api);
}
function combat(mtype, dyn, api) {
  return priestRotation(api, mtype, dyn || {});
}
v2_start_fighter({ combat: combat, pre_combat: pre_combat, form: FORM_PRIEST });
