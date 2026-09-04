"use strict";

const suites = [
  require("./test_al_core"),
  require("./test_class_scripts"),
  require("./test_gear_scripts"),
  require("./test_merchant_script"),
  require("./test_merchant_plan"),
  require("./test_gear_ops")
];

async function main() {
  let passed = 0, failed = 0;
  const failures = [];
  for (const suite of suites) {
    for (const t of suite.tests) {
      try {
        await t.fn();
        passed++;
        console.log("  ok  " + t.name);
      } catch (e) {
        failed++;
        failures.push({ name: t.name, err: e });
        console.log("  FAIL  " + t.name);
        console.log("        " + (e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n        ") : e));
      }
    }
  }
  console.log("\n" + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
}

main();
