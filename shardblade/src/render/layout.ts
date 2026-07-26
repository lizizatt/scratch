import type { RunSnapshot } from "../sim/run";
import { playerStyleButtons, type StyleButtonLayout } from "./hitTest";

export type CombatLayout = {
  groundY: number;
  playerX: number;
  enemyX: number;
  entityY: number;
  slope: number;
  styleButtons: StyleButtonLayout[];
};

/** Shared combat positions for draw + click hit-tests. */
export function layoutCombat(
  width: number,
  height: number,
  snap: Pick<RunSnapshot, "stormLevel">,
): CombatLayout {
  const groundY = height * 0.72;
  const slope = snap.stormLevel * 18;
  const playerX = width * 0.28;
  const enemyX = width * 0.62;
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
