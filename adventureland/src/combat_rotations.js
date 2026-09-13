"use strict";

const ROTATION = {
  warriorReserve: 200,
  mageReserve: 900,
  priestReserve: 800,
  hardshellCadenceMs: 60000,
  curseCadenceMs: 15000,
};

function now(api) {
  return api && api._now ? api._now() : Date.now();
}

function pct(entity, key, maxKey) {
  if (!entity || !(entity[maxKey] > 0)) return 1;
  return entity[key] / entity[maxKey];
}

function conditionActive(entity, name, at) {
  const condition = entity && entity.s && entity.s[name];
  if (!condition) return false;
  if (condition.expires != null) return condition.expires > at;
  if (condition.ms != null) return condition.ms > 0;
  return true;
}

function skillReady(api, name, reserve) {
  const skill = api.G && api.G.skills && api.G.skills[name];
  if (!skill) return false;
  if (skill.level && (api.character.level || 0) < skill.level) return false;
  if (api.is_on_cooldown && api.is_on_cooldown(name)) return false;
  return (api.character.mp || 0) >= Number(skill.mp || 0) + Number(reserve || 0);
}

function skillInRange(api, name, target) {
  if (!target) return false;
  const skill = api.G && api.G.skills && api.G.skills[name];
  const range = Number(skill && skill.range);
  if (!(range > 0) || !api.parent || !api.parent.distance) return true;
  return api.parent.distance(api.character, target) <= range;
}

function visibleFighters(api) {
  return ["Jazwyn", "Sarene", "Zarook"]
    .map((name) => (name === api.character.name ? api.character : api.get_player(name)))
    .filter(Boolean);
}

function visibleMonsters(api) {
  const entities = (api.parent && api.parent.entities) || {};
  return Object.keys(entities)
    .map((id) => entities[id])
    .filter(
      (entity) =>
        entity &&
        entity.type === "monster" &&
        !entity.dead &&
        !/^target(?:_|$)/.test(entity.mtype || "")
    );
}

function targetFor(api, mtype, dyn) {
  if (/^target(?:_|$)/.test(mtype || "")) {
    if (api.change_target) api.change_target(null);
    return null;
  }
  const leadName = (dyn && dyn.leadName) || "Jazwyn";
  const lead = api.get_player(leadName);
  const isLead = dyn && dyn.isLead != null ? dyn.isLead : api.character.name === leadName;
  let target = null;
  if (!isLead && lead && lead.target && api.get_monster) {
    target = api.get_monster(lead.target) || ((api.parent && api.parent.entities) || {})[lead.target];
  }
  if (!target && api.get_targeted_monster) target = api.get_targeted_monster();
  if (!target || target.dead || target.type !== "monster" || (mtype && target.mtype !== mtype)) {
    target =
      api.get_nearest_monster({ type: mtype, no_target: true }) ||
      api.get_nearest_monster({ type: mtype });
  }
  if (target && /^target(?:_|$)/.test(target.mtype || "")) target = null;
  if (!target && api.change_target) api.change_target(null);
  return target && target.type === "monster" && !target.dead ? target : null;
}

function engage(api, target, useCharge) {
  if (!target) {
    api.set_message("Idle");
    return "idle";
  }
  api.change_target(target);
  api.set_message("Hunt " + target.mtype);
  if (!api.is_in_range(target)) {
    if (useCharge && skillReady(api, "charge", ROTATION.warriorReserve)) api.use_skill("charge");
    api.move(
      api.character.real_x + (target.real_x - api.character.real_x) / 2,
      api.character.real_y + (target.real_y - api.character.real_y) / 2
    );
    return useCharge ? "charge_move" : "move";
  }
  if (api.can_attack(target)) {
    api.attack(target);
    return "attack";
  }
  return "wait";
}

function warriorRotation(api, mtype, dyn) {
  if (api.character.rip || (api.smart && api.smart.moving)) return "blocked";
  const at = now(api);
  const state = api.character._rotation || (api.character._rotation = {});
  const attackers = visibleMonsters(api).filter((monster) => monster.target === api.character.name);
  if (
    (pct(api.character, "hp", "max_hp") <= 0.5 || attackers.length >= 2) &&
    !conditionActive(api.character, "hardshell", at) &&
    at - (state.lastHardshellAt || -Infinity) >= ROTATION.hardshellCadenceMs &&
    skillReady(api, "hardshell", ROTATION.warriorReserve)
  ) {
    api.use_skill("hardshell");
    state.lastHardshellAt = at;
    api.set_message("Hard Shell");
    return "hardshell";
  }

  const threatened = visibleMonsters(api).find(
    (monster) =>
      (monster.target === "Sarene" || monster.target === "Zarook") &&
      (!api.parent.distance || api.parent.distance(api.character, monster) <= 200)
  );
  if (threatened && skillReady(api, "taunt", ROTATION.warriorReserve)) {
    api.use_skill("taunt", threatened);
    api.change_target(threatened);
    api.set_message("Taunt " + threatened.mtype);
    return "taunt";
  }

  return engage(api, targetFor(api, mtype, dyn), true);
}

