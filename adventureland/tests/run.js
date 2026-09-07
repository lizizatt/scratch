"use strict";

const suites = [require("./test_comms"), require("./test_scenarios")];

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
