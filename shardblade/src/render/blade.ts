import type { SkinId, Style, WeaponClass } from "../sim/types";
import { tuning } from "../data/tuning";

/** Shared blade length so layout spacing matches drawn tips. */
export const COMBAT_BLADE_LENGTH = 110;

/** Horizontal tip reach from body center (grip offset + blade). */
export const COMBAT_TIP_REACH = tuning.COMBAT_TIP_REACH;

export type WeaponPose = {
  angle: number;
  /** Extra grip translation along the strike (thrust). */
  offsetX: number;
  offsetY: number;
};

function smooth01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Overhead swing: ~30° past vertical (behind) → horizontal (front) at impact.
 * Used for light / fast greatsword.
 */
export function overheadSwingAngle(
  progress: number,
  facing: 1 | -1,
  hitWindowT: number = tuning.HIT_WINDOW_T,
): number {
  const start = -Math.PI / 2 - facing * (Math.PI / 6);
  const end = facing > 0 ? 0 : -Math.PI;
  const t = smooth01(progress / Math.max(1e-6, hitWindowT));
  return start + (end - start) * t;
}

/**
 * Heavy greatsword: one continuous arc — full revolution that flows straight
 * into the downswing (no ease-out pause at the top).
 */
export function heavySwordPose(
  progress: number,
  facing: 1 | -1,
  hitWindowT: number = tuning.HIT_WINDOW_T,
): WeaponPose {
  const t = smooth01(progress / Math.max(1e-6, hitWindowT));
  const start = -Math.PI / 2 - facing * (Math.PI / 6);
  const end = facing > 0 ? 0 : -Math.PI;
  const angle = start + (facing * Math.PI * 2 + (end - start)) * t;
  return { angle, offsetX: 0, offsetY: 0 };
}

/** Light spear: quick horizontal stab, no flourish. */
export function stabPose(
  progress: number,
  facing: 1 | -1,
  hitWindowT: number = tuning.HIT_WINDOW_T,
): WeaponPose {
  const t = smooth01(progress / Math.max(1e-6, hitWindowT));
  const rest = facing > 0 ? 0 : -Math.PI;
  const pullBack = 20;
  const extend = 42;
  return {
    angle: rest,
    offsetX: facing * (-pullBack + t * (pullBack + extend)),
    offsetY: 2 - t * 4,
  };
}

/**
 * Heavy spear kata: starts horizontal at idle, full 360° spin, lands tip-forward at impact.
 */
export function thrustPose(
  progress: number,
  facing: 1 | -1,
  hitWindowT: number = tuning.HIT_WINDOW_T,
): WeaponPose {
  const t = smooth01(progress / Math.max(1e-6, hitWindowT));
  const rest = facing > 0 ? 0 : -Math.PI;
  const spin = facing * Math.PI * 2;
  const angle = rest + spin * t;

  const pullBack = 18;
  const extend = 40;
  const thrustT = smooth01(Math.max(0, (t - 0.15) / 0.85));
  return {
    angle,
    offsetX: facing * (-pullBack + thrustT * (pullBack + extend)),
    offsetY: 2 - thrustT * 4 + Math.sin(t * Math.PI * 2) * 5,
  };
}

/** Blade / spear pose for the active style. */
export function weaponPoseForStyle(
  weaponClass: WeaponClass,
  style: Style,
  progress: number,
  facing: 1 | -1,
): WeaponPose {
  if (style === "defend") {
    if (weaponClass === "spear") {
      return {
        angle: -Math.PI / 2 + facing * (Math.PI / 16),
        offsetX: facing * 4,
        offsetY: -6,
      };
    }
    return {
      angle: -Math.PI / 2 + facing * (Math.PI / 12),
      offsetX: 0,
      offsetY: 0,
    };
  }
  if (weaponClass === "spear") {
    return style === "heavy" ? thrustPose(progress, facing) : stabPose(progress, facing);
  }
  if (style === "heavy") {
    return heavySwordPose(progress, facing);
  }
  return {
    angle: overheadSwingAngle(progress, facing),
    offsetX: 0,
    offsetY: 0,
  };
}

/** @deprecated prefer weaponPoseForStyle — kept for tests / callers that only need angle. */
export function bladeAngleForStyle(
  style: Style,
  progress: number,
  facing: 1 | -1,
): number {
  return weaponPoseForStyle("greatsword", style, progress, facing).angle;
}

/** Chasmfiend claw arc (high behind → sweeping forward). */
export function clawSwingAngle(
  progress: number,
  facing: 1 | -1 = -1,
  hitWindowT: number = tuning.HIT_WINDOW_T,
): number {
  const start = -Math.PI / 2 - facing * (Math.PI / 5);
  const end = facing > 0 ? Math.PI / 10 : -Math.PI - Math.PI / 10;
  const t = smooth01(progress / Math.max(1e-6, hitWindowT));
  return start + (end - start) * t;
}

