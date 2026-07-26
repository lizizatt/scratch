import { tuning } from "../data/tuning";
import type { Storage } from "../persist/storage";
import type { WeaponClass } from "../sim/types";

export const META_STORAGE_KEY = "shardblade.meta.v1";

export type MetaState = {
  stormlight: number;
  unlockedClasses: WeaponClass[];
};

export const DEFAULT_META: MetaState = {
  stormlight: 0,
  unlockedClasses: ["greatsword"],
};

export function normalizeMeta(raw: unknown): MetaState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_META, unlockedClasses: [...DEFAULT_META.unlockedClasses] };
  const obj = raw as Record<string, unknown>;
  const stormlight = typeof obj.stormlight === "number" && obj.stormlight >= 0 ? Math.floor(obj.stormlight) : 0;
  const unlocked: WeaponClass[] = ["greatsword"];
  if (Array.isArray(obj.unlockedClasses)) {
    for (const c of obj.unlockedClasses) {
      if ((c === "greatsword" || c === "spear") && !unlocked.includes(c)) {
        unlocked.push(c);
      }
    }
  }
  return { stormlight, unlockedClasses: unlocked };
}

export function loadMeta(storage: Storage): MetaState {
  const raw = storage.getItem(META_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_META, unlockedClasses: [...DEFAULT_META.unlockedClasses] };
  try {
    return normalizeMeta(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_META, unlockedClasses: [...DEFAULT_META.unlockedClasses] };
  }
}

export function saveMeta(storage: Storage, meta: MetaState): void {
  storage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
}

export function isClassUnlocked(meta: MetaState, weaponClass: WeaponClass): boolean {
  return meta.unlockedClasses.includes(weaponClass);
}

export function canPurchaseSpear(meta: MetaState): boolean {
  return (
    !isClassUnlocked(meta, "spear") && meta.stormlight >= tuning.SPEAR_UNLOCK_COST
  );
}

export function purchaseSpear(meta: MetaState): MetaState {
  if (!canPurchaseSpear(meta)) {
    return meta;
  }
  return {
    stormlight: meta.stormlight - tuning.SPEAR_UNLOCK_COST,
    unlockedClasses: [...meta.unlockedClasses, "spear"],
  };
}

export function addStormlight(meta: MetaState, amount: number): MetaState {
  return {
    ...meta,
    stormlight: meta.stormlight + Math.max(0, Math.floor(amount)),
  };
}
