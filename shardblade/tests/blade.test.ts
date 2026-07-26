import { describe, expect, it } from "vitest";
import { overheadSwingAngle } from "../src/render/blade";
import { tuning } from "../src/data/tuning";

describe("overheadSwingAngle", () => {
  it("starts ~30° behind vertical and reaches horizontal at hit window (player)", () => {
    const start = overheadSwingAngle(0, 1);
    const impact = overheadSwingAngle(tuning.HIT_WINDOW_T, 1);
    const held = overheadSwingAngle(1, 1);

    expect(start).toBeCloseTo(-Math.PI / 2 - Math.PI / 6, 5);
    expect(impact).toBeCloseTo(0, 5);
    expect(held).toBeCloseTo(0, 5);
  });

  it("mirrors the arc for a left-facing enemy", () => {
    const start = overheadSwingAngle(0, -1);
    const impact = overheadSwingAngle(tuning.HIT_WINDOW_T, -1);

    expect(start).toBeCloseTo(-Math.PI / 2 + Math.PI / 6, 5);
    expect(impact).toBeCloseTo(-Math.PI, 5);
  });
});
