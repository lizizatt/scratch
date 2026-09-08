"use strict";

/** Minimal G-shaped world data (maps, packs, NPCs). Real G can replace later. */
function baseG() {
  return {
    version: "v2-sim",
    monsters: {
      goo: { attack: 5, xp: 100 },
      bee: { attack: 16, xp: 400 },
      crab: { attack: 24, xp: 500 },
      snake: { attack: 24, xp: 960 },
      armadillo: { attack: 20, xp: 1720, hp: 280 },
      croc: { attack: 48, xp: 3600 },
      tortoise: { attack: 36, xp: 5200 },
      bat: { attack: 50, xp: 8000 },
      arcticbee: { attack: 64, xp: 1800 },
      porcupine: { attack: 16, xp: 3200 },
      boar: { attack: 240, xp: 10800 },
      gscorpion: { attack: 120, xp: 48000 },
      wolfie: { attack: 320, xp: 16400 },
      wolf: { attack: 480, xp: 48800 },
      phoenix: { attack: 400, xp: 120000, rare: true },
      spider: { attack: 80, xp: 12000 },
      scorpion: { attack: 100, xp: 20000 },
      target: { attack: 0, xp: 0, unlist: true },
    },
    items: {
      hpot0: { g: 20, type: "pot" },
      hpot1: { g: 100, type: "pot" },
      mpot0: { g: 20, type: "pot" },
      mpot1: { g: 100, type: "pot" },
      scroll0: { g: 1000 },
      pants: { g: 1600, type: "pants", upgrade: true, armor: 10, grades: [7, 9] },
      coat: { g: 2400, type: "chest", upgrade: true, armor: 12, grades: [7, 9] },
      gloves: { g: 800, type: "gloves", upgrade: true, armor: 4, grades: [7, 9] },
      shoes: { g: 800, type: "shoes", upgrade: true, armor: 4, grades: [7, 9] },
      helmet: { g: 1200, type: "helmet", upgrade: true, armor: 8, grades: [7, 9] },
      ringsj: { g: 24000, type: "ring", compound: { str: 2 }, grades: [2, 5] },
      /** Whitelisted junk — sell/stall (legacy SELL) */
      frogt: { g: 120, type: "material", sell: true },
      leatherboots: { g: 200, type: "shoes", upgrade: true, armor: 1, grades: [7, 9] },
      stand0: { g: 40000 },
    },
    skills: {
      taunt: { mp: 40, cooldown: 3000 },
      charge: { mp: 0, cooldown: 40000 },
      cleave: { mp: 720, cooldown: 1200, level: 52 },
      curse: { mp: 400, cooldown: 5000 },
      partyheal: { mp: 400, cooldown: 200 },
      revive: { mp: 500, cooldown: 200 },
      mluck: { mp: 10, cooldown: 100, level: 40, range: 320 },
    },
    maps: {
      main: {
        monsters: [
          { type: "goo", boundary: [-80, 100, 80, 260] },
          { type: "bee", boundary: [500, 1000, 580, 1100] },
          { type: "crab", boundary: [-1240, -100, -1160, -30] },
          { type: "snake", boundary: [-120, 1860, -40, 1940] },
          { type: "armadillo", boundary: [480, 1800, 560, 1880] },
          { type: "croc", boundary: [760, 1670, 840, 1750] },
          { type: "tortoise", boundary: [-1160, 1080, -1080, 1160] },
          { type: "spider", boundary: [700, -282, 1196, -6] },
        ],
        // 0 town, 1 potions-ish, 2 bank exit, 3 cave mouth, 4 cave east exit
        spawns: [
          [0, 0],
          [56, -122],
          [40, -20],
          [-40, -300],
          [750, 1800],
        ],
        doors: [
          { to: "cave", x: -40, y: -300, spawn: 0 },
          // SE farm entrance (symmetric with cave east exit → spawn 4)
          { to: "cave", x: 750, y: 1800, spawn: 2 },
          { to: "bank", x: 0, y: -50, spawn: 0 },
          // Stub transporters (real G later); explorer cross-map routes
          { to: "winterland", x: -50, y: -50, spawn: 0 },
          { to: "desertland", x: -80, y: -50, spawn: 0 },
        ],
        blocked: [
          // Water / spider-island (LESSONS §1.2)
          { x0: 304, y0: -300, x1: 688, y1: 120 },
          // Full-width ridge south of bee belt: SE farms (armadillo/croc) need cave;
          // bee (~y1059) stays overland-reachable from town.
          { x0: -4000, y0: 1200, x1: 4000, y1: 1580 },
          // Extra rock west of potions → cave mouth (forces a short west dogleg)
          { x0: -10, y0: -280, x1: 80, y1: -160 },
        ],
      },
      cave: {
        monsters: [
          { type: "bat", boundary: [-240, -500, -140, -420] },
          { type: "bat", boundary: [1060, 20, 1160, 100] },
        ],
        spawns: [
          [0, 0],
          [-194, -461],
          [1100, 50],
        ],
        doors: [
          // Back out near cave mouth on main
          { to: "main", x: 0, y: 0, spawn: 3 },
          // East tunnel → SE main (past the ridge)
          { to: "main", x: 1100, y: 50, spawn: 4 },
        ],
        blocked: [
          // Force a southern then eastern crawl through the cave
          { x0: 80, y0: -60, x1: 950, y1: 80 },
          { x0: -100, y0: -420, x1: 550, y1: -120 },
        ],
      },
      winterland: {
        monsters: [
          { type: "arcticbee", boundary: [1040, -900, 1120, -840] },
          { type: "boar", boundary: [-20, -1140, 60, -1070] },
          { type: "wolfie", boundary: [-200, -2060, -140, -1990] },
          { type: "wolf", boundary: [400, -2780, 460, -2710] },
        ],
        spawns: [[0, 0]],
        doors: [{ to: "main", x: 0, y: 0, spawn: 0 }],
      },
      desertland: {
        monsters: [
          { type: "porcupine", boundary: [-860, 100, -800, 170] },
          { type: "gscorpion", boundary: [360, -1460, 420, -1380] },
        ],
        spawns: [[0, 0], [-48, 56]],
        doors: [{ to: "main", x: 0, y: 0, spawn: 0 }],
      },
      bank: {
        monsters: [],
        spawns: [[0, -37]],
        doors: [{ to: "main", x: 0, y: -37, spawn: 2 }], // exit near bank door on main
      },
      halloween: { monsters: [], spawns: [[0, 0]] },
      jail: { monsters: [], spawns: [[0, 0]] },
      winter_inn: { monsters: [], spawns: [[0, 0]] },
      winter_cave: { monsters: [], spawns: [[0, 0]] },
      mtunnel: { monsters: [], spawns: [[0, 8]] },
    },
  };
}

