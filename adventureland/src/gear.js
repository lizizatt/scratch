"use strict";

const {
  VENDOR_NPC,
  KEEP_ALWAYS,
  GEAR_TYPES,
  GEAR_TARGETS,
  GIFT_TTL_MS,
  SCROLL0_ALLOW,
  MAX_SAFE_UPGRADE,
  MIN_UPGRADE_CHANCE,
  VENDOR_GEAR,
} = require("./constants");

const DENY_UPGRADE = ["candycanesword", "carrotsword", "epyjamas", "eears", "eslippers", "xmashat", "fireblade"];
const SLOT_VENDOR = {
  gloves: "gloves",
  shoes: "shoes",
  helmet: "helmet",
  pants: "pants",
  chest: "coat",
};

/**
 * Fallback when G.classes is missing — mirrors live class mainhand/offhand/doublehand keys.
 * Keep in sync with adventure.land classes.*.{mainhand,offhand,doublehand}.
 */
const CLASS_HANDS = {
  warrior: {
    mainhand: { spear: 1, short_sword: 1, sword: 1, fist: 1, mace: 1 },
    offhand: { shield: 1, short_sword: 1, sword: 1, misc_offhand: 1, fist: 1, mace: 1 },
    doublehand: { rapier: 1, bow: 1, axe: 1, scythe: 1, basher: 1, great_sword: 1 },
  },
  mage: {
    mainhand: { staff: 1, wblade: 1, wand: 1 },
    offhand: { source: 1, misc_offhand: 1 },
    doublehand: {},
  },
  priest: {
    mainhand: { pmace: 1, staff: 1 },
    offhand: { shield: 1, source: 1, misc_offhand: 1 },
    doublehand: { wand: 1 },
  },
  merchant: {
    mainhand: { mace: 1, staff: 1, bow: 1, spear: 1, short_sword: 1, fist: 1, dartgun: 1, dagger: 1 },
    offhand: { shield: 1, source: 1, quiver: 1, misc_offhand: 1 },
    doublehand: { rod: 1, pickaxe: 1, axe: 1, basher: 1 },
  },
};

/** Class-aware score weights — warrior tank prefs vs caster int. */
const SCORE_WEIGHTS = {
  warrior: {
    reflection: 14,
    dreturn: 12,
    str: 10,
    armor: 6,
    attack: 3,
    resistance: 2,
    vit: 1,
    hp: 0.02,
    int: 0,
    dex: 0,
    stat: 1,
  },
  mage: {
    int: 12,
    attack: 3,
    resistance: 3,
    armor: 1,
    vit: 1,
    str: 0,
    reflection: 0,
    dreturn: 0,
    dex: 0,
    hp: 0.01,
    stat: 1,
  },
  priest: {
    int: 12,
    vit: 3,
    attack: 2,
    resistance: 3,
    armor: 1,
    str: 0,
    reflection: 0,
    dreturn: 0,
    dex: 0,
    hp: 0.02,
    stat: 1,
  },
};

function itemDef(G, name) {
  return (G && G.items && G.items[name]) || {};
}

function classHands(ctype, G) {
  const c = ctype || "warrior";
  const live = G && G.classes && G.classes[c];
  if (live && (live.mainhand || live.offhand || live.doublehand)) {
    return {
      mainhand: live.mainhand || {},
      offhand: live.offhand || {},
      doublehand: live.doublehand || {},
    };
  }
  return CLASS_HANDS[c] || CLASS_HANDS.warrior;
}

/** Base + upgrade/compound growth × level for a numeric item stat. */
function scaledStat(g, it, key) {
  if (!g && !it) return 0;
  const lv = (it && it.level) || 0;
  let v = Number((g && g[key]) || 0) || 0;
  if (g && g.upgrade && g.upgrade[key] != null) v += Number(g.upgrade[key]) * lv;
  if (g && g.compound && g.compound[key] != null) v += Number(g.compound[key]) * lv;
  return v;
}

/**
 * Combined gear score for upgrade / equip / gift decisions.
 * Warrior: reflection, strength, armor (plus dreturn for shields).
 * Mage & priest: intelligence first.
 */
function score(it, G, ctype) {
  if (!it) return 0;
  const g = itemDef(G, it.name);
  const c = ctype || "warrior";
  const w = SCORE_WEIGHTS[c] || SCORE_WEIGHTS.warrior;
  const lv = it.level || 0;
  const keys = [
    "reflection",
    "dreturn",
    "str",
    "int",
    "vit",
    "dex",
    "armor",
    "attack",
    "resistance",
    "hp",
    "stat",
  ];
  let total = 0;
  for (const k of keys) {
    const wt = w[k];
    if (!wt) continue;
    total += scaledStat(g, it, k) * wt;
  }
  // Tiny level bias so same-name +1 wins ties when defs lack upgrade growth.
  total += lv * 0.5;
  // Avoid zero for unknown misc that still occupies a slot.
  if (!(total > 0) && !g.sell) total = 0.1 + lv * 0.05;
  return total;
}

