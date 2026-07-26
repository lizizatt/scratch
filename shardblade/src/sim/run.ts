import { tuning } from "../data/tuning";
import { movesetFor } from "../data/weapons";
import type { AttackResult } from "./combat";
import { createCombatant, type Combatant } from "./combat";
import { tickCombatants } from "./duelStep";
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
  | "approach"
  | "combat"
  | "storm"
  | "won"
  | "dead";

export type RunIntent =
  | { type: "startRun"; weaponClass: WeaponClass; skin: SkinId }
  | { type: "advanceDialogue" }
  | { type: "setStyle"; style: Style };

export type FloatText = {
  id: number;
  text: string;
  kind: "heal" | "storm";
  /** Normalized 0–1 along the player (for layout). */
  xN: number;
  yN: number;
  age: number;
  life: number;
};

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
  playerProgress: number;
  enemyHp: number | null;
  enemyMaxHp: number | null;
  enemyStyle: Style | null;
  enemyKind: EncounterKind | null;
  enemyProgress: number | null;
  /** 0 = off-screen right, 1 = in fight stance. */
  enemyApproach: number | null;
  tutorial: string | null;
  uiFade: number;
  stormLevel: number;
  waterHeight: number;
  floatTexts: FloatText[];
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
  approachT = 0;
  walkHealAcc = 0;
  floatTexts: FloatText[] = [];
  private nextFloatId = 1;
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
    this.player = createCombatant(
      "player",
      this.playerMaxHp,
      "fast",
      movesetFor(weaponClass),
    );
    this.encounter = null;
    this.combatElapsed = 0;
    this.uiFade = 0;
    this.stormLevel = 0;
    this.stormTimer = 0;
    this.approachT = 0;
    this.walkHealAcc = 0;
    this.floatTexts = [];
    this.lastAttacks = [];
  }

  private spawnFloat(text: string, kind: "heal" | "storm"): void {
    const jitter = (this.nextFloatId % 5) * 0.02;
    this.floatTexts.push({
      id: this.nextFloatId++,
      text,
      kind,
      xN: 0.28 + (kind === "heal" ? -0.04 : 0.04) + jitter,
      yN: 0.42,
      age: 0,
      life: 1.1,
    });
  }

  private tickFloats(dt: number): void {
    for (const f of this.floatTexts) {
      f.age += dt;
    }
    this.floatTexts = this.floatTexts.filter((f) => f.age < f.life);
  }

  private tickWalkHeal(dt: number): void {
    if (this.player.hp >= this.player.maxHp || this.stormlightRun <= 0) {
      this.walkHealAcc = 0;
      return;
    }
    this.walkHealAcc += dt;
    while (
      this.walkHealAcc >= tuning.WALK_HEAL_INTERVAL_S &&
      this.player.hp < this.player.maxHp &&
      this.stormlightRun > 0
    ) {
      this.walkHealAcc -= tuning.WALK_HEAL_INTERVAL_S;
      this.stormlightRun -= 1;
      this.player.hp += 1;
      this.spawnFloat("+1", "heal");
      this.spawnFloat("-1", "storm");
    }
  }

  private startApproach(): void {
    const kind = ENCOUNTER_ORDER[this.encounterIndex];
    if (!kind) {
      this.finishWin();
      return;
    }
    this.encounter = spawnEncounter(kind);
    this.phase = "approach";
    this.approachT = 0;
    this.combatElapsed = 0;
    this.uiFade = 0;
  }

  private startCombat(): void {
    if (!this.encounter) return;
    this.encounter.beginSwing(this.player.cooldown.style);
    this.phase = "combat";
    this.combatElapsed = 0;
    this.uiFade = 0;
    this.approachT = 1;
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
    this.stormTimer = 1.0;
    this.encounter = null;
    this.approachT = 0;
    this.walkHealAcc = 0;
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
    this.tickFloats(dt);

    if (this.phase === "storm") {
      this.stormTimer -= dt;
      if (this.stormTimer <= 0) {
        this.phase = "walk";
        this.walkHealAcc = 0;
      }
      return;
    }

    if (this.phase === "walk") {
      this.tickWalkHeal(dt);
      this.distance += this.walkSpeed * dt;
      const screens = Math.floor(this.distance / tuning.SCREEN_WIDTH_PX);
      if (screens > this.screensTraversed) {
        this.screensTraversed = screens;
        this.startApproach();
      }
      return;
    }

    if (this.phase === "approach") {
      this.approachT += dt / tuning.APPROACH_SECONDS;
      if (this.approachT >= 1) {
        this.approachT = 1;
        this.startCombat();
      }
      return;
    }

    if (this.phase === "combat" && this.encounter) {
      this.combatElapsed += dt;
      const fadeDur = tuning.COMBAT_UI_FADE_S;
      this.uiFade = fadeDur <= 0 ? 1 : Math.min(1, this.combatElapsed / fadeDur);

      this.lastAttacks = tickCombatants(dt, this.player, this.encounter);

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
    const approaching = this.phase === "approach" || this.phase === "combat";
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
      playerProgress: this.player.cooldown.progress,
      enemyHp: this.encounter?.enemy.hp ?? null,
      enemyMaxHp: this.encounter?.enemy.maxHp ?? null,
      enemyStyle: this.encounter?.enemy.cooldown.style ?? null,
      enemyKind: this.encounter?.def.kind ?? null,
      enemyProgress: this.encounter?.enemy.cooldown.progress ?? null,
      enemyApproach: approaching ? Math.min(1, this.approachT) : null,
      tutorial: this.phase === "combat" ? (this.encounter?.def.tutorial ?? null) : null,
      uiFade: this.uiFade,
      stormLevel: this.stormLevel,
      waterHeight: this.waterHeight,
      floatTexts: this.floatTexts.map((f) => ({ ...f })),
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
