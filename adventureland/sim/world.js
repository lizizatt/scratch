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
      goldenbat: { attack: 50, hp: 24000, xp: 20000, rare: true },
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
      cscroll0: { g: 800 },
      cscroll1: { g: 1600 },
      cscroll2: { g: 64000 },
      hpbelt: { g: 12000, type: "belt", compound: { hp: 60 }, grades: [2, 5] },
      pants: { g: 1600, type: "pants", upgrade: true, armor: 10, grades: [7, 9] },
      coat: { g: 2400, type: "chest", upgrade: true, armor: 12, grades: [7, 9] },
      gloves: { g: 800, type: "gloves", upgrade: true, armor: 4, grades: [7, 9] },
      shoes: { g: 800, type: "shoes", upgrade: true, armor: 4, grades: [7, 9] },
      helmet: { g: 1200, type: "helmet", upgrade: true, armor: 8, grades: [7, 9] },
      ringsj: { g: 24000, type: "ring", compound: { str: 2 }, grades: [2, 5] },
      /** Whitelisted junk — NPC vendor (VENDOR_NPC) */
      frogt: { g: 120, type: "material", sell: true },
      leatherboots: { g: 200, type: "shoes", upgrade: true, armor: 1, grades: [7, 9] },
      stand0: { g: 40000 },
      tracker: { g: 12000, type: "tracker" },
      gem0: { g: 24000, e: 1, type: "gem" },
      anniversarygift: { g: 0, e: 1, type: "misc" },
      ascale: { g: 500, type: "material", s: 9999 },
      pleather: { g: 400, type: "material", s: 9999 },
      cscale: { g: 200, type: "material", s: 9999 },
      bfur: { g: 5, type: "material", s: 9999 },
      orbg: {
        g: 60000,
        type: "orb",
        str: 2,
        int: 2,
        dex: 2,
        compound: { str: 1, int: 1, dex: 1 },
        grades: [4, 6, 6, 7],
      },
      sshield: {
        g: 24000,
        type: "shield",
        armor: 60,
        resistance: 20,
        dreturn: 3,
        upgrade: { dreturn: 1.5, armor: 10, resistance: 7 },
        grades: [4, 8, 10, 12],
      },
      shield: {
        g: 24000,
        type: "shield",
        armor: 60,
        resistance: 20,
        upgrade: { armor: 12.5, resistance: 7.5 },
        grades: [4, 8, 10, 12],
      },
      wbook0: { g: 12000, type: "source", int: 3 },
      beewings: { g: 20, type: "material", sell: true },
      strearring: { g: 38000, type: "earring", str: 3, compound: { str: 2 }, grades: [2, 5] },
      vitearring: { g: 38000, type: "earring", vit: 3, compound: { vit: 2 }, grades: [2, 5] },
      intearring: { g: 38000, type: "earring", int: 3, compound: { int: 2 }, grades: [2, 5] },
      dexearring: { g: 38000, type: "earring", dex: 3, compound: { dex: 2 }, grades: [2, 5] },
      cape: { g: 20000, type: "cape", armor: 10, resistance: 8, stat: 4, upgrade: true, grades: [0, 8, 10, 12] },
      staff: { g: 12400, type: "weapon", wtype: "staff", upgrade: true, attack: 25, grades: [7, 9] },
      fireblade: {
        g: 48000,
        type: "weapon",
        wtype: "short_sword",
        upgrade: { attack: 4.5, range: 1.5 },
        attack: 21,
        grades: [0, 8],
      },
      blade: { g: 8000, type: "weapon", wtype: "short_sword", upgrade: { attack: 4 }, attack: 15, grades: [7, 9] },
      wblade: { g: 100000, type: "weapon", wtype: "wblade", attack: 48, upgrade: { attack: 8 }, grades: [0, 0] },
      basher: { g: 40000, type: "weapon", wtype: "basher", attack: 35, armor: 20, upgrade: { attack: 9, armor: 4 }, grades: [0, 7] },
      bataxe: { g: 50000, type: "weapon", wtype: "axe", attack: 41, reflection: 4, upgrade: { attack: 10 }, grades: [0, 6] },
      spidersilk: { g: 300, type: "material", s: 9999 },
      pickaxe: { g: 2000, type: "tool", wtype: "pickaxe" },
      rod: { g: 2000, type: "tool", wtype: "rod" },
      monstertoken: { g: 12000, type: "token", npc: "monsterhunter" },
      mmhat: { class: ["mage"], set: "mmage", type: "helmet", stat: 2, armor: 19, resistance: 22, rpiercing: 40, grades: [0, 7] },
      mmgloves: { class: ["mage"], set: "mmage", type: "gloves", stat: 2, armor: 22, resistance: 11, grades: [0, 7] },
      mmpants: { class: ["mage"], set: "mmage", type: "pants", stat: 2, armor: 28, resistance: 17, grades: [0, 7] },
      mpgloves: { class: ["priest"], set: "mpriest", type: "gloves", stat: 2, armor: 22, resistance: 11, output: 5, grades: [0, 7] },
      mphat: { class: ["priest"], set: "mpriest", type: "helmet", stat: 2, armor: 19, resistance: 22, grades: [0, 7] },
      mppants: { class: ["priest"], set: "mpriest", type: "pants", stat: 2, armor: 28, resistance: 17, grades: [0, 7] },
      mwgloves: { class: ["warrior"], set: "mwarrior", type: "gloves", stat: 2, armor: 23, resistance: 12, crit: 1, grades: [0, 5] },
    },
    tokens: {
      monstertoken: {
        mmhat: 7,
        mmgloves: 8,
        mmpants: 11,
        mpgloves: 8,
        mphat: 7,
        mppants: 11,
        mwgloves: 8,
      },
    },
    sets: {
      mmage: { 2: { int: 2 }, 3: { speed: 2, int: 3 } },
      mpriest: { 2: { int: 3 }, 3: { speed: 2, int: 3 } },
      mwarrior: { 2: { str: 2 }, 3: { speed: 1, str: 3 } },
    },
    craft: {
      orbg: {
        items: [[1, "ascale"], [1, "pleather"], [1, "cscale"], [1, "bfur"]],
        cost: 0,
        quest: "mcollector",
      },
      pickaxe: { items: [[1, "staff"], [1, "spidersilk"], [1, "blade"]], cost: 100 },
      rod: { items: [[1, "staff"], [1, "spidersilk"]], cost: 100 },
    },
    classes: {
      warrior: {
        main_stat: "str",
        mainhand: { spear: {}, short_sword: {}, sword: {}, fist: {}, mace: {} },
        offhand: { shield: {}, short_sword: {}, sword: {}, misc_offhand: {}, fist: {}, mace: {} },
        doublehand: { rapier: {}, bow: {}, axe: {}, scythe: {}, basher: {}, great_sword: {} },
      },
      mage: {
        main_stat: "int",
        mainhand: { staff: {}, wblade: {}, wand: {} },
        offhand: { source: {}, misc_offhand: {} },
        doublehand: {},
      },
      priest: {
        main_stat: "int",
        mainhand: { pmace: {}, staff: {} },
        offhand: { shield: {}, source: {}, misc_offhand: {} },
        doublehand: { wand: {} },
      },
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
          { type: "goo", boundary: [-282, 702, 218, 872] },
          { type: "bee", boundary: [424, 1014, 668, 1104] },
          { type: "bee", boundary: [418, 994, 570, 1208] },
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
          // Walled grove immediately north of the main bee meadow.
          { x0: 416, y0: 856, x1: 680, y1: 984 },
          // Walled grove immediately north of the snake basin.
          { x0: -200, y0: 1544, x1: 104, y1: 1800 },
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

const { FARM_XY, packCenter, safeMeet, nearPack } = require("../src/packs");
const knobs = require("./knobs");

const NPC = {
  potions: { map: "main", x: 56, y: -122 },
  potions_alt: { map: "main", x: 40, y: -120 },
  bank: { map: "bank", x: 0, y: -50 },
  bank_exit: { map: "main", x: 40, y: -20 },
  upgrade: { map: "main", x: -207, y: -220 },
  ponty: { map: "main", x: 106, y: -47 },
  /** Daisy — live maps.main.npcs monsterhunter position [126,-413] */
  monsterhunt: { map: "main", x: 126, y: -413 },
  daisy: { map: "main", x: 126, y: -413 },
  /** Xyn — live maps.main.npcs exchange position [-25,-478] */
  exchange: { map: "main", x: -25, y: -478 },
  xyn: { map: "main", x: -25, y: -478 },
  /** Ponty — live maps.main.npcs secondhands ≈ [106,-47] */
  secondhands: { map: "main", x: 106, y: -47 },
  ponty: { map: "main", x: 106, y: -47 },
  /** Gabriel — basics/weapons vendor ≈ [-89,-165] */
  basics: { map: "main", x: -89, y: -165 },
  weapons: { map: "main", x: -89, y: -165 },
  /** Leo — craftsman ≈ [92,670] */
  craftsman: { map: "main", x: 92, y: 670 },
  /** Cole — Material Collector, official maps.main position [81,-283] */
  mcollector: { map: "main", x: 81, y: -283 },
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
  safeMeet,
  nearPack,
  boundaryCenter,
  isBlocked,
  dropsForKill,
  VISION_PX,
  SEND_ITEM_RANGE,
  SEND_GOLD_RANGE,
  LOOT_RANGE,
};
