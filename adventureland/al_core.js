"use strict";

const LADDER = [
  [1, "goo"], [8, "bee"], [12, "crab"], [16, "snake"], [20, "armadillo"],
  [24, "arcticbee"], [28, "porcupine"], [32, "croc"], [34, "tortoise"], [36, "bat"],
  [42, "spider"], [48, "scorpion"], [54, "boar"], [60, "bigbird"], [66, "gscorpion"],
  [72, "wolf"], [78, "dryad"]
];
const PARTY = ["Jazwyn", "Sarene", "Zarook"];
const LEADER = "Jazwyn";
const TANK = "Jazwyn";
const POTION_TARGET = 500;
const POTION_MIN = 40;
const MAX_ATTACK_RATIO = 0.28;
const MAX_SCRIPT_LEVEL = 90;
const MAX_GEAR_LEVEL = 5;
const MIN_GOLD = 8000;
const SCROLL_BUY = 10;
const WTYPES = ["sword", "short_sword", "wblade", "basher", "axe", "mace", "spear"];
const ARMOR = ["helmet", "chest", "pants", "shoes", "gloves", "cape", "shield"];
const BASICS = [
  ["mainhand", "blade"], ["helmet", "helmet"], ["chest", "coat"],
  ["pants", "pants"], ["shoes", "shoes"], ["gloves", "gloves"]
];

function pot(kind, level) {
  return kind === "hp"
    ? (level >= 30 ? "hpot1" : "hpot0")
    : (level >= 30 ? "mpot1" : "mpot0");
}

function attCap(maxHp, ratio) {
  return Math.max(8, Math.floor(maxHp * (ratio == null ? MAX_ATTACK_RATIO : ratio)));
}

function desired(level, maxHp, monsters, ratio) {
  var lvl = Math.min(level, MAX_SCRIPT_LEVEL), pick = LADDER[0][1], i, j, d, cap;
  cap = attCap(maxHp, ratio);
  for (i = 0; i < LADDER.length; i++) if (lvl >= LADDER[i][0]) pick = LADDER[i][1];
  if (monsters[pick] && monsters[pick].attack > cap) {
    for (j = LADDER.length - 1; j >= 0; j--) {
      d = monsters[LADDER[j][1]];
      if (d && d.attack <= cap && lvl >= LADDER[j][0]) return LADDER[j][1];
    }
    return "goo";
  }
  return pick;
}

function partyFarmTarget(self, members, monsters, ratio, peaks) {
  peaks = peaks || {};
  function bump(name, level, maxHp) {
    var s = peaks[name] || (peaks[name] = { level: 0, max_hp: 0 });
    if (level > s.level) s.level = level;
    if (maxHp > s.max_hp) s.max_hp = maxHp;
  }
  bump(self.name || "*", self.level, self.max_hp);
  var i, m, name, lvl = 99, hp = self.max_hp, s;
  for (i = 0; i < members.length; i++) {
    m = members[i];
    if (!m || m.rip || !(m.level >= 1)) continue;
    bump(m.name || ("m" + i), m.level, m.max_hp || 0);
  }
  for (name in peaks) {
    s = peaks[name];
    if (s.level && s.level < lvl) { lvl = s.level; hp = s.max_hp || hp; }
  }
  if (lvl === 99) lvl = self.level;
  return desired(lvl, hp, monsters, ratio);
}

function tankAnchor(mob, allies, pad) {
  var x = 0, y = 0, n = 0, i, a, dx, dy, d;
  pad = pad == null ? 28 : pad;
  for (i = 0; i < allies.length; i++) {
    a = allies[i];
    if (!a || a.rip) continue;
    x += a.real_x; y += a.real_y; n++;
  }
  if (!n || !mob) return null;
  x /= n; y /= n;
  dx = mob.real_x - x; dy = mob.real_y - y; d = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: mob.real_x + dx / d * pad, y: mob.real_y + dy / d * pad };
}

function tooClose(self, other, minD) {
  if (!self || !other) return false;
  var dx = self.real_x - other.real_x, dy = self.real_y - other.real_y;
  return Math.sqrt(dx * dx + dy * dy) < minD;
}

function stepAway(self, other, dist) {
  var dx = self.real_x - other.real_x, dy = self.real_y - other.real_y;
  var d = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: other.real_x + dx / d * dist, y: other.real_y + dy / d * dist };
}

function itemPrice(name, items, fallback) {
  return (items[name] && items[name].g) || fallback || 20;
}

function affordable(name, want, gold, items, fallback) {
  return Math.min(want, Math.floor(gold / itemPrice(name, items, fallback)));
}

