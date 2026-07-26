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
