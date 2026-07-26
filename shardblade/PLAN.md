# Shardblade — Roguelite Planning Document

## Pitch

You are a lost **Shardblade**, found in a chasm by an escaped slave. You do not play as the wielder — you *are* the weapon. Each run, the wielder picks you up and walks right into the storm. You choose the weapon’s class (moveset), fight through identical chasm foes while a rising flood chases you upslope, face a baby chasmfiend, and either escape with **stormlight** or die and prestige it into unlocks.

Inspired by spren / living weapons from *The Stormlight Archive*, scoped as a short-session **roguelite** (meta-progression between runs; runs themselves are fixed-length MVP encounters).

---

## Goals

| Goal | MVP target |
|------|------------|
| Browser-first | Single static page or tiny web app; no native install |
| Maximally portable | TypeScript + HTML Canvas (or lightweight 2D lib); no GPU-only APIs required |
| Agent-testable | Game rules as pure modules with headless tests; rendering is a thin adapter |
| Short loop | Customize → intro → 3 trash fights + boss → win/lose → spend stormlight |

---

## MVP Scope vs Later

### In MVP

- One weapon class: **greatsword** (classic shardblade moveset)
- Two **skins** (visual only); hook for deeper sword-building later
- Meta currency: **stormlight** (number) kept across runs
- Unlock next class with stormlight: **spear** (selectable after unlock; spear moveset can be stubbed or minimal)
- Side-on, rightward “autoscroll” pacing: ~1 screen width / 7.5s until combat
- Intro: slave finds blade → two dialogue lines → walk right
- Combat: dual styles **fast** / **heavy**, auto-attack, parry-same-style, clickable style UI
- 3 identical trash enemies with fixed AI policies, then baby chasmfiend (2× HP)
- Storm escalation between fights (rain, lightning, rising water / slope chase — can be mostly visual + scripted water height)
- Win / game-over screens returning to class select with stormlight shown

### Explicitly out of MVP (hooks only)

- Full sword crafting / part system (leave `WeaponBuild` interface / empty panel stub)
- Multiple biomes, branching paths, shops, relics
- Spren companion personality beyond flavor text
- Online / multiplayer
- Pixel-perfect animation polish beyond placeholder rectangles + timing hooks

---

## Fantasy Loop (Player-Facing)

```
[Class / skin select] --stormlight displayed-->
[Find scene: dialogue ×2] -->
[Walk right] --> [Fight 1] --> [storm grows] -->
[Fight 2] --> [storm grows] -->
[Fight 3] --> [storm grows / slope] -->
[Baby chasmfiend] -->
  WIN  -> keep stormlight -> class select
  DIE  -> game over (show stormlight) -> class select
```

Unlock: spend stormlight on **spear** when affordable; spear appears on class select thereafter.

---

## Systems Spec (Authoritative for Implementation)

### 1. Weapon / Class Select

- **Classes**: `greatsword` (start unlocked), `spear` (locked until purchased).
- Class = **moveset** for the hero who wields you (animation set + timing + damage profile).
- **Skins** (greatsword MVP): `skin_a`, `skin_b` — cosmetic only.
- Hook: `WeaponBuild` / `SwordBuilder` module reserved; UI may show “Coming later” disabled section. Do not implement crafting in MVP.

### 2. Run pacing & world

| Constant | Value |
|----------|-------|
| Screen width (logical) | e.g. `960` px (configurable) |
| Walk time per screen | `7.5` s |
| Walk speed | `screenWidth / 7.5` world units/sec |
| First enemy | After first screen of walking |
| Subsequent enemies | Every additional screen width |
| Enemies before boss | `3` |
| Boss | Baby chasmfiend at slope apex |

Between fights: storm intensifies (rain density, lightning flashes, water level rises). Water is a fail-forward chase *vibe* in MVP — prefer scripted water height keyed to encounter index over full fluid sim. Player should not soft-lock; water pressure is narrative/visual unless a simple “touch water = damage/death” rule is added later.

### 3. Intro beat

1. Slave enters / discovers blade in chasm.
2. One line of dialogue.
3. Picks you up (equip event).
4. Second line of dialogue.
5. Begins walking right at walk speed.

