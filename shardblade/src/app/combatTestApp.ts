import type { MetaState } from "../sim/meta";
import type { CombatTestSim } from "../sim/combatTest";
import { drawFrame, type FrameModel, type UiRects } from "../render/draw";
import { hitTestStyle, playerStyleButtons } from "../render/hitTest";
import { DEFAULT_META } from "../sim/meta";

/**
 * Thin canvas adapter for the infinite chasmfiend arena at /combat-test.
 */
export class CombatTestApp {
  private uiRects: UiRects | null = null;
  private readonly width: number;
  private readonly height: number;
  private readonly meta: MetaState = { ...DEFAULT_META, unlockedClasses: [...DEFAULT_META.unlockedClasses] };

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

  draw(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const model: FrameModel = {
      snap: this.sim.snapshot(),
      screen: "run",
      meta: this.meta,
      selectedClass: this.sim.weaponClass,
      selectedSkin: this.sim.skin,
      message: null,
      combatTest: {
        deaths: this.sim.deaths,
        kills: this.sim.kills,
      },
    };
    this.uiRects = drawFrame(ctx, this.width, this.height, model);
  }

  onClick(x: number, y: number): void {
    void this.uiRects;
    const playerX = this.width * 0.28;
    const groundY = this.height * 0.72;
    const entityY = groundY - 70;
    const style = hitTestStyle(x, y, playerStyleButtons(playerX, entityY));
    if (style) {
      this.sim.setStyle(style);
    }
  }
}
