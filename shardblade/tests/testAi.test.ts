import { describe, expect, it } from "vitest";
import { attackPeriod } from "../src/sim/styles";
import { CooldownTracker } from "../src/sim/cooldown";
import { CombatTestSim } from "../src/sim/combatTest";
import { SwingCycleBrain } from "../src/sim/testAi";
import { tuning } from "../src/data/tuning";

describe("combat pacing", () => {
  it("attack periods are slowed ×2 from the original 0.6 / 1.2", () => {
    expect(tuning.FAST_ATTACK_PERIOD).toBe(1.2);
    expect(tuning.HEAVY_ATTACK_PERIOD).toBe(2.4);
  });
});

describe("SwingCycleBrain", () => {
  it("alwaysFast / alwaysHeavy stay put", () => {
    const fast = new SwingCycleBrain("alwaysFast");
    expect(fast.decide("heavy")).toBe("fast");
    const heavy = new SwingCycleBrain("alwaysHeavy");
    expect(heavy.decide("fast")).toBe("heavy");
  });

  it("alternate flips every decide call", () => {
    const b = new SwingCycleBrain("alternate");
    expect(b.decide("fast")).toBe("fast");
    expect(b.decide("fast")).toBe("heavy");
    expect(b.decide("fast")).toBe("fast");
  });

  it("mirror and oppose read the player style", () => {
    const mirror = new SwingCycleBrain("mirror");
    expect(mirror.decide("heavy")).toBe("heavy");
    expect(mirror.decide("defend")).toBe("defend");
    const oppose = new SwingCycleBrain("oppose");
    expect(oppose.decide("heavy")).toBe("fast");
    expect(oppose.decide("fast")).toBe("heavy");
    expect(oppose.decide("defend")).toBe("heavy");
  });
});

describe("swing-cycle decision timing", () => {
  it("decides at the start of a new swing, not mid-swing", () => {
    const sim = new CombatTestSim({ aiKind: "mirror", playerMaxHp: 9999 });
    expect(sim.encounter.enemy.cooldown.style).toBe("fast"); // player starts fast

    sim.setStyle("heavy");
    // Mid-swing: mirror should not have updated yet
    sim.tick(0.1);
    expect(sim.encounter.enemy.cooldown.style).toBe("fast");

    // Drive until enemy wraps into a new swing
    const period = attackPeriod(sim.encounter.enemy.cooldown.style);
    for (let t = 0; t < period + 0.2; t += 0.05) {
      sim.tick(0.05);
    }
    expect(sim.encounter.enemy.cooldown.style).toBe("heavy");
  });

  it("onNewSwing runs before the new swing hit uses the updated style", () => {
    const styles: string[] = [];
    const cd = new CooldownTracker("fast", 0.95);
    cd.tick(attackPeriod("fast") * 0.2, {
      onNewSwing: () => {
        cd.setStyle("heavy");
        styles.push(cd.style);
      },
    });
    expect(styles).toEqual(["heavy"]);
  });
});

describe("CombatTestSim AI switching", () => {
  it("setAiKind changes brain and applies on next swing", () => {
    const sim = new CombatTestSim({ aiKind: "alwaysFast" });
    sim.setAiKind("alwaysHeavy");
    expect(sim.brain.kind).toBe("alwaysHeavy");
    // Still on prior swing style until wrap
    const startStyle = sim.encounter.enemy.cooldown.style;
    expect(startStyle).toBe("fast");
    for (let t = 0; t < tuning.FAST_ATTACK_PERIOD + 0.3; t += 0.05) {
      sim.tick(0.05);
    }
    expect(sim.encounter.enemy.cooldown.style).toBe("heavy");
  });
});
