import { tuning } from "../data/tuning";
import type { AttackResult } from "./combat";
import { createCombatant, resolveHit, type Combatant } from "./combat";
import {
  ENCOUNTER_ORDER,
  spawnEncounter,
  type EncounterKind,
  type EncounterRuntime,
} from "./encounters";
import type { SkinId, Style, WeaponClass } from "./types";

export type RunPhase =
  | "select"
  | "intro"
  | "walk"
  | "combat"
  | "storm"
  | "won"
  | "dead";

export type RunIntent =
  | { type: "startRun"; weaponClass: WeaponClass; skin: SkinId }
  | { type: "advanceDialogue" }
  | { type: "setStyle"; style: Style };

export type RunSnapshot = {
  phase: RunPhase;
  time: number;
  distance: number;
  screensTraversed: number;
  encounterIndex: number;
  stormlightRun: number;
  stormlightMeta: number;
  dialogueIndex: number;
  dialogueLines: string[];
  weaponClass: WeaponClass | null;
  skin: SkinId | null;
  playerStyle: Style;
  playerHp: number;
  playerMaxHp: number;
  enemyHp: number | null;
  enemyMaxHp: number | null;
  enemyStyle: Style | null;
  enemyKind: EncounterKind | null;
  uiFade: number;
  stormLevel: number;
  waterHeight: number;
};

const INTRO_LINES = [
  "A scarred figure stumbles into the chasm… and finds a blade that hums.",
  "\"You're awake? Then we climb. Together.\"",
];

export type RunSimOptions = {
  /** Starting meta stormlight (retained across runs). */
  stormlightMeta?: number;
  playerMaxHp?: number;
};

/**
 * Full run state machine. Pure — advance with tick(dt) and intents.
 */
export class RunSim {
  phase: RunPhase = "select";
  time = 0;
  distance = 0;
  screensTraversed = 0;
  encounterIndex = 0;
  stormlightRun = 0;
  stormlightMeta: number;
  dialogueIndex = 0;
  dialogueLines = INTRO_LINES;
  weaponClass: WeaponClass | null = null;
  skin: SkinId | null = null;
  player: Combatant;
  encounter: EncounterRuntime | null = null;
  combatElapsed = 0;
  uiFade = 0;
  stormLevel = 0;
  stormTimer = 0;
  readonly playerMaxHp: number;
  lastAttacks: AttackResult[] = [];

  constructor(opts: RunSimOptions = {}) {
    this.stormlightMeta = opts.stormlightMeta ?? 0;
    this.playerMaxHp = opts.playerMaxHp ?? tuning.BASE_ENEMY_HP * 2;
    this.player = createCombatant("player", this.playerMaxHp, "fast");
  }

  get walkSpeed(): number {
    return tuning.SCREEN_WIDTH_PX / tuning.WALK_SECONDS_PER_SCREEN;
  }

  get waterHeight(): number {
    // 0 at start; rises with storm level (spectacle / chase vibe).
    return Math.min(1, this.stormLevel * 0.22);
  }

  dispatch(intent: RunIntent): void {
    switch (intent.type) {
      case "startRun":
        if (this.phase !== "select" && this.phase !== "won" && this.phase !== "dead") {
          return;
        }
        this.beginRun(intent.weaponClass, intent.skin);
        break;
      case "advanceDialogue":
        if (this.phase === "intro") {
          this.dialogueIndex += 1;
          if (this.dialogueIndex >= this.dialogueLines.length) {
            this.phase = "walk";
          }
        }
        break;
      case "setStyle":
        this.player.cooldown.setStyle(intent.style);
        break;
    }
  }

  private beginRun(weaponClass: WeaponClass, skin: SkinId): void {
    this.phase = "intro";
    this.time = 0;
    this.distance = 0;
    this.screensTraversed = 0;
    this.encounterIndex = 0;
    this.stormlightRun = 0;
    this.dialogueIndex = 0;
    this.weaponClass = weaponClass;
    this.skin = skin;
    this.player = createCombatant("player", this.playerMaxHp, "fast");
    this.encounter = null;
    this.combatElapsed = 0;
    this.uiFade = 0;
    this.stormLevel = 0;
    this.stormTimer = 0;
    this.lastAttacks = [];
  }

  private startCombat(): void {
    const kind = ENCOUNTER_ORDER[this.encounterIndex];
    if (!kind) {
      this.finishWin();
      return;
    }
    this.encounter = spawnEncounter(kind);
    this.phase = "combat";
    this.combatElapsed = 0;
    this.uiFade = 0;
  }

  private finishWin(): void {
    this.stormlightMeta += this.stormlightRun;
    this.phase = "won";
    this.encounter = null;
  }

  private finishDead(): void {
    this.stormlightMeta += this.stormlightRun;
    this.phase = "dead";
    this.encounter = null;
  }

