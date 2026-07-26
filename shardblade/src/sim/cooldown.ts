import { tuning } from "../data/tuning";
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

function isAttackStyle(style: Style): boolean {
  return style === "fast" || style === "heavy";
}

/**
 * Tracks attack charge as progress in [0, 1].
 * Damage fires once when progress crosses the moveset hit window.
 * Defend resets and freezes the timer; fast↔heavy applies a time penalty.
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
    this.progress = style === "defend" ? 0 : progress;
    this.moveset = moveset;
    this.hitThisSwing = this.progress >= moveset.hitWindowT;
  }

  setMoveset(moveset: WeaponMoveset): void {
    this.moveset = moveset;
  }

  setStyle(next: Style): void {
    if (next === this.style) return;
    const prev = this.style;
    this.style = next;

    if (next === "defend") {
      this.progress = 0;
      this.hitThisSwing = false;
      return;
    }

    if (isAttackStyle(prev) && isAttackStyle(next)) {
      const penaltyFrac = tuning.STYLE_SWITCH_PENALTY_S / this.period();
      this.progress = Math.max(0, this.progress - penaltyFrac);
      this.hitThisSwing = this.progress >= this.moveset.hitWindowT;
    }
  }

  /** Test/helper: set swing progress; hit window may still fire if not yet crossed. */
  seekProgress(progress: number): void {
    this.progress = progress;
    this.hitThisSwing = false;
  }

  private period(): number {
    if (this.style === "fast") return this.moveset.fastPeriod;
    if (this.style === "heavy") return this.moveset.heavyPeriod;
    return this.moveset.defendPeriod;
  }

  private damage(): number {
    if (this.style === "fast") return this.moveset.fastDamage;
    if (this.style === "heavy") return this.moveset.heavyDamage;
    return this.moveset.defendDamage;
  }

  private makeHit(): HitEvent {
    return {
      style: this.style,
      damage: this.damage(),
      hitAt: this.moveset.hitWindowT,
    };
  }

  tick(dt: number, opts?: CooldownTickOptions): HitEvent | null {
    if (this.style === "defend") {
      this.progress = 0;
      this.hitThisSwing = false;
      return null;
    }

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
