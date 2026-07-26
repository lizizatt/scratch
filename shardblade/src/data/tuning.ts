/** Single source of truth for MVP balance knobs. */
export const tuning = {
  SCREEN_WIDTH_PX: 960,
  WALK_SECONDS_PER_SCREEN: 7.5,
  // Slowed ×2 from initial MVP so style reads are thinkable.
  // 5 fast or 3 heavy kills base HP exactly.
  FAST_ATTACK_PERIOD: 1.2,
  HEAVY_ATTACK_PERIOD: 2.4,
  FAST_DAMAGE: 3,
  HEAVY_DAMAGE: 5,
  BASE_ENEMY_HP: 15,
  CHASMFIEND_HP_MULT: 2,
  ENEMY3_MATCH_DELAY_S: 5,
  BOSS_MATCH_DELAY_S: 1,
  STORMLIGHT_PER_TRASH: 10,
  STORMLIGHT_PER_BOSS: 40,
  SPEAR_UNLOCK_COST: 50,
  PARRY_SAME_STYLE: true,
  COMBAT_UI_FADE_S: 0.4,
  /** Fraction of attack duration when damage is attempted (1 = end of swing / blade horizontal). */
  HIT_WINDOW_T: 1,
} as const;

export type Tuning = typeof tuning;

export const TUNING_KEYS = [
  "SCREEN_WIDTH_PX",
  "WALK_SECONDS_PER_SCREEN",
  "FAST_ATTACK_PERIOD",
  "HEAVY_ATTACK_PERIOD",
  "FAST_DAMAGE",
  "HEAVY_DAMAGE",
  "BASE_ENEMY_HP",
  "CHASMFIEND_HP_MULT",
  "ENEMY3_MATCH_DELAY_S",
  "BOSS_MATCH_DELAY_S",
  "STORMLIGHT_PER_TRASH",
  "STORMLIGHT_PER_BOSS",
  "SPEAR_UNLOCK_COST",
  "PARRY_SAME_STYLE",
  "COMBAT_UI_FADE_S",
  "HIT_WINDOW_T",
] as const;
