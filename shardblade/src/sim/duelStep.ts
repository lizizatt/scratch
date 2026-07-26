import type { AttackResult, Combatant } from "./combat";
import { resolveHit } from "./combat";
import type { EncounterRuntime } from "./encounters";

export type TickCombatantsOptions = {
  /** Skip encounter.tickAi (combat-test uses swing-cycle brain instead). */
  skipEncounterAi?: boolean;
  /** Invoked at the start of each new enemy swing, before its hit resolves. */
  onEnemyNewSwing?: () => void;
};

/**
 * Shared auto-attack step: AI → player hit → enemy hit.
 * Caller handles death / victory / respawn.
 */
export function tickCombatants(
  dt: number,
  player: Combatant,
  encounter: EncounterRuntime,
  opts: TickCombatantsOptions = {},
): AttackResult[] {
  if (!opts.skipEncounterAi) {
    encounter.tickAi(dt, player.cooldown.style);
  }
  const results: AttackResult[] = [];

  if (!player.dead) {
    const playerHit = player.cooldown.tick(dt);
    if (playerHit && !encounter.enemy.dead) {
      results.push(resolveHit(player, encounter.enemy, playerHit));
    }
  }

  if (!encounter.enemy.dead && !player.dead) {
    const enemyHit = encounter.enemy.cooldown.tick(dt, {
      onNewSwing: opts.onEnemyNewSwing,
    });
    if (enemyHit) {
      results.push(resolveHit(encounter.enemy, player, enemyHit));
    }
  }

  return results;
}
