"use strict";

/**
 * Derive keep / sell / combine / buy lists from a bank (+ optional bag) dump.
 * Rules blend legacy HOLD/SELL with V2 vendor-gear progression.
 */

const {
  VENDOR_NPC,
  VENDOR_NPC_LOW_LEVEL,
  VENDOR_NPC_MAX_LEVEL,
} = require("./constants");

/** Keep at least this many of each (name → min level to count as hold). */
const HOLD_TARGETS = [
  ["armorring", 1],
  ["vitring", 9],
  ["fireblade", 1],
  ["blade", 2],
  ["essenceoffire", 2],
  ["staff", 2],
  ["ringsj", 6],
  ["hpbelt", 3],
  ["hpamulet", 3],
  ["wbook0", 1],
  ["sshield", 1],
  ["shield", 2],
];

/** Always sell these names when not held for a combine triple. */
const LEGACY_SELL = [
  "dexearring",
  "intamulet",
  "dexamulet",
  "rednose",
  "wcap",
  "wshoes",
];

/** V2 vendor bases — keep the best copy for upgrade/gift; sell lower dupes. */
const VENDOR_GEAR = ["gloves", "shoes", "helmet", "pants", "coat"];

const COMBINE_PRIORITY = ["orbg", "ringsj", "hpbelt", "hpamulet", "wbook0", "stramulet", "intbelt", "vitring", "armorring"];
const COMBINE_MAX = 5;
const ALWAYS_KEEP = new Set([
  "stand0",
  "tracker",
  "gem0",
  "gem1",
  "ascale",
  "pleather",
  "cscale",
  "bfur",
  "orbg",
  "reefglass",
  "seashell",
  "essenceoffire",
  "anniversarygift",
]);

function isPot(name) {
  return /^hpot|^mpot/.test(name);
}
function isScroll(name) {
  return /^scroll\d$/.test(name) || /^cscroll\d$/.test(name);
}

function flattenPacks(packs) {
  const out = [];
  for (const [pack, bag] of Object.entries(packs || {})) {
    if (!Array.isArray(bag)) continue;
    for (let i = 0; i < bag.length; i++) {
      const it = bag[i];
      if (!it || !it.name) continue;
      out.push({
        where: "bank",
        pack,
        i,
        name: it.name,
        level: it.level || 0,
        q: it.q == null ? 1 : it.q,
        p: it.p || null,
        l: it.l || null,
      });
    }
  }
  return out;
}

function flattenBags(charBags) {
  const out = [];
  for (const [who, snap] of Object.entries(charBags || {})) {
    for (const it of snap.items || []) {
      if (!it || !it.name) continue;
      out.push({
        where: "bag:" + who,
        pack: null,
        i: null,
        name: it.name,
        level: it.level || 0,
        q: it.q == null ? 1 : it.q,
        p: it.p || null,
        l: it.l || null,
      });
    }
  }
  return out;
}

function tally(entries) {
  const by = {};
  for (const e of entries) {
    const key = e.name + "@" + e.level;
    if (!by[key]) by[key] = { name: e.name, level: e.level, count: 0, qty: 0, entries: [] };
    by[key].count += 1;
    by[key].qty += e.q || 1;
    by[key].entries.push(e);
  }
  return by;
}

function holdTarget(name) {
  for (const [n, lv] of HOLD_TARGETS) if (n === name) return lv;
  return null;
}

function cscrollFor(name, level, defs) {
  const g = (defs && defs[name]) || {};
  const grades = g.grades || [2, 5];
  let gl = 0;
  for (let i = 0; i < grades.length; i++) if ((level || 0) >= grades[i]) gl = i + 1;
  return gl <= 0 ? "cscroll0" : gl === 1 ? "cscroll1" : "cscroll2";
}

/**
 * @param {{packs, gold?, defs?, bags?}} dump
 * @returns lists + inventory summary
 */
