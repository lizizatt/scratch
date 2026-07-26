import { describe, expect, it } from "vitest";
import { tuning } from "../src/data/tuning";
import { RunSim, simulateRun } from "../src/sim/run";

describe("RunSim pacing", () => {
  it("enters first combat after 7.5s of walking", () => {
    const sim = new RunSim();
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    sim.dispatch({ type: "advanceDialogue" });
    sim.dispatch({ type: "advanceDialogue" });
    expect(sim.phase).toBe("walk");

    sim.tick(7.4);
    expect(sim.phase).toBe("walk");

    sim.tick(0.2);
    expect(sim.phase).toBe("combat");
    expect(sim.encounter?.def.kind).toBe("trash1");
  });

  it("spawns boss with 2× HP after three trash clears", () => {
    const sim = new RunSim({ playerMaxHp: 9999 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    sim.dispatch({ type: "advanceDialogue" });
    sim.dispatch({ type: "advanceDialogue" });

    // Kill path: opposite style of fixed AI; for trash3/boss, hit hard before match.
    const killEncounter = () => {
      expect(sim.phase).toBe("combat");
      const kind = sim.encounter!.def.kind;
      if (kind === "trash1" || kind === "trash3" || kind === "boss") {
        sim.dispatch({ type: "setStyle", style: "heavy" });
      } else {
        sim.dispatch({ type: "setStyle", style: "fast" });
      }
      // Force quick kills by dealing damage via many ticks; boost player damage pace
      for (let i = 0; i < 500 && sim.phase === "combat"; i++) {
        // Keep mismatched vs match-AI by flipping just before they match if needed
        if (kind === "trash3" || kind === "boss") {
          const enemyStyle = sim.encounter!.enemy.cooldown.style;
          sim.dispatch({
            type: "setStyle",
            style: enemyStyle === "fast" ? "heavy" : "fast",
          });
        }
        sim.tick(0.05);
      }
      if (sim.phase === "storm") {
        sim.tick(1.1);
      }
    };

    // Walk to fight 1
    sim.tick(7.6);
    killEncounter();
    // Walk to fight 2
    expect(sim.phase).toBe("walk");
    sim.tick(7.6);
    killEncounter();
    // Walk to fight 3
    sim.tick(7.6);
    killEncounter();
    // Walk to boss
    sim.tick(7.6);
    expect(sim.phase).toBe("combat");
    expect(sim.encounter?.def.kind).toBe("boss");
    expect(sim.encounter?.enemy.maxHp).toBe(tuning.BASE_ENEMY_HP * 2);
  });
});

describe("simulateRun", () => {
  it("wins a full run and banks stormlight", () => {
    // Keep opposite style of the enemy each tick (beats match-after-delay AI).
    const sim = new RunSim({ playerMaxHp: 9999, stormlightMeta: 5 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    while (sim.phase === "intro") sim.dispatch({ type: "advanceDialogue" });

    const dt = 0.05;
    for (let t = 0; t < 180 && sim.phase !== "won" && sim.phase !== "dead"; t += dt) {
      if (sim.phase === "combat" && sim.encounter) {
        const es = sim.encounter.enemy.cooldown.style;
        sim.dispatch({ type: "setStyle", style: es === "fast" ? "heavy" : "fast" });
      }
      sim.tick(dt);
    }

    expect(sim.phase).toBe("won");
    const expected =
      tuning.STORMLIGHT_PER_TRASH * 3 + tuning.STORMLIGHT_PER_BOSS;
    expect(sim.stormlightRun).toBe(expected);
    expect(sim.stormlightMeta).toBe(5 + expected);
  });

  it("on death banks run stormlight into meta and does not wipe it", () => {
    const sim = new RunSim({ playerMaxHp: 1, stormlightMeta: 7 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    while (sim.phase === "intro") sim.dispatch({ type: "advanceDialogue" });

    // Walk to enemy 1 (always fast). Stay on fast so we parry... actually we need to DIE.
    // Stay heavy so enemy fast hits us; with 1 HP one hit kills.
    sim.dispatch({ type: "setStyle", style: "heavy" });
    for (let t = 0; t < 30 && sim.phase !== "dead"; t += 0.05) {
      sim.tick(0.05);
    }
    expect(sim.phase).toBe("dead");
    // May or may not have killed anyone; meta should be previous + run gains
    expect(sim.stormlightMeta).toBe(7 + sim.stormlightRun);
  });

  it("expose simulateRun helper result shape", () => {
    const { result, snap } = simulateRun({
      playerMaxHp: 1,
      styleSchedule: [{ t: 0, style: "heavy" }],
      maxTime: 30,
      stormlightMeta: 0,
    });
    expect(["won", "dead", "timeout"]).toContain(result);
    expect(snap.phase).toBeTruthy();
  });
});
