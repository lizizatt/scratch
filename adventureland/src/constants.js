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
/** Keep this many merchant bag slots open while withdrawing economy batches. */
const ECON_BAG_RESERVE = 4;
/** Keep enough vault capacity for several fighter pickups before expanding boxes/gifts. */
const ECON_BANK_RESERVE = 12;
/** Keep one emergency slot while draining stacked Xyn exchange items one reward at a time. */
const XYN_BAG_RESERVE = 1;
/** Obsolete now that every character uses the stronger hpot1/mpot1 tier. */
const OBSOLETE_POTIONS = ["hpot0", "mpot0"];
/** Last-resort full-bag slot recovery before sacrificing compound inputs. */
const EMERGENCY_SLOT_ITEMS = ["confetti", "cake", "bwing"];
/** Safe fixed rendezvous for saturation pickups. */
const PICKUP_MEET = { map: "main", x: 40, y: -20 };
/** Emergency heal thresholds (live use_hp/use_mp trigger points; also used in sim). */
const HEAL_HP_PCT = 0.55;
const HEAL_MP_PCT = 0.5;
const SEND_RANGE = 320;
const ASSEMBLE_TIMEOUT_MS = 60000;
const RARE_GONE_MS = 20000;
const RARE_WHITELIST = ["phoenix", "goldenbat"];
/** Approved full Monster Hunter sets; order also defines purchase/log order. */
const HUNTER_PLAN = [
  { who: "Sarene", name: "mmhat", slot: "helmet", cost: 7 },
  { who: "Sarene", name: "mmgloves", slot: "gloves", cost: 8 },
  { who: "Sarene", name: "mmpants", slot: "pants", cost: 11 },
  { who: "Zarook", name: "mpgloves", slot: "gloves", cost: 8 },
  { who: "Zarook", name: "mphat", slot: "helmet", cost: 7 },
  { who: "Zarook", name: "mppants", slot: "pants", cost: 11 },
  { who: "Jazwyn", name: "mwgloves", slot: "gloves", cost: 8 },
  { who: "Jazwyn", name: "mwarmor", slot: "chest", cost: 12 },
  { who: "Jazwyn", name: "mwpants", slot: "pants", cost: 11 },
  { who: "Sarene", name: "mmarmor", slot: "chest", cost: 12 },
  { who: "Jazwyn", name: "mwhelmet", slot: "helmet", cost: 7 },
  { who: "Jazwyn", name: "mwboots", slot: "shoes", cost: 15 },
  { who: "Zarook", name: "mparmor", slot: "chest", cost: 12 },
  { who: "Zarook", name: "mpshoes", slot: "shoes", cost: 15 },
  { who: "Sarene", name: "mmshoes", slot: "shoes", cost: 15 },
];
const HUNTER_ITEMS = HUNTER_PLAN.map((x) => x.name);
/** Never toss/sell — Tracktrix stays permanent; approved Hunter pieces survive swaps. */
const KEEP_ALWAYS = ["stand0", "tracker", "pickaxe", "rod"].concat(HUNTER_ITEMS);
/** Merchant idle: exchange these with Xyn (NPC `exchange`). */
const EXCHANGE_ITEMS = [
  "gem0",
  "gift0",
  "anniversarygift",
  "armorbox",
  "weaponbox",
  "jewellerybox",
  "apologybox",
  "bugbountybox",
  "mysterybox",
  "xbox",
];
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
/** Upgradeable junk that is safe to NPC-vendor through +1. */
const VENDOR_NPC_LOW_LEVEL = [
  "wattire",
  "wgloves",
  "partyhat",
  "ringsj",
  "hpamulet",
  "hpbelt",
  "wbook0",
];
const VENDOR_NPC_MAX_LEVEL = 1;
/** Low-value unneeded drops: reclaim immediately instead of occupying stall/vault slots. */
const EMERGENCY_VENDOR_NPC = [
  "cclaw",
  "stinger",
  "poker",
  "slimestaff",
  "eears",
  "mushroomstaff",
];
/**
 * Player-market liquidation. `keep` counts all equipped, bagged, banked, and
 * already-listed copies; only merchant-owned surplus may enter the stall.
 */
const STALL_SELL = [
  { name: "fireblade", keep: 1, floor: 115200, upgradeTo: 5, minLevel: 5 },
  { name: "sshield", keep: 2, floor: 200000, upgradeTo: 5, minLevel: 5 },
  { name: "dagger", keep: 0, upgradeTo: 5, minLevel: 5 },
  { name: "candycanesword", keep: 0 },
  { name: "t2bow", keep: 0, upgradeTo: 5, minLevel: 5 },
  { name: "coat1", keep: 0, upgradeTo: 5, minLevel: 5 },
  { name: "gloves1", keep: 0, upgradeTo: 5, minLevel: 5 },
  { name: "helmet1", keep: 1, upgradeTo: 5, minLevel: 5 },
  { name: "pants1", keep: 1, upgradeTo: 5, minLevel: 5 },
  { name: "xmashat", keep: 0 },
  { name: "firestaff", keep: 0, upgradeTo: 5, minLevel: 5 },
  { name: "firebow", keep: 0, upgradeTo: 5, minLevel: 5 },
  { name: "shoes1", keep: 0, upgradeTo: 5, minLevel: 5 },
  { name: "stramulet", keep: 0, maxLevel: 1 },
  { name: "pants", keep: 0 },
  { name: "gloves", keep: 0 },
  { name: "helmet", keep: 0 },
  { name: "shoes", keep: 0 },
  { name: "coat", keep: 0 },
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
    helmet: "mwhelmet",
    chest: "mwarmor",
    pants: "mwpants",
    shoes: "mwboots",
    gloves: "mwgloves",
    earring1: "strearring",
    earring2: "strearring",
    cape: "cape",
  },
  Zarook: {
    orb: "orbg",
    offhand: "wbook0",
    helmet: "mphat",
    chest: "mparmor",
    pants: "mppants",
    shoes: "mpshoes",
    gloves: "mpgloves",
    earring1: "vitearring",
    earring2: "vitearring",
    cape: "cape",
  },
  Sarene: {
    orb: "orbg",
    offhand: "wbook0",
    helmet: "mmhat",
    chest: "mmarmor",
    pants: "mmpants",
    shoes: "mmshoes",
    gloves: "mmgloves",
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
const HUNTER_UPGRADE_MAX_LEVEL = 5;
const HUNTER_UPGRADE_MIN_CHANCE = 0.95;
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
  ECON_BAG_RESERVE,
  ECON_BANK_RESERVE,
  XYN_BAG_RESERVE,
  OBSOLETE_POTIONS,
  EMERGENCY_SLOT_ITEMS,
  PICKUP_MEET,
  HEAL_HP_PCT,
  HEAL_MP_PCT,
  SEND_RANGE,
  ASSEMBLE_TIMEOUT_MS,
  RARE_GONE_MS,
  RARE_WHITELIST,
  HUNTER_PLAN,
  HUNTER_ITEMS,
  KEEP_ALWAYS,
  EXCHANGE_ITEMS,
  VENDOR_NPC,
  VENDOR_NPC_LOW_LEVEL,
  VENDOR_NPC_MAX_LEVEL,
  EMERGENCY_VENDOR_NPC,
  STALL_SELL,
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
  HUNTER_UPGRADE_MAX_LEVEL,
  HUNTER_UPGRADE_MIN_CHANCE,
  GOLD_FLOAT_MERCHANT,
  GEAR_AD_MS,
  GIFT_TTL_MS,
  JOB_MS,
  METRICS_MS,
};
