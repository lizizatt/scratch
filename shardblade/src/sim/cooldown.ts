import { attackDamage, attackPeriod } from "./styles";
import type { Style } from "./types";

export type HitEvent = {
  style: Style;
  damage: number;
};

/**
 * Tracks attack charge as progress in [0, 1].
 * Style switches preserve the same fraction of charge.
 */
export class CooldownTracker {
  style: Style;
  /** Elapsed fraction of the current style's attack period. */
  progress: number;

  constructor(style: Style = "fast", progress = 0) {
    this.style = style;
    this.progress = progress;
  }

  setStyle(next: Style): void {
    if (next === this.style) return;
    this.style = next;
    // progress fraction is preserved by design
  }

  tick(dt: number): HitEvent | null {
    const period = attackPeriod(this.style);
    if (period <= 0) {
      throw new Error("attack period must be positive");
    }
    this.progress += dt / period;
    if (this.progress < 1) {
      return null;
    }
    this.progress -= 1;
    // Clamp tiny float overshoot into [0, 1)
    if (this.progress >= 1) {
      this.progress = this.progress % 1;
    }
    return {
      style: this.style,
      damage: attackDamage(this.style),
    };
  }
}
