"use strict";

/** Pack centers — shared by sim and live (no G dependency). */
const FARM_XY = {
  // Live G.maps.main goo boundary [-282,702,218,872] → center (~-32,787).
  // Legacy (0,180) was town plaza south — Daisy goo hunts parked there forever.
  goo: { map: "main", x: -32, y: 787 },
  bee: { map: "main", x: 546, y: 1059 },
  crab: { map: "main", x: -1202, y: -66 },
  snake: { map: "main", x: -82, y: 1901 },
  armadillo: { map: "main", x: 526, y: 1846 },
  croc: { map: "main", x: 801, y: 1710 },
  tortoise: { map: "main", x: -1124, y: 1118 },
  bat: { map: "cave", x: -194, y: -461 },
  arcticbee: { map: "winterland", x: 1082, y: -873 },
  porcupine: { map: "desertland", x: -829, y: 135 },
  boar: { map: "winterland", x: 20, y: -1109 },
  gscorpion: { map: "desertland", x: 391, y: -1422 },
  wolfie: { map: "winterland", x: -169, y: -2026 },
  wolf: { map: "winterland", x: 433, y: -2745 },
};

/**
 * Merchant staging — outside pack aggro. Fighters walk here for restock.
 * Armadillo: SE cave mouth (sim spawn 4 / door), not packCenter (526,1846).
 */
const SAFE_MEET = {
  goo: { map: "main", x: -32, y: 560 },
  // West edge of the bee meadow. (546,900) is inside the walled grove north of it.
  bee: { map: "main", x: 300, y: 1059 },
  crab: { map: "main", x: -1202, y: -220 },
  snake: { map: "main", x: -82, y: 1720 },
  armadillo: { map: "main", x: 750, y: 1800 },
  croc: { map: "main", x: 750, y: 1800 },
  tortoise: { map: "main", x: -1124, y: 950 },
  bat: { map: "cave", x: -100, y: -200 },
  arcticbee: { map: "winterland", x: 1082, y: -600 },
  porcupine: { map: "desertland", x: -829, y: -80 },
  boar: { map: "winterland", x: 20, y: -900 },
  gscorpion: { map: "desertland", x: 391, y: -1200 },
  wolfie: { map: "winterland", x: -169, y: -1800 },
  wolf: { map: "winterland", x: 433, y: -2500 },
};

/** Approx radius from packCenter where merchant dies to aggro (live). */
const PACK_DANGER_R = 200;

function packCenter(mtype) {
  return FARM_XY[mtype] || null;
}

function safeMeet(mtype) {
  if (SAFE_MEET[mtype]) return Object.assign({}, SAFE_MEET[mtype]);
  const c = packCenter(mtype);
  if (!c) return null;
  return { map: c.map, x: c.x, y: c.y - 400 };
}

function nearPack(mtype, map, x, y) {
  const c = packCenter(mtype);
  if (!c || !mtype || map !== c.map) return false;
  return Math.hypot((x || 0) - c.x, (y || 0) - c.y) < PACK_DANGER_R;
}

module.exports = { FARM_XY, SAFE_MEET, PACK_DANGER_R, packCenter, safeMeet, nearPack };
