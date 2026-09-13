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

const FARM_SPAWNS = {
  bat: [FARM_XY.bat, { map: "cave", x: 1110, y: 60 }],
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
  // Northwest edge of the snake basin. (-82,1720) is inside the walled grove above it.
  snake: { map: "main", x: -280, y: 1810 },
  armadillo: { map: "main", x: 750, y: 1800 },
  croc: { map: "main", x: 750, y: 1800 },
  tortoise: { map: "main", x: -1124, y: 950 },
  bat: { map: "cave", x: -294, y: -241 },
  arcticbee: { map: "winterland", x: 1082, y: -600 },
  porcupine: { map: "desertland", x: -829, y: -80 },
  boar: { map: "winterland", x: 20, y: -900 },
  gscorpion: { map: "desertland", x: 391, y: -1200 },
  wolfie: { map: "winterland", x: -169, y: -1800 },
  wolf: { map: "winterland", x: 433, y: -2500 },
};

const SAFE_MEETS = {
  bat: [SAFE_MEET.bat, { map: "cave", x: 890, y: 140 }],
};

/** Approx radius from packCenter where merchant dies to aggro (live). */
const PACK_DANGER_R = 200;

function packCenters(mtype) {
  return FARM_SPAWNS[mtype] || (FARM_XY[mtype] ? [FARM_XY[mtype]] : []);
}

function nearestPackIndex(mtype, map, x, y) {
  const centers = packCenters(mtype);
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const center = centers[i];
    if (map != null && center.map !== map) continue;
    const distance =
      x == null || y == null ? (i ? Infinity : 0) : Math.hypot(x - center.x, y - center.y);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

function packCenter(mtype, map, x, y) {
  const centers = packCenters(mtype);
  const index = nearestPackIndex(mtype, map, x, y);
  return index >= 0 ? centers[index] : centers[0] || null;
}

function nearAnyKnownPack(map, x, y) {
  return Object.keys(FARM_XY).some((mtype) =>
    packCenters(mtype).some(
      (center) =>
        center.map === map &&
        Math.hypot(x - center.x, y - center.y) <= PACK_DANGER_R + 120
    )
  );
}

function safeMeet(mtype, map, x, y) {
  const meets = SAFE_MEETS[mtype];
  const index = nearestPackIndex(mtype, map, x, y);
  const center = index >= 0 ? packCenters(mtype)[index] : null;
  const configured = meets && index >= 0 ? meets[index] : SAFE_MEET[mtype];
  if (
    configured &&
    (x == null || y == null || Math.hypot(x - center.x, y - center.y) <= PACK_DANGER_R + 120)
  )
    return Object.assign({}, configured);
  if (map != null && x != null && y != null && nearAnyKnownPack(map, x, y)) {
    return SAFE_MEET[mtype] ? Object.assign({}, SAFE_MEET[mtype]) : null;
  }
  if (map != null && x != null && y != null) {
    const distance = Math.hypot(x, y);
    if (distance > 0) {
      const offset = Math.min(260, distance);
      return {
        map,
        x: Math.round(x - (x / distance) * offset),
        y: Math.round(y - (y / distance) * offset),
      };
    }
  }
  if (SAFE_MEET[mtype]) return Object.assign({}, SAFE_MEET[mtype]);
  const c = center || packCenter(mtype, map, x, y);
  if (!c) return null;
  return { map: c.map, x: c.x, y: c.y - 400 };
}

function nearPack(mtype, map, x, y) {
  if (!mtype) return false;
  return packCenters(mtype).some(
    (c) => map === c.map && Math.hypot((x || 0) - c.x, (y || 0) - c.y) < PACK_DANGER_R
  );
}

module.exports = {
  FARM_XY,
  FARM_SPAWNS,
  SAFE_MEET,
  SAFE_MEETS,
  PACK_DANGER_R,
  packCenters,
  packCenter,
  safeMeet,
  nearPack,
};
