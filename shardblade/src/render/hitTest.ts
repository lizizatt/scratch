import type { Style } from "../sim/types";

export type Rect = { x: number; y: number; w: number; h: number };

export type StyleButtonLayout = {
  style: Style;
  label: string;
  rect: Rect;
};

export const STYLE_BUTTON_LABELS: Record<Style, string> = {
  fast: "fast (q)",
  heavy: "heavy (e)",
  defend: "defend (s)",
};

/** Layout for clickable style buttons above the player. */
export function playerStyleButtons(
  playerHeadX: number,
  playerHeadY: number,
): StyleButtonLayout[] {
  const w = 78;
  const h = Math.round(28 * (2 / 3)); // ~19
  const gap = 6;
  const total = w * 2 + gap;
  const left = playerHeadX - total / 2;
  const topRowY = playerHeadY - 40;
  const bottomRowY = topRowY + h + gap;
  return [
    { style: "fast", label: STYLE_BUTTON_LABELS.fast, rect: { x: left, y: topRowY, w, h } },
    {
      style: "heavy",
      label: STYLE_BUTTON_LABELS.heavy,
      rect: { x: left + w + gap, y: topRowY, w, h },
    },
    {
      style: "defend",
      label: STYLE_BUTTON_LABELS.defend,
      rect: { x: left, y: bottomRowY, w: total, h },
    },
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
