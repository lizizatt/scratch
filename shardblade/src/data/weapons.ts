import { tuning } from "./tuning";
import type { WeaponClass } from "../sim/types";

export type WeaponMoveset = {
  classId: WeaponClass;
  label: string;
  fastPeriod: number;
  heavyPeriod: number;
  defendPeriod: number;
  fastDamage: number;
  heavyDamage: number;
  defendDamage: number;
  hitWindowT: number;
};

/** Greatsword — classic shardblade. */
export const GREATSWORD: WeaponMoveset = {
  classId: "greatsword",
  label: "Greatsword",
  fastPeriod: tuning.FAST_ATTACK_PERIOD,
  heavyPeriod: tuning.HEAVY_ATTACK_PERIOD,
  defendPeriod: tuning.DEFEND_PERIOD,
  fastDamage: tuning.FAST_DAMAGE,
  heavyDamage: tuning.HEAVY_DAMAGE,
  defendDamage: tuning.DEFEND_DAMAGE,
  hitWindowT: tuning.HIT_WINDOW_T,
};

/**
 * Spear — always available on the select screen.
 * MVP: same numbers as greatsword (distinct art/feel later).
 */
export const SPEAR: WeaponMoveset = {
  classId: "spear",
  label: "Spear",
  fastPeriod: tuning.FAST_ATTACK_PERIOD,
  heavyPeriod: tuning.HEAVY_ATTACK_PERIOD,
  defendPeriod: tuning.DEFEND_PERIOD,
  fastDamage: tuning.FAST_DAMAGE,
  heavyDamage: tuning.HEAVY_DAMAGE,
  defendDamage: tuning.DEFEND_DAMAGE,
  hitWindowT: tuning.HIT_WINDOW_T,
};

export function movesetFor(weaponClass: WeaponClass): WeaponMoveset {
  return weaponClass === "spear" ? SPEAR : GREATSWORD;
}

/** Hook reserved for deeper sword crafting (not MVP). */
export type WeaponBuild = {
  classId: WeaponClass;
  /** Future: blade / guard / glow parts */
  parts: Record<string, string>;
};

export function stubWeaponBuild(classId: WeaponClass): WeaponBuild {
  return { classId, parts: {} };
}
