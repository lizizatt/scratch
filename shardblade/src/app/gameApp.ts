import { clearLegacyMetaStorage } from "../sim/meta";
import { RunSim } from "../sim/run";
import {
  BASE_SWORD,
  CastleSceneSim,
  type SceneId,
} from "../sim/scenes";
import { CASTLE_STEP } from "../sim/scenes/castleSteps";
import type { SkinId, Style, WeaponClass } from "../sim/types";
import { drawFrame, type FrameModel, type UiRects } from "../render/draw";
import { drawCastleFrame, type CastleUiRects } from "../render/drawCastle";
import { layoutCombat } from "../render/layout";
import { hitTestStyle, pointInRect } from "../render/hitTest";

export type GameAppOptions = {
  godMode?: boolean;
  /** Happy path starts at forge; scene-1/2 URLs jump in with BASE_SWORD. */
  startScene?: SceneId;
};

/**
 * App shell: forge (scene 0) → chasm → castle → forge.
 * Stormlight is per-scene only.
 */
export class GameApp {
  sceneId: SceneId = "forge";
  readonly chasm: RunSim;
  readonly castle = new CastleSceneSim();
  selectedClass: WeaponClass = BASE_SWORD.weaponClass;
  selectedSkin: SkinId = BASE_SWORD.skin;
  message: string | null = null;
  private uiRects: UiRects | null = null;
  private castleRects: CastleUiRects | null = null;
  private readonly width: number;
  private readonly height: number;
  private handedToCastle = false;

  constructor(
    private canvas: HTMLCanvasElement,
    opts: GameAppOptions = {},
  ) {
    clearLegacyMetaStorage();
    this.chasm = new RunSim({ godMode: opts.godMode });
    this.width = canvas.width;
    this.height = canvas.height;

    const start = opts.startScene ?? "forge";
    if (start === "chasm") {
      this.applyBaseSword();
      this.startChasmScene();
    } else if (start === "castle") {
      this.applyBaseSword();
      this.handedToCastle = true;
      this.startCastleScene();
    } else {
      this.sceneId = "forge";
    }
  }

  get sim(): RunSim {
    return this.chasm;
  }

  /** Back-compat: forge is the old "select" screen. */
  get screen(): "select" | "run" {
    return this.sceneId === "forge" ? "select" : "run";
  }

  private applyBaseSword(): void {
    this.selectedClass = BASE_SWORD.weaponClass;
    this.selectedSkin = BASE_SWORD.skin;
  }

  private startChasmScene(): void {
    this.sceneId = "chasm";
    this.handedToCastle = false;
    this.chasm.dispatch({
      type: "startRun",
      weaponClass: this.selectedClass,
      skin: this.selectedSkin,
    });
    this.message = null;
  }

  private startCastleScene(): void {
    this.sceneId = "castle";
    this.castle.dispatch({ type: "start" });
    this.message = null;
  }

  private returnToForge(): void {
    this.sceneId = "forge";
    this.handedToCastle = false;
    this.message = null;
  }

  tick(dt: number): void {
    if (this.sceneId === "forge") return;
    if (this.sceneId === "chasm") {
      this.chasm.tick(dt);
      if (this.chasm.phase === "won" && !this.handedToCastle) {
        this.handedToCastle = true;
        this.startCastleScene();
      }
    } else {
      this.castle.tick(dt);
    }
  }

  onPointerMove(_x: number, _y: number): void {}

  onKeyDown(key: string): void {
    if (this.sceneId !== "castle") return;
    if (key === "f" || key === "F") {
      this.castle.dispatch({ type: "interact" });
    }
  }

  setStyle(style: Style): void {
    if (this.sceneId === "chasm" && this.chasm.phase === "combat") {
      this.chasm.dispatch({ type: "setStyle", style });
    }
  }

  draw(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    if (this.sceneId === "castle") {
      this.castleRects = drawCastleFrame(
        ctx,
        this.width,
        this.height,
        this.castle.snapshot(),
        null,
      );
      this.uiRects = null;
      return;
    }

    const model: FrameModel = {
      snap: this.sceneId === "chasm" ? this.chasm.snapshot() : null,
      screen: this.screen,
      selectedClass: this.selectedClass,
      selectedSkin: this.selectedSkin,
      message: this.message,
    };
    this.uiRects = drawFrame(ctx, this.width, this.height, model);
    this.castleRects = null;
  }

  onClick(x: number, y: number): void {
    if (this.sceneId === "forge") {
      const r = this.uiRects;
      if (!r) return;
      if (r.greatsword && pointInRect(x, y, r.greatsword)) {
        this.selectedClass = "greatsword";
        this.message = null;
      }
      if (r.spear && pointInRect(x, y, r.spear)) {
        this.selectedClass = "spear";
        this.message = null;
      }
      if (r.skinA && pointInRect(x, y, r.skinA)) this.selectedSkin = "skin_a";
      if (r.skinB && pointInRect(x, y, r.skinB)) this.selectedSkin = "skin_b";
      if (r.start && pointInRect(x, y, r.start)) {
        this.startChasmScene();
      }
      return;
    }

    if (this.sceneId === "castle") {
      const snap = this.castle.snapshot();
      if (snap.stepId === CASTLE_STEP.BLACK_END) {
        const adv = this.castleRects?.advance;
        if (adv && pointInRect(x, y, adv)) {
          this.castle.dispatch({ type: "advance" });
          this.returnToForge();
        }
      }
      return;
    }

    const r = this.uiRects;
    if (!r) return;
    const snap = this.chasm.snapshot();
    if (snap.phase === "intro" || snap.phase === "barracks") {
      if (r.advance && pointInRect(x, y, r.advance)) {
        this.chasm.dispatch({ type: "advanceDialogue" });
      }
      return;
    }
    if (snap.phase === "epilogue") {
      this.chasm.dispatch({ type: "advanceDialogue" });
      return;
    }
    if (snap.phase === "dead" && r.backToSelect && pointInRect(x, y, r.backToSelect)) {
      this.returnToForge();
      return;
    }
    if (snap.phase === "combat") {
      const layout = layoutCombat(this.width, this.height, snap);
      const style = hitTestStyle(x, y, layout.styleButtons);
      if (style) {
        this.chasm.dispatch({ type: "setStyle", style });
      }
    }
  }
}
