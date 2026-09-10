"use strict";

const LEADER_ORDER = ["Jazwyn", "Sarene", "Zarook"];
const FIGHTERS = ["Jazwyn", "Sarene", "Zarook"];
const MERCHANT = "Puppygirl";
const FARM = ["US", "III"];
const HOME = ["US", "II"];

const CHAT_GAP_MS = 16000;
const HEARTBEAT_MS = 60000;
const FORM_R_IN = 220;
const FORM_R_OUT = 400;
/** Fighter: max distance from pack center to still consider a found monster "here". */
const FIGHTER_ENGAGE_R = 280;
/** Merchant avoid-steering: distance at which a hostile is worth dodge-stepping around. */
const AVOID_ENGAGE_R = 180;
/** Loose formation (legacy fighter_core): near/far band + re-anchor. */
const FORM_NEAR = 18;
const FORM_FAR = 40;
const FORM_REANCHOR = 70;
const FORM_MAGE = { dx: -45, dy: 55, face: 1 };
const FORM_PRIEST = { dx: 45, dy: 55, face: 1 };
const PACK_COUNT = 5;
const RESPAWN_MS = 10000;
const MELEE_RANGE = 40;
const MAGE_RANGE = 120;
const PRIEST_RANGE = 100;
const PRESENT_EXIT_MS = 20000;
const WAIT_PARTY_MS = 90000;
const ACK_MS = 20000;
const PENDING_MS = 480000;
const FALLBACK_SILENCE_MS = 90000;
const BEACON_MS = 8000;
const GOLD_FLOAT_FIGHTER = 100000; // keep ~100k on fighters for town buys / float
const POTION_TARGET = 200;
const POTION_LOW = 80;
const POTION_DRY = 0;
/** Emergency heal thresholds (live use_hp/use_mp trigger points; also used in sim). */
const HEAL_HP_PCT = 0.55;
const HEAL_MP_PCT = 0.5;
const SEND_RANGE = 320;
const ASSEMBLE_TIMEOUT_MS = 60000;
const RARE_GONE_MS = 20000;
const RARE_WHITELIST = ["phoenix"];
/** Never toss/sell — Tracktrix (`tracker`) stays on Jazwyn permanently; craft tools stay parked. */
const KEEP_ALWAYS = ["stand0", "tracker", "pickaxe", "rod"];
/** Merchant idle: exchange these with Xyn (NPC `exchange`). */
const EXCHANGE_ITEMS = ["gem0", "anniversarygift"];
/**
 * Instant NPC vendor (`sell`) — holiday junk + materials that never move on stall.
 * Do NOT vendor goal earrings (strearring / vitearring / intearring) or capes.
 */
const VENDOR_NPC = [
  "dexamulet",
  "dexearring",
  "rednose",
  "wcap",
  "wshoes",
  "frogt",
  "leatherboots",
  "beewings",
  "gslime",
];
/** Compound priority for bank clean / merchant combine. */
const COMBINE_PRIORITY = [
  "orbg",
  "ringsj",
  "strearring",
  "vitearring",
  "intearring",
  "hpbelt",
  "hpamulet",
  "wbook0",
  "stramulet",
  "intbelt",
  "vitring",
  "armorring",
];
const GEAR_TYPES = ["gloves", "shoes", "helmet", "pants", "coat", "ringsj", "cape"];
/** Vendor base pieces we may buy for empty fighter slots (post-MVP sourcing). */
const VENDOR_GEAR = ["gloves", "shoes", "helmet", "pants", "coat"];
/** scroll0 upgrade allowlist — armor bases + cape + Jazwyn spiked shield. */
const SCROLL0_ALLOW = ["pants", "coat", "gloves", "shoes", "helmet", "sshield", "cape"];
/**
 * Named gear targets (gift / keep / Ponty·Ron browse).
 * Earrings: str → warrior, vit → priest, int → mage. Cape: basic cape for all fighters.
 */
const GEAR_TARGETS = {
  Jazwyn: {
    orb: "orbg",
    offhand: "sshield",
    mainhand: "fireblade",
    earring1: "strearring",
    earring2: "strearring",
    cape: "cape",
  },
  Zarook: {
    orb: "orbg",
    offhand: "wbook0",
    earring1: "vitearring",
    earring2: "vitearring",
    cape: "cape",
  },
  Sarene: {
    orb: "orbg",
    offhand: "wbook0",
    earring1: "intearring",
    earring2: "intearring",
    cape: "cape",
  },
};
/** Ponty browse quotas: [name, wantCount] across bag+bank+equipped. */
const PONTY_WANT = [
  ["strearring", 6],
  ["vitearring", 6],
  ["intearring", 4],
  ["cape", 3],
  ["sshield", 2],
  ["wbook0", 2],
];
const PONTY_MULT = 1.25;
/** Idle recipes: gathered-material orb at Cole, then one each of Leo's tools. */
const CRAFT_TARGETS = ["orbg", "rod", "pickaxe"];
const MAX_SAFE_UPGRADE = 5;
const MIN_UPGRADE_CHANCE = 0.9;
/** Merchant keeps this gold floor for pot deliveries before gear buys. */
const GOLD_FLOAT_MERCHANT = 150000;
const GEAR_AD_MS = 20000;
const GIFT_TTL_MS = 120000;
const JOB_MS = 480000;
/** Emit `metrics kpm=… gpm=…` this often (ms). */
const METRICS_MS = 60000;

module.exports = {
  LEADER_ORDER,
  FIGHTERS,
  MERCHANT,
  FARM,
  HOME,
  CHAT_GAP_MS,
  HEARTBEAT_MS,
  FORM_R_IN,
  FORM_R_OUT,
  FIGHTER_ENGAGE_R,
  AVOID_ENGAGE_R,
  FORM_NEAR,
  FORM_FAR,
  FORM_REANCHOR,
  FORM_MAGE,
  FORM_PRIEST,
  PACK_COUNT,
  RESPAWN_MS,
  MELEE_RANGE,
  MAGE_RANGE,
  PRIEST_RANGE,
  PRESENT_EXIT_MS,
  WAIT_PARTY_MS,
  ACK_MS,
  PENDING_MS,
  FALLBACK_SILENCE_MS,
  BEACON_MS,
  GOLD_FLOAT_FIGHTER,
  POTION_TARGET,
  POTION_LOW,
  POTION_DRY,
  HEAL_HP_PCT,
  HEAL_MP_PCT,
  SEND_RANGE,
  ASSEMBLE_TIMEOUT_MS,
  RARE_GONE_MS,
  RARE_WHITELIST,
  KEEP_ALWAYS,
  EXCHANGE_ITEMS,
  VENDOR_NPC,
  COMBINE_PRIORITY,
  GEAR_TYPES,
  VENDOR_GEAR,
  SCROLL0_ALLOW,
  GEAR_TARGETS,
  PONTY_WANT,
  PONTY_MULT,
  CRAFT_TARGETS,
  MAX_SAFE_UPGRADE,
  MIN_UPGRADE_CHANCE,
  GOLD_FLOAT_MERCHANT,
  GEAR_AD_MS,
  GIFT_TTL_MS,
  JOB_MS,
  METRICS_MS,
};
