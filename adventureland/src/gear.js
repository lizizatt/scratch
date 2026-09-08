"use strict";

const { SELL_WHITELIST, GEAR_TYPES, GIFT_TTL_MS } = require("./constants");

function itemDef(G, name) {
  return (G && G.items && G.items[name]) || {};
}

function score(it, G, ctype) {
  if (!it) return 0;
  const g = itemDef(G, it.name);
  const lv = it.level || 0;
  const armor = g.armor || 0;
  const atk = g.attack || 0;
  const res = g.resistance || 0;
  const prim = ctype === "mage" ? g.int || 0 : ctype === "priest" ? g.vit || 0 : g.str || 0;
  const base = atk || armor || prim || (g.sell ? 0 : 1);
  return (base + res) * (1 + 0.08 * lv);
}

function candidateSlots(it, G) {
  if (!it) return [];
  const g = itemDef(G, it.name);
  const t = g.type;
  if (t === "ring") return ["ring1", "ring2"];
  if (t === "amulet") return ["amulet"];
  if (t === "belt") return ["belt"];
  if (t === "helmet") return ["helmet"];
  if (t === "chest") return ["chest"];
  if (t === "pants") return ["pants"];
  if (t === "shoes") return ["shoes"];
  if (t === "gloves") return ["gloves"];
  if (t === "cape") return ["cape"];
  if (t === "weapon" || g.wtype) return ["mainhand"];
  if (t === "shield" || t === "source") return ["offhand"];
  return [];
}

function isSellJunk(it, G) {
  if (!it) return false;
  if (/^hpot|^mpot/.test(it.name)) return false;
  if (it.name === "stand0" || it.name === "scroll0") return false;
  if (SELL_WHITELIST.indexOf(it.name) >= 0) return true;
  const g = itemDef(G, it.name);
  return !!g.sell;
}

function isGearPiece(it, G) {
  if (!it) return false;
  const g = itemDef(G, it.name);
  return GEAR_TYPES.indexOf(it.name) >= 0 || !!(g.type && candidateSlots(it, G).length);
}

function pendingBetter(api, it, G) {
  const slots = candidateSlots(it, G);
  const ctype = api.character.ctype;
  for (const s of slots) {
    const worn = api.character.slots[s];
    if (score(it, G, ctype) > score(worn, G, ctype)) return true;
  }
  return false;
}

function isKeep(api, it, G, giftTtl) {
  if (!it) return true;
  if (/^hpot|^mpot/.test(it.name)) return true;
  if (it.name === "stand0" || /^scroll/.test(it.name)) return true;
  const now = api._now ? api._now() : Date.now();
  for (const id of Object.keys(giftTtl || {})) {
    const g = giftTtl[id];
    if (g && g.name === it.name && now < g.expire) return true;
  }
  return pendingBetter(api, it, G);
}

/** Equip any bag piece that beats the worn slot. Returns count equipped. */
function equipPending(api, G, giftTtl) {
  let n = 0;
  const ctype = api.character.ctype;
  for (let i = 0; i < api.character.items.length; i++) {
    const it = api.character.items[i];
    if (!it) continue;
    const targets = candidateSlots(it, G);
    let best = null;
    for (const s of targets) {
      const worn = api.character.slots[s];
      const sw = score(worn, G, ctype);
      const sc = score(it, G, ctype);
      if (sc > sw && (!best || sw < best.sw)) best = { slot: s, sw };
    }
    if (best && typeof api.equip === "function") {
      api.equip(i, best.slot);
      n++;
      api.game_log && api.game_log("equip " + it.name + " +" + (it.level || 0) + " -> " + best.slot);
      for (const id of Object.keys(giftTtl || {})) {
        if (giftTtl[id] && giftTtl[id].name === it.name) delete giftTtl[id];
      }
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
    "ring1",
    "ring2",
  ];
  for (const k of keys) {
    const it = s[k];
    slots[k] = it ? { name: it.name, level: it.level || 0 } : null;
  }
  return { slots, esize: api.character.esize || 0, ctype: api.character.ctype };
}

/**
 * Plan gifts: bank items better than fighter worn ads.
 * bankItems: [{name,level,pack,i}]
 * ads: { Jazwyn: { slots, esize, ctype } }
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
      let best = null;
      for (let j = 0; j < (bankItems || []).length; j++) {
        const e = bankItems[j];
        if (!e || used[j]) continue;
        const it = { name: e.name, level: e.level || 0 };
        if (candidateSlots(it, G).indexOf(slot) < 0) continue;
        const sc = score(it, G, ctype);
        if (!(sc > wc)) continue;
        if (!best || sc > best.sc) best = { who, slot, it, e, sc, idx: j };
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

module.exports = {
  score,
  candidateSlots,
  isSellJunk,
  isGearPiece,
  isKeep,
  pendingBetter,
  equipPending,
  wornSnapshot,
  planGifts,
  markGift,
  itemDef,
};