function deriveBankLists(dump) {
  const defs = dump.defs || {};
  const bankEntries = flattenPacks(dump.packs);
  const bagEntries = flattenBags(dump.bags);
  const all = bankEntries.concat(bagEntries);
  const byKey = tally(all);

  const inventory = Object.values(byKey)
    .map((r) => ({
      name: r.name,
      level: r.level,
      copies: r.count,
      qty: r.qty,
      compound: !!(defs[r.name] && defs[r.name].compound),
      upgrade: !!(defs[r.name] && defs[r.name].upgrade),
      type: (defs[r.name] && defs[r.name].type) || null,
      locations: r.entries.map((e) => e.where + (e.pack ? "/" + e.pack + "[" + e.i + "]" : "")),
    }))
    .sort((a, b) => (a.name === b.name ? a.level - b.level : a.name < b.name ? -1 : 1));

  const keep = [];
  const sell = [];
  const combine = [];
  const buy = [];
  const notes = [];

  // Combine candidates first (bank+bag counts)
  for (const row of inventory) {
    const def = defs[row.name] || {};
    if (!def.compound || row.level >= COMBINE_MAX) continue;
    if (row.copies < 3) continue;
    const prio = COMBINE_PRIORITY.indexOf(row.name);
    combine.push({
      name: row.name,
      level: row.level,
      copies: row.copies,
      priority: prio < 0 ? 99 : prio,
      cscroll: cscrollFor(row.name, row.level, defs),
    });
  }
  combine.sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : b.level - a.level));

  const combineKeys = new Set(combine.map((c) => c.name + "@" + c.level));

  // Classify each name@level stack
  for (const row of inventory) {
    const name = row.name;
    const lv = row.level;
    const key = name + "@" + lv;
    const def = defs[name] || {};

    if (isPot(name) || isScroll(name) || ALWAYS_KEEP.has(name)) {
      keep.push({ name, level: lv, reason: "consumable_or_material", copies: row.copies });
      continue;
    }
    if (all.some((e) => e.name === name && (e.level || 0) === lv && (e.p || e.l))) {
      keep.push({ name, level: lv, reason: "locked_or_shiny", copies: row.copies });
      continue;
    }
    if (combineKeys.has(key)) {
      keep.push({ name, level: lv, reason: "combine_feed", copies: row.copies });
      continue;
    }

    const ht = holdTarget(name);
    if (ht != null) {
      keep.push({ name, level: lv, reason: "hold_target_max_" + ht, copies: row.copies });
      // Excess low copies of HOLD names that are also LEGACY_SELL and below useful → still sell singles that aren't progressing compound
      if (LEGACY_SELL.indexOf(name) >= 0 && row.copies < 3 && lv === 0 && ht > 0) {
        // e.g. stray rednose while HOLD doesn't list it — handled below
      }
      continue;
    }

    if (LEGACY_SELL.indexOf(name) >= 0) {
      sell.push({ name, level: lv, reason: "legacy_sell", copies: row.copies, locations: row.locations });
      continue;
    }

    // Canonical instant-vendor junk (src/constants.VENDOR_NPC) — items that
    // never showed up in LEGACY_SELL's hand-picked list should still sell,
    // not fall through to "unknown_keep".
    if (VENDOR_NPC.indexOf(name) >= 0) {
      sell.push({ name, level: lv, reason: "vendor_npc_junk", copies: row.copies, locations: row.locations });
      continue;
    }
    if (VENDOR_NPC_LOW_LEVEL.indexOf(name) >= 0 && lv <= VENDOR_NPC_MAX_LEVEL) {
      sell.push({ name, level: lv, reason: "vendor_npc_low_level", copies: row.copies, locations: row.locations });
      continue;
    }

    if (VENDOR_GEAR.indexOf(name) >= 0 && def.upgrade) {
      // Keep only the highest level copy; sell lower duplicates
      const same = inventory.filter((r) => r.name === name);
      const maxLv = Math.max(...same.map((r) => r.level));
      if (lv < maxLv) {
        sell.push({ name, level: lv, reason: "vendor_dupe_below_" + maxLv, copies: row.copies, locations: row.locations });
      } else if (row.copies > 1) {
        sell.push({
          name,
          level: lv,
          reason: "vendor_extra_copies",
          copies: row.copies - 1,
          locations: row.locations,
        });
        keep.push({ name, level: lv, reason: "best_vendor_piece", copies: 1 });
      } else {
        keep.push({ name, level: lv, reason: "best_vendor_piece", copies: row.copies });
      }
      continue;
    }

    if (def.type === "material" || def.type === "gem" || def.type === "quest") {
      keep.push({ name, level: lv, reason: "type_" + def.type, copies: row.copies });
      continue;
    }

    // Default: keep unknowns (safer); note them
    keep.push({ name, level: lv, reason: "unknown_keep", copies: row.copies });
    notes.push("review unknown: " + key);
  }

  // Buy list: cscrolls for planned combines; missing HOLD if zero owned
  const ownedNames = new Set(inventory.map((r) => r.name));
  for (const c of combine) {
    const sc = c.cscroll;
    const have = inventory.filter((r) => r.name === sc).reduce((n, r) => n + r.qty, 0);
    if (have < 1) buy.push({ name: sc, qty: 1, reason: "compound " + c.name + "@" + c.level });
  }
  for (const [n, lv] of HOLD_TARGETS) {
    if (!ownedNames.has(n) && ["sshield", "fireblade", "armorring", "vitring"].indexOf(n) >= 0) {
      buy.push({ name: n, qty: 1, reason: "missing_hold_target_lv" + lv, via: "ponty_or_drop" });
    }
  }

  const sellNames = [
    ...new Set(
      sell
        .filter((s) => VENDOR_GEAR.indexOf(s.name) < 0 && VENDOR_NPC_LOW_LEVEL.indexOf(s.name) < 0)
        .map((s) => s.name)
    ),
  ];
  const combineNames = [...new Set(combine.map((c) => c.name))];
  const buyNow = buy.filter((b) => /^cscroll\d$/.test(b.name) || b.via == null);

  return {
    gold: dump.gold,
    inventory,
    keep,
    sell,
    combine,
    buy,
    notes,
    /** Ready to paste into constants / bank_clean */
    proposed: {
      /** Name-only junk safe to sell at any level (excludes vendor gear needing level gates). */
      SELL_WHITELIST: sellNames.sort(),
      /** Level-aware sells for one-shot clean (includes vendor dupes). */
      SELL_ROWS: sell.map((s) => ({ name: s.name, level: s.level, copies: s.copies, reason: s.reason })),
      COMBINE_PRIORITY: combineNames.length
        ? COMBINE_PRIORITY.filter((n) => combineNames.indexOf(n) >= 0).concat(
            combineNames.filter((n) => COMBINE_PRIORITY.indexOf(n) < 0)
          )
        : COMBINE_PRIORITY.slice(),
      BUY_NOW: buyNow,
      BUY_WISH: buy.filter((b) => buyNow.indexOf(b) < 0),
    },
  };
}

module.exports = {
  HOLD_TARGETS,
  LEGACY_SELL,
  VENDOR_GEAR,
  COMBINE_PRIORITY,
  deriveBankLists,
  flattenPacks,
  flattenBags,
  tally,
};
