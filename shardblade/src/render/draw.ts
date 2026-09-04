import { tuning } from "../data/tuning";
import type { RunSnapshot } from "../sim/run";
import { TEST_AI_OPTIONS } from "../sim/testAi";
import type { SkinId, WeaponClass } from "../sim/types";
import {
  clawSwingAngle,
  drawGenericBlade,
  drawPlayerWeapon,
  drawShardblade,
  drawShardspear,
  weaponPoseForStyle,
} from "./blade";
import {
  drawAlethiGuard,
  drawBarracks,
  drawChasmfiend,
  drawDroppedClaw,
  drawMainCharacter,
  drawSnail,
} from "./characters";
import { type Rect } from "./hitTest";
import { layoutCombat } from "./layout";

export type UiRects = {
  start: Rect | null;
  greatsword: Rect | null;
  spear: Rect | null;
  skinA: Rect | null;
  skinB: Rect | null;
  advance: Rect | null;
  backToSelect: Rect | null;
  aiButtons: Array<{ kind: import("../sim/testAi").TestAiKind; rect: Rect }>;
};

export type FrameModel = {
  snap: RunSnapshot | null;
  screen: "select" | "run";
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

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  model: FrameModel,
): UiRects {
  ctx.clearRect(0, 0, width, height);

  // Sky / storm gradient — chasm stays dark; storm only deepens it slightly
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

  ctx.font = "16px Georgia";
  ctx.fillStyle = "#a8b8d8";
  ctx.fillText("Scene 0 — choose your blade, then enter the chasm.", 48, 100);

  if (model.message) {
    ctx.fillStyle = "#ffb4b4";
    ctx.fillText(model.message, 48, 130);
  }

  // Class buttons
  rects.greatsword = { x: 48, y: 160, w: 180, h: 48 };
  drawButton(ctx, rects.greatsword, "Greatsword", model.selectedClass === "greatsword");

  rects.spear = { x: 248, y: 160, w: 180, h: 48 };
  drawButton(ctx, rects.spear, "Spear", model.selectedClass === "spear");

  rects.skinA = { x: 48, y: 240, w: 120, h: 40 };
  rects.skinB = { x: 184, y: 240, w: 120, h: 40 };
  drawButton(ctx, rects.skinA, "Skin A", model.selectedSkin === "skin_a");
  drawButton(ctx, rects.skinB, "Skin B", model.selectedSkin === "skin_b");

  // Sword builder hook
  ctx.fillStyle = "#6a7a9a";
  ctx.font = "14px Georgia";
  ctx.fillText("Sword building — coming later", 48, 320);

  rects.start = { x: 48, y: 420, w: 400, h: 104 };
  drawButton(ctx, rects.start, "Enter the chasm", false);

  // Preview weapon — tip up, full hilt/pommel visible
  if (model.selectedClass === "spear") {
    drawShardspear(ctx, width - 208, 355, -Math.PI / 2, model.selectedSkin, 190);
  } else {
    drawShardblade(ctx, width - 208, 355, -Math.PI / 2, model.selectedSkin, 170);
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

  drawChasmBackdrop(
    ctx,
    width,
    height,
    groundY,
    slope,
    snap.distance,
    snap.stormLevel,
    snap.waterHeight,
    snap.time,
  );

  if (snap.barracksScreenX !== null) {
    drawBarracks(ctx, width, height, groundY, snap.barracksScreenX);
  }

  // Ground / slope
  ctx.fillStyle = '#2c3a2e';
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY - slope);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  drawChasmFloorDetail(ctx, width, groundY, slope, snap.distance);

  // Water
  if (snap.waterHeight > 0) {
    const wh = snap.waterHeight * (height * 0.35);
    ctx.fillStyle = 'rgba(60, 120, 180, 0.45)';
    ctx.fillRect(0, height - wh, width, wh);
  }

  // Rain
  if (snap.stormLevel > 0) {
    ctx.strokeStyle = 'rgba(180, 200, 255, 0.35)';
    ctx.beginPath();
    const drops = Math.round((40 + snap.stormLevel * 25) * 3);
    for (let i = 0; i < drops; i++) {
      const x = ((i * 37 + snap.time * 120) % width);
      const y = ((i * 23 + snap.time * 400) % height);
      ctx.moveTo(x, y);
      ctx.lineTo(x + 2, y + 10);
    }
    ctx.stroke();
  }

  // Lightning flash
  if (snap.stormLevel > 0 && Math.floor(snap.time * 3) % 17 === 0) {
    ctx.fillStyle = 'rgba(220, 230, 255, 0.15)';
    ctx.fillRect(0, 0, width, height);
  }

  const feetY = entityY + 64;

  // Corpse scrolls away behind the MC while stormlight is absorbed
  if (snap.corpseVisual && snap.corpseScreenX !== null) {
    drawEnemySprite(
      ctx,
      snap.corpseVisual,
      snap.corpseScreenX,
      entityY,
      {
        progress: 0,
        style: "fast",
        combat: false,
        fallT: snap.enemyFallT,
        feetY,
      },
    );
  }

  // Boss flee: body without claw runs off; claw stays and sheds light
  if (snap.fleeScreenX !== null) {
    drawChasmfiend(ctx, snap.fleeScreenX, entityY - 8, {
      showClaw: false,
      clawAngle: -Math.PI * 0.85,
      scale: 2,
    });
  }
  if (snap.clawScreenX !== null) {
    drawDroppedClaw(
      ctx,
      snap.clawScreenX,
      entityY + 40,
      snap.clawDropT,
      2,
    );
  }

  // Player
  drawMainCharacter(ctx, playerX, entityY);
  if (snap.playerAbsorbGlow > 0) {
    drawAbsorbAura(ctx, playerX, entityY + 20, snap.playerAbsorbGlow, snap.time);
  }

  {
    const weaponClass = snap.weaponClass ?? "greatsword";
    const progress = snap.phase === "combat" ? snap.playerProgress : 0;
    drawPlayerWeapon(
      ctx,
      playerX + 8,
      entityY + 22,
      weaponClass,
      snap.playerStyle,
      progress,
      snap.skin ?? "skin_a",
      1,
    );
  }

  const showEnemy = snap.enemyScreenX !== null && snap.enemyVisual !== null;
  const drawEnemyX = snap.enemyScreenX ?? enemyX;
  if (showEnemy) {
    const visual = snap.enemyVisual!;
    const progress = snap.phase === "combat" ? (snap.enemyProgress ?? 0) : 0;
    const style = snap.enemyStyle ?? "fast";
    drawEnemySprite(ctx, visual, drawEnemyX, entityY, {
      progress,
      style,
      combat: snap.phase === "combat",
      fallT: 0,
      feetY,
    });

    if (snap.tauntLine && snap.tauntAlpha > 0) {
      drawSpeechBubble(
        ctx,
        drawEnemyX + (visual === "chasmfiend" ? 36 : visual === "snail" ? 28 : 22),
        entityY - (visual === "chasmfiend" ? 20 : 8),
        snap.tauntLine,
        snap.tauntAlpha,
      );
    }
  }

  // Stormlight spheres zipping from corpse/claw → MC
  const sphereFromX = snap.clawScreenX ?? snap.corpseScreenX ?? drawEnemyX;
  for (const s of snap.spheres) {
    if (!s.visible) continue;
    const fromX = sphereFromX + s.jitterX;
    const fromY = entityY + 18 + s.jitterY;
    const toX = playerX;
    const toY = entityY + 16;
    const u = s.flyT * s.flyT * (3 - 2 * s.flyT);
    const sx = fromX + (toX - fromX) * u;
    const sy = fromY + (toY - fromY) * u - Math.sin(u * Math.PI) * 18;
    drawStormlightSphere(ctx, sx, sy, 1 - u * 0.15);
  }

  // HUD stormlight
  ctx.fillStyle = '#e8eefc';
  ctx.font = '16px Georgia';
  if (model.combatTest) {
    ctx.fillText(
      `Combat test — kills: ${model.combatTest.kills}  deaths: ${model.combatTest.deaths}`,
      16,
      28,
    );
    ctx.fillStyle = '#a8b8d8';
    ctx.fillText('Q = fast · E = heavy · S = defend · AI switches at start of its next swing', 16, 52);

    ctx.fillStyle = '#e8eefc';
    ctx.font = '14px Georgia';
    ctx.fillText('Enemy AI:', 16, height - 58);
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
    ctx.fillText(`Stormlight: ${snap.stormlightRun}`, 16, 28);
    if (snap.godMode) {
      ctx.fillStyle = '#ffd28a';
      ctx.font = '14px Georgia';
      ctx.fillText('GOD MODE — invincible · one-shot', 16, 50);
    }
  }

  if (snap.phase === 'intro' || snap.phase === 'barracks') {
    const line = snap.dialogueLines[Math.min(snap.dialogueIndex, snap.dialogueLines.length - 1)];
    ctx.fillStyle = 'rgba(10, 14, 28, 0.75)';
    ctx.fillRect(40, height - 120, width - 80, 80);
    ctx.fillStyle = '#e8eefc';
    ctx.font = '18px Georgia';
    ctx.fillText(line, 60, height - 75);
    rects.advance = { x: width - 200, y: height - 100, w: 140, h: 40 };
    drawButton(ctx, rects.advance, 'Continue', false);
  }

  if (snap.phase === 'barracks') {
    const gx =
      snap.barracksScreenX !== null
        ? snap.barracksScreenX + snap.guardScreenOffsetX
        : width * 0.62;
    drawAlethiGuard(ctx, gx, entityY);
  } else if (
    snap.phase === 'exit' &&
    snap.barracksScreenX !== null &&
    snap.barracksScreenX < width * 0.7
  ) {
    drawAlethiGuard(ctx, snap.barracksScreenX + snap.guardScreenOffsetX, entityY);
  }

  if (snap.phase === 'walk' || snap.phase === 'exit') {
    ctx.fillStyle = '#a8b8d8';
    ctx.font = '16px Georgia';
    ctx.fillText(
      snap.phase === 'exit'
        ? 'Climbing out…'
        : snap.corpseVisual || snap.clawScreenX
          ? 'Stormlight gathers…'
          : 'Walking the chasm…',
      16,
      56,
    );
  }

  if (snap.fadeAlpha > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${snap.fadeAlpha})`;
    ctx.fillRect(0, 0, width, height);
    if (snap.epilogueText) {
      ctx.fillStyle = '#e8eefc';
      ctx.font = '28px Georgia';
      const tw = ctx.measureText(snap.epilogueText).width;
      ctx.globalAlpha = Math.min(1, snap.fadeAlpha * 1.4);
      ctx.fillText(snap.epilogueText, (width - tw) / 2, height * 0.48);
      ctx.globalAlpha = 1;
    }
  }

  if (snap.phase === 'combat' && snap.enemyHp !== null) {
    const fade = snap.uiFade;
    ctx.globalAlpha = fade;

    if (snap.tutorial) {
      ctx.fillStyle = 'rgba(10, 14, 28, 0.55)';
      const tw = Math.min(520, width - 80);
      const tx = (width - tw) / 2;
      const ty = height * 0.14;
      ctx.fillRect(tx, ty, tw, 44);
      ctx.fillStyle = '#e8eefc';
      ctx.font = '20px Georgia';
      const text = snap.tutorial;
      const metrics = ctx.measureText(text);
      ctx.fillText(text, tx + (tw - metrics.width) / 2, ty + 28);
    }

    for (const b of layout.styleButtons) {
      const active = snap.playerStyle === b.style;
      drawButton(ctx, b.rect, b.label, active);
    }

    drawBar(ctx, playerX - 40, entityY - 92, 80, 8, snap.playerHp / snap.playerMaxHp, '#6dffa8');
    drawBar(
      ctx,
      drawEnemyX - 40,
      entityY - 92,
      80,
      8,
      snap.enemyHp / (snap.enemyMaxHp ?? 1),
      '#ff6d6d',
    );

    const hitT = tuning.HIT_WINDOW_T;
    drawAttackProgress(ctx, playerX - 40, entityY - 78, 80, 7, snap.playerProgress, hitT, '#9db7ff');
    drawAttackProgress(
      ctx,
      drawEnemyX - 40,
      entityY - 78,
      80,
      7,
      snap.enemyProgress ?? 0,
      hitT,
      '#e8a0a0',
    );

    ctx.fillStyle = '#e8eefc';
    ctx.font = '14px Georgia';
    ctx.fillText(snap.enemyStyle ?? '', drawEnemyX - 20, entityY - 100);

    ctx.globalAlpha = 1;
  }

  for (const f of snap.floatTexts) {
    const t = f.age / f.life;
    const alpha = 1 - t;
    const rise = t * 48;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = 'bold 18px Georgia';
    ctx.fillStyle = f.kind === 'heal' ? '#5dff8a' : '#6db0ff';
    ctx.fillText(f.text, f.xN * width, f.yN * height - rise);
  }
  ctx.globalAlpha = 1;

  if (snap.phase === 'won' || snap.phase === 'dead') {
    ctx.fillStyle = 'rgba(10, 14, 28, 0.8)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#e8eefc';
    ctx.font = '32px Georgia';
    ctx.fillText(snap.phase === 'won' ? 'You won' : 'Game over', width / 2 - 80, height / 2 - 40);
    ctx.font = '18px Georgia';
    ctx.fillText(`Stormlight gathered: ${snap.stormlightRun}`, width / 2 - 100, height / 2);
    rects.backToSelect = { x: width / 2 - 90, y: height / 2 + 30, w: 180, h: 44 };
    drawButton(ctx, rects.backToSelect, 'Continue', false);
  }

  return rects;
}

function stormMood(stormLevel: number, waterHeight: number): number {
  return Math.min(1, Math.max(stormLevel * 0.18, waterHeight / 0.88));
}

function drawChasmBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  groundY: number,
  slope: number,
  distance: number,
  stormLevel: number,
  waterHeight: number,
  time: number,
): void {
  const scrollFar = distance * 0.25;
  const scrollNear = distance * 0.55;
  const wallTop = 40;
  const mood = stormMood(stormLevel, waterHeight);
  void height;

  for (let i = -1; i < 10; i++) {
    const x = ((i * 160 - scrollFar) % (width + 160) + (width + 160)) % (width + 160) - 80;
    const shade = 18 + ((i * 17) % 10);
    ctx.fillStyle = `rgb(${shade + 8},${shade + 12},${shade + 22})`;
    ctx.fillRect(x, wallTop, 70, groundY - wallTop - 20);
    ctx.fillStyle = `rgb(${shade},${shade + 4},${shade + 14})`;
    ctx.fillRect(x + 12, wallTop + 30, 18, groundY - wallTop - 80);
  }

  // God-rays + a touch of orange — sunny cue without brightening the chasm
  if (mood < 0.72) {
    drawGodRays(ctx, width, groundY, time, 1 - mood / 0.72);
  }

  for (let i = -1; i < 8; i++) {
    const x = ((i * 220 - scrollNear) % (width + 220) + (width + 220)) % (width + 220) - 110;
    const h = 90 + ((i * 37) % 70);
    const gy = groundY - slope * (x / Math.max(1, width));
    ctx.fillStyle = stormLevel > 1 ? '#1c2838' : '#243044';
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + 28, gy - h);
    ctx.lineTo(x + 55, gy - h * 0.7);
    ctx.lineTo(x + 70, gy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.moveTo(x + 30, gy - 10);
    ctx.lineTo(x + 36, gy - h * 0.55);
    ctx.stroke();
  }

  ctx.fillStyle = '#152030';
  for (let i = -1; i < 14; i++) {
    const x = ((i * 95 - scrollFar * 1.2) % (width + 95) + (width + 95)) % (width + 95) - 40;
    const h = 24 + ((i * 13) % 40);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 14, h);
    ctx.lineTo(x + 28, 0);
    ctx.closePath();
    ctx.fill();
  }
}

/** Soft shafts of sunlight pouring into the dark chasm from the rim above. */
function drawGodRays(
  ctx: CanvasRenderingContext2D,
  width: number,
  groundY: number,
  time: number,
  alpha: number,
): void {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const cx = width * 0.48;
  const top = -20;
  for (let i = 0; i < 7; i++) {
    const sway = Math.sin(time * 0.7 + i * 0.9) * 12;
    const mid = cx + (i - 3) * 56 + sway;
    const halfTop = 8 + (i % 3) * 3;
    const halfBot = 28 + (i % 4) * 12;
    const a = alpha * (0.028 + (i % 3) * 0.008);
    ctx.fillStyle = `rgba(255, 170, 90, ${a})`;
    ctx.beginPath();
    ctx.moveTo(mid - halfTop, top);
    ctx.lineTo(mid + halfTop, top);
    ctx.lineTo(mid + halfBot + sway * 0.3, groundY + 20);
    ctx.lineTo(mid - halfBot + sway * 0.3, groundY + 20);
    ctx.closePath();
    ctx.fill();
  }
  // Subtle orange rim-light wash — keeps the scene dark
  const wash = ctx.createRadialGradient(cx, groundY * 0.35, 10, cx, groundY * 0.45, width * 0.38);
  wash.addColorStop(0, `rgba(255, 140, 60, ${0.045 * alpha})`);
  wash.addColorStop(1, "rgba(255, 140, 60, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, groundY + 20);
  ctx.restore();
}

function drawChasmFloorDetail(
  ctx: CanvasRenderingContext2D,
  width: number,
  groundY: number,
  slope: number,
  distance: number,
): void {
  const scroll = distance;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let i = -1; i < 16; i++) {
    const x = ((i * 80 - scroll) % (width + 80) + (width + 80)) % (width + 80) - 40;
    const gy = groundY - slope * (x / Math.max(1, width));
    ctx.fillRect(x, gy + 8, 36 + (i % 3) * 10, 6);
    ctx.fillRect(x + 10, gy + 22, 18, 4);
  }
}

function drawEnemySprite(
  ctx: CanvasRenderingContext2D,
  visual: import("../sim/encounters").EnemyVisual,
  x: number,
  entityY: number,
  opts: {
    progress: number;
    style: import("../sim/types").Style;
    combat: boolean;
    fallT: number;
    feetY: number;
  },
): void {
  const drawBody = () => {
    if (visual === "chasmfiend") {
      const clawAngle =
        opts.combat && opts.style !== "defend"
          ? clawSwingAngle(opts.progress, -1)
          : -Math.PI * 0.85;
      drawChasmfiend(ctx, x, entityY - 8, {
        clawAngle,
        style: opts.style,
        attackProgress: opts.progress,
        scale: 2,
        showClaw: true,
      });
    } else if (visual === "snail") {
      drawSnail(ctx, x, entityY, {
        style: opts.style,
        attackProgress: opts.combat ? opts.progress : 0,
      });
    } else {
      drawAlethiGuard(ctx, x, entityY);
      if (opts.combat) {
        const pose = weaponPoseForStyle("greatsword", opts.style, opts.progress, -1);
        drawGenericBlade(
          ctx,
          x - 8 + pose.offsetX,
          entityY + 22 + pose.offsetY,
          pose.angle,
        );
      }
    }
  };

  if (opts.fallT > 0) {
    ctx.save();
    ctx.translate(x, opts.feetY);
    ctx.rotate(opts.fallT * (Math.PI / 2));
    ctx.translate(-x, -opts.feetY);
    drawBody();
    ctx.restore();
  } else {
    drawBody();
  }
}

/** Soft stormlight glow + fog wisps around the MC while absorbing. */
function drawAbsorbAura(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  glow: number,
  time: number,
): void {
  const a = Math.min(1, glow);
  ctx.save();
  ctx.globalAlpha = a * 0.55;
  const g = ctx.createRadialGradient(x, y, 4, x, y, 48);
  g.addColorStop(0, "rgba(180, 220, 255, 0.9)");
  g.addColorStop(0.45, "rgba(120, 180, 255, 0.35)");
  g.addColorStop(1, "rgba(120, 180, 255, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 48, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = a * 0.4;
  ctx.strokeStyle = "rgba(200, 230, 255, 0.7)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    const ang = time * 1.4 + i * 1.3;
    const r = 18 + (i % 3) * 6;
    const fx = x + Math.cos(ang) * r;
    const fy = y - 8 - ((time * 22 + i * 11) % 28);
    ctx.beginPath();
    ctx.ellipse(fx, fy, 5, 9, ang * 0.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStormlightSphere(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.fillStyle = "rgba(160, 210, 255, 0.35)";
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d8ecff";
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x - 1, y - 1.2, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Small flavor speech bubble to the right of an NPC. */
function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  text: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha) * 0.9;
  ctx.font = "12px Georgia";
  const padX = 8;
  const padY = 5;
  const tw = ctx.measureText(text).width;
  const bw = tw + padX * 2;
  const bh = 18 + padY;
  const bx = anchorX;
  const by = anchorY - bh;

  ctx.fillStyle = "rgba(18, 22, 34, 0.72)";
  ctx.strokeStyle = "rgba(180, 190, 210, 0.35)";
  ctx.lineWidth = 1;
  roundRect(ctx, bx, by, bw, bh, 6);
  ctx.fill();
  ctx.stroke();

  // Tail pointing left toward the speaker
  ctx.beginPath();
  ctx.moveTo(bx, by + bh * 0.55);
  ctx.lineTo(bx - 7, by + bh * 0.7);
  ctx.lineTo(bx + 2, by + bh * 0.78);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#b8c2d4";
  ctx.fillText(text, bx + padX, by + padY + 12);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function emptyRects(): UiRects {
  return {
    start: null,
    greatsword: null,
    spear: null,
    skinA: null,
    skinB: null,
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
  const fontSize = r.h >= 80 ? 28 : r.h < 24 ? 12 : 16;
  ctx.font = `${fontSize}px Georgia`;
  const metrics = ctx.measureText(label);
  ctx.fillText(
    label,
    r.x + (r.w - metrics.width) / 2,
    r.y + r.h / 2 + fontSize * 0.35,
  );
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
