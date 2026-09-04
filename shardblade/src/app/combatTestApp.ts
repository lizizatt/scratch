import type { CombatTestSim } from "../sim/combatTest";
import { drawFrame, type FrameModel, type UiRects } from "../render/draw";
import { layoutCombat } from "../render/layout";
import { hitTestStyle, pointInRect } from "../render/hitTest";
import type { Style } from "../sim/types";
import type { TestAiKind } from "../sim/testAi";

/**
 * Thin canvas adapter for the infinite chasmfiend arena at /combat-test.
 */
export class CombatTestApp {
  private uiRects: UiRects | null = null;
  private readonly width: number;
  private readonly height: number;

  constructor(
    private canvas: HTMLCanvasElement,
    readonly sim: CombatTestSim,
  ) {
    this.width = canvas.width;
    this.height = canvas.height;
  }

  tick(dt: number): void {
    this.sim.tick(dt);
  }

  setStyle(style: Style): void {
    this.sim.setStyle(style);
  }

  setAiKind(kind: TestAiKind): void {
    this.sim.setAiKind(kind);
  }

  draw(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const model: FrameModel = {
      snap: this.sim.snapshot(),
      screen: "run",
      selectedClass: this.sim.weaponClass,
      selectedSkin: this.sim.skin,
      message: null,
      combatTest: {
        deaths: this.sim.deaths,
        kills: this.sim.kills,
        aiKind: this.sim.brain.kind,
      },
    };
    this.uiRects = drawFrame(ctx, this.width, this.height, model);
  }

  onClick(x: number, y: number): void {
    const r = this.uiRects;
    if (r) {
      for (const btn of r.aiButtons) {
        if (pointInRect(x, y, btn.rect)) {
          this.setAiKind(btn.kind);
          return;
        }
      }
    }
    const snap = this.sim.snapshot();
    const layout = layoutCombat(this.width, this.height, snap);
    const style = hitTestStyle(x, y, layout.styleButtons);
    if (style) {
      this.sim.setStyle(style);
    }
  }
}
