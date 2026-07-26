import type { SkinId } from "../sim/types";
import { tuning } from "../data/tuning";

/**
 * Overhead swing: ~30° past vertical (behind) → horizontal (front) at impact.
 * `facing` 1 = right (player), -1 = left (enemy).
 */
export function overheadSwingAngle(
  progress: number,
  facing: 1 | -1,
  hitWindowT: number = tuning.HIT_WINDOW_T,
): number {
  const start = -Math.PI / 2 - facing * (Math.PI / 6);
  const end = facing > 0 ? 0 : -Math.PI;
  const t = Math.min(1, Math.max(0, progress / Math.max(1e-6, hitWindowT)));
  const s = t * t * (3 - 2 * t); // smoothstep
  return start + (end - start) * s;
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
  length = 110,
): void {
  const colors = skinMetal(skin);
  ctx.save();
  ctx.translate(gripX, gripY);
  ctx.rotate(angle);

  // Soft glow
  ctx.strokeStyle = colors.glow;
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(length, 0);
  ctx.stroke();

  // Blade body
  ctx.fillStyle = colors.blade;
  ctx.beginPath();
  ctx.moveTo(16, -5);
  ctx.lineTo(length - 8, -3);
  ctx.lineTo(length, 0);
  ctx.lineTo(length - 8, 3);
  ctx.lineTo(16, 5);
  ctx.closePath();
  ctx.fill();

  // Bright edge line
  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(20, -1);
  ctx.lineTo(length - 6, 0);
  ctx.stroke();

  // Crossguard
  ctx.fillStyle = "#9aa8c4";
  ctx.fillRect(10, -12, 8, 24);
  // Grip
  ctx.fillStyle = "#3a3040";
  ctx.fillRect(-6, -4, 18, 8);
  // Pommel
  ctx.beginPath();
  ctx.arc(-8, 0, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#c5d4ff";
  ctx.fill();

  ctx.restore();
}

/** Plain steel greatsword for enemies. */
export function drawGenericBlade(
  ctx: CanvasRenderingContext2D,
  gripX: number,
  gripY: number,
  angle: number,
  length = 100,
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
