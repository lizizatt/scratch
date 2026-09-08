"use strict";

/** Pack centers — shared by sim and live (no G dependency). */
const FARM_XY = {
  goo: { map: "main", x: 0, y: 180 },
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

function packCenter(mtype) {
  return FARM_XY[mtype] || null;
}

module.exports = { FARM_XY, packCenter };
