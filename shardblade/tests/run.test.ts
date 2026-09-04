import { describe, expect, it } from "vitest";
import { tuning } from "../src/data/tuning";
import { ENCOUNTER_ORDER } from "../src/sim/encounters";
import { enemyWorldX, RunSim, simulateRun } from "../src/sim/run";

function advanceToCombat(sim: RunSim): void {
  sim.tick(7.6);
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
  // Absorb spheres while walking past the corpse
  for (let i = 0; i < 400; i++) {
    const snap = sim.snapshot();
    if (snap.spheres.length === 0 && snap.corpseVisual === null) break;
    if (sim.phase === "combat" || sim.phase === "won") break;
    sim.tick(0.05);
  }
}

describe("RunSim pacing", () => {
  it("walks up to a standing enemy and starts combat with a non-blocking taunt", () => {
    const sim = new RunSim();
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    sim.dispatch({ type: "advanceDialogue" });
    sim.dispatch({ type: "advanceDialogue" });
    expect(sim.phase).toBe("walk");

    sim.tick(5.0);
    expect(sim.phase).toBe("walk");
    const mid = sim.snapshot();
    expect(mid.enemyKind).toBe("fight1");
    expect(mid.enemyVisual).toBe("snail");
    expect(mid.enemyScreenX).not.toBeNull();
    expect(mid.enemyScreenX).toBeCloseTo(enemyWorldX(0) - sim.distance, 5);

    sim.tick(2.6);
    expect(sim.phase).toBe("combat");
    const combatSnap = sim.snapshot();
    expect(combatSnap.tauntLine).toBe("Squeak?!");
    expect(combatSnap.tauntAlpha).toBeGreaterThan(0);
    expect(combatSnap.tutorial).toBe("heavy (e) parries heavy");
    expect(combatSnap.playerStyle).toBe("heavy");
    expect(combatSnap.enemyScreenX).toBeCloseTo(
      tuning.SCREEN_WIDTH_PX * 0.5 + tuning.COMBAT_TIP_REACH / 2,
      5,
    );

    sim.tick(tuning.TAUNT_DURATION_S);
    expect(sim.phase).toBe("combat");
    expect(sim.snapshot().tauntLine).toBeNull();
  });

  it("walks on immediately after a kill; corpse recedes while spheres absorb", () => {
    const sim = new RunSim({ playerMaxHp: 9999 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    while (sim.phase === "intro") sim.dispatch({ type: "advanceDialogue" });
    advanceToCombat(sim);

    const distAtKill = sim.distance;
    sim.encounter!.enemy.hp = 0;
    sim.encounter!.enemy.dead = true;
    sim.tick(0.05);
    expect(sim.phase).toBe("walk");
    expect(sim.distance).toBeGreaterThan(distAtKill);

    const loot = sim.snapshot();
    expect(loot.corpseVisual).toBe("snail");
    expect(loot.corpseScreenX).not.toBeNull();
    expect(loot.enemyFallT).toBeGreaterThan(0);
    expect(loot.spheres.length).toBe(tuning.STORMLIGHT_PER_TRASH);
    const corpseX0 = loot.corpseScreenX!;

    sim.tick(0.4);
    const mid = sim.snapshot();
    expect(mid.phase).toBe("walk");
    expect(mid.corpseScreenX!).toBeLessThan(corpseX0);

    sim.tick(0.5);
    expect(sim.stormlightRun).toBeGreaterThan(0);
    expect(sim.playerAbsorbGlow).toBeGreaterThan(0);

    for (let i = 0; i < 200; i++) {
      if (sim.snapshot().corpseVisual === null && sim.snapshot().spheres.length === 0) break;
      sim.tick(0.05);
    }
    expect(sim.phase).toBe("walk");
    expect(sim.snapshot().corpseVisual).toBeNull();
  });

  it("reaches boss after snails then soldiers", () => {
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
    expect(sim.encounter?.def.visual).toBe("chasmfiend");
    expect(sim.encounter?.def.aiKind).toBe("oppose");
    expect(sim.encounter?.enemy.maxHp).toBe(tuning.BASE_ENEMY_HP * 2);
    expect(sim.encounter?.def.taunt).toContain("RRR");
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
    expect(sim.floatTexts.some((f) => f.text === "+1" && f.kind === "heal")).toBe(true);
    expect(sim.floatTexts.some((f) => f.text === "-1")).toBe(false);

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
  it("wins a full run and keeps scene stormlight (no meta bank)", () => {
    const sim = new RunSim({ playerMaxHp: 9999 });
    sim.skipExitCinematic = true;
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    while (sim.phase === "intro") sim.dispatch({ type: "advanceDialogue" });

    const dt = 0.05;
    for (let t = 0; t < 500 && sim.phase !== "won" && sim.phase !== "dead"; t += dt) {
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
    expect(sim.stormlightRun).toBeGreaterThan(0);
  });

  it("on death ends the scene without a meta bank", () => {
    const sim = new RunSim({ playerMaxHp: 1 });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    while (sim.phase === "intro") sim.dispatch({ type: "advanceDialogue" });

    for (let t = 0; t < 80 && sim.phase !== "dead"; t += 0.05) {
      // First fight auto-picks heavy; force a losing matchup for this death test.
      if (sim.phase === "combat") {
        sim.dispatch({ type: "setStyle", style: "fast" });
      }
      sim.tick(0.05);
    }
    expect(sim.phase).toBe("dead");
  });

  it("god mode one-shots enemies and ignores incoming damage", () => {
    const sim = new RunSim({ godMode: true });
    sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });
    while (sim.phase === "intro") sim.dispatch({ type: "advanceDialogue" });
    advanceToCombat(sim);

    const startHp = sim.player.hp;
    // Same-style as first snail (heavy) would normally parry — god mode still kills.
    sim.dispatch({ type: "setStyle", style: "heavy" });
    for (let i = 0; i < 80 && sim.phase === "combat"; i++) {
      sim.tick(0.05);
    }
    expect(sim.phase).toBe("walk");
    expect(sim.player.hp).toBe(startHp);
    expect(sim.snapshot().godMode).toBe(true);
  });

  it("expose simulateRun helper result shape", () => {
    const { result, snap } = simulateRun({
      playerMaxHp: 1,
      styleSchedule: [{ t: 0, style: "fast" }],
      maxTime: 40,
    });
    expect(["won", "dead", "timeout"]).toContain(result);
    expect(snap.phase).toBeTruthy();
  });
});
