import { tuning } from "../data/tuning";
import type { MetaState } from "../sim/meta";
import type { RunSnapshot } from "../sim/run";
import type { SkinId, WeaponClass } from "../sim/types";
import { playerStyleButtons, type Rect } from "./hitTest";

export type UiRects = {
  start: Rect | null;
  greatsword: Rect | null;
  spear: Rect | null;
  skinA: Rect | null;
  skinB: Rect | null;
  unlockSpear: Rect | null;
  advance: Rect | null;
  backToSelect: Rect | null;
};

export type FrameModel = {
  snap: RunSnapshot | null;
  screen: "select" | "run";
  meta: MetaState;
  selectedClass: WeaponClass;
  selectedSkin: SkinId;
  message: string | null;
};

function skinColor(skin: SkinId): string {
  return skin === "skin_a" ? "#c5d4ff" : "#ffd4a8";
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  model: FrameModel,
): UiRects {
  ctx.clearRect(0, 0, width, height);

  // Sky / storm gradient
  const storm = model.snap?.stormLevel ?? 0;
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, storm > 0 ? "#1a2238" : "#243150");
  g.addColorStop(1, "#0b1020");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  if (model.screen === "select") {
    return drawSelect(ctx, width, height, model);
  }

  return drawRun(ctx, width, height, model);
}

function drawSelect(
  ctx: CanvasRenderingContext2D,
  width: number,
  _height: number,
  model: FrameModel,
): UiRects {
  const rects: UiRects = emptyRects();

  ctx.fillStyle = "#e8eefc";
  ctx.font = "36px Georgia";
  ctx.fillText("Shardblade", 48, 64);

  ctx.font = "18px Georgia";
  ctx.fillText(`Stormlight: ${model.meta.stormlight}`, 48, 100);

  if (model.message) {
    ctx.fillStyle = "#ffb4b4";
    ctx.fillText(model.message, 48, 130);
  }

  // Class buttons
  rects.greatsword = { x: 48, y: 160, w: 180, h: 48 };
  drawButton(ctx, rects.greatsword, "Greatsword", model.selectedClass === "greatsword");

  rects.spear = { x: 248, y: 160, w: 180, h: 48 };
  const spearUnlocked = model.meta.unlockedClasses.includes("spear");
  drawButton(
    ctx,
    rects.spear,
    spearUnlocked ? "Spear" : "Spear (locked)",
    model.selectedClass === "spear",
    !spearUnlocked,
  );

  rects.skinA = { x: 48, y: 240, w: 120, h: 40 };
  rects.skinB = { x: 184, y: 240, w: 120, h: 40 };
  drawButton(ctx, rects.skinA, "Skin A", model.selectedSkin === "skin_a");
  drawButton(ctx, rects.skinB, "Skin B", model.selectedSkin === "skin_b");

  // Sword builder hook
  ctx.fillStyle = "#6a7a9a";
  ctx.font = "14px Georgia";
  ctx.fillText("Sword building — coming later", 48, 320);

  if (!spearUnlocked) {
    rects.unlockSpear = { x: 48, y: 350, w: 260, h: 40 };
    drawButton(
      ctx,
      rects.unlockSpear,
      `Unlock Spear (${tuning.SPEAR_UNLOCK_COST} stormlight)`,
      false,
    );
  }

  rects.start = { x: 48, y: 420, w: 200, h: 52 };
  drawButton(ctx, rects.start, "Enter the chasm", false);

  // Preview blade
  ctx.fillStyle = skinColor(model.selectedSkin);
  if (model.selectedClass === "spear") {
    ctx.fillRect(width - 210, 160, 8, 180);
    ctx.fillStyle = "#8a96b0";
    ctx.fillRect(width - 220, 330, 28, 14);
  } else {
    ctx.fillRect(width - 220, 180, 24, 160);
    ctx.fillStyle = "#8a96b0";
    ctx.fillRect(width - 230, 330, 44, 18);
  }

  return rects;
}