function mageRotation(api, mtype, dyn) {
  if (api.character.rip || (api.smart && api.smart.moving)) return "blocked";
  const at = now(api);
  const tank = api.get_player("Jazwyn");
  const priest = api.get_player("Zarook");
  const tankAttackers = tank
    ? visibleMonsters(api).filter((monster) => monster.target === tank.name).length
    : 0;
  if (
    tank &&
    !tank.rip &&
    (pct(tank, "hp", "max_hp") <= 0.5 || tankAttackers >= 2) &&
    pct(api.character, "mp", "max_mp") > 0.8 &&
    !conditionActive(tank, "hardshell", at) &&
    !conditionActive(tank, "reflection", at) &&
    skillInRange(api, "reflection", tank) &&
    skillReady(api, "reflection", ROTATION.mageReserve)
  ) {
    api.use_skill("reflection", tank);
    api.set_message("Reflect Jazwyn");
    return "reflection";
  }

  if (
    priest &&
    !priest.rip &&
    pct(priest, "mp", "max_mp") < 0.3 &&
    pct(api.character, "mp", "max_mp") > 0.8 &&
    skillInRange(api, "energize", priest) &&
    skillReady(api, "energize", ROTATION.mageReserve)
  ) {
    const amount = Math.min(200, Math.max(1, priest.max_mp - priest.mp));
    api.use_skill("energize", priest, amount);
    api.set_message("Energize Zarook");
    return "energize_priest";
  }

  const target = targetFor(api, mtype, dyn);
  if (
    tank &&
    !tank.rip &&
    target &&
    pct(api.character, "mp", "max_mp") > 0.8 &&
    skillInRange(api, "energize", tank) &&
    skillReady(api, "energize", ROTATION.mageReserve)
  ) {
    api.use_skill("energize", tank, 1);
    return "energize_tank";
  }
  return engage(api, target, false);
}

function priestPreCombat(api) {
  if (api.character.rip || (api.smart && api.smart.moving)) return false;
  const party = visibleFighters(api);
  const dead = party.find((member) => member.rip);
  if (dead && dead.hp < dead.max_hp && api.can_heal(dead)) {
    api.heal(dead);
    api.set_message("Heal Gravestone");
    return "heal_gravestone";
  }
  if (
    dead &&
    dead.hp >= dead.max_hp &&
    api.locate_item &&
    api.locate_item("essenceoflife") !== -1 &&
    skillInRange(api, "revive", dead) &&
    skillReady(api, "revive", ROTATION.priestReserve)
  ) {
    api.use_skill("revive", dead);
    api.set_message("Revive");
    return "revive";
  }

  const living = party.filter((member) => !member.rip);
  const lowest = living.reduce(
    (best, member) => (!best || pct(member, "hp", "max_hp") < pct(best, "hp", "max_hp") ? member : best),
    null
  );
  if (lowest && pct(lowest, "hp", "max_hp") < 0.45 && api.can_heal(lowest)) {
    api.heal(lowest);
    api.set_message("Emergency Heal");
    return "heal_emergency";
  }

  const hurt = living.filter((member) => pct(member, "hp", "max_hp") < 0.75);
  if (
    hurt.length >= 2 &&
    pct(api.character, "mp", "max_mp") > 0.85 &&
    skillReady(api, "partyheal", ROTATION.priestReserve)
  ) {
    api.use_skill("partyheal");
    api.set_message("Party Heal");
    return "partyheal";
  }

  if (lowest && pct(lowest, "hp", "max_hp") < 0.8 && api.can_heal(lowest)) {
    api.heal(lowest);
    api.set_message("Heal");
    return "heal";
  }
  return false;
}

function priestRotation(api, mtype, dyn) {
  if (api.character.rip || (api.smart && api.smart.moving)) return "blocked";
  const mage = api.get_player("Sarene");
  if (
    mage &&
    pct(mage, "hp", "max_hp") < 0.35 &&
    pct(api.character, "hp", "max_hp") > 0.7 &&
    visibleMonsters(api).some((monster) => monster.target === mage.name) &&
    skillInRange(api, "absorb", mage) &&
    skillReady(api, "absorb", ROTATION.priestReserve)
  ) {
    api.use_skill("absorb", mage);
    api.set_message("Absorb Sarene");
    return "absorb";
  }

  const target = targetFor(api, mtype, dyn);
  const state = api.character._rotation || (api.character._rotation = {});
  if (
    target &&
    (target.max_hp || target.hp || 0) >= (api.character.attack || 70) * 6 &&
    pct(api.character, "mp", "max_mp") > 0.85 &&
    !conditionActive(target, "cursed", now(api)) &&
    now(api) - (state.lastCurseAt || -Infinity) >= ROTATION.curseCadenceMs &&
    skillInRange(api, "curse", target) &&
    skillReady(api, "curse", ROTATION.priestReserve)
  ) {
    api.use_skill("curse", target);
    state.lastCurseAt = now(api);
    api.set_message("Curse " + target.mtype);
    return "curse";
  }
  return engage(api, target, false);
}

module.exports = {
  ROTATION,
  conditionActive,
  skillReady,
  skillInRange,
  targetFor,
  warriorRotation,
  mageRotation,
  priestPreCombat,
  priestRotation,
};
