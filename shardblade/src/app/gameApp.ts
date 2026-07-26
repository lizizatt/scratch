import { tuning } from "../data/tuning";
import { MemoryStorage, type Storage } from "../persist/storage";
import {
  canPurchaseSpear,
  isClassUnlocked,
  loadMeta,
  purchaseSpear,
  saveMeta,
  type MetaState,
} from "../sim/meta";
import { RunSim } from "../sim/run";
import type { SkinId, WeaponClass } from "../sim/types";
import { drawFrame, type FrameModel, type UiRects } from "../render/draw";
import { layoutCombat } from "../render/layout";
import { hitTestStyle, pointInRect } from "../render/hitTest";

export class GameApp {
  readonly sim = new RunSim();
  meta: MetaState;
  screen: "select" | "run" = "select";
  selectedClass: WeaponClass = "greatsword";
  selectedSkin: SkinId = "skin_a";
  message: string | null = null;
  private storage: Storage;
  private uiRects: UiRects | null = null;
  private readonly width: number;
  private readonly height: number;
  /** Avoid writing localStorage every frame while sitting on won/dead. */
  private metaSyncedForEnd = false;

  constructor(
    private canvas: HTMLCanvasElement,
    storage?: Storage,
  ) {
    this.width = canvas.width;
    this.height = canvas.height;
    this.storage = storage ?? (typeof localStorage !== "undefined" ? {
      getItem: (k) => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, v),
      removeItem: (k) => localStorage.removeItem(k),
    } : new MemoryStorage());
    this.meta = loadMeta(this.storage);
    this.sim.stormlightMeta = this.meta.stormlight;
  }

  private persist(): void {
    saveMeta(this.storage, this.meta);
  }

  private syncMetaFromSim(): void {
    if (this.sim.phase !== "won" && this.sim.phase !== "dead") {
      this.metaSyncedForEnd = false;
      return;
    }
    if (this.metaSyncedForEnd) return;
    this.meta = { ...this.meta, stormlight: this.sim.stormlightMeta };
    this.persist();
    this.metaSyncedForEnd = true;
  }

  tick(dt: number): void {
    if (this.screen === "run") {
      this.sim.tick(dt);
      this.syncMetaFromSim();
    }
  }

  draw(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const model: FrameModel = {
      snap: this.screen === "run" ? this.sim.snapshot() : null,
      screen: this.screen,
      meta: this.meta,
      selectedClass: this.selectedClass,
      selectedSkin: this.selectedSkin,
      message: this.message,
    };
    this.uiRects = drawFrame(ctx, this.width, this.height, model);
  }

  onClick(x: number, y: number): void {
    const r = this.uiRects;
    if (!r) return;

    if (this.screen === "select") {
      if (r.greatsword && pointInRect(x, y, r.greatsword)) {
        this.selectedClass = "greatsword";
        this.message = null;
      }
      if (r.spear && pointInRect(x, y, r.spear)) {
        if (isClassUnlocked(this.meta, "spear")) {
          this.selectedClass = "spear";
          this.message = null;
        } else {
          this.message = "Spear is locked — earn stormlight first.";
        }
      }
      if (r.skinA && pointInRect(x, y, r.skinA)) this.selectedSkin = "skin_a";
      if (r.skinB && pointInRect(x, y, r.skinB)) this.selectedSkin = "skin_b";
      if (r.unlockSpear && pointInRect(x, y, r.unlockSpear)) {
        if (canPurchaseSpear(this.meta)) {
          this.meta = purchaseSpear(this.meta);
          this.persist();
          this.message = "Spear unlocked.";
        } else {
          this.message = `Need ${tuning.SPEAR_UNLOCK_COST} stormlight to unlock spear.`;
        }
      }
      if (r.start && pointInRect(x, y, r.start)) {
        if (!isClassUnlocked(this.meta, this.selectedClass)) {
          this.message = "That class is locked.";
          return;
        }
        this.sim.stormlightMeta = this.meta.stormlight;
        this.metaSyncedForEnd = false;
        this.sim.dispatch({
          type: "startRun",
          weaponClass: this.selectedClass,
          skin: this.selectedSkin,
        });
        this.screen = "run";
        this.message = null;
      }
      return;
    }

    const snap = this.sim.snapshot();
    if (snap.phase === "intro" && r.advance && pointInRect(x, y, r.advance)) {
      this.sim.dispatch({ type: "advanceDialogue" });
      return;
    }
    if ((snap.phase === "won" || snap.phase === "dead") && r.backToSelect && pointInRect(x, y, r.backToSelect)) {
      this.meta = { ...this.meta, stormlight: this.sim.stormlightMeta };
      this.persist();
      this.metaSyncedForEnd = true;
      this.screen = "select";
      return;
    }
    if (snap.phase === "combat") {
      const layout = layoutCombat(this.width, this.height, snap);
      const style = hitTestStyle(x, y, layout.styleButtons);
      if (style) {
        this.sim.dispatch({ type: "setStyle", style });
      }
    }
  }
}
