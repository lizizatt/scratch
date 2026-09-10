"use strict";

/**
 * Pure helpers for bank clean (combine + sell junk). Shared by tests.
 * `code/bank_clean.js` is a standalone one-shot Mainframe upload (raw globals,
 * no require()) and intentionally keeps its own inline copy of these rules.
 *
 * Names are prefixed bankPlan* where they would collide with gear.js globals
 * after compress strips requires into shared AL CODE slots.
 */

const { VENDOR_NPC } = require("./constants");
const { isSellJunk: gearIsSellJunk } = require("./gear");

const DEFAULT_SELL = VENDOR_NPC;
const DEFAULT_COMBINE = ["ringsj", "hpbelt", "hpamulet", "wbook0", "stramulet", "intbelt", "vitring", "armorring"];
const BANK_COMBINE_MAX = 5;

function bankPlanIsPot(it) {
  return it && (/^hpot/.test(it.name) || /^mpot/.test(it.name));
}

function bankPlanIsKeep(it) {
  if (!it) return true;
  if (bankPlanIsPot(it) || it.name === "stand0" || it.name === "tracker" || it.l) return true;
  if (/^scroll\d$/.test(it.name) || /^cscroll\d$/.test(it.name)) return true;
  return false;
}

/**
 * Same junk call as merchant/vendor's gear.isSellJunk (VENDOR_NPC + G .sell
 * fallback + GEAR_TARGETS protection) -- park and vendor share one source of
 * truth. `sellList`, when passed explicitly (tests, ops probes), overrides
 * with a plain name-whitelist check instead of deferring to gear.js.
 */
function bankPlanIsSellJunk(it, sellList, G) {
  if (!it || bankPlanIsKeep(it)) return false;
  if (sellList) return sellList.indexOf(it.name) >= 0;
  return gearIsSellJunk(it, G);
}

function cscrollFor(name, level, G) {
  const g = (G && G.items && G.items[name]) || {};
  const grades = g.grades || [2, 5];
  let gl = 0;
  for (let i = 0; i < grades.length; i++) {
    if ((level || 0) >= grades[i]) gl = i + 1;
  }
  return gl <= 0 ? "cscroll0" : gl === 1 ? "cscroll1" : "cscroll2";
}

/** Count {name,level} across bag + bank packs. */
function countOwned(bags, name, level) {
  let n = 0;
  for (const bag of bags || []) {
    if (!Array.isArray(bag)) continue;
    for (const it of bag) {
      if (it && it.name === name && (it.level || 0) === (level || 0)) n += 1;
    }
  }
  return n;
}

/**
 * Find compound candidates: names with ≥3 copies at same level < BANK_COMBINE_MAX.
 * Returns [{name, level, priority}] sorted by combine priority then higher level.
 */
function planCompounds(bags, G, combineList) {
  const prio = combineList || DEFAULT_COMBINE;
  const seen = {};
  const cand = [];
  for (const bag of bags || []) {
    if (!Array.isArray(bag)) continue;
    for (const it of bag) {
      if (!it || !it.name) continue;
      const g = (G && G.items && G.items[it.name]) || {};
      if (!g.compound) continue;
      const lv = it.level || 0;
      if (lv >= BANK_COMBINE_MAX) continue;
      const key = it.name + "@" + lv;
      if (seen[key]) continue;
      seen[key] = 1;
      if (countOwned(bags, it.name, lv) >= 3) {
        const pi = prio.indexOf(it.name);
        cand.push({ name: it.name, level: lv, priority: pi < 0 ? 99 : pi });
      }
    }
  }
  cand.sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : b.level - a.level));
  return cand;
}

/** Bag indices that are sell-junk (whitelist). */
function planSellBag(items, sellList, G) {
  const out = [];
  for (let i = 0; i < (items || []).length; i++) {
    if (bankPlanIsSellJunk(items[i], sellList, G)) out.push(i);
  }
  return out;
}

/**
 * Bank entries to pull for selling: [{pack, i, name, level, q}].
 */
function planSellBank(bank, sellList, G) {
  const out = [];
  if (!bank) return out;
  for (const pack of Object.keys(bank)) {
    if (pack === "gold") continue;
    const bag = bank[pack];
    if (!Array.isArray(bag)) continue;
    for (let i = 0; i < bag.length; i++) {
      const it = bag[i];
      if (bankPlanIsSellJunk(it, sellList, G)) out.push({ pack, i, name: it.name, level: it.level || 0, q: it.q });
    }
  }
  return out;
}

module.exports = {
  DEFAULT_SELL,
  DEFAULT_COMBINE,
  COMBINE_MAX: BANK_COMBINE_MAX,
  BANK_COMBINE_MAX,
  isPot: bankPlanIsPot,
  isKeepAlways: bankPlanIsKeep,
  isSellJunk: bankPlanIsSellJunk,
  bankPlanIsPot,
  bankPlanIsKeep,
  bankPlanIsSellJunk,
  cscrollFor,
  countOwned,
  planCompounds,
  planSellBag,
  planSellBank,
};