Dialogue is data-driven strings; skippable or click-to-advance is fine for MVP.

### 4. Combat

**Model:** both sides auto-attack using their **active style**.

| Style | Relative attack period | Relative damage |
|-------|------------------------|-----------------|
| Fast  | shorter cooldown       | lower damage    |
| Heavy | longer cooldown        | higher damage   |

**Tuning target:** trash enemy dies in **~5 light** or **~3 heavy** hits (same HP budget). Chasmfiend = **2×** that HP.

**Cooldown continuity:** switching style mid-cooldown does **not** reset cooldown; it preserves **fraction of charge** (elapsed/total of old style → same fraction on new style’s period).

**Parry:** if an incoming attack’s style equals your current style, it is parried (no damage). Cross-style hits land.

**Animation hooks:** each attack clip exposes one or more **damage windows** (`hitFrame` / `t ∈ [0,1]` of attack duration) when damage application is attempted. Missed windows (target dead, already resolved) no-op.

**UI during combat:**

- Style + health bars fade in over heads when combat starts.
- Enemy: show **active style** over head.
- Player: show **available styles**; click to set active; active style highlighted.

### 5. Enemy AI (MVP scripts)

| Encounter | HP | Style policy |
|-----------|----|--------------|
| Enemy 1 | base | Always **fast** |
| Enemy 2 | base | Always **heavy** |
| Enemy 3 | base | Match player style after **5.0 s** delay (then track changes with that delay, or snap once—prefer: on each player style change, wait 5s then match) |
| Baby chasmfiend | `2 × base` | Match player after **1.0 s** delay |

“Match after delay” for MVP: when player’s style differs from AI’s, start/restart a timer; when timer elapses, set AI style = player style. Preserve cooldown fraction on AI style switch same as player.

### 6. Economy / meta

- Defeating an enemy grants stormlight (tunable flat amount per kill; boss grants more).
- Death: show game over + accumulated stormlight this prestige pool (lifetime / account pool for MVP = single `stormlight` integer in `localStorage`).
- Win: keep stormlight, return to select.
- Spend stormlight to unlock spear (fixed cost constant).

### 7. Presentation vibe (later polish, stub OK in MVP)

- Side-on, Mario/Terraria-like autoscroll feel.
- Placeholder art acceptable if timing and combat feel correct.
- Storm: particles + flashes + rising water plane.

---

## Technical Approach

### Stack (recommended)

- **TypeScript**
- **Vite** for build/dev
- **HTML5 Canvas 2D** (no engine lock-in; easiest to reason about in tests)
- Optional later: PixiJS if batching/sprites become painful — keep sim independent of renderer
- Persist meta in **`localStorage`**
- Ship as static files → any static host / `file`-adjacent via local server

Avoid: Unity WebGL, heavy native plugins, server-authoritative play for MVP.

### Architecture (testability first)

```
src/
  sim/           # pure logic: no DOM, no canvas
    combat.ts
    styles.ts
    pacing.ts
    run.ts
    ai.ts
    economy.ts
    types.ts
  data/          # weapons, dialogue, tuning constants
  render/        # canvas draw, input → sim commands
  app/           # screen state machine: select → intro → run → result
  persist/       # localStorage adapter (swappable in tests)
tests/           # vitest (or node:test) against sim/*
```

**Rule:** all combat, AI, pacing clocks, unlock rules, and win/lose resolution live in `sim/` and accept an injected `clock` / `rng` / `storage`. Renderer only:

1. Reads sim snapshot
2. Issues intents (`SetStyle`, `AdvanceDialogue`, `StartRun`, …)

### Determinism

- Fixed timestep for sim (`dt` clamped); tests advance time manually.
- No `Math.random` in sim without injected `Rng`.
- Animation “frames” are time fractions, not sprite sheet coupling.

---

## Tunable Constants (single source of truth)

Expose in `data/tuning.ts` (names illustrative):