function skinMetal(skin: SkinId): { blade: string; glow: string; edge: string } {
  if (skin === "skin_b") {
    return { blade: "#ffe0b8", glow: "rgba(255, 180, 100, 0.45)", edge: "#fff6e8" };
  }
  return { blade: "#c8dcff", glow: "rgba(140, 180, 255, 0.5)", edge: "#f0f6ff" };
}

/** Living shardblade — long glowing greatsword along local +X from the grip. */
export function drawShardblade(
  ctx: CanvasRenderingContext2D,
  gripX: number,
  gripY: number,
  angle: number,
  skin: SkinId,
  length = COMBAT_BLADE_LENGTH,
): void {
  const colors = skinMetal(skin);
  ctx.save();
  ctx.translate(gripX, gripY);
  ctx.rotate(angle);

  ctx.strokeStyle = colors.glow;
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(length, 0);
  ctx.stroke();

  ctx.fillStyle = colors.blade;
  ctx.beginPath();
  ctx.moveTo(16, -5);
  ctx.lineTo(length - 8, -3);
  ctx.lineTo(length, 0);
  ctx.lineTo(length - 8, 3);
  ctx.lineTo(16, 5);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(20, -1);
  ctx.lineTo(length - 6, 0);
  ctx.stroke();

  ctx.fillStyle = "#9aa8c4";
  ctx.fillRect(10, -12, 8, 24);
  ctx.fillStyle = "#3a3040";
  ctx.fillRect(-6, -4, 18, 8);
  ctx.beginPath();
  ctx.arc(-8, 0, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#c5d4ff";
  ctx.fill();

  ctx.restore();
}

/** Living shardspear — shaft + glowing tip along local +X. */
export function drawShardspear(
  ctx: CanvasRenderingContext2D,
  gripX: number,
  gripY: number,
  angle: number,
  skin: SkinId,
  length = COMBAT_BLADE_LENGTH + 18,
): void {
  const colors = skinMetal(skin);
  ctx.save();
  ctx.translate(gripX, gripY);
  ctx.rotate(angle);

  // Soft shaft glow
  ctx.strokeStyle = colors.glow;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(length - 10, 0);
  ctx.stroke();

  // Wooden / bone shaft
  ctx.strokeStyle = "#5a4638";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(length * 0.62, 0);
  ctx.stroke();

  // Living metal tip
  ctx.fillStyle = colors.blade;
  ctx.beginPath();
  ctx.moveTo(length * 0.55, -3.5);
  ctx.lineTo(length - 4, -1.5);
  ctx.lineTo(length + 6, 0);
  ctx.lineTo(length - 4, 1.5);
  ctx.lineTo(length * 0.55, 3.5);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(length * 0.6, 0);
  ctx.lineTo(length + 2, 0);
  ctx.stroke();

  // Grip wrap
  ctx.fillStyle = "#2a2430";
  ctx.fillRect(-4, -5, 16, 10);
  ctx.fillStyle = "#c5d4ff";
  ctx.beginPath();
  ctx.arc(-8, 0, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Plain steel greatsword for enemies. */
export function drawGenericBlade(
  ctx: CanvasRenderingContext2D,
  gripX: number,
  gripY: number,
  angle: number,
  length = COMBAT_BLADE_LENGTH,
): void {
  ctx.save();
  ctx.translate(gripX, gripY);
  ctx.rotate(angle);

  ctx.fillStyle = "#8a9099";
  ctx.beginPath();
  ctx.moveTo(14, -4);
  ctx.lineTo(length - 6, -2.5);
  ctx.lineTo(length, 0);
  ctx.lineTo(length - 6, 2.5);
  ctx.lineTo(14, 4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#5c6168";
  ctx.fillRect(8, -10, 7, 20);
  ctx.fillStyle = "#2e2820";
  ctx.fillRect(-4, -3.5, 14, 7);
  ctx.fillStyle = "#6a7078";
  ctx.beginPath();
  ctx.arc(-6, 0, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function drawPlayerWeapon(
  ctx: CanvasRenderingContext2D,
  gripX: number,
  gripY: number,
  weaponClass: WeaponClass,
  style: Style,
  progress: number,
  skin: SkinId,
  facing: 1 | -1 = 1,
): void {
  const pose = weaponPoseForStyle(weaponClass, style, progress, facing);
  const x = gripX + pose.offsetX;
  const y = gripY + pose.offsetY;
  if (weaponClass === "spear") {
    drawShardspear(ctx, x, y, pose.angle, skin);
  } else {
    drawShardblade(ctx, x, y, pose.angle, skin);
  }
}