function drawRun(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  model: FrameModel,
): UiRects {
  const rects: UiRects = emptyRects();
  const snap = model.snap!;
  const groundY = height * 0.72;

  // Ground / slope
  ctx.fillStyle = "#2c3a2e";
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  const slope = snap.stormLevel * 18;
  ctx.lineTo(width, groundY - slope);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  // Water
  if (snap.waterHeight > 0) {
    const wh = snap.waterHeight * (height * 0.35);
    ctx.fillStyle = "rgba(60, 120, 180, 0.45)";
    ctx.fillRect(0, height - wh, width, wh);
  }

  // Rain
  if (snap.stormLevel > 0) {
    ctx.strokeStyle = "rgba(180, 200, 255, 0.35)";
    ctx.beginPath();
    const drops = 40 + snap.stormLevel * 25;
    for (let i = 0; i < drops; i++) {
      const x = ((i * 97 + snap.time * 120) % width);
      const y = ((i * 53 + snap.time * 400) % height);
      ctx.moveTo(x, y);
      ctx.lineTo(x + 2, y + 10);
    }
    ctx.stroke();
  }

  // Lightning flash
  if (snap.stormLevel > 0 && Math.floor(snap.time * 3) % 17 === 0) {
    ctx.fillStyle = "rgba(220, 230, 255, 0.15)";
    ctx.fillRect(0, 0, width, height);
  }

  const playerX = width * 0.28;
  const enemyX = width * 0.62;
  const entityY = groundY - 70 - (snap.stormLevel > 2 ? slope * 0.3 : 0);

  // Player
  const isSpear = snap.weaponClass === "spear";
  ctx.fillStyle = skinColor(snap.skin ?? "skin_a");
  if (isSpear) {
    ctx.fillRect(playerX - 10, entityY + 10, 20, 60);
    ctx.fillStyle = skinColor(snap.skin ?? "skin_a");
    ctx.fillRect(playerX + 8, entityY - 10, 6, 90);
  } else {
    ctx.fillRect(playerX - 14, entityY, 28, 70);
  }
  // Swing telegraph from attack progress (damage window at HIT_WINDOW_T)
  if (snap.phase === "combat") {
    const swing = snap.playerStyle === "heavy" ? 50 : 30;
    const windup = Math.min(1, snap.playerProgress / Math.max(0.001, tuning.HIT_WINDOW_T));
    ctx.strokeStyle = snap.playerProgress >= tuning.HIT_WINDOW_T ? "#ffe08a" : "#e8eefc";
    ctx.lineWidth = isSpear ? 2 : 3;
    ctx.beginPath();
    ctx.moveTo(playerX + 10, entityY + 20);
    const reach = swing * (0.2 + windup * 0.8);
    ctx.lineTo(playerX + 10 + reach, entityY + (isSpear ? -10 : 10));
    ctx.stroke();
  }

  // Enemy
  if (snap.phase === "combat" && snap.enemyHp !== null) {
    const boss = snap.enemyKind === "boss";
    ctx.fillStyle = boss ? "#6b2d3c" : "#4a5568";
    const ew = boss ? 48 : 32;
    const eh = boss ? 90 : 70;
    ctx.fillRect(enemyX - ew / 2, entityY - (boss ? 20 : 0), ew, eh);
  }

  // HUD stormlight
  ctx.fillStyle = "#e8eefc";
  ctx.font = "16px Georgia";
  ctx.fillText(`Stormlight: ${snap.stormlightRun} (bank ${model.meta.stormlight})`, 16, 28);

  // Dialogue / phase text
  if (snap.phase === "intro") {
    const line = snap.dialogueLines[Math.min(snap.dialogueIndex, snap.dialogueLines.length - 1)];
    ctx.fillStyle = "rgba(10, 14, 28, 0.75)";
    ctx.fillRect(40, height - 120, width - 80, 80);
    ctx.fillStyle = "#e8eefc";
    ctx.font = "18px Georgia";
    ctx.fillText(line, 60, height - 75);
    rects.advance = { x: width - 200, y: height - 100, w: 140, h: 40 };
    drawButton(ctx, rects.advance, "Continue", false);
  }

  if (snap.phase === "walk" || snap.phase === "storm") {
    ctx.fillStyle = "#a8b8d8";
    ctx.font = "16px Georgia";
    ctx.fillText(snap.phase === "storm" ? "The storm grows…" : "Walking the chasm…", 16, 56);
  }

  if (snap.phase === "combat" && snap.enemyHp !== null) {
    const fade = snap.uiFade;
    ctx.globalAlpha = fade;

    // Player styles
    const buttons = playerStyleButtons(playerX, entityY);
    for (const b of buttons) {
      const active = snap.playerStyle === b.style;
      drawButton(ctx, b.rect, b.style, active);
    }

    // HP bars
    drawBar(ctx, playerX - 40, entityY - 56, 80, 8, snap.playerHp / snap.playerMaxHp, "#6dffa8");
    drawBar(
      ctx,
      enemyX - 40,
      entityY - 56,
      80,
      8,
      snap.enemyHp / (snap.enemyMaxHp ?? 1),
      "#ff6d6d",
    );

    // Enemy active style
    ctx.fillStyle = "#e8eefc";
    ctx.font = "14px Georgia";
    ctx.fillText(snap.enemyStyle ?? "", enemyX - 20, entityY - 64);

    ctx.globalAlpha = 1;
  }

  if (snap.phase === "won" || snap.phase === "dead") {
    ctx.fillStyle = "rgba(10, 14, 28, 0.8)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#e8eefc";
    ctx.font = "32px Georgia";
    ctx.fillText(snap.phase === "won" ? "You won" : "Game over", width / 2 - 80, height / 2 - 40);
    ctx.font = "18px Georgia";
    ctx.fillText(`Stormlight banked: ${model.meta.stormlight}`, width / 2 - 100, height / 2);
    rects.backToSelect = { x: width / 2 - 90, y: height / 2 + 30, w: 180, h: 44 };
    drawButton(ctx, rects.backToSelect, "Continue", false);
  }

  return rects;
}

function emptyRects(): UiRects {
  return {
    start: null,
    greatsword: null,
    spear: null,
    skinA: null,
    skinB: null,
    unlockSpear: null,
    advance: null,
    backToSelect: null,
  };
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  label: string,
  active: boolean,
  disabled = false,
): void {
  ctx.fillStyle = disabled ? "#2a3348" : active ? "#3d5a9a" : "#243044";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = active ? "#9db7ff" : "#4a5a78";
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = disabled ? "#6a7a9a" : "#e8eefc";
  ctx.font = "16px Georgia";
  ctx.fillText(label, r.x + 12, r.y + r.h / 2 + 5);
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: string,
): void {
  ctx.fillStyle = "#1a2030";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
}
