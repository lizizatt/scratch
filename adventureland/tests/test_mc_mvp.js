"use strict";

const assert = require("assert");
const { runOne } = require("../tools/mc_mvp");

const tests = [
  {
    name: "mc_mvp: 5 seeded short farms pass fighter_hop/throttle gates",
    async fn() {
      const fails = [];
      for (let i = 0; i < 5; i++) {
        const r = await runOne(42 + i * 9973, 60 * 1000);
        if (!r.ok) fails.push(r);
      }
      assert.strictEqual(
        fails.length,
        0,
        "MC failures: " + JSON.stringify(fails.map((f) => ({ seed: f.seed, reasons: f.reasons, counters: f.counters })))
      );
    },
  },
];

module.exports = { tests };
