import { tuning } from "../data/tuning";
import type { Style } from "./types";
import { GREATSWORD, type WeaponMoveset } from "../data/weapons";

export function attackPeriod(style: Style, moveset: WeaponMoveset = GREATSWORD): number {
  return style === "fast" ? moveset.fastPeriod : moveset.heavyPeriod;
}

export function attackDamage(style: Style, moveset: WeaponMoveset = GREATSWORD): number {
  return style === "fast" ? moveset.fastDamage : moveset.heavyDamage;
}

/** Default greatsword lookups used by older call sites / tests. */
export function defaultHitWindow(): number {
  return tuning.HIT_WINDOW_T;
}
