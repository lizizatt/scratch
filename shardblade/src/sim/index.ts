/** Pure simulation modules live here — no DOM / canvas imports. */
export type { Style, WeaponClass, SkinId } from "./types";
export { attackPeriod, attackDamage } from "./styles";
export { CooldownTracker } from "./cooldown";
export type { HitEvent } from "./cooldown";
