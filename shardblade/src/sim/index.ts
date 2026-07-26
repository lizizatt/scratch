/** Pure simulation modules live here — no DOM / canvas imports. */
export type { Style, WeaponClass, SkinId } from "./types";
export { attackPeriod, attackDamage } from "./styles";
export { CooldownTracker } from "./cooldown";
export type { HitEvent } from "./cooldown";
export {
  CombatDuel,
  createCombatant,
  resolveHit,
} from "./combat";
export type {
  AttackResult,
  CombatSnapshot,
  Combatant,
  CombatantId,
  CombatantView,
} from "./combat";
export { MatchStyleAi, createPolicyController } from "./ai";
export type { AiPolicy, AiPolicyKind } from "./ai";
export {
  encounterDef,
  spawnEncounter,
  ENCOUNTER_ORDER,
} from "./encounters";
export type { EncounterDef, EncounterKind, EncounterRuntime } from "./encounters";
export { RunSim, simulateRun } from "./run";
export type {
  RunIntent,
  RunPhase,
  RunSnapshot,
  RunSimOptions,
  StyleScheduleEntry,
  FloatText,
} from "./run";
export { CombatTestSim, isCombatTestPath } from "./combatTest";
export type { CombatTestOptions } from "./combatTest";
export { tickCombatants } from "./duelStep";
export { SwingCycleBrain, TEST_AI_OPTIONS } from "./testAi";
export type { TestAiKind, TestAiOption } from "./testAi";
export {
  loadMeta,
  saveMeta,
  purchaseSpear,
  canPurchaseSpear,
  isClassUnlocked,
  addStormlight,
  DEFAULT_META,
  META_STORAGE_KEY,
} from "./meta";
export type { MetaState } from "./meta";
