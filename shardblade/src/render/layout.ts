import type { RunSnapshot } from "../sim/run";
import { COMBAT_TIP_REACH } from "./blade";
import { playerStyleButtons, type StyleButtonLayout } from "./hitTest";

export type CombatLayout = {
  groundY: number;
  playerX: number;
  enemyX: number;
  entityY: number;
  slope: number;
  styleButtons: StyleButtonLayout[];
};

/**
 * Shared combat positions for draw + click hit-tests.
 * Fighters stand so horizontal blade tips meet the opponent's chest.
 */
export function layoutCombat(
  width: number,
  height: number,
  snap: Pick<RunSnapshot, "stormLevel">,
): CombatLayout {
  const groundY = height * 0.72;
  const slope = snap.stormLevel * 18;
  const mid = width * 0.5;
  const playerX = mid - COMBAT_TIP_REACH / 2;
  const enemyX = mid + COMBAT_TIP_REACH / 2;
  const entityY = groundY - 70 - (snap.stormLevel > 2 ? slope * 0.3 : 0);
  return {
    groundY,
    playerX,
    enemyX,
    entityY,
    slope,
    styleButtons: playerStyleButtons(playerX, entityY),
  };
}
