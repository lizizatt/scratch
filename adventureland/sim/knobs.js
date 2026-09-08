"use strict";

/**
 * Assumed sim knobs (V2_PLAN §12.3 / LESSONS §11).
 * Live explorers replace these with measured values in data/*.live.json;
 * unit tests assert character/world still match this module.
 */
module.exports = {
  VISION_PX: 600,
  SEND_ITEM_RANGE: 320,
  SEND_GOLD_RANGE: 320,
  WALK_PX_PER_S: 30,
  CROSS_MAP_BASE_MS: 8000,
  TOWN_MS: 2000,
  /** change_server reconnect (LESSONS harness ~55–60s) */
  RECONNECT_MS: 55000,
  /** server_region unset after reload (sim delay before go_s can fire) */
  SERVER_REGION_DELAY_MS: 3000,
  PATH_SAMPLE_MS: 2000,
  source: "assumed",
  note: "Calibrate via tools/explore_live.js + Mainframe; keep sim in lockstep with this file until then.",
};
