import { movesetFor } from "../data/weapons";
import { createCombatant, type AttackResult, type Combatant } from "./combat";
import { tickCombatants } from "./duelStep";
import { spawnEncounter, type EncounterRuntime } from "./encounters";
import type { RunSnapshot } from "./run";
import { SwingCycleBrain, type TestAiKind } from "./testAi";
import type { SkinId, Style, WeaponClass } from "./types";
import { tuning } from "../data/tuning";

export type CombatTestOptions = {
  playerMaxHp?: number;
  weaponClass?: WeaponClass;
  skin?: SkinId;
  aiKind?: TestAiKind;
};

/**
 * Infinite chasmfiend arena: always in combat, respawn player on death,
 * respawn boss on kill. Pure sim for /combat-test.
 */
export class CombatTestSim {
  time = 0;
  combatElapsed = 0;
  uiFade = 0;
  deaths = 0;
  kills = 0;
  weaponClass: WeaponClass;
  skin: SkinId;
  player: Combatant;
  encounter: EncounterRuntime;
  brain: SwingCycleBrain;
  lastAttacks: AttackResult[] = [];
  readonly playerMaxHp: number;

  constructor(opts: CombatTestOptions = {}) {
    this.playerMaxHp = opts.playerMaxHp ?? tuning.BASE_ENEMY_HP * 2;
    this.weaponClass = opts.weaponClass ?? "greatsword";
    this.skin = opts.skin ?? "skin_a";
    this.brain = new SwingCycleBrain(opts.aiKind ?? "alwaysFast");
    this.player = createCombatant(
      "player",
      this.playerMaxHp,
      "fast",
      movesetFor(this.weaponClass),
    );
    this.encounter = spawnEncounter("boss");
    this.uiFade = 1;
    this.applySwingDecision();
  }

  setStyle(style: Style): void {
    this.player.cooldown.setStyle(style);
  }

  setAiKind(kind: TestAiKind): void {
    this.brain.setKind(kind);
    // Takes effect at the beginning of the enemy's next swing cycle.
  }

  private applySwingDecision(): void {
    const next = this.brain.decide(this.player.cooldown.style);
    this.encounter.enemy.cooldown.setStyle(next);
  }

  private respawnPlayer(): void {
    const style = this.player.cooldown.style;
    this.player = createCombatant(
      "player",
      this.playerMaxHp,
      style,
      movesetFor(this.weaponClass),
    );
    this.deaths += 1;
    this.combatElapsed = 0;
  }

  private respawnBoss(): void {
    this.kills += 1;
    this.encounter = spawnEncounter("boss");
    this.combatElapsed = 0;
    this.applySwingDecision();
  }

  tick(dt: number): void {
    this.time += dt;
    this.combatElapsed += dt;
    const fadeDur = tuning.COMBAT_UI_FADE_S;
    this.uiFade = fadeDur <= 0 ? 1 : Math.min(1, this.combatElapsed / fadeDur);

    this.lastAttacks = tickCombatants(dt, this.player, this.encounter, {
      skipEncounterAi: true,
      onEnemyNewSwing: () => this.applySwingDecision(),
    });

    if (this.player.dead) {
      this.respawnPlayer();
      return;
    }
    if (this.encounter.enemy.dead) {
      this.respawnBoss();
    }
  }

  /** Snapshot shaped for the shared combat renderer. */
  snapshot(): RunSnapshot {
    return {
      phase: "combat",
      time: this.time,
      distance: 0,
      screensTraversed: 0,
      encounterIndex: 3,
      stormlightRun: 0,
      stormlightMeta: 0,
      dialogueIndex: 0,
      dialogueLines: [],
      weaponClass: this.weaponClass,
      skin: this.skin,
      playerStyle: this.player.cooldown.style,
      playerHp: this.player.hp,
      playerMaxHp: this.player.maxHp,
      playerProgress: this.player.cooldown.progress,
      enemyHp: this.encounter.enemy.hp,
      enemyMaxHp: this.encounter.enemy.maxHp,
      enemyStyle: this.encounter.enemy.cooldown.style,
      enemyKind: "boss",
      enemyProgress: this.encounter.enemy.cooldown.progress,
      uiFade: this.uiFade,
      stormLevel: 3,
      waterHeight: 0.5,
    };
  }
}

export function isCombatTestPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === "/combat-test" || normalized.endsWith("/combat-test");
}
