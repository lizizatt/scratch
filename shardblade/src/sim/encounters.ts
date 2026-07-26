import { tuning } from "../data/tuning";
import { createCombatant, type Combatant } from "./combat";
import { SwingCycleBrain, type TestAiKind } from "./testAi";
import type { Style } from "./types";

export type EncounterKind = "fight1" | "fight2" | "fight3" | "fight4" | "boss";

export type EncounterDef = {
  kind: EncounterKind;
  hp: number;
  aiKind: TestAiKind;
  stormlightReward: number;
  /** Shown during combat in the main demo (null for the chasmfiend). */
  tutorial: string | null;
};

export function encounterDef(kind: EncounterKind): EncounterDef {
  const base = tuning.BASE_ENEMY_HP;
  switch (kind) {
    case "fight1":
      return {
        kind,
        hp: base,
        aiKind: "alwaysFast",
        stormlightReward: tuning.STORMLIGHT_PER_TRASH,
        tutorial: "fast (q) parries fast",
      };
    case "fight2":
      return {
        kind,
        hp: base,
        aiKind: "alwaysHeavy",
        stormlightReward: tuning.STORMLIGHT_PER_TRASH,
        tutorial: "heavy (e) parries heavy",
      };
    case "fight3":
      return {
        kind,
        hp: base,
        aiKind: "alternate",
        stormlightReward: tuning.STORMLIGHT_PER_TRASH,
        tutorial: "defend (s) parries everything",
      };
    case "fight4":
      return {
        kind,
        hp: base,
        aiKind: "mirror",
        stormlightReward: tuning.STORMLIGHT_PER_TRASH,
        tutorial: "escape the chasm",
      };
    case "boss":
      return {
        kind,
        hp: base * tuning.CHASMFIEND_HP_MULT,
        aiKind: "oppose",
        stormlightReward: tuning.STORMLIGHT_PER_BOSS,
        tutorial: null,
      };
  }
}

export type EncounterRuntime = {
  def: EncounterDef;
  enemy: Combatant;
  brain: SwingCycleBrain;
  /** Call at the start of each enemy swing (and on spawn). */
  beginSwing: (playerStyle: Style) => void;
};

export function spawnEncounter(kind: EncounterKind): EncounterRuntime {
  const def = encounterDef(kind);
  const brain = new SwingCycleBrain(def.aiKind);
  const enemy = createCombatant("enemy", def.hp, "fast");
  const beginSwing = (playerStyle: Style) => {
    enemy.cooldown.setStyle(brain.decide(playerStyle));
  };
  beginSwing("fast");
  return { def, enemy, brain, beginSwing };
}

export const ENCOUNTER_ORDER: EncounterKind[] = [
  "fight1",
  "fight2",
  "fight3",
  "fight4",
  "boss",
];
