import { tuning } from "../data/tuning";
import { movesetFor } from "../data/weapons";
import type { AttackResult } from "./combat";
import { createCombatant, type Combatant } from "./combat";
import { tickCombatants } from "./duelStep";
import {
  ENCOUNTER_ORDER,
  encounterDef,
  spawnEncounter,
  type EncounterKind,
  type EncounterRuntime,
  type EnemyVisual,
} from "./encounters";
import type { SkinId, Style, WeaponClass } from "./types";
import {
  CHASM_BARRACKS_STEPS,
  CHASM_DIALOGUE,
  CHASM_INTRO_STEPS,
  CHASM_STEP,
  type ChasmStepId,
} from "./scenes/chasmSteps";
import { CHASM_CINE } from "./scenes/chasmCine";

export type RunPhase =
  | "select"
  | "intro"
  | "walk"
  | "combat"
  | "exit"
  | "barracks"
  | "epilogue"
  | "won"
  | "dead";

/** Which scripted adventure this sim belongs to. */
export const CHASM_SCENE_ID = "chasm" as const;

export type RunIntent =
  | { type: "startRun"; weaponClass: WeaponClass; skin: SkinId }
  | { type: "advanceDialogue" }
  | { type: "setStyle"; style: Style };

export type FloatText = {
  id: number;
  text: string;
  kind: "heal" | "storm";
  xN: number;
  yN: number;
  age: number;
  life: number;
};

/** One dropped stormlight sphere during the loot/death beat. */
export type SphereFx = {
  id: number;
  age: number;
  delay: number;
  hold: number;
  fly: number;
  /** Pixel jitter from the corpse center when spawned. */
  jitterX: number;
  jitterY: number;
  collected: boolean;
};

export type SphereSnapshot = {
  id: number;
  /** 0 = at corpse (after delay), 1 = at player. */
  flyT: number;
  /** False while still waiting to appear. */
  visible: boolean;
  jitterX: number;
  jitterY: number;
};

export type RunSnapshot = {
  phase: RunPhase;
  time: number;
  distance: number;
  screensTraversed: number;
  encounterIndex: number;
  stormlightRun: number;
  dialogueIndex: number;
  dialogueLines: string[];
  weaponClass: WeaponClass | null;
  skin: SkinId | null;
  playerStyle: Style;
  playerHp: number;
  playerMaxHp: number;
  playerProgress: number;
  /** 0–1 absorb glow while stormlight spheres heal the MC. */
  playerAbsorbGlow: number;
  enemyHp: number | null;
  enemyMaxHp: number | null;
  enemyStyle: Style | null;
  enemyKind: EncounterKind | null;
  enemyVisual: EnemyVisual | null;
  enemyProgress: number | null;
  /** Screen X for the standing/fighting enemy (null if none visible). */
  enemyScreenX: number | null;
  /** Corpse left behind after a kill (scrolls away while walking). */
  corpseVisual: EnemyVisual | null;
  corpseScreenX: number | null;
  /** 0 upright → 1 tipped 90° right (death fall on the corpse). */
  enemyFallT: number;
  /** Boss: detached claw on the ground. */
  clawScreenX: number | null;
  clawDropT: number;
  /** Boss: fleeing body (no claw). */
  fleeScreenX: number | null;
  /** Barracks / epilogue presentation. */
  showBarracks: boolean;
  /** Screen X of barracks cluster origin (scrolls in during exit). */
  barracksScreenX: number | null;
  /** Guard offset from barracks origin (from chasm_cine.json). */
  guardScreenOffsetX: number;
  fadeAlpha: number;
  epilogueText: string | null;
  /** Scene this run implements. */
  sceneId: typeof CHASM_SCENE_ID;
  /** Flavor line shown briefly as a speech bubble once combat starts. */
  tauntLine: string | null;
  /** 0–1 opacity for the speech bubble. */
  tauntAlpha: number;
  tutorial: string | null;
  uiFade: number;
  stormLevel: number;
  waterHeight: number;
  /** Dev: /god-mode — invincible + one-shot. */
  godMode: boolean;
  /** Narrative cursor — mirrors scripts/chasm.md */
  stepId: ChasmStepId;
  floatTexts: FloatText[];
  spheres: SphereSnapshot[];
};

