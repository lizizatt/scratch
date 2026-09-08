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
/** Loose formation (legacy fighter_core): near/far band + re-anchor. */
const FORM_NEAR = 18;
const FORM_FAR = 40;
const FORM_REANCHOR = 70;
const FORM_MAGE = { dx: -45, dy: 55, face: 1 };
const FORM_PRIEST = { dx: 45, dy: 55, face: 1 };
const ATTACK_MS = 800;
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
const GOLD_FLOAT_FIGHTER = 40000; // ≥ 2 * 200 * ~100 for hpot1; tune with prices
const POTION_TARGET = 200;
const POTION_LOW = 80;
const POTION_DRY = 0;
const SEND_RANGE = 320;
const ASSEMBLE_TIMEOUT_MS = 60000;
const RARE_GONE_MS = 20000;
const RARE_WHITELIST = ["phoenix"];
/** Merchant stall / bank junk whitelist (legacy SELL subset). */
const SELL_WHITELIST = ["frogt", "leatherboots"];
/** Armor names we treat as equippable upgrades in sim. */
const GEAR_TYPES = ["gloves", "shoes", "helmet", "pants", "coat", "ringsj"];
const GEAR_AD_MS = 20000;
const GIFT_TTL_MS = 120000;
const JOB_MS = 480000;

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
  FORM_NEAR,
  FORM_FAR,
  FORM_REANCHOR,
  FORM_MAGE,
  FORM_PRIEST,
  ATTACK_MS,
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
  SEND_RANGE,
  ASSEMBLE_TIMEOUT_MS,
  RARE_GONE_MS,
  RARE_WHITELIST,
  SELL_WHITELIST,
  GEAR_TYPES,
  GEAR_AD_MS,
  GIFT_TTL_MS,
  JOB_MS,
};