/** Which hand table lists this wtype for ctype, or null if unusable. */
function weaponHandKind(it, ctype, G) {
  if (!it) return null;
  const g = itemDef(G, it.name);
  const w = g.wtype;
  if (!w) return null;
  const hands = classHands(ctype, G);
  if (hands.doublehand[w]) return "doublehand";
  if (hands.mainhand[w]) return "mainhand";
  if (hands.offhand[w]) return "offhand";
  return null;
}

/**
 * Weapon / offhand class gate.
 * Shields: our party policy keeps them on warriors (priest prefers sources).
 * Sources: mage/priest. Tools: never auto-equip on fighters.
 * Weapons: must appear in that class's mainhand, offhand, or doublehand table.
 */
function classOk(it, ctype, G) {
  if (!it) return false;
  const g = itemDef(G, it.name);
  const c = ctype || "warrior";
  const t = g.type;
  if (t === "tool") return false;
  if (t === "shield") return c === "warrior";
  if (t === "source") return c === "mage" || c === "priest";
  if (g.wtype) return weaponHandKind(it, c, G) != null;
  return true;
}

/**
 * Slot is free of 2H conflicts. Doublehand needs empty offhand; skip thrashing
 * that produces live "Wrong weapon" spam every tick.
 */
function canEquipSlot(api, it, slot, G) {
  if (!it || !slot) return false;
  const ctype = (api.character && api.character.ctype) || "warrior";
  if (!classOk(it, ctype, G)) return false;
  const slots = candidateSlots(it, G);
  if (slots.indexOf(slot) < 0) return false;
  const kind = weaponHandKind(it, ctype, G);
  const worn = (api.character && api.character.slots) || {};
  if (kind === "doublehand" && slot === "mainhand" && worn.offhand) return false;
  if (slot === "offhand" && worn.mainhand) {
    const mhKind = weaponHandKind(worn.mainhand, ctype, G);
    if (mhKind === "doublehand") return false;
  }
  return true;
}

function candidateSlots(it, G) {
  if (!it) return [];
  const g = itemDef(G, it.name);
  const t = g.type;
  if (t === "ring") return ["ring1", "ring2"];
  if (t === "earring") return ["earring1", "earring2"];
  if (t === "amulet") return ["amulet"];
  if (t === "belt") return ["belt"];
  if (t === "helmet") return ["helmet"];
  if (t === "chest") return ["chest"];
  if (t === "pants") return ["pants"];
  if (t === "shoes") return ["shoes"];
  if (t === "gloves") return ["gloves"];
  if (t === "cape") return ["cape"];
  if (t === "orb") return ["orb"];
  if (t === "shield" || t === "source") return ["offhand"];
  if (t === "weapon" || g.wtype) {
    // Offhand-capable 1H swords stay mainhand-first for tank (shield stays).
    return ["mainhand"];
  }
  return [];
}

/** Names we keep for GEAR_TARGETS (never NPC-vendor). */
function isGearTargetName(name) {
  if (!name) return false;
  for (const who of Object.keys(GEAR_TARGETS || {})) {
    const t = GEAR_TARGETS[who];
    for (const slot of Object.keys(t || {})) {
      if (t[slot] === name) return true;
    }
  }
  return false;
}

function targetNameFor(who, slot) {
  const t = GEAR_TARGETS && GEAR_TARGETS[who];
  return t && t[slot] ? t[slot] : null;
}

function isSellJunk(it, G) {
  if (!it) return false;
  if (/^hpot|^mpot/.test(it.name)) return false;
  if (it.name === "stand0" || it.name === "scroll0") return false;
  if (isGearTargetName(it.name)) return false;
  if (VENDOR_NPC.indexOf(it.name) >= 0) return true;
  const g = itemDef(G, it.name);
  return !!g.sell;
}

function isGearPiece(it, G) {
  if (!it) return false;
  const g = itemDef(G, it.name);
  return GEAR_TYPES.indexOf(it.name) >= 0 || !!(g.type && candidateSlots(it, G).length);
}

/**
 * Best (lowest-scoring currently-worn) equip slot for `it`, or null if it
 * beats nothing worn / can't be equipped by this class. Single source of
 * truth shared by pendingBetter (bool check) and equipPending (actual pick).
 */
