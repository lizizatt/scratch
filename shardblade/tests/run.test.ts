import { describe, expect, it } from "vitest";
import { tuning } from "../src/data/tuning";
import { ENCOUNTER_ORDER } from "../src/sim/encounters";
import { RunSim, simulateRun } from "../src/sim/run";

function advanceToCombat(sim: RunSim): void {
  sim.tick(7.6);
  for (let i = 0; i < 200 && sim.phase === "approach"; i++) {
    sim.tick(0.05);
  }
  expect(sim.phase).toBe("combat");
}

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
  it("approaches then enters first combat after walking a screen", () => {
    const sim = new RunSim();
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    sim.dispatch({ type: "advanceDialogue" });
    sim.dispatch({ type: "advanceDialogue" });
    expect(sim.phase).toBe("walk");

    sim.tick(7.4);
    expect(sim.phase).toBe("walk");

    sim.tick(0.2);
    expect(sim.phase).toBe("approach");
    expect(sim.encounter?.def.kind).toBe("fight1");
    expect(sim.snapshot().enemyApproach).toBeGreaterThanOrEqual(0);
    expect(sim.snapshot().enemyApproach).toBeLessThan(1);

    for (let i = 0; i < 80 && sim.phase === "approach"; i++) {
      sim.tick(0.05);
    }
    expect(sim.phase).toBe("combat");
    expect(sim.snapshot().tutorial).toBe("fast (q) parries fast");
    expect(sim.snapshot().enemyApproach).toBe(1);
  });

  it("reaches boss with 2× HP after four tutorial fights", () => {
    const sim = new RunSim({ playerMaxHp: 9999 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    sim.dispatch({ type: "advanceDialogue" });
    sim.dispatch({ type: "advanceDialogue" });

    for (let i = 0; i < 4; i++) {
      advanceToCombat(sim);
      expect(sim.encounter?.def.kind).toBe(ENCOUNTER_ORDER[i]);
      expect(sim.snapshot().tutorial).toBeTruthy();
      clearCombat(sim);
      expect(sim.phase).toBe("walk");
    }

    advanceToCombat(sim);
    expect(sim.phase).toBe("combat");
    expect(sim.encounter?.def.kind).toBe("boss");
    expect(sim.encounter?.def.aiKind).toBe("oppose");
    expect(sim.encounter?.enemy.maxHp).toBe(tuning.BASE_ENEMY_HP * 2);
    expect(sim.snapshot().tutorial).toBeNull();
  });
});

describe("walk heal", () => {
  it("spends 1 stormlight per second to heal 1 HP with float texts", () => {
    const sim = new RunSim({ playerMaxHp: 10 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    while (sim.phase === "intro") sim.dispatch({ type: "advanceDialogue" });

    sim.player.hp = 7;
    sim.stormlightRun = 5;
    sim.phase = "walk";

    sim.tick(1.0);
    expect(sim.player.hp).toBe(8);
    expect(sim.stormlightRun).toBe(4);
    const kinds = sim.floatTexts.map((f) => f.kind).sort();
    expect(kinds).toEqual(["heal", "storm"]);
    expect(sim.floatTexts.some((f) => f.text === "+1" && f.kind === "heal")).toBe(true);
    expect(sim.floatTexts.some((f) => f.text === "-1" && f.kind === "storm")).toBe(true);

    sim.tick(1.0);
    expect(sim.player.hp).toBe(9);
    expect(sim.stormlightRun).toBe(3);
  });

  it("stops healing when full or out of stormlight", () => {
    const sim = new RunSim({ playerMaxHp: 10 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    while (sim.phase === "intro") sim.dispatch({ type: "advanceDialogue" });
    sim.phase = "walk";

    sim.player.hp = 10;
    sim.stormlightRun = 5;
    sim.tick(2);
    expect(sim.player.hp).toBe(10);
    expect(sim.stormlightRun).toBe(5);

    sim.player.hp = 8;
    sim.stormlightRun = 0;
    sim.tick(2);
    expect(sim.player.hp).toBe(8);
  });
});

describe("simulateRun", () => {
  it("wins a full run and banks stormlight", () => {
    const sim = new RunSim({ playerMaxHp: 9999, stormlightMeta: 5 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    while (sim.phase === "intro") sim.dispatch({ type: "advanceDialogue" });

    const dt = 0.05;
    for (let t = 0; t < 400 && sim.phase !== "won" && sim.phase !== "dead"; t += dt) {
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
    // Heal may spend some run stormlight while walking; banked total still includes remaining.
    expect(sim.stormlightMeta).toBe(5 + sim.stormlightRun);
    expect(sim.stormlightRun).toBeGreaterThan(0);
  });

  it("on death banks run stormlight into meta and does not wipe it", () => {
    const sim = new RunSim({ playerMaxHp: 1, stormlightMeta: 7 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    while (sim.phase === "intro") sim.dispatch({ type: "advanceDialogue" });

    sim.dispatch({ type: "setStyle", style: "heavy" });
    for (let t = 0; t < 40 && sim.phase !== "dead"; t += 0.05) {
      sim.tick(0.05);
    }
    expect(sim.phase).toBe("dead");
    expect(sim.stormlightMeta).toBe(7 + sim.stormlightRun);
  });

  it("expose simulateRun helper result shape", () => {
    const { result, snap } = simulateRun({
      playerMaxHp: 1,
      styleSchedule: [{ t: 0, style: "heavy" }],
      maxTime: 40,
      stormlightMeta: 0,
    });
    expect(["won", "dead", "timeout"]).toContain(result);
    expect(snap.phase).toBeTruthy();
  });
});
