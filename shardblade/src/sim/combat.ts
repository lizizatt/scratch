import { tuning } from "../data/tuning";
import { GREATSWORD, type WeaponMoveset } from "../data/weapons";
import { CooldownTracker, type HitEvent } from "./cooldown";
import type { Style } from "./types";

export type CombatantId = "player" | "enemy";

export type Combatant = {
  id: CombatantId;
  hp: number;
  maxHp: number;
  cooldown: CooldownTracker;
  dead: boolean;
};

export type AttackResult = {
  attacker: CombatantId;
  defender: CombatantId;
  style: Style;
  damage: number;
  parried: boolean;
  lethal: boolean;
};

export type CombatSnapshot = {
  player: CombatantView;
  enemy: CombatantView;
  uiFade: number; // 0..1 visibility of combat HUD
  elapsed: number;
  over: boolean;
  winner: CombatantId | null;
};

export type CombatantView = {
  id: CombatantId;
  hp: number;
  maxHp: number;
  style: Style;
  progress: number;
  dead: boolean;
};

function view(c: Combatant): CombatantView {
  return {
    id: c.id,
    hp: c.hp,
    maxHp: c.maxHp,
    style: c.cooldown.style,
    progress: c.cooldown.progress,
    dead: c.dead,
  };
}

export function createCombatant(
  id: CombatantId,
  maxHp: number,
  style: Style = "fast",
  moveset: WeaponMoveset = GREATSWORD,
): Combatant {
  return {
    id,
    hp: maxHp,
    maxHp,
    cooldown: new CooldownTracker(style, 0, moveset),
    dead: false,
  };
}

export type ResolveHitOptions = {
  /** Ignore incoming damage (god mode on the defender). */
  invincible?: boolean;
  /** Bypass parry and deal enough to kill (god mode on the attacker). */
  oneShot?: boolean;
};

/**
 * Resolve a hit against a defender.
 * Same-style attacks are parried when PARRY_SAME_STYLE is enabled.
 * Defend blocks both fast and heavy.
 */
export function resolveHit(
  attacker: Combatant,
  defender: Combatant,
  hit: HitEvent,
  opts: ResolveHitOptions = {},
): AttackResult {
  if (opts.invincible || defender.dead) {
    return {
      attacker: attacker.id,
      defender: defender.id,
      style: hit.style,
      damage: 0,
      parried: false,
      lethal: false,
    };
  }

  if (opts.oneShot && hit.damage > 0) {
    const damage = defender.hp;
    defender.hp = 0;
    defender.dead = true;
    return {
      attacker: attacker.id,
      defender: defender.id,
      style: hit.style,
      damage,
      parried: false,
      lethal: true,
    };
  }

  const defending = defender.cooldown.style === "defend";
  const sameStyle = hit.style === defender.cooldown.style;
  const parried =
    hit.damage > 0 &&
    (defending || (tuning.PARRY_SAME_STYLE && sameStyle));
  let damage = 0;
  let lethal = false;

  if (!parried) {
    damage = hit.damage;
    defender.hp = Math.max(0, defender.hp - damage);
    if (defender.hp <= 0) {
      defender.dead = true;
      lethal = true;
    }
  }

  return {
    attacker: attacker.id,
    defender: defender.id,
    style: hit.style,
    damage,
    parried,
    lethal,
  };
}

/**
 * Headless duel: both sides auto-attack.
 * Order: player fires first within a tick, then enemy (documented).
 */
export class CombatDuel {
  player: Combatant;
  enemy: Combatant;
  elapsed = 0;
  uiFade = 0;
  log: AttackResult[] = [];

  constructor(playerHp: number, enemyHp: number, playerStyle: Style = "fast", enemyStyle: Style = "fast") {
    this.player = createCombatant("player", playerHp, playerStyle);
    this.enemy = createCombatant("enemy", enemyHp, enemyStyle);
  }

  setPlayerStyle(style: Style): void {
    this.player.cooldown.setStyle(style);
  }

  setEnemyStyle(style: Style): void {
    this.enemy.cooldown.setStyle(style);
  }

  get over(): boolean {
    return this.player.dead || this.enemy.dead;
  }

  get winner(): CombatantId | null {
    if (this.player.dead && this.enemy.dead) return null;
    if (this.enemy.dead) return "player";
    if (this.player.dead) return "enemy";
    return null;
  }

  tick(dt: number): AttackResult[] {
    if (this.over) return [];

    this.elapsed += dt;
    const fadeDur = tuning.COMBAT_UI_FADE_S;
    this.uiFade = fadeDur <= 0 ? 1 : Math.min(1, this.elapsed / fadeDur);

    const results: AttackResult[] = [];

    if (!this.player.dead) {
      const hit = this.player.cooldown.tick(dt);
      if (hit && !this.enemy.dead) {
        const result = resolveHit(this.player, this.enemy, hit);
        results.push(result);
        this.log.push(result);
      }
    }

    if (!this.enemy.dead && !this.player.dead) {
      const hit = this.enemy.cooldown.tick(dt);
      if (hit && !this.player.dead) {
        const result = resolveHit(this.enemy, this.player, hit);
        results.push(result);
        this.log.push(result);
      }
    }

    return results;
  }

  snapshot(): CombatSnapshot {
    return {
      player: view(this.player),
      enemy: view(this.enemy),
      uiFade: this.uiFade,
      elapsed: this.elapsed,
      over: this.over,
      winner: this.winner,
    };
  }
}
