"use strict";

const assert = require("assert");
const { deriveBankLists } = require("../src/derive_bank_lists");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const defs = {
  ringsj: { compound: true, type: "ring", grades: [3, 5] },
  strearring: { compound: true, type: "earring" },
  shoes: { upgrade: true, type: "shoes" },
  wcap: { upgrade: true, type: "helmet" },
  gem0: { type: "gem", g: 240000 },
  hpot1: { type: "pot" },
  cscroll0: { g: 800 },
  stramulet: { compound: true, type: "amulet" },
  wattire: { upgrade: true, type: "chest" },
};

test("derive: legacy sell + combine ringsj x3", () => {
  const packs = {
    items0: [
      { name: "ringsj", level: 0 },
      { name: "ringsj", level: 0 },
      { name: "ringsj", level: 0 },
      { name: "strearring", level: 0 },
      { name: "wcap", level: 0 },
      { name: "gem0", q: 2 },
      { name: "shoes", level: 3 },
      { name: "shoes", level: 4 },
    ],
  };
  const d = deriveBankLists({ packs, defs, bags: {} });
  assert.ok(d.combine.some((c) => c.name === "ringsj" && c.level === 0 && c.copies === 3));
  assert.ok(d.proposed.SELL_WHITELIST.indexOf("strearring") < 0, "goal earrings are not legacy sell");
  assert.ok(d.proposed.SELL_WHITELIST.indexOf("wcap") >= 0);
  assert.ok(d.proposed.SELL_WHITELIST.indexOf("shoes") >= 0, "shoes are unconditional vendor stock");
  assert.ok(d.sell.some((s) => s.name === "shoes" && s.level === 3));
  assert.ok(d.sell.some((s) => s.name === "shoes" && s.level === 4));
  assert.ok(d.proposed.BUY_NOW.some((b) => b.name === "cscroll0"));
  assert.ok(d.keep.some((k) => k.name === "gem0"));
});

test("derive: compound inputs and upgraded wearable junk are retained", () => {
  const packs = {
    items0: [
      { name: "stramulet", level: 0 },
      { name: "stramulet", level: 1 },
      { name: "wattire", level: 0 },
      { name: "wattire", level: 2 },
    ],
  };
  const d = deriveBankLists({ packs, defs, bags: {} });
  assert.ok(!d.sell.some((s) => s.name === "stramulet"), "partial compound feed retained");
  assert.ok(d.sell.some((s) => s.name === "wattire" && s.level === 0), "level-zero duplicate sold");
  assert.ok(!d.sell.some((s) => s.name === "wattire" && s.level === 2), "upgraded wearable retained");
  assert.ok(d.proposed.SELL_WHITELIST.indexOf("wattire") < 0, "level-gated gear excluded from name whitelist");
});

test("derive: bag copies count toward combine", () => {
  const packs = { items0: [{ name: "ringsj", level: 0 }, { name: "ringsj", level: 0 }] };
  const bags = { Puppygirl: { items: [{ name: "ringsj", level: 0 }] } };
  const d = deriveBankLists({ packs, defs, bags });
  assert.strictEqual(d.combine.length, 1);
  assert.strictEqual(d.combine[0].copies, 3);
});

module.exports = { tests };

if (require.main === module) {
  (async () => {
    for (const t of tests) {
      await t.fn();
      console.log("ok", t.name);
    }
    console.log(tests.length + " passed");
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