function pickBestSlot(api, it, G) {
  const ctype = api.character.ctype;
  if (!classOk(it, ctype, G)) return null;
  const slots = candidateSlots(it, G);
  const sc = score(it, G, ctype);
  let best = null;
  for (const s of slots) {
    if (!canEquipSlot(api, it, s, G)) continue;
    const worn = api.character.slots[s];
    const sw = score(worn, G, ctype);
    if (sc > sw && (!best || sw < best.sw)) best = { slot: s, sw };
  }
  return best;
}

function pendingBetter(api, it, G) {
  return !!pickBestSlot(api, it, G);
}

function isKeep(api, it, G, giftTtl) {
  if (!it) return true;
  if (KEEP_ALWAYS.indexOf(it.name) >= 0) return true;
  if (/^hpot|^mpot/.test(it.name)) return true;
  if (/^scroll/.test(it.name)) return true;
  const now = api._now ? api._now() : Date.now();
  for (const id of Object.keys(giftTtl || {})) {
    const g = giftTtl[id];
    if (g && g.name === it.name && now < g.expire) return true;
  }
  return pendingBetter(api, it, G);
}

/**
 * Equip any bag piece that beats the worn slot.
 * Skips class-illegal and 2H+offhand conflicts (avoids live "Wrong weapon" spam).
 * `rejectMemo` (optional, caller-owned map key -> ts) remembers recent live
 * "Wrong weapon" rejections so we don't re-attempt (and re-spam) the same
 * item/slot every tick — retries after EQUIP_REJECT_COOLDOWN_MS in case gear
 * state changed (e.g. offhand freed up).
 */
const EQUIP_REJECT_COOLDOWN_MS = 60000;

async function equipPending(api, G, giftTtl, rejectMemo) {
  let n = 0;
  const now = api._now ? api._now() : Date.now();
  for (let i = 0; i < api.character.items.length; i++) {
    const it = api.character.items[i];
    if (!it) continue;
    const best = pickBestSlot(api, it, G);
    if (!best || typeof api.equip !== "function") continue;
    const rejectKey = it.name + "@" + (it.level || 0) + "->" + best.slot;
    if (rejectMemo && rejectMemo[rejectKey] != null && now - rejectMemo[rejectKey] < EQUIP_REJECT_COOLDOWN_MS) {
      continue;
    }
    let r;
    try {
      r = await Promise.resolve(api.equip(i, best.slot));
    } catch (e) {
      if (api.game_log) api.game_log("equip:err " + it.name);
      continue;
    }
    if (r && r.failed) {
      if (api.game_log) api.game_log("equip:fail " + it.name + " " + (r.reason || ""));
      continue;
    }
    const wornNow = api.character.slots[best.slot];
    if (!wornNow || wornNow.name !== it.name) {
      // Live may reject with only a UI "Wrong weapon" — do not thrash.
      if (rejectMemo) rejectMemo[rejectKey] = now;
      if (api.game_log) api.game_log("equip:reject " + it.name);
      continue;
    }
    n++;
    if (api.game_log) api.game_log("equip " + it.name + " +" + (it.level || 0) + " -> " + best.slot);
    for (const id of Object.keys(giftTtl || {})) {
      if (giftTtl[id] && giftTtl[id].name === it.name) delete giftTtl[id];
    }
  }
  return n;
}

function wornSnapshot(api) {
  const slots = {};
  const s = api.character.slots || {};
  const keys = [
    "mainhand",
    "offhand",
    "helmet",
    "chest",
    "pants",
    "shoes",
    "gloves",
    "cape",
    "belt",
    "amulet",
    "earring1",
    "earring2",
    "ring1",
    "ring2",
    "orb",
  ];
  for (const k of keys) {
    const it = s[k];
    slots[k] = it ? { name: it.name, level: it.level || 0 } : null;
  }
  return { slots, esize: api.character.esize || 0, ctype: api.character.ctype };
}

/**
 * Plan gifts: bank items better than fighter worn ads.
 * Prefers GEAR_TARGETS names when filling empty/weak slots.
 */