const { FARM_XY, packCenter } = require("../src/packs");
const knobs = require("./knobs");

const NPC = {
  potions: { map: "main", x: 56, y: -122 },
  potions_alt: { map: "main", x: 40, y: -120 },
  bank: { map: "bank", x: 0, y: -50 },
  bank_exit: { map: "main", x: 40, y: -20 },
  upgrade: { map: "main", x: -207, y: -220 },
  ponty: { map: "main", x: 106, y: -47 },
};

function dist(a, b) {
  const ax = a.real_x != null ? a.real_x : a.x;
  const ay = a.real_y != null ? a.real_y : a.y;
  const bx = b.real_x != null ? b.real_x : b.x;
  const by = b.real_y != null ? b.real_y : b.y;
  return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}

function boundaryCenter(b) {
  return { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 };
}

function isBlocked(map, x, y, G) {
  const m = G.maps[map];
  if (!m || !m.blocked) return false;
  for (const r of m.blocked) {
    if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
  }
  return false;
}

/** Default vision radius (px). Explorer will calibrate; ASSUMED until then. */
const VISION_PX = knobs.VISION_PX;
const SEND_ITEM_RANGE = knobs.SEND_ITEM_RANGE;
const SEND_GOLD_RANGE = knobs.SEND_GOLD_RANGE;
const LOOT_RANGE = 40;

/**
 * Deterministic kill drops: whitelist junk every kill + rotating gear upgrades.
 * n = world kill counter (stable for tests / viz).
 */
function dropsForKill(mtype, n) {
  const out = [{ name: "frogt", q: 1 }];
  const gear = ["gloves", "shoes", "helmet", "pants"];
  if (n % 2 === 0) out.push({ name: gear[(n / 2) % gear.length], level: 0 });
  if (mtype === "armadillo" && n % 5 === 0) out.push({ name: "leatherboots", level: 0 });
  return out;
}

module.exports = {
  baseG,
  FARM_XY,
  NPC,
  dist,
  packCenter,
  boundaryCenter,
  isBlocked,
  dropsForKill,
  VISION_PX,
  SEND_ITEM_RANGE,
  SEND_GOLD_RANGE,
  LOOT_RANGE,
};