const INTRO_LINES =
  CHASM_CINE.introLines.length > 0
    ? CHASM_CINE.introLines
    : CHASM_INTRO_STEPS.map((id) => CHASM_DIALOGUE[id]);
const BARRACKS_LINES =
  CHASM_CINE.barracksLine.length > 0
    ? [CHASM_CINE.barracksLine]
    : CHASM_BARRACKS_STEPS.map((id) => CHASM_DIALOGUE[id]);

const EPILOGUE_DURATION_S = 2.8;

export type RunSimOptions = {
  playerMaxHp?: number;
  /** Invincible player + one-shot enemies (story walkthrough). */
  godMode?: boolean;
};

export function isGodModePath(pathname: string): boolean {
  return parseGodModeLaunch(pathname) !== null;
}

export type GodModeLaunch = {
  /** Which scene to start in. */
  startScene: "chasm" | "castle";
};

/**
 * `/god-mode`, `/god-mode/scene-1` → chasm with cheats.
 * `/god-mode/scene-2` → castle chase (cheats on for the shell / return to chasm).
 */
export function parseGodModeLaunch(pathname: string): GodModeLaunch | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  const parts = normalized.split("/").filter(Boolean);
  const godIdx = parts.indexOf("god-mode");
  if (godIdx < 0) return null;
  const rest = parts.slice(godIdx + 1);
  if (rest[0] === "scene-2") return { startScene: "castle" };
  return { startScene: "chasm" };
}


function combatEnemyStanceX(): number {
  return tuning.SCREEN_WIDTH_PX * 0.5 + tuning.COMBAT_TIP_REACH / 2;
}

