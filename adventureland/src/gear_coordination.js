"use strict";

const { FIGHTERS, MERCHANT, GEAR_TARGETS } = require("./constants");
const { score, classOk, candidateSlots } = require("./gear");

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
const DIRECT_GEAR_GROUPS = [
  ["earring1", "earring2"],
  ["ring1", "ring2"],
  ["amulet"],
  ["belt"],
  ["cape"],
  ["orb"],
];
const TARGET_BONUS = 10000;

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
  if (!it) return "null";
  const stable = {
    name: it.name,
    level: it.level || 0,
    p: it.p == null ? null : it.p,
    stat_type: it.stat_type == null ? null : it.stat_type,
    l: it.l ? 1 : 0,
  };
  return JSON.stringify(stable);
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
    observed_revision: revision,
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
    reservations: Object.keys(reservations || {})
      .map((id) => reservations[id] && reservations[id].fingerprint)
      .filter(Boolean),
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

function assignmentValue(item, who, slot, ctype, G) {
  if (!item || !classOk(item, ctype, G)) return -Infinity;
  if (candidateSlots(item, G).indexOf(slot) < 0) return -Infinity;
  const target = GEAR_TARGETS[who] && GEAR_TARGETS[who][slot];
  return score(item, G, ctype) + (target && item.name === target ? TARGET_BONUS : 0);
}

function planGroup(ads, G, group) {
  const slots = [];
  const items = [];
  for (const who of FIGHTERS) {
    const ad = ads[who];
    if (!ad || !ad.slots || !ad.ctype) return null;
    for (const slot of group) {
      slots.push({ who, slot, ctype: ad.ctype });
      const it = ad.slots[slot];
      if (it && !it.l && (ad.reservations || []).indexOf(it.fingerprint) < 0) {
        items.push({ owner: who, sourceSlot: slot, ref: it });
      }
    }
    for (const it of ad.bag || []) {
      if (
        it &&
        !it.l &&
        (ad.reservations || []).indexOf(it.fingerprint) < 0 &&
        candidateSlots(it, G).some((slot) => group.indexOf(slot) >= 0)
      ) {
        items.push({ owner: who, sourceSlot: null, ref: it });
      }
    }
  }

  let states = new Map();
  states.set(0, { value: 0, assignment: [] });
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const next = new Map(states);
    for (const [mask, state] of states) {
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
        if (mask & (1 << slotIndex)) continue;
        const slot = slots[slotIndex];
        if (items[itemIndex].sourceSlot == null && items[itemIndex].owner === slot.who) continue;
        const value = assignmentValue(items[itemIndex].ref, slot.who, slot.slot, slot.ctype, G);
        if (!Number.isFinite(value)) continue;
        const nextMask = mask | (1 << slotIndex);
        const candidate = {
          value: state.value + value,
          assignment: state.assignment.concat([{ itemIndex, slotIndex, value }]),
        };
        const old = next.get(nextMask);
        if (!old || candidate.value > old.value) next.set(nextMask, candidate);
      }
    }
    states = next;
  }

  let best = null;
  for (const state of states.values()) {
    if (!best || state.value > best.value) best = state;
  }
  if (!best) return null;

  const currentByWho = {};
  const finalByWho = {};
  for (const who of FIGHTERS) {
    currentByWho[who] = 0;
    finalByWho[who] = 0;
    const ad = ads[who];
    for (const slot of group) {
      const it = ad.slots[slot];
      if (it) currentByWho[who] += Math.max(0, assignmentValue(it, who, slot, ad.ctype, G));
    }
  }
  for (const a of best.assignment) {
    const slot = slots[a.slotIndex];
    finalByWho[slot.who] += a.value;
  }
  for (const who of FIGHTERS) {
    if (finalByWho[who] + 0.001 < currentByWho[who]) return null;
  }

  const legs = [];
  for (const a of best.assignment) {
    const item = items[a.itemIndex];
    const target = slots[a.slotIndex];
    if (item.owner === target.who) continue;
    legs.push({
      from: item.owner,
      to: target.who,
      fromSlot: item.sourceSlot,
      toSlot: target.slot,
      item: item.ref,
    });
  }
  if (!legs.length) return null;
  legs.sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) ||
      a.toSlot.localeCompare(b.toSlot) ||
      a.item.name.localeCompare(b.item.name)
  );
  return { gain: best.value - Object.values(currentByWho).reduce((a, b) => a + b, 0), legs };
}

function planPeerGearTransfers(ads, G) {
  let best = null;
  for (const group of DIRECT_GEAR_GROUPS) {
    const plan = planGroup(ads || {}, G || {}, group);
    if (plan && plan.gain > 0.001 && (!best || plan.gain > best.gain)) best = plan;
  }
  return best;
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
  planPeerGearTransfers,
};
