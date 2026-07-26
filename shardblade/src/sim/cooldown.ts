import { GREATSWORD, type WeaponMoveset } from "../data/weapons";
import type { Style } from "./types";

export type HitEvent = {
  style: Style;
  damage: number;
  /** Fraction of the swing when the hit window fired. */
  hitAt: number;
};

export type CooldownTickOptions = {
  /**
   * Invoked at the start of a new swing (when the previous swing wraps),
   * before that swing's hit window is evaluated — so AI can pick a style
   * for the upcoming cycle.
   */
  onNewSwing?: () => void;
};

/**
 * Tracks attack charge as progress in [0, 1].
 * Damage fires once when progress crosses the moveset hit window.
 * Style switches preserve the same fraction of charge.
 */
export class CooldownTracker {
  style: Style;
  /** Elapsed fraction of the current style's attack period. */
  progress: number;
  moveset: WeaponMoveset;
  private hitThisSwing = false;

  constructor(
    style: Style = "fast",
    progress = 0,
    moveset: WeaponMoveset = GREATSWORD,
  ) {
    this.style = style;
    this.progress = progress;
    this.moveset = moveset;
    this.hitThisSwing = progress >= moveset.hitWindowT;
  }

  setMoveset(moveset: WeaponMoveset): void {
    this.moveset = moveset;
  }

  setStyle(next: Style): void {
    if (next === this.style) return;
    this.style = next;
  }

  /** Test/helper: set swing progress; hit window may still fire if not yet crossed. */
  seekProgress(progress: number): void {
    this.progress = progress;
    this.hitThisSwing = false;
  }

  private period(): number {
    return this.style === "fast" ? this.moveset.fastPeriod : this.moveset.heavyPeriod;
  }

  private damage(): number {
    return this.style === "fast" ? this.moveset.fastDamage : this.moveset.heavyDamage;
  }

  private makeHit(): HitEvent {
    return {
      style: this.style,
      damage: this.damage(),
      hitAt: this.moveset.hitWindowT,
    };
  }

  tick(dt: number, opts?: CooldownTickOptions): HitEvent | null {
    const period = this.period();
    if (period <= 0) {
      throw new Error("attack period must be positive");
    }
    const prev = this.progress;
    this.progress += dt / period;

    let hit: HitEvent | null = null;
    const windowT = this.moveset.hitWindowT;
    if (!this.hitThisSwing && prev < windowT && this.progress >= windowT) {
      this.hitThisSwing = true;
      hit = this.makeHit();
    }

    if (this.progress >= 1) {
      this.progress -= 1;
      if (this.progress >= 1) {
        this.progress = this.progress % 1;
      }
      // New swing begins — AI decides here before hit evaluation.
      opts?.onNewSwing?.();
      if (this.progress >= windowT) {
        this.hitThisSwing = true;
        hit = this.makeHit();
      } else {
        this.hitThisSwing = false;
      }
    }

    return hit;
  }
}
