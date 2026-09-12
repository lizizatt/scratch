"use strict";

const assert = require("assert");
const {
  planCompounds,
  planSellBag,
  planSellBank,
  cscrollFor,
  isSellJunk,
  isKeepAlways,
} = require("../src/bank_clean_plan");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const G = {
  items: {
    orbg: { compound: true, grades: [4, 6, 6, 7] },
    ringsj: { compound: true, grades: [2, 5] },
    hpbelt: { compound: true, grades: [2, 5] },
    frogt: { g: 10 },
    leatherboots: { g: 20 },
    hpot1: { g: 20 },
    scroll0: { g: 1000 },
    cscroll0: { g: 800 },
    stand0: {},
  },
};

test("planSellBag picks whitelist only", () => {
  const items = [
    { name: "frogt" },
    { name: "hpot1", q: 50 },
    { name: "leatherboots" },
    { name: "ringsj", level: 0 },
    null,
  ];
  assert.deepStrictEqual(planSellBag(items), [0, 2, 3]);
});

test("planSellBank skips gold and keep items", () => {
  const bank = {
    gold: 1e6,
    items0: [{ name: "frogt" }, { name: "hpot1", q: 10 }, { name: "scroll0" }],
    items1: [null, { name: "leatherboots", level: 0 }],
  };
  const hits = planSellBank(bank);
  assert.strictEqual(hits.length, 2);
  assert.strictEqual(hits[0].name, "frogt");
  assert.strictEqual(hits[1].name, "leatherboots");
});

test("planCompounds needs 3 same name@level", () => {
  const bags = [
    [{ name: "ringsj", level: 0 }, { name: "ringsj", level: 0 }],
    [{ name: "ringsj", level: 0 }, { name: "hpbelt", level: 1 }],
  ];
  const c = planCompounds(bags, G);
  assert.strictEqual(c.length, 1);
  assert.deepStrictEqual(c[0], { name: "ringsj", level: 0, priority: 1 });
});

test("planCompounds prioritizes Orb of Beginnings triples", () => {
  const bags = [[
    { name: "ringsj", level: 0 },
    { name: "ringsj", level: 0 },
    { name: "ringsj", level: 0 },
    { name: "orbg", level: 0 },
    { name: "orbg", level: 0 },
    { name: "orbg", level: 0 },
  ]];
  const c = planCompounds(bags, G);
  assert.strictEqual(c[0].name, "orbg");
  assert.strictEqual(c[0].priority, 0);
});

test("planCompounds skips level >= COMBINE_MAX", () => {
  const bags = [[{ name: "ringsj", level: 5 }, { name: "ringsj", level: 5 }, { name: "ringsj", level: 5 }]];
  assert.strictEqual(planCompounds(bags, G).length, 0);
});

test("cscrollFor uses grades", () => {
  assert.strictEqual(cscrollFor("ringsj", 0, G), "cscroll0");
  assert.strictEqual(cscrollFor("ringsj", 2, G), "cscroll1");
  assert.strictEqual(cscrollFor("ringsj", 5, G), "cscroll2");
});

test("keep pots/scrolls/stand", () => {
  assert.ok(isKeepAlways({ name: "hpot0", q: 1 }));
  assert.ok(isKeepAlways({ name: "cscroll0" }));
  assert.ok(isKeepAlways({ name: "stand0" }));
  assert.ok(!isSellJunk({ name: "hpot0" }));
  assert.ok(isSellJunk({ name: "frogt" }));
});

(async () => {
  if (require.main !== module) return;
  let fail = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log("ok", t.name);
    } catch (e) {
      fail++;
      console.error("FAIL", t.name, e && e.message);
    }
  }
  if (fail) process.exit(1);
  console.log(tests.length + " passed");
})();

module.exports = { tests };