/** World X where the next foe stands still until you walk into range. */
export function enemyWorldX(encounterIndex: number): number {
  return (encounterIndex + 1) * tuning.SCREEN_WIDTH_PX + combatEnemyStanceX();
}

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
  dialogueIndex = 0;
  dialogueLines = INTRO_LINES;
  weaponClass: WeaponClass | null = null;
  skin: SkinId | null = null;
  player: Combatant;
  encounter: EncounterRuntime | null = null;
  combatElapsed = 0;
  uiFade = 0;
  stormLevel = 0;
  /** Smoothed flood fill 0–1 (lerps toward stormLevel target). */
  waterHeight = 0;
  walkHealAcc = 0;
  floatTexts: FloatText[] = [];
  private nextFloatId = 1;
  readonly playerMaxHp: number;
  lastAttacks: AttackResult[] = [];
  /** Corpse / stormlight absorb overlay (runs during walk/combat). */
  lootAge = 0;
  enemyFallT = 0;
  lootVisual: EnemyVisual | null = null;
  /** World X of the fallen foe — screen X = lootWorldX - distance. */
  lootWorldX = 0;
  spheres: SphereFx[] = [];
  playerAbsorbGlow = 0;
  /** Boss flee / claw-drop loot (instead of tipping over). */
  bossFlee = false;
  fleeWorldX = 0;
  clawWorldX = 0;
  clawDropT = 0;
  exitStartDistance = 0;
  /** World X of the barracks building cluster (set on exit). */
  barracksWorldX = 0;
  epilogueAge = 0;
  /** Headless / tests: skip barracks cinematic and bank win immediately. */
  skipExitCinematic = false;
  /** Invincible + one-shot (see /god-mode). */
  readonly godMode: boolean;

  constructor(opts: RunSimOptions = {}) {
    this.playerMaxHp = opts.playerMaxHp ?? tuning.BASE_ENEMY_HP * 2;
    this.godMode = opts.godMode ?? false;
    this.player = createCombatant("player", this.playerMaxHp, "fast");
  }

  get walkSpeed(): number {
    return tuning.SCREEN_WIDTH_PX / tuning.WALK_SECONDS_PER_SCREEN;
  }

  private targetWaterHeight(): number {
    return Math.min(1, this.stormLevel * 0.22);
  }

  private tickWaterRise(dt: number): void {
    const target = this.targetWaterHeight();
    if (this.waterHeight === target) return;
    const step = tuning.WATER_RISE_PER_S * dt;
    if (this.waterHeight < target) {
      this.waterHeight = Math.min(target, this.waterHeight + step);
    } else {
      this.waterHeight = Math.max(target, this.waterHeight - step);
    }
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
        } else if (this.phase === "barracks") {
          this.dialogueIndex += 1;
          if (this.dialogueIndex >= this.dialogueLines.length) {
            this.beginEpilogue();
          }
        } else if (this.phase === "epilogue") {
          this.finishWin();
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
    this.dialogueLines = INTRO_LINES;
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
    this.waterHeight = 0;
    this.walkHealAcc = 0;
    this.floatTexts = [];
    this.lastAttacks = [];
    this.clearLoot();
    this.exitStartDistance = 0;
    this.barracksWorldX = 0;
    this.epilogueAge = 0;
  }

  private clearLoot(): void {
    this.lootAge = 0;
    this.enemyFallT = 0;
    this.lootVisual = null;
    this.lootWorldX = 0;
    this.spheres = [];
    this.playerAbsorbGlow = 0;
    this.bossFlee = false;
    this.fleeWorldX = 0;
    this.clawWorldX = 0;
    this.clawDropT = 0;
  }

  private hasActiveLoot(): boolean {
    return this.lootVisual !== null || this.bossFlee || this.spheres.some((s) => !s.collected);
  }

  private worldToScreen(worldX: number): number | null {
    const sx = worldX - this.distance;
    const w = tuning.SCREEN_WIDTH_PX;
    if (sx < -160 || sx > w + 160) return null;
    return sx;
  }

  private corpseScreenX(): number | null {
    if (!this.lootVisual) return null;
    return this.worldToScreen(this.lootWorldX);
  }

  private clawScreenX(): number | null {
    if (!this.bossFlee) return null;
    return this.worldToScreen(this.clawWorldX);
  }

  private fleeScreenX(): number | null {
    if (!this.bossFlee) return null;
    const sx = this.worldToScreen(this.fleeWorldX);
    // Hide once clear of the right edge so despawn isn't visible.
    if (sx === null || sx > tuning.SCREEN_WIDTH_PX + 80) return null;
    return sx;
  }

  /** Screenplay step id for scripts/chasm.md */
  resolveStepId(): ChasmStepId {
    switch (this.phase) {
      case "intro":
        return (
          CHASM_INTRO_STEPS[Math.min(this.dialogueIndex, CHASM_INTRO_STEPS.length - 1)] ??
          CHASM_STEP.INTRO_FIND_BLADE
        );
      case "walk":
        return this.hasActiveLoot() ? CHASM_STEP.LOOT_AFTER_KILL : CHASM_STEP.WALK_OPEN;
      case "combat": {
        const kind = this.encounter?.def.kind ?? ENCOUNTER_ORDER[this.encounterIndex] ?? "fight1";
        return `${CHASM_STEP.COMBAT_PREFIX}${kind}` as ChasmStepId;
      }
      case "exit":
        return CHASM_STEP.EXIT_CLIMB;
      case "barracks":
        return CHASM_STEP.BARRACKS_RESCUED;
      case "epilogue":
        return CHASM_STEP.EPILOGUE_YEARS_LATER;
      case "won":
        return CHASM_STEP.WON;
      case "dead":
        return CHASM_STEP.DEAD;
      default:
        return CHASM_STEP.WALK_OPEN;
    }
  }

  private barracksScreenX(): number | null {
    if (
      this.phase !== "exit" &&
      this.phase !== "barracks" &&
      this.phase !== "epilogue"
    ) {
      return null;
    }
    return this.worldToScreen(this.barracksWorldX);
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
    }
  }

  private startEncounter(): void {
    const kind = ENCOUNTER_ORDER[this.encounterIndex];
    if (!kind) {
      this.finishWin();
      return;
    }
    this.encounter = spawnEncounter(kind);
    // First fight defaults to heavy so the opening snail tutorial matches.
    if (this.encounterIndex === 0) {
      this.player.cooldown.setStyle("heavy");
    }
    this.encounter.beginSwing(this.player.cooldown.style);
    this.phase = "combat";
    this.combatElapsed = 0;
    this.uiFade = 0;
  }

  private finishWin(): void {
    this.phase = "won";
    this.encounter = null;
    this.clearLoot();
  }

  private finishDead(): void {
    this.phase = "dead";
    this.encounter = null;
    this.clearLoot();
  }

  private onEnemyDefeated(): void {
    if (!this.encounter) return;
    const def = this.encounter.def;
    this.encounterIndex += 1;
    if (this.encounterIndex < ENCOUNTER_ORDER.length) {
      this.stormLevel += 1;
    }
    if (def.visual === "chasmfiend") {
      this.beginBossFleeLoot(def.stormlightReward);
    } else {
      this.beginLoot(def.visual, def.stormlightReward);
    }
    this.encounter = null;
    this.walkHealAcc = 0;
    this.phase = "walk";
  }

  private beginLoot(visual: EnemyVisual, reward: number): void {
    this.lootAge = 0;
    this.enemyFallT = 0;
    this.bossFlee = false;
    this.lootVisual = visual;
    this.lootWorldX = this.distance + combatEnemyStanceX();
    this.playerAbsorbGlow = 0;
    this.spawnSpheres(reward);
  }

  /** Claw drops (and sheds stormlight); the fiend flees without tipping over. */
  private beginBossFleeLoot(reward: number): void {
    this.lootAge = 0;
    this.enemyFallT = 0;
    this.clawDropT = 0;
    this.bossFlee = true;
    this.lootVisual = null;
    const stance = this.distance + combatEnemyStanceX();
    this.lootWorldX = stance;
    this.clawWorldX = stance - 10;
    this.fleeWorldX = stance + 20;
    this.playerAbsorbGlow = 0;
    this.spawnSpheres(reward);
  }

  private spawnSpheres(reward: number): void {
    this.spheres = [];
    for (let i = 0; i < reward; i++) {
      this.spheres.push({
        id: this.nextFloatId++,
        age: 0,
        delay: i * tuning.SPHERE_STAGGER_S,
        hold: tuning.SPHERE_HOLD_S,
        fly: tuning.SPHERE_FLY_S,
        jitterX: ((i * 47) % 28) - 14,
        jitterY: ((i * 31) % 22) - 14,
        collected: false,
      });
    }
  }

  private collectSphere(): void {
    // Always bank the sphere first (blue +1). Healing drains stormlight separately.
    this.stormlightRun += 1;
    this.playerAbsorbGlow = 1;
    this.spawnFloat("+1", "storm");
  }

  private tickLoot(dt: number): void {
    if (!this.hasActiveLoot()) return;
    this.lootAge += dt;
    if (this.bossFlee) {
      this.clawDropT = Math.min(1, this.lootAge / tuning.DEATH_FALL_S);
      this.fleeWorldX += this.walkSpeed * tuning.BOSS_FLEE_SPEED_MULT * dt;
    } else {
      this.enemyFallT = Math.min(1, this.lootAge / tuning.DEATH_FALL_S);
    }
    this.playerAbsorbGlow = Math.max(0, this.playerAbsorbGlow - dt / 0.45);

    let pending = 0;
    for (const s of this.spheres) {
      if (s.collected) continue;
      s.age += dt;
      const done = s.delay + s.hold + s.fly;
      if (s.age >= done) {
        s.collected = true;
        this.collectSphere();
      } else {
        pending += 1;
      }
    }

    const settleDone = this.bossFlee
      ? this.clawDropT >= 1
      : this.enemyFallT >= 1;
    if (pending === 0 && settleDone) {
      this.finishLoot();
    }
  }

  private finishLoot(): void {
    const afterBoss = this.encounterIndex >= ENCOUNTER_ORDER.length;
    this.clearLoot();
    if (!afterBoss) return;
    if (this.skipExitCinematic) {
      this.finishWin();
      return;
    }
    this.beginExit();
  }

  private beginExit(): void {
    this.phase = "exit";
    this.exitStartDistance = this.distance;
    this.barracksWorldX =
      this.distance +
      tuning.SCREEN_WIDTH_PX * CHASM_CINE.exitWalkScreens +
      CHASM_CINE.barracksWorldOffset;
  }

  private beginBarracks(): void {
    this.phase = "barracks";
    this.dialogueLines = BARRACKS_LINES;
    this.dialogueIndex = 0;
  }

  private beginEpilogue(): void {
    this.phase = "epilogue";
    this.epilogueAge = 0;
  }

  /** Screen X of the next standing foe while walking, or fight stance X in combat. */
  private resolveEnemyScreenX(): number | null {
    if (this.phase === "combat") {
      return combatEnemyStanceX();
    }
    if (this.phase !== "walk") return null;
    if (this.encounterIndex >= ENCOUNTER_ORDER.length) return null;
    const sx = enemyWorldX(this.encounterIndex) - this.distance;
    const w = tuning.SCREEN_WIDTH_PX;
    if (sx < -80 || sx > w + 120) return null;
    return sx;
  }

  private resolveVisibleEnemyKind(): EncounterKind | null {
    if (this.encounter) return this.encounter.def.kind;
    if (this.phase === "walk" && this.resolveEnemyScreenX() !== null) {
      return ENCOUNTER_ORDER[this.encounterIndex] ?? null;
    }
    return null;
  }

  private resolveVisibleEnemyVisual(): EnemyVisual | null {
    if (this.encounter) return this.encounter.def.visual;
    const kind = this.resolveVisibleEnemyKind();
    return kind ? encounterDef(kind).visual : null;
  }

  tick(dt: number): void {
    if (this.phase === "select" || this.phase === "won" || this.phase === "dead") {
      return;
    }
    if (this.phase === "intro" || this.phase === "barracks") {
      this.time += dt;
      this.tickFloats(dt);
      this.tickWaterRise(dt);
      return;
    }
    if (this.phase === "epilogue") {
      this.time += dt;
      this.epilogueAge += dt;
      this.tickFloats(dt);
      this.tickWaterRise(dt);
      if (this.epilogueAge >= EPILOGUE_DURATION_S) {
        this.finishWin();
      }
      return;
    }

    this.time += dt;
    this.tickFloats(dt);
    this.tickLoot(dt);
    this.tickWaterRise(dt);

    if (this.phase === "walk") {
      this.tickWalkHeal(dt);
      this.distance += this.walkSpeed * dt;
      const screens = Math.floor(this.distance / tuning.SCREEN_WIDTH_PX);
      if (screens > this.screensTraversed) {
        this.screensTraversed = screens;
        this.startEncounter();
      }
      return;
    }

    if (this.phase === "exit") {
      this.tickWalkHeal(dt);
      this.distance += this.walkSpeed * dt;
      if (
        this.distance >=
        this.exitStartDistance + tuning.SCREEN_WIDTH_PX * CHASM_CINE.exitWalkScreens
      ) {
        this.beginBarracks();
      }
      return;
    }

    if (this.phase === "combat" && this.encounter) {
      this.combatElapsed += dt;
      const fadeDur = tuning.COMBAT_UI_FADE_S;
      this.uiFade = fadeDur <= 0 ? 1 : Math.min(1, this.combatElapsed / fadeDur);

      this.lastAttacks = tickCombatants(dt, this.player, this.encounter, {
        godMode: this.godMode,
      });

      if (this.player.dead) {
        this.finishDead();
        return;
      }
      if (this.encounter.enemy.dead) {
        this.onEnemyDefeated();
        this.tickLoot(dt);
        this.distance += this.walkSpeed * dt;
      }
    }
  }

  snapshot(): RunSnapshot {
    const enemyKind = this.resolveVisibleEnemyKind();
    const enemyScreenX = this.resolveEnemyScreenX();
    const showTaunt =
      this.phase === "combat" &&
      this.encounter !== null &&
      this.combatElapsed < tuning.TAUNT_DURATION_S;
    const corpseScreenX = this.corpseScreenX();
    return {
      phase: this.phase,
      time: this.time,
      distance: this.distance,
      screensTraversed: this.screensTraversed,
      encounterIndex: this.encounterIndex,
      stormlightRun: this.stormlightRun,
      dialogueIndex: this.dialogueIndex,
      dialogueLines: this.dialogueLines,
      weaponClass: this.weaponClass,
      skin: this.skin,
      playerStyle: this.player.cooldown.style,
      playerHp: this.player.hp,
      playerMaxHp: this.player.maxHp,
      playerProgress: this.player.cooldown.progress,
      playerAbsorbGlow: this.playerAbsorbGlow,
      enemyHp: this.encounter?.enemy.hp ?? null,
      enemyMaxHp: this.encounter?.enemy.maxHp ?? null,
      enemyStyle: this.encounter?.enemy.cooldown.style ?? null,
      enemyKind,
      enemyVisual: this.resolveVisibleEnemyVisual(),
      enemyProgress: this.encounter?.enemy.cooldown.progress ?? null,
      enemyScreenX,
      corpseVisual: corpseScreenX !== null ? this.lootVisual : null,
      corpseScreenX,
      enemyFallT: this.lootVisual ? this.enemyFallT : 0,
      clawScreenX: this.clawScreenX(),
      clawDropT: this.bossFlee ? this.clawDropT : 0,
      fleeScreenX: this.fleeScreenX(),
      showBarracks: this.phase === "barracks" || this.phase === "epilogue" || this.phase === "exit",
      barracksScreenX: this.barracksScreenX(),
      guardScreenOffsetX: CHASM_CINE.guardScreenOffsetX,
      fadeAlpha:
        this.phase === "epilogue"
          ? Math.min(1, this.epilogueAge / 1.1)
          : 0,
      epilogueText:
        this.phase === "epilogue" ? "Several years later" : null,
      sceneId: CHASM_SCENE_ID,
      tauntLine: showTaunt ? this.encounter!.def.taunt : null,
      tauntAlpha: showTaunt ? tauntAlpha(this.combatElapsed) : 0,
      tutorial: this.phase === "combat" ? (this.encounter?.def.tutorial ?? null) : null,
      uiFade: this.uiFade,
      stormLevel: this.stormLevel,
      waterHeight: this.waterHeight,
      godMode: this.godMode,
      stepId: this.resolveStepId(),
      floatTexts: this.floatTexts.map((f) => ({ ...f })),
      spheres: this.spheres
        .filter((s) => !s.collected)
        .map((s) => {
          const appearAt = s.delay;
          const flyAt = s.delay + s.hold;
          const visible = s.age >= appearAt;
          const flyT =
            s.age <= flyAt
              ? 0
              : Math.min(1, (s.age - flyAt) / Math.max(1e-6, s.fly));
          return {
            id: s.id,
            flyT,
            visible,
            jitterX: s.jitterX,
            jitterY: s.jitterY,
          };
        }),
    };
  }
}

export type StyleScheduleEntry = { t: number; style: Style };

export function simulateRun(opts: {
  styleSchedule?: StyleScheduleEntry[];
  playerMaxHp?: number;
  maxTime?: number;
  dt?: number;
  skipIntro?: boolean;
}): { result: "won" | "dead" | "timeout"; snap: RunSnapshot; sim: RunSim } {
  const sim = new RunSim({
    playerMaxHp: opts.playerMaxHp,
  });
  sim.skipExitCinematic = true;
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

function tauntAlpha(elapsed: number): number {
  const dur = tuning.TAUNT_DURATION_S;
  const fadeOut = 0.85;
  if (elapsed >= dur - fadeOut) return Math.max(0, (dur - elapsed) / fadeOut);
  return 1;
}
