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
  {
    name: "boot: key orderings (merchant-first, lead-last, lead-first) farm",
    async fn() {
      const orders = [
        ["Puppygirl", "Zarook", "Sarene", "Jazwyn"],
        ["Jazwyn", "Sarene", "Zarook", "Puppygirl"],
        ["Sarene", "Jazwyn", "Puppygirl", "Zarook"],
      ];
      for (const order of orders) {
        const p = bootParty({ pack: "armadillo", pots: 40, members: order });
        for (let i = 0; i < 12; i++) await p.tickAll();
        const lead = LEADER_ORDER.find((n) => p.bots[n]);
        if (lead) assert.strictEqual(p.bots[lead].ctrl.isLead(), true, order.join("→"));
        assert.strictEqual(p.world.where(Object.keys(p.bots)[0]).key, "US/III");
      }
    },
  },
];

module.exports = { tests };