function buyPotCounts(hpHave, mpHave, gold, hpName, mpName, items) {
  var hb = Math.max(0, POTION_TARGET - hpHave);
  var mb = Math.max(0, POTION_TARGET - mpHave);
  var cost = hb * itemPrice(hpName, items, 20) + mb * itemPrice(mpName, items, 20);
  if (!cost || gold < cost) return { hp: 0, mp: 0 };
  return { hp: hb, mp: mb };
}

function restockCost(hpHave, mpHave, hpName, mpName, items) {
  return Math.max(0, POTION_TARGET - hpHave) * itemPrice(hpName, items, 20)
    + Math.max(0, POTION_TARGET - mpHave) * itemPrice(mpName, items, 20);
}

function isKeep(it, items, gradeFn) {
  if (!it) return true;
  if (it.name.indexOf("pot") >= 0 || it.name === "stand0" || it.name === "tracker") return true;
  if (it.l || it.level) return true;
  var g = items[it.name];
  if (!g || g.e || g.type === "gem" || g.type === "token" || g.type === "quest") return true;
  return (gradeFn || function () { return 0; })(it) > 0;
}

function hasJunk(inv, items, gradeFn) {
  for (var i = 0; i < inv.length; i++)
    if (inv[i] && !isKeep(inv[i], items, gradeFn)) return true;
  return false;
}

function needsPots(hpQty, mpQty, gold, level, items) {
  var hp = pot("hp", level), mp = pot("mp", level);
  if (hpQty >= POTION_MIN && mpQty >= POTION_MIN) return false;
  var cost = restockCost(hpQty, mpQty, hp, mp, items);
  return cost > 0 && gold >= cost;
}

function needsVendor(esize, hpQty, mpQty, gold, level, inv, items, gradeFn) {
  if (esize === 0) return true;
  if (needsPots(hpQty, mpQty, gold, level, items)) return true;
  return (hpQty < POTION_MIN || mpQty < POTION_MIN) && hasJunk(inv, items, gradeFn);
}

function usePotSkill(hp, maxHp, mp, maxMp) {
  if (hp / maxHp < 0.5) return "use_hp";
  if (mp / maxMp < 0.5) return "use_mp";
  return null;
}

function farmable(t, monsters) {
  if (!t || t.dead || !t.mtype) return false;
  if (t.mtype.indexOf("target") >= 0) return false;
  var g = monsters[t.mtype] || {};
  if (g.unlist) return false;
  return true;
}

function pickCombatTarget(opts) {
  var t = null;
  if (!opts.isLead) {
    t = opts.leadTarget || null;
    return farmable(t, opts.monsters) ? t : null;
  }
  t = opts.targeted || null;
  if (!farmable(t, opts.monsters) || (opts.mtype && t.mtype !== opts.mtype))
    t = opts.nearestUntargeted || opts.nearest || null;
  return farmable(t, opts.monsters) ? t : null;
}

function priestDecision(self, members, canHealId, canPartyheal) {
  if (self.ctype !== "priest" || self.rip) return { action: "none" };
  var hurt = 0, lowest = null, i, m;
  for (i = 0; i < members.length; i++) {
    m = members[i];
    if (!m || m.rip) continue;
    if (m.hp < m.max_hp * 0.8) hurt++;
    if (m.hp < m.max_hp * 0.7 && (!lowest || m.hp / m.max_hp < lowest.hp / lowest.max_hp)) lowest = m;
  }
  if (hurt >= 2 && canPartyheal) return { action: "partyheal" };
  if (lowest && canHealId && canHealId(lowest)) return { action: "heal", target: lowest };
  if (lowest) return { action: "move", target: lowest };
  return { action: "none" };
}

function classifyChat(from, message, selfName, party) {
  if (!from || from === selfName) return { gratz: false, rally: false, ok: false, summon: false };
  var m = ("" + message).toLowerCase();
  var gratz = m.indexOf("ding") >= 0;
  if (party.indexOf(from) < 0) return { gratz: gratz, rally: false, ok: false, summon: false };
  if (m.indexOf("potion") >= 0) return { gratz: gratz, rally: "potions", ok: true, summon: false };
  if (m.indexOf("upgrade") >= 0) return { gratz: gratz, rally: "upgrade", ok: true, summon: false };
  if (m.indexOf("summon") >= 0) return { gratz: gratz, rally: false, ok: false, summon: true };
  return { gratz: gratz, rally: false, ok: false, summon: false };
}

