import type { Style } from "../sim/types";

export type Rect = { x: number; y: number; w: number; h: number };

export type StyleButtonLayout = {
  style: Style;
  rect: Rect;
};

/** Layout for clickable style buttons above the player. */
export function playerStyleButtons(
  playerHeadX: number,
  playerHeadY: number,
): StyleButtonLayout[] {
  const w = 56;
  const h = Math.round(28 * (2 / 3)); // ~19
  const gap = 6;
  const total = w * 2 + gap;
  const left = playerHeadX - total / 2;
  const bottomRowY = playerHeadY - 40;
  const topRowY = bottomRowY - gap - h;
  return [
    { style: "defend", rect: { x: left, y: topRowY, w: total, h } },
    { style: "fast", rect: { x: left, y: bottomRowY, w, h } },
    { style: "heavy", rect: { x: left + w + gap, y: bottomRowY, w, h } },
  ];
}

export function hitTestStyle(
  x: number,
  y: number,
  buttons: StyleButtonLayout[],
): Style | null {
  for (const b of buttons) {
    const { rect } = b;
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
      return b.style;
    }
  }
  return null;
}

export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
