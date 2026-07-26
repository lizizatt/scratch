import type { AttackResult, Combatant } from "./combat";
import { resolveHit } from "./combat";
import type { EncounterRuntime } from "./encounters";

export type TickCombatantsOptions = {
  /**
   * Called at the start of each new enemy swing.
   * Defaults to encounter.beginSwing(playerStyle).
   */
  onEnemyNewSwing?: () => void;
};

/**
 * Shared auto-attack step: player hit → enemy hit (swing-cycle AI on wrap).
 * Caller handles death / victory / respawn.
 */
export function tickCombatants(
  dt: number,
  player: Combatant,
  encounter: EncounterRuntime,
  opts: TickCombatantsOptions = {},
): AttackResult[] {
  const onEnemyNewSwing =
    opts.onEnemyNewSwing ??
    (() => encounter.beginSwing(player.cooldown.style));

  const results: AttackResult[] = [];

  if (!player.dead) {
    const playerHit = player.cooldown.tick(dt);
    if (playerHit && !encounter.enemy.dead) {
      results.push(resolveHit(player, encounter.enemy, playerHit));
    }
  }

  if (!encounter.enemy.dead && !player.dead) {
    const enemyHit = encounter.enemy.cooldown.tick(dt, {
      onNewSwing: onEnemyNewSwing,
    });
    if (enemyHit) {
      results.push(resolveHit(encounter.enemy, player, enemyHit));
    }
  }

  return results;
}
