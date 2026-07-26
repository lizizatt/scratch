import { tuning } from "../data/tuning";
import type { MetaState } from "../sim/meta";
import type { RunSnapshot } from "../sim/run";
import { TEST_AI_OPTIONS } from "../sim/testAi";
import type { SkinId, WeaponClass } from "../sim/types";
import {
  bladeAngleForStyle,
  drawGenericBlade,
  drawShardblade,
} from "./blade";
import { type Rect } from "./hitTest";
import { layoutCombat } from "./layout";

export type UiRects = {
  start: Rect | null;
  greatsword: Rect | null;
  spear: Rect | null;
  skinA: Rect | null;
  skinB: Rect | null;
  unlockSpear: Rect | null;
  advance: Rect | null;
  backToSelect: Rect | null;
  aiButtons: Array<{ kind: import("../sim/testAi").TestAiKind; rect: Rect }>;
};

export type FrameModel = {
  snap: RunSnapshot | null;
  screen: "select" | "run";
  meta: MetaState;
  selectedClass: WeaponClass;
  selectedSkin: SkinId;
  message: string | null;
  /** Present when running the /combat-test arena. */
  combatTest?: {
    deaths: number;
    kills: number;
    aiKind: import("../sim/testAi").TestAiKind;
  };
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
  const layout = layoutCombat(width, height, snap);
  const { groundY, playerX, enemyX, entityY, slope } = layout;

  // Ground / slope
  ctx.fillStyle = "#2c3a2e";
  ctx.beginPath();
  ctx.moveTo(0, groundY);
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

  // Player body
  ctx.fillStyle = "#4a5568";
  ctx.fillRect(playerX - 12, entityY + 8, 24, 62);
  // Head
  ctx.fillStyle = "#c4a882";
  ctx.beginPath();
  ctx.arc(playerX, entityY + 4, 10, 0, Math.PI * 2);
  ctx.fill();

  // Player overhead shardblade swing (or idle windup when not in combat)
  {
    const progress = snap.phase === "combat" ? snap.playerProgress : 0;
    const angle = bladeAngleForStyle(snap.playerStyle, progress, 1);
    const gripX = playerX + 6;
    const gripY = entityY + 22;
    drawShardblade(ctx, gripX, gripY, angle, snap.skin ?? "skin_a");
  }

  // Enemy body + generic blade
  if (snap.phase === "combat" && snap.enemyHp !== null) {
    const boss = snap.enemyKind === "boss";
    const ew = boss ? 48 : 32;
    const eh = boss ? 90 : 70;
    const bodyTop = entityY - (boss ? 20 : 0);
    ctx.fillStyle = boss ? "#6b2d3c" : "#4a5568";
    ctx.fillRect(enemyX - ew / 2, bodyTop, ew, eh);
    ctx.fillStyle = boss ? "#8a4050" : "#c4a882";
    ctx.beginPath();
    ctx.arc(enemyX, bodyTop + 6, boss ? 14 : 10, 0, Math.PI * 2);
    ctx.fill();

    const angle = bladeAngleForStyle(snap.enemyStyle ?? "fast", snap.enemyProgress ?? 0, -1);
    const gripX = enemyX - 6;
    const gripY = bodyTop + 28;
    drawGenericBlade(ctx, gripX, gripY, angle);
  }

  // HUD stormlight
  ctx.fillStyle = "#e8eefc";
  ctx.font = "16px Georgia";
  if (model.combatTest) {
    ctx.fillText(
      `Combat test — kills: ${model.combatTest.kills}  deaths: ${model.combatTest.deaths}`,
      16,
      28,
    );
    ctx.fillStyle = "#a8b8d8";
    ctx.fillText("Q = fast · E = heavy · S = defend · AI switches at start of its next swing", 16, 52);

    // AI preset buttons along the bottom
    ctx.fillStyle = "#e8eefc";
    ctx.font = "14px Georgia";
    ctx.fillText("Enemy AI:", 16, height - 58);
    const btnW = 150;
    const btnH = 32;
    const gap = 8;
    const startX = 16;
    const y = height - 44;
    TEST_AI_OPTIONS.forEach((opt, i) => {
      const rect = { x: startX + i * (btnW + gap), y, w: btnW, h: btnH };
      rects.aiButtons.push({ kind: opt.kind, rect });
      drawButton(ctx, rect, opt.label, model.combatTest!.aiKind === opt.kind);
    });
  } else {
    ctx.fillText(`Stormlight: ${snap.stormlightRun} (bank ${model.meta.stormlight})`, 16, 28);
  }

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

    for (const b of layout.styleButtons) {
      const active = snap.playerStyle === b.style;
      drawButton(ctx, b.rect, b.style, active);
    }

    // HP bars (above style buttons so they don't overlap)
    drawBar(ctx, playerX - 40, entityY - 92, 80, 8, snap.playerHp / snap.playerMaxHp, "#6dffa8");
    drawBar(
      ctx,
      enemyX - 40,
      entityY - 92,
      80,
      8,
      snap.enemyHp / (snap.enemyMaxHp ?? 1),
      "#ff6d6d",
    );

    // Attack-loop progress (charge → hit window → recovery)
    const hitT = tuning.HIT_WINDOW_T;
    drawAttackProgress(ctx, playerX - 40, entityY - 78, 80, 7, snap.playerProgress, hitT, "#9db7ff");
    drawAttackProgress(
      ctx,
      enemyX - 40,
      entityY - 78,
      80,
      7,
      snap.enemyProgress ?? 0,
      hitT,
      "#e8a0a0",
    );

    // Enemy active style
    ctx.fillStyle = "#e8eefc";
    ctx.font = "14px Georgia";
    ctx.fillText(snap.enemyStyle ?? "", enemyX - 20, entityY - 100);

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
    aiButtons: [],
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
  ctx.font = r.h < 24 ? "12px Georgia" : "16px Georgia";
  ctx.fillText(label, r.x + 10, r.y + r.h / 2 + 4);
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

/** Attack charge bar with a tick at the damage-window fraction. */
function drawAttackProgress(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  progress: number,
  hitWindowT: number,
  color: string,
): void {
  const p = Math.max(0, Math.min(1, progress));
  ctx.fillStyle = "#1a2030";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * p, h);
  // Hit-window marker
  const mx = x + w * hitWindowT;
  ctx.strokeStyle = "#ffe08a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mx, y - 1);
  ctx.lineTo(mx, y + h + 1);
  ctx.stroke();
  // Flash brighter once past the window (recovery portion of the swing)
  if (p >= hitWindowT) {
    ctx.fillStyle = "rgba(255, 224, 138, 0.35)";
    ctx.fillRect(x + w * hitWindowT, y, w * (p - hitWindowT), h);
  }
}
