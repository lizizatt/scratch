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
  it("applies a 0.5s penalty only when switching fast → heavy", () => {
    const toHeavy = new CooldownTracker("fast", 0);
    toHeavy.tick(attackPeriod("fast") * 0.5);
    toHeavy.setStyle("heavy");
    expect(toHeavy.progress).toBeCloseTo(
      0.5 - tuning.STYLE_SWITCH_PENALTY_S / attackPeriod("heavy"),
      5,
    );

    const toFast = new CooldownTracker("heavy", 0);
    toFast.tick(attackPeriod("heavy") * 0.5);
    toFast.setStyle("fast");
    expect(toFast.progress).toBeCloseTo(0.5, 5);
  });

  it("resets and freezes the attack timer while defending", () => {
    const cd = new CooldownTracker("fast", 0);
    cd.tick(attackPeriod("fast") * 0.7);
    cd.setStyle("defend");
    expect(cd.progress).toBe(0);

    cd.tick(1.0);
    expect(cd.style).toBe("defend");
    expect(cd.progress).toBe(0);
    expect(cd.tick(0.5)).toBeNull();
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
  });

  it("emits a hit when a large dt completes the swing (horizontal impact)", () => {
    const cd = new CooldownTracker("fast", 0);
    cd.seekProgress(0.95);
    const hit = cd.tick(attackPeriod("fast") * 0.1);
    expect(hit).not.toBeNull();
    expect(hit!.hitAt).toBe(tuning.HIT_WINDOW_T);
  });

  it("no-ops style switch to the same style", () => {
    const cd = new CooldownTracker("heavy", 0.3);
    cd.setStyle("heavy");
    expect(cd.progress).toBe(0.3);
  });
});
