"use strict";

const suites = [
  require("./test_comms"),
  require("./test_scenarios"),
  require("./test_adversarial"),
  require("./test_dist"),
  require("./test_packs"),
  require("./test_boot_subsets"),
  require("./test_mc_mvp"),
  require("./test_bank_clean"),
  require("./test_derive_bank_lists"),
  require("./test_bank_park"),
  require("./test_live_regressions"),
  require("./test_bank_linger"),
  require("./test_restock_range"),
  require("./test_dlv_safe_meet"),
  require("./test_idle_bank_clean"),
  require("./test_xyn_exchange"),
  require("./test_vendor_sshield"),
  require("./test_earring_cape"),
  require("./test_stall_gear_spam"),
  require("./test_equip_class"),
  require("./test_gear_score"),
  require("./test_monsterhunt"),
  require("./test_live_runtime_interval"),
  require("./test_live_warrior_combat"),
  require("./test_rare_resume"),
  require("./test_merchant_avoid"),
  require("./test_merchant_potions"),
  require("./test_craft_idle"),
  require("./test_party_state"),
];

async function main() {
  let passed = 0,
    failed = 0;
  for (const suite of suites) {
    for (const t of suite.tests) {
      try {
        await t.fn();
        passed++;
        console.log("  ok  " + t.name);
      } catch (e) {
        failed++;
        console.log("  FAIL  " + t.name);
        console.log("        " + (e && e.stack ? e.stack.split("\n").slice(0, 6).join("\n        ") : e));
      }
    }
  }
  console.log("\n" + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
}

main();
