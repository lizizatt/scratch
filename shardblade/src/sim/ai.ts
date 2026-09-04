import type { Style } from "./types";

export type AiPolicyKind = "alwaysFast" | "alwaysHeavy" | "matchPlayerAfter";

export type AiPolicy =
  | { kind: "alwaysFast" }
  | { kind: "alwaysHeavy" }
  | { kind: "matchPlayerAfter"; delayS: number };

/**
 * Tracks when the AI should change style to match the player.
 * On each player style change that differs from AI, the timer restarts.
 */
export class MatchStyleAi {
  readonly delayS: number;
  private timer: number | null = null;
  private pendingStyle: Style | null = null;

  constructor(delayS: number) {
    this.delayS = delayS;
  }

  /** Call when player style is known (every tick or on change). */
  observePlayerStyle(playerStyle: Style, currentAiStyle: Style): void {
    if (playerStyle === currentAiStyle) {
      this.timer = null;
      this.pendingStyle = null;
      return;
    }
    if (this.pendingStyle !== playerStyle) {
      this.pendingStyle = playerStyle;
      this.timer = this.delayS;
    }
  }

  /**
   * Advance timer. Returns the style to switch to when delay elapses, else null.
   */
  tick(dt: number): Style | null {
    if (this.timer === null || this.pendingStyle === null) {
      return null;
    }
    this.timer -= dt;
    if (this.timer > 0) {
      return null;
    }
    const next = this.pendingStyle;
    this.timer = null;
    this.pendingStyle = null;
    return next;
  }
}

export function createPolicyController(policy: AiPolicy): {
  initialStyle: Style;
  tick: (dt: number, playerStyle: Style, aiStyle: Style) => Style | null;
} {
  if (policy.kind === "alwaysFast") {
    return {
      initialStyle: "fast",
      tick: () => null,
    };
  }
  if (policy.kind === "alwaysHeavy") {
    return {
      initialStyle: "heavy",
      tick: () => null,
    };
  }
  const matcher = new MatchStyleAi(policy.delayS);
  return {
    initialStyle: "fast",
    tick: (dt, playerStyle, aiStyle) => {
      matcher.observePlayerStyle(playerStyle, aiStyle);
      return matcher.tick(dt);
    },
  };
}
