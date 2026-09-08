"use strict";

const assert = require("assert");
const { bootParty } = require("../src/boot_party");
const { FIGHTERS, LEADER_ORDER, MERCHANT } = require("../src/constants");

const ROSTER = FIGHTERS.concat([MERCHANT]);

function allNonEmptySubsets(names) {
  const out = [];
  const n = names.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const sub = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sub.push(names[i]);
    out.push(sub);
  }
  return out;
}

const tests = [
  {
    name: "boot: all 15 non-empty roster subsets tick without crash",
    async fn() {
      const subsets = allNonEmptySubsets(ROSTER);
      assert.strictEqual(subsets.length, 15);
      for (const members of subsets) {
        const p = bootParty({ pack: "armadillo", pots: 50, members });
        assert.deepStrictEqual(Object.keys(p.bots).sort(), members.slice().sort());
        for (let i = 0; i < 8; i++) await p.tickAll();
        const fighters = FIGHTERS.filter((n) => p.bots[n]);
        if (fighters.length) {
          const leadName = LEADER_ORDER.find((n) => p.bots[n]);
          assert.ok(leadName, "expected a leader in " + members.join(","));
          assert.strictEqual(p.bots[leadName].ctrl.isLead(), true, members.join("+"));
        }
      }
    },
  },
];

module.exports = { tests };
