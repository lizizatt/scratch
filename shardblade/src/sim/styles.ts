import { tuning } from "../data/tuning";
import type { Style } from "./types";
import { GREATSWORD, type WeaponMoveset } from "../data/weapons";

export function attackPeriod(style: Style, moveset: WeaponMoveset = GREATSWORD): number {
  if (style === "fast") return moveset.fastPeriod;
  if (style === "heavy") return moveset.heavyPeriod;
  return moveset.defendPeriod;
}

export function attackDamage(style: Style, moveset: WeaponMoveset = GREATSWORD): number {
  if (style === "fast") return moveset.fastDamage;
  if (style === "heavy") return moveset.heavyDamage;
  return moveset.defendDamage;
}

/** Default greatsword lookups used by older call sites / tests. */
export function defaultHitWindow(): number {
  return tuning.HIT_WINDOW_T;
}