function skillReady(name, mp, skills, canUse, level) {
  var d = (skills && skills[name]) || {};
  if (!canUse(name) || mp < (d.mp || 0)) return false;
  if (d.level && (level == null || level < d.level)) return false;
  return true;
}

function warriorSkillPlan(t, selfName, inRange, canUse) {
  var s = [];
  if (!t) return s;
  if (t.target && t.target !== selfName && canUse("taunt")) s.push("taunt");
  if (!inRange && canUse("charge")) s.push("charge");
  if (inRange && canUse("cleave")) s.push("cleave");
  return s;
}

function peelTauntTarget(mobs, selfName, party, maxRange) {
  var i, m;
  for (i = 0; i < mobs.length; i++) {
    m = mobs[i];
    if (!m || m.dead || !m.target || m.target === selfName) continue;
    if (party.indexOf(m.target) < 0) continue;
    if (maxRange != null && m.dist != null && m.dist > maxRange) continue;
    return m;
  }
  return null;
}

function magePortOk(atPack, moving, busy, canUse) {
  return !!(atPack && !moving && !busy && canUse("magiport"));
}

function priestReviveTarget(members, hasEssence, canRevive) {
  if (!hasEssence || !canRevive) return null;
  var i, m;
  for (i = 0; i < members.length; i++) {
    m = members[i];
    if (m && m.rip) return m;
  }
  return null;
}

function shouldCallPots(needsVendorNow, lastSayMs) {
  return needsVendorNow && lastSayMs > 20000;
}

function classWtypes(ctype) {
  if (ctype === "warrior") return WTYPES;
  if (ctype === "mage" || ctype === "priest") return ["staff", "wand"];
  return [];
}

function isGear(it, items) {
  return isClassGear(it, "warrior", items);
}

function isClassGear(it, ctype, items) {
  var g = it && items[it.name];
  if (!it || !g || !g.upgrade || it.l) return false;
  if (g.wtype) return classWtypes(ctype).indexOf(g.wtype) >= 0;
  return ARMOR.indexOf(g.type) >= 0;
}

function scrollName(it, gradeFn) {
  return "scroll" + gradeFn(it);
}

function findUpgrade(inv, items, maxLevel, gradeUnused) {
  var best = -1, lvl = 99, i, it, lv;
  for (i = 0; i < inv.length; i++) {
    it = inv[i];
    if (!isGear(it, items)) continue;
    lv = it.level || 0;
    if (lv < maxLevel && lv < lvl) { lvl = lv; best = i; }
  }
  return best;
}

function hasPiece(slot, name, slots, inv, items) {
  var s = slots[slot];
  if (s && isGear(s, items)) return true;
  for (var i = 0; i < inv.length; i++) {
    var it = inv[i], g = it && items[it.name];
    if (!isGear(it, items)) continue;
    if (it.name === name) return true;
    if (slot === "mainhand" && g.wtype) return true;
    if (g.type === (items[name] && items[name].type)) return true;
  }
  return false;
}

function canBuyScrolls(gold, scrollName, items) {
  var p = itemPrice(scrollName, items, 1000);
  return gold >= p * SCROLL_BUY + MIN_GOLD;
}

function canBuyBasic(gold, name, items) {
  return gold >= itemPrice(name, items, 1000) + MIN_GOLD;
}

function followDistance(ctype) {
  return ctype === "priest" ? 80 : 180;
}

function shouldFollow(self, leader, ctype) {
  if (!leader) return false;
  if (self.map !== leader.map) return true;
  var dx = self.x - leader.x, dy = self.y - leader.y;
  return Math.sqrt(dx * dx + dy * dy) > followDistance(ctype);
}

module.exports = {
  LADDER, PARTY, LEADER, TANK, POTION_TARGET, POTION_MIN, MAX_ATTACK_RATIO,
  MAX_SCRIPT_LEVEL, MAX_GEAR_LEVEL, MIN_GOLD, SCROLL_BUY, WTYPES, ARMOR, BASICS,
  pot, attCap, desired, partyFarmTarget, itemPrice, affordable, buyPotCounts, restockCost,
  isKeep, hasJunk, needsPots, needsVendor, usePotSkill,
  farmable, pickCombatTarget, priestDecision, classifyChat, shouldCallPots,
  skillReady, warriorSkillPlan, peelTauntTarget, magePortOk, priestReviveTarget,
  classWtypes, isGear, isClassGear, scrollName, findUpgrade, hasPiece, canBuyScrolls, canBuyBasic,
  followDistance, shouldFollow, tankAnchor, tooClose, stepAway
};