function planGifts(bankItems, ads, G) {
  const out = [];
  const used = {};
  for (const who of Object.keys(ads || {})) {
    const ad = ads[who];
    if (!ad || !ad.slots) continue;
    if (ad.esize != null && ad.esize < 1) continue;
    const ctype = ad.ctype || "warrior";
    for (const slot of Object.keys(ad.slots)) {
      const worn = ad.slots[slot];
      const wc = worn ? score(worn, G, ctype) : 0;
      const prefer = targetNameFor(who, slot);
      let best = null;
      for (let j = 0; j < (bankItems || []).length; j++) {
        const e = bankItems[j];
        if (!e || used[j]) continue;
        const it = { name: e.name, level: e.level || 0 };
        if (!classOk(it, ctype, G)) continue;
        if (candidateSlots(it, G).indexOf(slot) < 0) continue;
        const sc = score(it, G, ctype);
        if (!(sc > wc)) continue;
        // Prefer named target over higher-score wrong accessory (e.g. vitearring on mage).
        const preferHit = prefer && it.name === prefer ? 1 : 0;
        const bestPref = best && prefer && best.it.name === prefer ? 1 : 0;
        if (!best || preferHit > bestPref || (preferHit === bestPref && sc > best.sc)) {
          best = { who, slot, it, e, sc, idx: j };
        }
      }
      // Empty slot with a named target: accept target even if score ties weirdly.
      if (!best && !worn && prefer) {
        for (let j = 0; j < (bankItems || []).length; j++) {
          const e = bankItems[j];
          if (!e || used[j] || e.name !== prefer) continue;
          const it = { name: e.name, level: e.level || 0 };
          if (!classOk(it, ctype, G)) continue;
          if (candidateSlots(it, G).indexOf(slot) < 0) continue;
          best = { who, slot, it, e, sc: score(it, G, ctype), idx: j };
          break;
        }
      }
      if (best) {
        used[best.idx] = 1;
        out.push(best);
      }
    }
  }
  return out;
}

function markGift(giftTtl, id, name, now) {
  giftTtl[id] = { name, expire: (now || Date.now()) + GIFT_TTL_MS };
}

/** Grade 0 while level < first grade boundary (AL-ish). */
function itemGrade(it, G) {
  if (!it) return 99;
  const g = itemDef(G, it.name);
  const grades = g.grades || [7, 9];
  const lv = it.level || 0;
  if (lv < (grades[0] != null ? grades[0] : 7)) return 0;
  if (lv < (grades[1] != null ? grades[1] : 9)) return 1;
  return 2;
}

function upgradeChance(it) {
  const lv = (it && it.level) || 0;
  return Math.max(0.5, 1 - lv * 0.08);
}

function eligibleUpgrade(it, G) {
  if (!it) return false;
  const g = itemDef(G, it.name);
  if (!g.upgrade || it.l) return false;
  if (DENY_UPGRADE.indexOf(it.name) >= 0) return false;
  if (SCROLL0_ALLOW.indexOf(it.name) < 0) return false;
  if (itemGrade(it, G) !== 0) return false;
  return (it.level || 0) < MAX_SAFE_UPGRADE;
}

function scrollFor(it, G) {
  if (!eligibleUpgrade(it, G)) return null;
  return "scroll0";
}

function pickUpgradeIndex(items, G) {
  let best = -1;
  let bl = 99;
  for (let i = 0; i < (items || []).length; i++) {
    const it = items[i];
    if (!eligibleUpgrade(it, G)) continue;
    if (upgradeChance(it) < MIN_UPGRADE_CHANCE) continue;
    const lv = it.level || 0;
    if (lv < bl) {
      bl = lv;
      best = i;
    }
  }
  return best;
}

/**
 * One vendor buy for the worst empty armor gap vs ads, if no bank/bag piece covers it.
 * owned: [{name,level}] from bank+bag
 */
function planVendorBuy(ads, owned, G) {
  owned = owned || [];
  for (const who of Object.keys(ads || {})) {
    const ad = ads[who];
    if (!ad || !ad.slots) continue;
    const ctype = ad.ctype || "warrior";
    for (const slot of Object.keys(SLOT_VENDOR)) {
      const vendorName = SLOT_VENDOR[slot];
      if (VENDOR_GEAR.indexOf(vendorName) < 0) continue;
      const worn = ad.slots[slot];
      const wc = worn ? score(worn, G, ctype) : 0;
      const base = { name: vendorName, level: 0 };
      if (!(score(base, G, ctype) > wc)) continue;
      const covered = owned.some((e) => {
        if (!e || e.name !== vendorName) return false;
        return score({ name: e.name, level: e.level || 0 }, G, ctype) > wc;
      });
      if (covered) continue;
      return { who, slot, name: vendorName };
    }
  }
  return null;
}

module.exports = {
  score,
  SCORE_WEIGHTS,
  scaledStat,
  candidateSlots,
  classOk,
  classHands,
  weaponHandKind,
  canEquipSlot,
  CLASS_HANDS,
  isSellJunk,
  isGearPiece,
  isGearTargetName,
  targetNameFor,
  isKeep,
  pendingBetter,
  equipPending,
  wornSnapshot,
  planGifts,
  markGift,
  itemDef,
  itemGrade,
  upgradeChance,
  eligibleUpgrade,
  scrollFor,
  pickUpgradeIndex,
  planVendorBuy,
  MIN_UPGRADE_CHANCE,
};
