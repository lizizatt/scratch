import { describe, expect, it } from "vitest";
import { tuning } from "../src/data/tuning";
import { MatchStyleAi, createPolicyController } from "../src/sim/ai";
import { ENCOUNTER_ORDER, encounterDef, spawnEncounter } from "../src/sim/encounters";
import { attackPeriod } from "../src/sim/styles";

describe("demo encounter ladder", () => {
  it("walks through five swing-cycle modes ending in oppose chasmfiend", () => {
    expect(ENCOUNTER_ORDER).toEqual([
      "fight1",
      "fight2",
      "fight3",
      "fight4",
      "boss",
    ]);
    expect(encounterDef("fight1")).toMatchObject({
      aiKind: "alwaysFast",
      tutorial: "fast (q) parries fast",
    });
    expect(encounterDef("fight2")).toMatchObject({
      aiKind: "alwaysHeavy",
      tutorial: "heavy (e) parries heavy",
    });
    expect(encounterDef("fight3")).toMatchObject({
      aiKind: "alternate",
      tutorial: "defend (s) parries everything",
    });
    expect(encounterDef("fight4")).toMatchObject({
      aiKind: "mirror",
      tutorial: "escape the chasm",
    });
    expect(encounterDef("boss")).toMatchObject({
      aiKind: "oppose",
      tutorial: null,
      hp: tuning.BASE_ENEMY_HP * 2,
    });
  });
});

describe("swing-cycle encounter AI", () => {
  it("fight1 stays fast across swings", () => {
    const enc = spawnEncounter("fight1");
    expect(enc.enemy.cooldown.style).toBe("fast");
    enc.beginSwing("heavy");
    expect(enc.enemy.cooldown.style).toBe("fast");
    enc.beginSwing("defend");
    expect(enc.enemy.cooldown.style).toBe("fast");
  });

  it("fight2 stays heavy across swings", () => {
    const enc = spawnEncounter("fight2");
    expect(enc.enemy.cooldown.style).toBe("heavy");
    enc.beginSwing("fast");
    expect(enc.enemy.cooldown.style).toBe("heavy");
  });

  it("fight3 alternates each swing", () => {
    const enc = spawnEncounter("fight3");
    // spawn already called beginSwing once → fast, alternateNext=heavy
    expect(enc.enemy.cooldown.style).toBe("fast");
    enc.beginSwing("fast");
    expect(enc.enemy.cooldown.style).toBe("heavy");
    enc.beginSwing("fast");
    expect(enc.enemy.cooldown.style).toBe("fast");
  });

  it("fight4 mirrors the player at swing start", () => {
    const enc = spawnEncounter("fight4");
    enc.beginSwing("heavy");
    expect(enc.enemy.cooldown.style).toBe("heavy");
    enc.beginSwing("defend");
    expect(enc.enemy.cooldown.style).toBe("defend");
  });

  it("boss opposes the player at swing start", () => {
    const enc = spawnEncounter("boss");
    enc.beginSwing("fast");
    expect(enc.enemy.cooldown.style).toBe("heavy");
    enc.beginSwing("heavy");
    expect(enc.enemy.cooldown.style).toBe("fast");
    enc.beginSwing("defend");
    expect(enc.enemy.cooldown.style).toBe("heavy");
  });

  it("applies switch penalty on AI fast → heavy, not heavy → fast", () => {
    const enc = spawnEncounter("fight4");
    enc.enemy.cooldown.progress = 0.4;
    enc.beginSwing("heavy"); // mirror → heavy from previous fast spawn; was fast, now heavy
    // After spawn beginSwing("fast") enemy was fast. beginSwing heavy: decide mirror→heavy, setStyle fast→heavy penalized
    const expected = 0.4 - tuning.STYLE_SWITCH_PENALTY_S / attackPeriod("heavy");
    expect(enc.enemy.cooldown.style).toBe("heavy");
    expect(enc.enemy.cooldown.progress).toBeCloseTo(expected, 5);

    enc.enemy.cooldown.progress = 0.4;
    enc.enemy.cooldown.setStyle("fast");
    expect(enc.enemy.cooldown.progress).toBeCloseTo(0.4, 5);
  });
});

describe("legacy MatchStyleAi helpers", () => {
  it("alwaysFast never proposes a switch", () => {
    const c = createPolicyController({ kind: "alwaysFast" });
    expect(c.initialStyle).toBe("fast");
    expect(c.tick(10, "heavy", "fast")).toBeNull();
  });

  it("matchPlayerAfter restarts timer when player style changes mid-wait", () => {
    const matcher = new MatchStyleAi(5);
    matcher.observePlayerStyle("heavy", "fast");
    expect(matcher.tick(3)).toBeNull();
    matcher.observePlayerStyle("fast", "fast");
    matcher.observePlayerStyle("heavy", "fast");
    expect(matcher.tick(4.9)).toBeNull();
    expect(matcher.tick(0.2)).toBe("heavy");
  });
});