```ts
SCREEN_WIDTH_PX = 960
WALK_SECONDS_PER_SCREEN = 7.5
FAST_ATTACK_PERIOD = …   // tuned so 5 hits ≈ kill
HEAVY_ATTACK_PERIOD = …
FAST_DAMAGE = …
HEAVY_DAMAGE = …
BASE_ENEMY_HP = …        // = 5 * FAST_DAMAGE = 3 * HEAVY_DAMAGE
CHASMFIEND_HP_MULT = 2
ENEMY3_MATCH_DELAY_S = 5
BOSS_MATCH_DELAY_S = 1
STORMLIGHT_PER_TRASH = …
STORMLIGHT_PER_BOSS = …
SPEAR_UNLOCK_COST = …
PARRY_SAME_STYLE = true
```

Acceptance for damage math: `5 * FAST_DAMAGE >= BASE_ENEMY_HP` and `3 * HEAVY_DAMAGE >= BASE_ENEMY_HP`, with equality preferred.

---

## Implementation Phases (Agent-Executable)

Each phase has **deliverables**, **automated tests**, and a **done checklist**. An agent should not start phase N+1 until phase N tests pass.

### Phase 0 — Skeleton

**Deliverables**

- Vite + TS project under `shardblade/`
- `sim/` empty modules + `tuning.ts`
- Vitest (or equivalent) wired: `npm test`
- README with `npm install`, `npm run dev`, `npm test`

**Tests**

- Smoke: `tuning` exports expected keys; `1 + 1` harness works

**Done when:** `npm test` green in CI/local.

---

### Phase 1 — Style & cooldown math (headless)

**Deliverables**

- `Style` = `fast` | `heavy`
- Attack period & damage lookups
- Cooldown tracker: `progress ∈ [0,1]`, tick, try-fire
- Style switch preserves progress fraction

**Tests**

- Switching at 50% progress on fast → heavy starts at 50% of heavy period
- Fire at progress ≥ 1 resets progress to 0 and emits hit event with style + damage
- Periods: heavy > fast; damage: heavy > fast
- HP budget: 5 fast or 3 heavy kills base HP exactly (or within 1 HP if integers)

**Done when:** all cooldown/style unit tests pass; no renderer required.

---

### Phase 2 — Combat resolution & parry

**Deliverables**

- Two combatants: HP, style, cooldown
- On damage window / fire: if attacker style === defender style → parry (0 dmg), else apply damage
- Death when HP ≤ 0
- Fade-in timers as sim flags (`uiCombatVisible` after combat start + fade duration) — logic only

**Tests**

- Same-style attack → no HP change, parry counted
- Cross-style → HP reduced by attack damage
- Lethal hit sets dead flag
- Simultaneous fires resolved in defined order (document: player first or simultaneous snapshot)

**Done when:** headless duel sims produce expected HP timelines.

---

### Phase 3 — Enemy AI policies

**Deliverables**

- `AiPolicy`: `alwaysFast`, `alwaysHeavy`, `matchPlayerAfter(delay)`
- Encounter factory: enemies 1–3 + boss with correct HP/policy

**Tests**

- E1 never leaves fast over 30s simulated
- E2 never leaves heavy
- E3: player switches at t=0; AI still old style until t=5; then matches
- Boss: matches after 1s
- Style switch on AI preserves cooldown fraction (reuse phase 1 helper)

**Done when:** AI tests pass without rendering.

---

### Phase 4 — Run / pacing state machine

**Deliverables**

- States: `Select` → `Intro` → `Walk` → `Combat` → `StormBeat` → … → `Boss` → `Won` | `Dead`
- Walk: accumulate distance; after each screen width, spawn next encounter
- Stormlight accrual on kill
- Win after boss; death on player HP ≤ 0

**Tests**

- From run start, after `7.5s` walk, enter combat with enemy 1
- After 3 trash clears + walk segments, boss spawns with 2× HP
- Kill all → `Won` and stormlight ≥ sum of grants
- Player HP → 0 → `Dead` with stormlight retained in meta pool (not wiped)

**Done when:** full run simulatable via `RunSim.tick(dt)` + scripted intents.

---

### Phase 5 — Meta / unlocks / persistence

**Deliverables**

- `MetaState`: `{ stormlight, unlockedClasses: string[] }`
- Purchase spear when `stormlight >= cost`
- Adapter interface `Storage`; memory impl for tests; `localStorage` for browser

