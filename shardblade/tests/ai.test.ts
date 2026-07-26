import { describe, expect, it } from "vitest";
import { tuning } from "../src/data/tuning";
import { MatchStyleAi, createPolicyController } from "../src/sim/ai";
import { encounterDef, spawnEncounter } from "../src/sim/encounters";
import { attackPeriod } from "../src/sim/styles";

describe("encounter defs", () => {
  it("sets correct HP and policies", () => {
    expect(encounterDef("trash1").policy).toEqual({ kind: "alwaysFast" });
    expect(encounterDef("trash2").policy).toEqual({ kind: "alwaysHeavy" });
    expect(encounterDef("trash3").policy).toEqual({
      kind: "matchPlayerAfter",
      delayS: 5,
    });
    expect(encounterDef("boss").hp).toBe(tuning.BASE_ENEMY_HP * 2);
    expect(encounterDef("boss").policy).toEqual({
      kind: "matchPlayerAfter",
      delayS: 1,
    });
  });
});

describe("always policies", () => {
  it("enemy 1 never leaves fast over 30s", () => {
    const enc = spawnEncounter("trash1");
    for (let t = 0; t < 30; t += 0.1) {
      enc.tickAi(0.1, "heavy");
      expect(enc.enemy.cooldown.style).toBe("fast");
    }
  });

  it("enemy 2 never leaves heavy over 30s", () => {
    const enc = spawnEncounter("trash2");
    expect(enc.enemy.cooldown.style).toBe("heavy");
    for (let t = 0; t < 30; t += 0.1) {
      enc.tickAi(0.1, "fast");
      expect(enc.enemy.cooldown.style).toBe("heavy");
    }
  });
});

describe("matchPlayerAfter", () => {
  it("enemy 3 matches after 5s delay", () => {
    const enc = spawnEncounter("trash3");
    expect(enc.enemy.cooldown.style).toBe("fast");

    enc.tickAi(4.9, "heavy");
    expect(enc.enemy.cooldown.style).toBe("fast");

    enc.tickAi(0.2, "heavy");
    expect(enc.enemy.cooldown.style).toBe("heavy");
  });

  it("boss matches after 1s delay", () => {
    const enc = spawnEncounter("boss");
    enc.tickAi(0.9, "heavy");
    expect(enc.enemy.cooldown.style).toBe("fast");
    enc.tickAi(0.2, "heavy");
    expect(enc.enemy.cooldown.style).toBe("heavy");
  });

  it("restarts timer when player style changes mid-wait", () => {
    const matcher = new MatchStyleAi(5);
    matcher.observePlayerStyle("heavy", "fast");
    expect(matcher.tick(3)).toBeNull();
    matcher.observePlayerStyle("fast", "fast"); // cancelled — already matching conceptually if AI stayed fast
    // Player goes heavy again — fresh 5s
    matcher.observePlayerStyle("heavy", "fast");
    expect(matcher.tick(4.9)).toBeNull();
    expect(matcher.tick(0.2)).toBe("heavy");
  });

  it("applies switch penalty on AI fast → heavy, not heavy → fast", () => {
    const enc = spawnEncounter("trash3");
    enc.enemy.cooldown.progress = 0.4;
    enc.tickAi(5.1, "heavy");
    expect(enc.enemy.cooldown.style).toBe("heavy");
    const expected = 0.4 - tuning.STYLE_SWITCH_PENALTY_S / attackPeriod("heavy");
    expect(enc.enemy.cooldown.progress).toBeCloseTo(expected, 5);

    enc.enemy.cooldown.progress = 0.4;
    // Restart match timer by changing player style away then back... simpler: setStyle directly
    enc.enemy.cooldown.setStyle("fast");
    expect(enc.enemy.cooldown.progress).toBeCloseTo(0.4, 5);
  });
});

describe("createPolicyController", () => {
  it("alwaysFast never proposes a switch", () => {
    const c = createPolicyController({ kind: "alwaysFast" });
    expect(c.initialStyle).toBe("fast");
    expect(c.tick(10, "heavy", "fast")).toBeNull();
  });
});
