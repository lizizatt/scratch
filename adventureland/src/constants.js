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
const JOB_MS = 300000;

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
  JOB_MS,
};
