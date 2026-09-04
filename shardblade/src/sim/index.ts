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
  ResolveHitOptions,
} from "./combat";
export { MatchStyleAi, createPolicyController } from "./ai";
export type { AiPolicy, AiPolicyKind } from "./ai";
export {
  encounterDef,
  spawnEncounter,
  ENCOUNTER_ORDER,
} from "./encounters";
export type { EncounterDef, EncounterKind, EncounterRuntime, EnemyVisual } from "./encounters";
export { RunSim, simulateRun, isGodModePath, parseGodModeLaunch } from "./run";
export type {
  RunIntent,
  RunPhase,
  RunSnapshot,
  RunSimOptions,
  StyleScheduleEntry,
  FloatText,
  SphereFx,
  SphereSnapshot,
  GodModeLaunch,
} from "./run";
export type { SceneId } from "./scenes";
export {
  SCENE_ORDER,
  CHASM_SCENE_ID,
  CASTLE_SCENE_ID,
  FORGE_SCENE_ID,
  ChasmSceneSim,
  CastleSceneSim,
  isCastlePath,
  parseAppLaunch,
  CHASM_STEP,
  CASTLE_STEP,
  BASE_SWORD,
} from "./scenes";
export type {
  ChasmSceneSnapshot,
  ChasmScenePhase,
  CastleSceneSnapshot,
  CastleScenePhase,
  ChasmStepId,
  CastleStepId,
  AppLaunch,
} from "./scenes";
export { CombatTestSim, isCombatTestPath } from "./combatTest";
export type { CombatTestOptions } from "./combatTest";
export { tickCombatants } from "./duelStep";
export { SwingCycleBrain, TEST_AI_OPTIONS } from "./testAi";
export type { TestAiKind, TestAiOption } from "./testAi";
export {
  AVAILABLE_CLASSES,
  isClassAvailable,
  clearLegacyMetaStorage,
  META_STORAGE_KEY,
} from "./meta";
export { followAnchor, frameSubjects, worldToScreen, worldToScreenX } from "./camera";
export type { Camera2D, FrameSubjectsOpts } from "./camera";
export {
  clamp01,
  lerp,
  smoothstep,
  damp,
  sampleKeyframes,
  SoftScalar,
  SoftPose,
} from "./anim";
export type { Keyframe, Pose2 } from "./anim";
export {
  ScenePlayer,
  parseSceneDoc,
  cloneSceneDoc,
  sampleTrackAt,
  upsertKeyframe,
  SCENE_SCHEMA_VERSION,
} from "./sceneDoc";
export type {
  SceneDoc,
  ScenePlayerSnapshot,
  VisualRef,
  DrawVisualId,
} from "./sceneDoc";
export { CHASM_CINE, loadChasmCine } from "./scenes/chasmCine";
export type { ChasmCineConfig } from "./scenes/chasmCine";
