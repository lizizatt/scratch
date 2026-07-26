import { tuning } from "../data/tuning";
import { createPolicyController, type AiPolicy } from "./ai";
import { createCombatant, type Combatant } from "./combat";

export type EncounterKind = "trash1" | "trash2" | "trash3" | "boss";

export type EncounterDef = {
  kind: EncounterKind;
  hp: number;
  policy: AiPolicy;
  stormlightReward: number;
};

export function encounterDef(kind: EncounterKind): EncounterDef {
  const base = tuning.BASE_ENEMY_HP;
  switch (kind) {
    case "trash1":
      return {
        kind,
        hp: base,
        policy: { kind: "alwaysFast" },
        stormlightReward: tuning.STORMLIGHT_PER_TRASH,
      };
    case "trash2":
      return {
        kind,
        hp: base,
        policy: { kind: "alwaysHeavy" },
        stormlightReward: tuning.STORMLIGHT_PER_TRASH,
      };
    case "trash3":
      return {
        kind,
        hp: base,
        policy: { kind: "matchPlayerAfter", delayS: tuning.ENEMY3_MATCH_DELAY_S },
        stormlightReward: tuning.STORMLIGHT_PER_TRASH,
      };
    case "boss":
      return {
        kind,
        hp: base * tuning.CHASMFIEND_HP_MULT,
        policy: { kind: "matchPlayerAfter", delayS: tuning.BOSS_MATCH_DELAY_S },
        stormlightReward: tuning.STORMLIGHT_PER_BOSS,
      };
  }
}

export type EncounterRuntime = {
  def: EncounterDef;
  enemy: Combatant;
  tickAi: (dt: number, playerStyle: import("./types").Style) => void;
};

export function spawnEncounter(kind: EncounterKind): EncounterRuntime {
  const def = encounterDef(kind);
  const controller = createPolicyController(def.policy);
  const enemy = createCombatant("enemy", def.hp, controller.initialStyle);
  return {
    def,
    enemy,
    tickAi: (dt, playerStyle) => {
      const next = controller.tick(dt, playerStyle, enemy.cooldown.style);
      if (next) {
        enemy.cooldown.setStyle(next);
      }
    },
  };
}

export const ENCOUNTER_ORDER: EncounterKind[] = [
  "trash1",
  "trash2",
  "trash3",
  "boss",
];
