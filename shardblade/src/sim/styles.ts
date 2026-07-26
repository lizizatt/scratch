import { tuning } from "../data/tuning";
import type { Style } from "./types";

export function attackPeriod(style: Style): number {
  return style === "fast" ? tuning.FAST_ATTACK_PERIOD : tuning.HEAVY_ATTACK_PERIOD;
}

export function attackDamage(style: Style): number {
  return style === "fast" ? tuning.FAST_DAMAGE : tuning.HEAVY_DAMAGE;
}
