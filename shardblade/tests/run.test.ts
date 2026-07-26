import { describe, expect, it } from "vitest";
import { tuning } from "../src/data/tuning";
import { ENCOUNTER_ORDER } from "../src/sim/encounters";
import { RunSim, simulateRun } from "../src/sim/run";

function clearCombat(sim: RunSim): void {
  expect(sim.phase).toBe("combat");
  for (let i = 0; i < 800 && sim.phase === "combat"; i++) {
    const es = sim.encounter!.enemy.cooldown.style;
    if (es === "defend") {
      sim.dispatch({ type: "setStyle", style: "heavy" });
    } else if (es === "fast") {
      sim.dispatch({ type: "setStyle", style: "heavy" });
    } else {
      sim.dispatch({ type: "setStyle", style: "fast" });
    }
    sim.tick(0.05);
  }
  if (sim.phase === "storm") {
    sim.tick(1.1);
  }
}

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
    expect(sim.encounter?.def.kind).toBe("fight1");
    expect(sim.snapshot().tutorial).toBe("fast (q) parries fast");
  });

  it("reaches boss with 2× HP after four tutorial fights", () => {
    const sim = new RunSim({ playerMaxHp: 9999 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    sim.dispatch({ type: "advanceDialogue" });
    sim.dispatch({ type: "advanceDialogue" });

    for (let i = 0; i < 4; i++) {
      sim.tick(7.6);
      expect(sim.encounter?.def.kind).toBe(ENCOUNTER_ORDER[i]);
      expect(sim.snapshot().tutorial).toBeTruthy();
      clearCombat(sim);
      expect(sim.phase).toBe("walk");
    }

    sim.tick(7.6);
    expect(sim.phase).toBe("combat");
    expect(sim.encounter?.def.kind).toBe("boss");
    expect(sim.encounter?.def.aiKind).toBe("oppose");
    expect(sim.encounter?.enemy.maxHp).toBe(tuning.BASE_ENEMY_HP * 2);
    expect(sim.snapshot().tutorial).toBeNull();
  });
});

describe("simulateRun", () => {
  it("wins a full run and banks stormlight", () => {
    const sim = new RunSim({ playerMaxHp: 9999, stormlightMeta: 5 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    while (sim.phase === "intro") sim.dispatch({ type: "advanceDialogue" });

    const dt = 0.05;
    for (let t = 0; t < 300 && sim.phase !== "won" && sim.phase !== "dead"; t += dt) {
      if (sim.phase === "combat" && sim.encounter) {
        const es = sim.encounter.enemy.cooldown.style;
        if (es === "defend") {
          sim.dispatch({ type: "setStyle", style: "heavy" });
        } else {
          sim.dispatch({ type: "setStyle", style: es === "fast" ? "heavy" : "fast" });
        }
      }
      sim.tick(dt);
    }

    expect(sim.phase).toBe("won");
    const expected =
      tuning.STORMLIGHT_PER_TRASH * 4 + tuning.STORMLIGHT_PER_BOSS;
    expect(sim.stormlightRun).toBe(expected);
    expect(sim.stormlightMeta).toBe(5 + expected);
  });

  it("on death banks run stormlight into meta and does not wipe it", () => {
    const sim = new RunSim({ playerMaxHp: 1, stormlightMeta: 7 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    while (sim.phase === "intro") sim.dispatch({ type: "advanceDialogue" });

    sim.dispatch({ type: "setStyle", style: "heavy" });
    for (let t = 0; t < 30 && sim.phase !== "dead"; t += 0.05) {
      sim.tick(0.05);
    }
    expect(sim.phase).toBe("dead");
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