**Tests**

- Cannot select spear when locked
- Purchase deducts cost and unlocks
- Memory storage round-trips JSON
- Death does not reset stormlight; spend only on unlock

**Done when:** meta tests pass with in-memory storage.

---

### Phase 6 — Thin renderer & screens (manual + light e2e)

**Deliverables**

- Canvas: ground, player, enemy placeholders, water plane, rain stubs
- HUD: stormlight, style buttons (click hit-tests), HP/style fade-in
- Screens: class select (skins), intro dialogue, combat, game over, you won
- Wire input → sim intents

**Tests / checks**

- Unit: hit-test mapping from click → `SetStyle`
- Optional Playwright smoke: load page, select greatsword, advance intro (agent-runnable if browser available)
- Manual checklist (below) for feel

**Done when:** playable in browser; core loop completable with placeholders.

---

### Phase 7 — Content polish pass (still MVP)

**Deliverables**

- Two greatsword skins swap sprites/colors
- Spear unlock UI + minimal spear periods/damage (can clone greatsword timings initially)
- Storm escalation visuals keyed to encounter index
- Damage window hooks wired to animation time (even if anim is a colored rectangle “swing”)

**Tests**

- Skin id persisted for run but does not change damage
- Spear selectable only when unlocked
- Boss HP still 2× after any content tweaks (regression)

**Done when:** README “How to play” matches build; `npm test` still green.

---

## Agent Test Strategy

### Layers

1. **Unit (required, fast):** `sim/**` — styles, parry, AI delays, pacing timestamps, economy.
2. **Integration (required):** `RunSim` full happy-path and death-path with fake clock.
3. **Contract:** `tuning` invariants (5 fast / 3 heavy kill; boss mult; delays 5 and 1).
4. **Optional e2e:** Playwright against `vite preview` — only smoke, not combat balance.

### Agent workflow

```
implement phase → npm test → fix until green → commit checkpoint (if asked) → next phase
```

Prefer **failing tests first** within a phase when adding behavior.

### What not to test

- Pixel diffs of rain
- Exact lightning RNG cosmetics
- Frame-perfect canvas anti-aliasing

### Headless run harness (for agents)

Expose something like:

```ts
function simulateRun(opts: {
  styleSchedule: Array<{ t: number; style: Style }>;
  // optional: force enemy HP overrides
}): RunResult
```

Used by tests and by an agent to validate balance after tuning edits.

---

## Manual Play Checklist (MVP acceptance)

- [ ] Select greatsword + either skin; stormlight visible
- [ ] Intro: two lines, then auto-walk right
- [ ] ~7.5s to first enemy; combat UI fades in
- [ ] Click fast/heavy; highlight updates; cooldown % preserved on switch
- [ ] Same-style attacks parry; cross-style deal damage
- [ ] Enemy 1 stays fast; 2 heavy; 3 mirrors after ~5s; boss after ~1s
- [ ] Trash ~5 light / ~3 heavy; boss twice as tanky
- [ ] Storm/water vibe escalates between fights
- [ ] Win and lose both return to select with stormlight kept
- [ ] Enough stormlight can unlock spear; spear appears thereafter

---

## Open Questions (resolve during Phase 1–4)

1. Integer vs float HP/damage (prefer integers for stable tests).
2. Does water deal damage on contact in MVP, or pure spectacle?
3. Can dialogue be skipped with click/space? (recommend yes)
4. Spear MVP: unique moveset numbers or clone greatsword until art exists?
5. Exact stormlight grants and spear cost (set after first feel pass; lock via tests once chosen).

---

## File / Doc Map

| Path | Role |
|------|------|
| `PLAN.md` | This document — product + phased engineering |
| `README.md` | (Phase 0) install / play / test commands |
| `src/sim/*` | Authoritative rules |
| `src/data/tuning.ts` | Balance knobs |
| `tests/*` | Agent-facing gates |

---

## One-line North Star

**A portable browser roguelite where the sim is the product truth, the canvas is a skin, and every combat/meta rule is provable with `npm test` before any art lands.**
