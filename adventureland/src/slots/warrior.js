load_code("v2_lib");
load_code("v2_fighter");
function combat(mtype, dyn, api) {
  return warriorRotation(api, mtype, dyn || {});
}
v2_start_fighter({ combat: combat, doInvite: true });
