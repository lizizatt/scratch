import { describe, expect, it } from "vitest";
import { tuning } from "../src/data/tuning";
import { CombatDuel, resolveHit, createCombatant } from "../src/sim/combat";
import { attackPeriod } from "../src/sim/styles";

describe("resolveHit", () => {
  it("parries same-style attacks with no HP change", () => {
    const attacker = createCombatant("player", 15, "fast");
    const defender = createCombatant("enemy", 15, "fast");
    const result = resolveHit(attacker, defender, { style: "fast", damage: 3, hitAt: 1 });
    expect(result.parried).toBe(true);
    expect(result.damage).toBe(0);
    expect(defender.hp).toBe(15);
  });

  it("applies damage on cross-style hits", () => {
    const attacker = createCombatant("player", 15, "heavy");
    const defender = createCombatant("enemy", 15, "fast");
    const result = resolveHit(attacker, defender, { style: "heavy", damage: 5, hitAt: 1 });
    expect(result.parried).toBe(false);
    expect(result.damage).toBe(5);
    expect(defender.hp).toBe(10);
  });

  it("marks lethal when HP reaches zero", () => {
    const attacker = createCombatant("player", 15, "heavy");
    const defender = createCombatant("enemy", 5, "fast");
    const result = resolveHit(attacker, defender, { style: "heavy", damage: 5, hitAt: 1 });
    expect(result.lethal).toBe(true);
    expect(defender.dead).toBe(true);
    expect(defender.hp).toBe(0);
  });
});

describe("CombatDuel", () => {
  it("fades combat UI in over COMBAT_UI_FADE_S", () => {
    const duel = new CombatDuel(15, 15);
    duel.tick(tuning.COMBAT_UI_FADE_S / 2);
    expect(duel.uiFade).toBeCloseTo(0.5, 5);
    duel.tick(tuning.COMBAT_UI_FADE_S);
    expect(duel.uiFade).toBe(1);
  });

  it("resolves player attacks before enemy within a tick", () => {
    const duel = new CombatDuel(15, 15, "heavy", "fast");
    const t = tuning.HIT_WINDOW_T - 0.01;
    duel.player.cooldown.seekProgress(t);
    duel.enemy.cooldown.seekProgress(t);
    const results = duel.tick(attackPeriod("heavy") * 0.05);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].attacker).toBe("player");
  });

  it("cross-style duel reduces HP on both sides over time", () => {
    const duel = new CombatDuel(tuning.BASE_ENEMY_HP, tuning.BASE_ENEMY_HP, "fast", "heavy");
    for (let i = 0; i < 200 && !duel.over; i++) {
      duel.tick(0.05);
    }
    expect(duel.over).toBe(true);
    // Someone should have died from unparried hits
    expect(duel.player.dead || duel.enemy.dead).toBe(true);
  });

  it("same-style stalemate deals no damage", () => {
    const duel = new CombatDuel(15, 15, "fast", "fast");
    for (let i = 0; i < 100; i++) {
      duel.tick(0.1);
    }
    expect(duel.player.hp).toBe(15);
    expect(duel.enemy.hp).toBe(15);
    expect(duel.log.every((r) => r.parried)).toBe(true);
  });
});
