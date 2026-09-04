import { describe, expect, it } from "vitest";
import {
  COMBAT_TIP_REACH,
  clawSwingAngle,
  heavySwordPose,
  overheadSwingAngle,
  stabPose,
  thrustPose,
  weaponPoseForStyle,
} from "../src/render/blade";
import { layoutCombat } from "../src/render/layout";
import { tuning } from "../src/data/tuning";

describe("overheadSwingAngle", () => {
  it("starts ~30° behind vertical and reaches horizontal at end of swing (player)", () => {
    const start = overheadSwingAngle(0, 1);
    const impact = overheadSwingAngle(tuning.HIT_WINDOW_T, 1);

    expect(start).toBeCloseTo(-Math.PI / 2 - Math.PI / 6, 5);
    expect(impact).toBeCloseTo(0, 5);
    expect(tuning.HIT_WINDOW_T).toBe(1);
  });

  it("mirrors the arc for a left-facing enemy", () => {
    const start = overheadSwingAngle(0, -1);
    const impact = overheadSwingAngle(tuning.HIT_WINDOW_T, -1);

    expect(start).toBeCloseTo(-Math.PI / 2 + Math.PI / 6, 5);
    expect(impact).toBeCloseTo(-Math.PI, 5);
  });
});

describe("heavySwordPose", () => {
  it("flows continuously through a full revolution into the downswing", () => {
    const start = heavySwordPose(0, 1);
    const a = heavySwordPose(0.33, 1);
    const b = heavySwordPose(0.66, 1);
    const impact = heavySwordPose(1, 1);

    expect(start.angle).toBeCloseTo(-Math.PI / 2 - Math.PI / 6, 5);
    // Strictly increasing angle (no pause / reverse at the top)
    expect(a.angle).toBeGreaterThan(start.angle);
    expect(b.angle).toBeGreaterThan(a.angle);
    expect(impact.angle).toBeGreaterThan(b.angle);
    expect(impact.angle - start.angle).toBeCloseTo(Math.PI * 2 + (0 - start.angle), 5);
    expect(Math.cos(impact.angle)).toBeCloseTo(1, 5);
    expect(Math.sin(impact.angle)).toBeCloseTo(0, 5);
  });
});

describe("stabPose", () => {
  it("stays horizontal and only slides forward", () => {
    const start = stabPose(0, 1);
    const mid = stabPose(0.5, 1);
    const impact = stabPose(1, 1);

    expect(Math.cos(start.angle)).toBeCloseTo(1, 5);
    expect(Math.cos(mid.angle)).toBeCloseTo(1, 5);
    expect(Math.cos(impact.angle)).toBeCloseTo(1, 5);
    expect(start.offsetX).toBeLessThan(mid.offsetX);
    expect(mid.offsetX).toBeLessThan(impact.offsetX);
  });
});

describe("thrustPose", () => {
  it("holds horizontal at idle, spins a full turn, lands in a forward thrust", () => {
    const start = thrustPose(0, 1);
    const mid = thrustPose(0.5, 1);
    const impact = thrustPose(1, 1);

    expect(Math.cos(start.angle)).toBeCloseTo(1, 5);
    expect(Math.sin(start.angle)).toBeCloseTo(0, 5);
    expect(start.offsetX).toBeLessThan(impact.offsetX);
    expect(impact.offsetX).toBeGreaterThan(0);
    expect(Math.cos(impact.angle)).toBeCloseTo(1, 5);
    expect(Math.sin(impact.angle)).toBeCloseTo(0, 5);
    expect(Math.abs(mid.angle - start.angle)).toBeGreaterThanOrEqual(Math.PI);
  });
});

describe("weaponPoseForStyle routing", () => {
  it("maps fast/heavy to the matching sword and spear animations", () => {
    expect(weaponPoseForStyle("greatsword", "fast", 0.3, 1).angle).toBeCloseTo(
      overheadSwingAngle(0.3, 1),
      5,
    );
    expect(weaponPoseForStyle("greatsword", "heavy", 0.3, 1).angle).toBeCloseTo(
      heavySwordPose(0.3, 1).angle,
      5,
    );
    expect(weaponPoseForStyle("spear", "fast", 0.3, 1).offsetX).toBeCloseTo(
      stabPose(0.3, 1).offsetX,
      5,
    );
    expect(weaponPoseForStyle("spear", "heavy", 0.3, 1).angle).toBeCloseTo(
      thrustPose(0.3, 1).angle,
      5,
    );
  });
});

describe("clawSwingAngle", () => {
  it("sweeps the chasmfiend claw from high to forward", () => {
    const start = clawSwingAngle(0, -1);
    const impact = clawSwingAngle(1, -1);
    expect(start).toBeGreaterThan(impact);
  });
});

describe("combat spacing", () => {
  it("places fighters so horizontal tips meet the opponent chest line", () => {
    const layout = layoutCombat(960, 540, { stormLevel: 0 });
    expect(layout.enemyX - layout.playerX).toBeCloseTo(COMBAT_TIP_REACH, 5);
    expect(layout.playerX + COMBAT_TIP_REACH).toBeCloseTo(layout.enemyX, 5);
    expect(layout.enemyX - COMBAT_TIP_REACH).toBeCloseTo(layout.playerX, 5);
  });
});
