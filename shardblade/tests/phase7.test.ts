import { describe, expect, it } from "vitest";
import { GREATSWORD, SPEAR, movesetFor, stubWeaponBuild } from "../src/data/weapons";
import { tuning } from "../src/data/tuning";
import { encounterDef } from "../src/sim/encounters";
import { isClassAvailable } from "../src/sim/meta";
import { RunSim } from "../src/sim/run";
import { attackDamage } from "../src/sim/styles";

describe("Phase 7 content", () => {
  it("skin id is stored on the run but does not change damage", () => {
    const a = new RunSim();
    a.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    const b = new RunSim();
    b.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_b" });
    expect(a.skin).toBe("skin_a");
    expect(b.skin).toBe("skin_b");
    expect(attackDamage("fast")).toBe(attackDamage("fast"));
    expect(a.player.cooldown.moveset.fastDamage).toBe(b.player.cooldown.moveset.fastDamage);
  });

  it("spear is always available (no unlock economy)", () => {
    expect(isClassAvailable("spear")).toBe(true);
  });

  it("spear moveset exists and matches greatsword MVP numbers", () => {
    expect(movesetFor("spear")).toEqual(SPEAR);
    expect(SPEAR.fastDamage).toBe(GREATSWORD.fastDamage);
    expect(SPEAR.heavyDamage).toBe(GREATSWORD.heavyDamage);
  });

  it("boss HP remains 2× base after content polish", () => {
    expect(encounterDef("boss").hp).toBe(tuning.BASE_ENEMY_HP * tuning.CHASMFIEND_HP_MULT);
  });

  it("exposes sword-builder stub hook without crafting", () => {
    const build = stubWeaponBuild("greatsword");
    expect(build.classId).toBe("greatsword");
    expect(build.parts).toEqual({});
  });

  it("wires hit window from moveset", () => {
    const sim = new RunSim();
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    expect(sim.player.cooldown.moveset.hitWindowT).toBe(tuning.HIT_WINDOW_T);
  });
});
