"use strict";

const { FIGHTERS, MERCHANT } = require("./constants");

const ITEM_VOLATILE_KEYS = { index: 1, slot: 1 };
const EQUIPMENT_SLOTS = [
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

function stableValue(v) {
  if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(stableValue);
  if (typeof v !== "object") return undefined;
  const out = {};
  for (const k of Object.keys(v).sort()) {
    if (ITEM_VOLATILE_KEYS[k]) continue;
    const x = stableValue(v[k]);
    if (x !== undefined) out[k] = x;
  }
  return out;
}

function compactGearItem(it) {
  return it ? stableValue(it) : null;
}

function itemFingerprint(it) {
  return JSON.stringify(compactGearItem(it));
}

function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function observedItem(it, where, revision) {
  if (!it) return null;
  const item = compactGearItem(it);
  const fingerprint = itemFingerprint(item);
  return Object.assign({}, item, {
    uid: revision + ":" + where + ":" + shortHash(fingerprint),
    where,
    fingerprint,
  });
}

function inventoryDigest(api) {
  const slots = {};
  for (const slot of Object.keys((api.character && api.character.slots) || {}).sort()) {
    const it = api.character.slots[slot];
    if (it) slots[slot] = compactGearItem(it);
  }
  const bag = [];
  const items = (api.character && api.character.items) || [];
  for (let i = 0; i < items.length; i++) {
    if (items[i]) bag.push({ index: i, item: compactGearItem(items[i]) });
  }
  return JSON.stringify({ slots, bag });
}

function makeInventorySnapshot(api, revision, reservations) {
  const slots = {};
  const worn = (api.character && api.character.slots) || {};
  for (const slot of EQUIPMENT_SLOTS) {
    const it = worn[slot];
    slots[slot] = it ? observedItem(it, "slot:" + slot, revision) : null;
  }
  const bag = [];
  const items = (api.character && api.character.items) || [];
  for (let i = 0; i < items.length; i++) {
    if (items[i]) bag.push(observedItem(items[i], "bag:" + i, revision));
  }
  return {
    inventory_ad: 1,
    v: 2,
    who: api.character.name,
    revision,
    observed_at: api._now ? api._now() : Date.now(),
    server_region: api.parent && api.parent.server_region,
    server_identifier: api.parent && api.parent.server_identifier,
    map: api.character.map,
    x: api.character.real_x,
    y: api.character.real_y,
    esize: api.character.esize || 0,
    ctype: api.character.ctype,
    slots,
    bag,
    reservations: Object.keys(reservations || {}),
  };
}

function resolveObservedItem(api, ref) {
  if (!ref || !ref.where || !ref.fingerprint) return null;
  let it = null;
  let index = -1;
  let slot = null;
  if (ref.where.indexOf("slot:") === 0) {
    slot = ref.where.slice(5);
    it = api.character.slots && api.character.slots[slot];
  } else if (ref.where.indexOf("bag:") === 0) {
    index = Number(ref.where.slice(4));
    if (!Number.isInteger(index) || index < 0) return null;
    it = api.character.items && api.character.items[index];
  }
  if (!it || itemFingerprint(it) !== ref.fingerprint) return null;
  return { item: it, index, slot };
}

function cmSender(m) {
  return m && (m.name || m.from) ? m.name || m.from : null;
}

function isMerchantMessage(m) {
  return cmSender(m) === MERCHANT;
}

function isFighterName(name) {
  return FIGHTERS.indexOf(name) >= 0;
}

module.exports = {
  compactGearItem,
  itemFingerprint,
  inventoryDigest,
  makeInventorySnapshot,
  resolveObservedItem,
  cmSender,
  isMerchantMessage,
  isFighterName,
};
