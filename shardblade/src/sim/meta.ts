import type { WeaponClass } from "./types";

/** Both classes are always available — no meta unlock economy. */
export const AVAILABLE_CLASSES: WeaponClass[] = ["greatsword", "spear"];

export function isClassAvailable(weaponClass: WeaponClass): boolean {
  return AVAILABLE_CLASSES.includes(weaponClass);
}

/** Legacy key — cleared on boot so old roguelite banks don't linger. */
export const META_STORAGE_KEY = "shardblade.meta.v1";

export function clearLegacyMetaStorage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(META_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