  private onEnemyDefeated(): void {
    if (!this.encounter) return;
    this.stormlightRun += this.encounter.def.stormlightReward;
    this.encounterIndex += 1;
    if (this.encounterIndex >= ENCOUNTER_ORDER.length) {
      this.finishWin();
      return;
    }
    this.phase = "storm";
    this.stormLevel += 1;
    this.stormTimer = 1.0; // brief beat before walking again
    this.encounter = null;
  }

  tick(dt: number): void {
    if (this.phase === "select" || this.phase === "won" || this.phase === "dead") {
      return;
    }
    if (this.phase === "intro") {
      this.time += dt;
      return;
    }

    this.time += dt;

    if (this.phase === "storm") {
      this.stormTimer -= dt;
      if (this.stormTimer <= 0) {
        this.phase = "walk";
      }
      return;
    }

    if (this.phase === "walk") {
      this.distance += this.walkSpeed * dt;
      const screens = Math.floor(this.distance / tuning.SCREEN_WIDTH_PX);
      if (screens > this.screensTraversed) {
        this.screensTraversed = screens;
        this.startCombat();
      }
      return;
    }

    if (this.phase === "combat" && this.encounter) {
      this.combatElapsed += dt;
      const fadeDur = tuning.COMBAT_UI_FADE_S;
      this.uiFade = fadeDur <= 0 ? 1 : Math.min(1, this.combatElapsed / fadeDur);

      this.encounter.tickAi(dt, this.player.cooldown.style);

      this.lastAttacks = [];
      const playerHit = this.player.cooldown.tick(dt);
      if (playerHit && !this.encounter.enemy.dead) {
        const result = resolveHit(this.player, this.encounter.enemy, playerHit);
        this.lastAttacks.push(result);
      }

      if (!this.encounter.enemy.dead && !this.player.dead) {
        const enemyHit = this.encounter.enemy.cooldown.tick(dt);
        if (enemyHit) {
          const result = resolveHit(this.encounter.enemy, this.player, enemyHit);
          this.lastAttacks.push(result);
        }
      }

      if (this.player.dead) {
        this.finishDead();
        return;
      }
      if (this.encounter.enemy.dead) {
        this.onEnemyDefeated();
      }
    }
  }

  snapshot(): RunSnapshot {
    return {
      phase: this.phase,
      time: this.time,
      distance: this.distance,
      screensTraversed: this.screensTraversed,
      encounterIndex: this.encounterIndex,
      stormlightRun: this.stormlightRun,
      stormlightMeta: this.stormlightMeta,
      dialogueIndex: this.dialogueIndex,
      dialogueLines: this.dialogueLines,
      weaponClass: this.weaponClass,
      skin: this.skin,
      playerStyle: this.player.cooldown.style,
      playerHp: this.player.hp,
      playerMaxHp: this.player.maxHp,
      enemyHp: this.encounter?.enemy.hp ?? null,
      enemyMaxHp: this.encounter?.enemy.maxHp ?? null,
      enemyStyle: this.encounter?.enemy.cooldown.style ?? null,
      enemyKind: this.encounter?.def.kind ?? null,
      uiFade: this.uiFade,
      stormLevel: this.stormLevel,
      waterHeight: this.waterHeight,
    };
  }
}

export type StyleScheduleEntry = { t: number; style: Style };

/**
 * Headless harness for agents: drive a full run with a style schedule.
 */
export function simulateRun(opts: {
  styleSchedule?: StyleScheduleEntry[];
  stormlightMeta?: number;
  playerMaxHp?: number;
  maxTime?: number;
  dt?: number;
  /** Auto-advance intro dialogue immediately. */
  skipIntro?: boolean;
}): { result: "won" | "dead" | "timeout"; snap: RunSnapshot; sim: RunSim } {
  const sim = new RunSim({
    stormlightMeta: opts.stormlightMeta,
    playerMaxHp: opts.playerMaxHp,
  });
  sim.dispatch({ type: "startRun", weaponClass: "greatsword", skin: "skin_a" });

  if (opts.skipIntro !== false) {
    while (sim.phase === "intro") {
      sim.dispatch({ type: "advanceDialogue" });
    }
  }

  const dt = opts.dt ?? 0.05;
  const maxTime = opts.maxTime ?? 120;
  const schedule = [...(opts.styleSchedule ?? [])].sort((a, b) => a.t - b.t);
  let si = 0;
  let t = 0;

  while (t < maxTime && sim.phase !== "won" && sim.phase !== "dead") {
    while (si < schedule.length && schedule[si].t <= t) {
      sim.dispatch({ type: "setStyle", style: schedule[si].style });
      si += 1;
    }
    sim.tick(dt);
    t += dt;
  }

  const result =
    sim.phase === "won" ? "won" : sim.phase === "dead" ? "dead" : "timeout";
  return { result, snap: sim.snapshot(), sim };
}
