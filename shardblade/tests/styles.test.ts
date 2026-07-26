import { describe, expect, it } from "vitest";
import { tuning } from "../src/data/tuning";
import { CooldownTracker } from "../src/sim/cooldown";
import { attackDamage, attackPeriod } from "../src/sim/styles";

describe("style lookups", () => {
  it("heavy is slower and harder-hitting than fast", () => {
    expect(attackPeriod("heavy")).toBeGreaterThan(attackPeriod("fast"));
    expect(attackDamage("heavy")).toBeGreaterThan(attackDamage("fast"));
  });

  it("5 fast or 3 heavy kills base HP exactly", () => {
    expect(5 * tuning.FAST_DAMAGE).toBe(tuning.BASE_ENEMY_HP);
    expect(3 * tuning.HEAVY_DAMAGE).toBe(tuning.BASE_ENEMY_HP);
  });
});

describe("CooldownTracker", () => {
  it("preserves progress fraction when switching styles", () => {
    const cd = new CooldownTracker("fast", 0);
    cd.tick(attackPeriod("fast") * 0.5);
    expect(cd.progress).toBeCloseTo(0.5, 5);

    cd.setStyle("heavy");
    expect(cd.style).toBe("heavy");
    expect(cd.progress).toBeCloseTo(0.5, 5);

    // Remaining half of heavy period should fire
    const hit = cd.tick(attackPeriod("heavy") * 0.5);
    expect(hit).not.toBeNull();
    expect(hit!.style).toBe("heavy");
    expect(hit!.damage).toBe(tuning.HEAVY_DAMAGE);
  });

  it("fires at progress >= 1, resets progress, and emits hit", () => {
    const cd = new CooldownTracker("fast", 0);
    expect(cd.tick(attackPeriod("fast") * 0.99)).toBeNull();
    const hit = cd.tick(attackPeriod("fast") * 0.02);
    expect(hit).toEqual({ style: "fast", damage: tuning.FAST_DAMAGE });
    expect(cd.progress).toBeGreaterThanOrEqual(0);
    expect(cd.progress).toBeLessThan(1);
  });

  it("no-ops style switch to the same style", () => {
    const cd = new CooldownTracker("heavy", 0.3);
    cd.setStyle("heavy");
    expect(cd.progress).toBe(0.3);
  });
});
