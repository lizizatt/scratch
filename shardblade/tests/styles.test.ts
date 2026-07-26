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
  });

  it("fires when crossing the hit window, not only at swing end", () => {
    const cd = new CooldownTracker("fast", 0);
    const windowT = tuning.HIT_WINDOW_T;
    expect(cd.tick(attackPeriod("fast") * (windowT - 0.05))).toBeNull();
    const hit = cd.tick(attackPeriod("fast") * 0.1);
    expect(hit).not.toBeNull();
    expect(hit!.style).toBe("fast");
    expect(hit!.damage).toBe(tuning.FAST_DAMAGE);
    expect(hit!.hitAt).toBe(windowT);
    expect(cd.progress).toBeGreaterThanOrEqual(windowT);
    expect(cd.progress).toBeLessThan(1);
  });

  it("emits a hit when a large dt wraps past the hit window on the new swing", () => {
    const cd = new CooldownTracker("fast", 0);
    cd.seekProgress(0.9);
    // 0.9 + 0.8 wraps to 0.7, which is past HIT_WINDOW_T — must emit for the new swing.
    const hit = cd.tick(attackPeriod("fast") * 0.8);
    expect(hit).not.toBeNull();
    expect(hit!.hitAt).toBe(tuning.HIT_WINDOW_T);
    expect(cd.progress).toBeCloseTo(0.7, 5);
  });

  it("no-ops style switch to the same style", () => {
    const cd = new CooldownTracker("heavy", 0.3);
    cd.setStyle("heavy");
    expect(cd.progress).toBe(0.3);
  });
});
