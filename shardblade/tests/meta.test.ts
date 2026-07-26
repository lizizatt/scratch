import { describe, expect, it } from "vitest";
import { tuning } from "../src/data/tuning";
import { MemoryStorage } from "../src/persist/storage";
import {
  META_STORAGE_KEY,
  addStormlight,
  canPurchaseSpear,
  isClassUnlocked,
  loadMeta,
  purchaseSpear,
  saveMeta,
} from "../src/sim/meta";

describe("meta unlocks", () => {
  it("greatsword starts unlocked; spear locked", () => {
    const meta = loadMeta(new MemoryStorage());
    expect(isClassUnlocked(meta, "greatsword")).toBe(true);
    expect(isClassUnlocked(meta, "spear")).toBe(false);
  });

  it("cannot purchase spear without enough stormlight", () => {
    let meta = loadMeta(new MemoryStorage());
    meta = addStormlight(meta, tuning.SPEAR_UNLOCK_COST - 1);
    expect(canPurchaseSpear(meta)).toBe(false);
    expect(purchaseSpear(meta)).toEqual(meta);
  });

  it("purchase deducts cost and unlocks spear", () => {
    let meta = loadMeta(new MemoryStorage());
    meta = addStormlight(meta, tuning.SPEAR_UNLOCK_COST);
    meta = purchaseSpear(meta);
    expect(isClassUnlocked(meta, "spear")).toBe(true);
    expect(meta.stormlight).toBe(0);
  });

  it("death-style banking does not wipe stormlight", () => {
    let meta = loadMeta(new MemoryStorage());
    meta = addStormlight(meta, 7);
    meta = addStormlight(meta, 10); // run gains
    expect(meta.stormlight).toBe(17);
  });
});

describe("storage round-trip", () => {
  it("memory storage persists JSON meta", () => {
    const storage = new MemoryStorage();
    let meta = loadMeta(storage);
    meta = addStormlight(meta, tuning.SPEAR_UNLOCK_COST);
    meta = purchaseSpear(meta);
    saveMeta(storage, meta);

    const raw = storage.getItem(META_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const loaded = loadMeta(storage);
    expect(loaded.stormlight).toBe(0);
    expect(loaded.unlockedClasses).toContain("spear");
  });
});
