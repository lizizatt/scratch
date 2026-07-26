import { describe, expect, it } from "vitest";
import { COMBAT_TIP_REACH, overheadSwingAngle } from "../src/render/blade";
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

describe("combat spacing", () => {
  it("places fighters so horizontal tips meet the opponent chest line", () => {
    const layout = layoutCombat(960, 540, { stormLevel: 0 });
    expect(layout.enemyX - layout.playerX).toBeCloseTo(COMBAT_TIP_REACH, 5);
    expect(layout.playerX + COMBAT_TIP_REACH).toBeCloseTo(layout.enemyX, 5);
    expect(layout.enemyX - COMBAT_TIP_REACH).toBeCloseTo(layout.playerX, 5);
  });
});
