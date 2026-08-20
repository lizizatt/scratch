import { PITCH_CLASS_COUNT } from "./types";

export function updateHeatmap(
  current: readonly number[],
  chroma: readonly number[],
  elapsedSeconds: number,
  accumulationSeconds: number,
  fadeSeconds: number,
): readonly number[] {
  const peak = Math.max(...chroma, 0);
  const attack = 1 - Math.exp(-elapsedSeconds / accumulationSeconds);
  const decay = Math.exp(-elapsedSeconds / fadeSeconds);

  return Array.from({ length: PITCH_CLASS_COUNT }, (_, index) => {
    const previous = (current[index] ?? 0) * decay;
    const strength = peak > 0 ? (chroma[index] ?? 0) / peak : 0;
    return clamp01(previous + strength * attack * (1 - previous));
  });
}

export function emptyHeatmap(): readonly number[] {
  return new Array<number>(PITCH_CLASS_COUNT).fill(0);
}

export function logarithmicOpacity(strength: number, response: number): number {
  const clampedStrength = clamp01(strength);
  const clampedResponse = Math.max(response, Number.EPSILON);
  return Math.log1p(clampedResponse * clampedStrength) / Math.log1p(clampedResponse);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
