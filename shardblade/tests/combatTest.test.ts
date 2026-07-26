import { describe, expect, it } from "vitest";
import { tuning } from "../src/data/tuning";
import { CombatTestSim, isCombatTestPath } from "../src/sim/combatTest";

describe("isCombatTestPath", () => {
  it("matches /combat-test with optional trailing slash or base path", () => {
    expect(isCombatTestPath("/combat-test")).toBe(true);
    expect(isCombatTestPath("/combat-test/")).toBe(true);
    expect(isCombatTestPath("/")).toBe(false);
    expect(isCombatTestPath("/select")).toBe(false);
  });
});

describe("CombatTestSim", () => {
  it("starts in combat against the chasmfiend", () => {
    const sim = new CombatTestSim();
    const snap = sim.snapshot();
    expect(snap.phase).toBe("combat");
    expect(snap.enemyKind).toBe("boss");
    expect(snap.enemyMaxHp).toBe(tuning.BASE_ENEMY_HP * 2);
  });

  it("respawns the player on death and increments deaths", () => {
    const sim = new CombatTestSim({ playerMaxHp: 1 });
    sim.setStyle("heavy"); // take damage from boss (starts fast)
    for (let i = 0; i < 500 && sim.deaths === 0; i++) {
      sim.tick(0.05);
    }
    expect(sim.deaths).toBeGreaterThanOrEqual(1);
    expect(sim.player.dead).toBe(false);
    expect(sim.player.hp).toBe(sim.playerMaxHp);
    expect(sim.snapshot().phase).toBe("combat");
  });

  it("respawns the boss after a kill and increments kills", () => {
    const sim = new CombatTestSim({ playerMaxHp: 9999 });
    for (let t = 0; t < 120 && sim.kills === 0; t += 0.05) {
      const es = sim.encounter.enemy.cooldown.style;
      sim.setStyle(es === "fast" ? "heavy" : "fast");
      sim.tick(0.05);
    }
    expect(sim.kills).toBeGreaterThanOrEqual(1);
    expect(sim.encounter.enemy.dead).toBe(false);
    expect(sim.encounter.enemy.hp).toBe(sim.encounter.enemy.maxHp);
  });

  it("preserves player style across death respawn", () => {
    const sim = new CombatTestSim({ playerMaxHp: 1 });
    sim.setStyle("heavy");
    for (let i = 0; i < 500 && sim.deaths === 0; i++) {
      sim.tick(0.05);
    }
    expect(sim.deaths).toBeGreaterThanOrEqual(1);
    expect(sim.player.cooldown.style).toBe("heavy");
  });
});
