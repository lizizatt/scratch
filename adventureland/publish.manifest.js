"use strict";

/**
 * Single source of truth for the V2 publish pipeline.
 *
 * Edit source under src/; never hand-edit dist/.
 * Build:  node publish.js --build
 * Upload: node publish.js --upload
 * Full:   node publish.js
 *
 * Adventure Land CODE editor limit: ≤176 non-empty lines per slot.
 * We do NOT mangle identifiers — load_code slots share globals by name.
 */

const path = require("path");

const MAX_LINES = 176;
const MAX_CHARS = 12000;

/**
 * @typedef {object} SlotSpec
 * @property {string} id           dist basename without .js / report key
 * @property {string} out          filename under dist/
 * @property {"bundle"|"entry"} kind
 *   bundle = multi-file join (strip require/module.exports/"use strict")
 *   entry  = character/library entrypoint (pack only; keeps load_code calls)
 * @property {string[]} sources    paths relative to adventureland/
 * @property {{ name: string, match: RegExp }} upload  MCP save_code target
 * @property {string} [role]       human blurb for docs
 */

/** @type {SlotSpec[]} */
const SLOTS = [
  {
    id: "v2_lib",
    out: "v2_lib.js",
    kind: "bundle",
    role: "Shared constants, packs, gear helpers, chat queue, party state, motion",
    sources: [
      "src/constants.js",
      "src/potions.js",
      "src/packs.js",
      "src/gear.js",
      "src/gear_coordination.js",
      "src/monsterhunt.js",
      "src/chat_queue.js",
      "src/party_state.js",
      "src/motion.js",
    ],
    upload: { name: "v2_lib", match: /^v2_lib$/i },
  },
  {
    id: "v2_fighter",
    out: "v2_fighter.js",
    kind: "bundle",
    role: "Fighter runtime (AL API shim + fighter + live hooks)",
    sources: [
      "src/al_api.js",
      "src/party_movement.js",
      "src/combat_rotations.js",
      "src/combat_runner.js",
      "src/fighter.js",
      "src/live_fighter_runtime.js",
    ],
    upload: { name: "v2_fighter", match: /^v2_fighter$/i },
  },
  {
    id: "v2_merchant",
    out: "v2_merchant.js",
    kind: "bundle",
    role: "Merchant runtime (AL API shim + merchant + live hooks)",
    sources: ["src/al_api.js", "src/bank_clean_plan.js", "src/merchant_avoid.js", "src/merchant_meet.js", "src/merchant.js", "src/live_merchant_runtime.js"],
    upload: { name: "v2_merchant", match: /^v2_merchant$/i },
  },
  {
    id: "warrior",
    out: "warrior.js",
    kind: "entry",
    role: "Jazwyn character entry — load_code lib+fighter, warrior combat",
    sources: ["src/slots/warrior.js"],
    upload: { name: "Jazwyn", match: /jazwyn/i },
  },
  {
    id: "mage",
    out: "mage.js",
    kind: "entry",
    role: "Sarene character entry",
    sources: ["src/slots/mage.js"],
    upload: { name: "Sarene", match: /sarene/i },
  },
  {
    id: "priest",
    out: "priest.js",
    kind: "entry",
    role: "Zarook character entry",
    sources: ["src/slots/priest.js"],
    upload: { name: "Zarook", match: /zarook/i },
  },
  {
    id: "merchant",
    out: "merchant.js",
    kind: "entry",
    role: "Puppygirl character entry — load_code lib+merchant",
    sources: ["src/slots/merchant.js"],
    upload: { name: "Puppygirl", match: /puppygirl/i },
  },
];

function resolveSources(root, slot) {
  return slot.sources.map((s) => path.join(root, s));
}

function uploadsFromManifest() {
  return SLOTS.map((s) => ({
    file: s.out,
    name: s.upload.name,
    match: s.upload.match,
    id: s.id,
  }));
}

module.exports = {
  MAX_LINES,
  MAX_CHARS,
  SLOTS,
  resolveSources,
  uploadsFromManifest,
};
