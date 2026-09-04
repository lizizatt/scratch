import { describe, expect, it } from "vitest";
import { TUNING_KEYS, tuning } from "../src/data/tuning";

describe("Phase 0 harness", () => {
  it("adds one and one", () => {
    expect(1 + 1).toBe(2);
  });
});

describe("tuning", () => {
  it("exports expected keys", () => {
    for (const key of TUNING_KEYS) {
      expect(tuning).toHaveProperty(key);
    }
  });

  it("has positive walk and screen constants", () => {
    expect(tuning.SCREEN_WIDTH_PX).toBeGreaterThan(0);
    expect(tuning.WALK_SECONDS_PER_SCREEN).toBe(7.5);
    expect(tuning.ENEMY3_MATCH_DELAY_S).toBe(5);
    expect(tuning.BOSS_MATCH_DELAY_S).toBe(1);
    expect(tuning.CHASMFIEND_HP_MULT).toBe(2);
  });
});
