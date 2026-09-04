/** Single source of truth for MVP balance knobs. */
export const tuning = {
  /** Must match render blade length + grip offset (tip reach to opponent chest). */
  COMBAT_TIP_REACH: 116,
  SCREEN_WIDTH_PX: 960,
  WALK_SECONDS_PER_SCREEN: 7.5,
  /** While walking, spend 1 stormlight to heal 1 HP this often (seconds). */
  WALK_HEAL_INTERVAL_S: 1.0,
  // Slowed ×2 from initial MVP so style reads are thinkable.
  // 5 fast or 3 heavy kills base HP exactly.
  FAST_ATTACK_PERIOD: 1.2,
  HEAVY_ATTACK_PERIOD: 2.4,
  /** Guard stance cycle (no damage); keeps the swing meter readable. */
  DEFEND_PERIOD: 1.2,
  FAST_DAMAGE: 3,
  HEAVY_DAMAGE: 5,
  DEFEND_DAMAGE: 0,
  BASE_ENEMY_HP: 15,
  CHASMFIEND_HP_MULT: 2,
  ENEMY3_MATCH_DELAY_S: 5,
  BOSS_MATCH_DELAY_S: 1,
  STORMLIGHT_PER_TRASH: 10,
  STORMLIGHT_PER_BOSS: 40,
  /** Scene 2 starting stormlight. */
  CASTLE_START_STORMLIGHT: 25,
  /** Stormlight spent per Tension click (Tighten / Release / Panic). */
  TENSION_COST: 5,
  /** Stormlight drained from the hallway sphere-brazier after the chase. */
  BRAZIER_STORMLIGHT: 15,
  PARRY_SAME_STYLE: true,
  COMBAT_UI_FADE_S: 0.4,
  /** Enemy flavor line over their head before combat starts. */
  TAUNT_DURATION_S: 2.4,
  /** How fast flood water catches up to the storm-level target (0–1 units / sec). */
  WATER_RISE_PER_S: 0.18,
  /** Chasmfiend flee speed as a multiple of walk speed (must clear the screen before loot ends). */
  BOSS_FLEE_SPEED_MULT: 7.5,
  /** Enemy tip-over death animation duration. */
  DEATH_FALL_S: 0.65,
  /** Stormlight sphere sits near the corpse before flying. */
  SPHERE_HOLD_S: 0.28,
  /** Sphere flight time into the MC. */
  SPHERE_FLY_S: 0.38,
  /** Stagger between successive sphere launches. */
  SPHERE_STAGGER_S: 0.045,
  /** Fraction of attack duration when damage is attempted (1 = end of swing / blade horizontal). */
  HIT_WINDOW_T: 1,
  /** Extra delay applied when switching from fast to heavy. */
  STYLE_SWITCH_PENALTY_S: 0.5,
} as const;

export type Tuning = typeof tuning;

export const TUNING_KEYS = [
  "COMBAT_TIP_REACH",
  "SCREEN_WIDTH_PX",
  "WALK_SECONDS_PER_SCREEN",
  "WALK_HEAL_INTERVAL_S",
  "FAST_ATTACK_PERIOD",
  "HEAVY_ATTACK_PERIOD",
  "DEFEND_PERIOD",
  "FAST_DAMAGE",
  "HEAVY_DAMAGE",
  "DEFEND_DAMAGE",
  "BASE_ENEMY_HP",
  "CHASMFIEND_HP_MULT",
  "ENEMY3_MATCH_DELAY_S",
  "BOSS_MATCH_DELAY_S",
  "STORMLIGHT_PER_TRASH",
  "STORMLIGHT_PER_BOSS",
  "CASTLE_START_STORMLIGHT",
  "TENSION_COST",
  "BRAZIER_STORMLIGHT",
  "PARRY_SAME_STYLE",
  "COMBAT_UI_FADE_S",
  "TAUNT_DURATION_S",
  "WATER_RISE_PER_S",
  "BOSS_FLEE_SPEED_MULT",
  "DEATH_FALL_S",
  "SPHERE_HOLD_S",
  "SPHERE_FLY_S",
  "SPHERE_STAGGER_S",
  "HIT_WINDOW_T",
  "STYLE_SWITCH_PENALTY_S",
] as const;
