# World Boss System — Product Requirements

## Purpose

**Static** page that **rotates every 30 minutes**: each window gets a **boss id** and one **pluggable world boss module** from a **registry** (rotation is deterministic from the window; new modules join the pool without changing the shell contract). **Completed** runs submit a **32-bit score** and metadata to **Google Form → Sheet**; **leaderboard** + **parses** use that row. **Abandoned** runs submit nothing. Separate from the quest list; **primary entry:** QR in **Epic bag** (direct links OK).

## Goals & non-goals

**Goals:** Rhythm/FOMO; **modular** minigames (add modules → they appear in rotation); **32-bit** scored runs; Form-backed storage; social proof; parse history + **item level** = parse count.

**Non-goals:** Quest tiers/bags/proof; esports anti-cheat (good faith + optional rate limits later).

## Roles

**Player:** play → submit → leaderboard + profile. **Operator:** optional monitoring / minigame tuning. **Spectator:** may view boss + board without playing (default allow).

## Entry

Epic-bag QR → world boss URL. No in-app quest completion required; access is whoever holds the card/link.

## Rotation

**Windows:** e.g. `floor(now / 30min)` in a **named convention-local timezone** (configure per deploy, e.g. `America/Los_Angeles`); show that TZ or local offset on-page. Each window: **boss id** + **module id** chosen **deterministically** from the registry (seed from window index + salt so all clients agree). **Static hosting:** shell loads **current module** by id; advance at boundary (poll or timer). Adding a module = register its id + factory/import and include it in the weighted or flat random pool—rotation picks it **without** special cases per game.

## World boss module (interface)

A **world boss** is **one pluggable minigame module** behind a shared contract:

- **Identity:** stable **`module_id`** (string) used in rotation, Form rows, and parses.
- **Play surface:** renders inside the shell (instructions + interactive UI). Implementation is **open-ended** (canvas, DOM game, Web Audio, etc.) as long as it honors the contract below.
- **Outcome:** only a **completed** run produces data. The module resolves with a single **`score`: unsigned 32-bit integer** (`0` … `2³²−1`). Interpretation is **higher = better** for leaderboard unless you later add an optional per-module flag (default: higher wins).
- **Completion vs abandon:** **`onComplete({ score })`** — shell records submission. **`onAbandon()` / navigate away / close before completion** — shell **must not** submit; **no Sheet row, no parse, no leaderboard entry.** Early exit leaves **no trace** on profile or history.
- **Shell responsibilities:** pass **context** into the module (at minimum **boss id**, **window index**, **`module_id`**, optional **deterministic seed** for fairness). After `onComplete`, shell attaches **server/Form timestamp**, computes **frozen percentile** for that boss id at submit time, and writes the full parse row.

Modules do **not** talk to the Form directly; they return **score only** (and completion signal) to the shell.

## Data pipeline

**Submit (completion only):** boss/window id, **`module_id`**, **`score`** (unsigned **32-bit** integer), **display name** (**unique per event** — duplicate rejected via Sheet/Apps Script), **timestamp** (**Form submit time** preferred). Derive **frozen percentile** for that **boss id** at insert time and store with the row. No submit ⇒ no row.

**Store:** Sheet as system of record.

**Read model:** Leaderboard + profile read published data — Sheet **CSV/API**, **scheduled JSON** to static host, or **Apps Script** web app; pick in tech spec. Expect **eventual consistency** (minutes lag OK).

## Leaderboard

Same view (or obvious anchor) as current boss: boss name, **countdown**, **active `module_id`** (and friendly title from module metadata if present). **Tabs or sections:** *this 30m window* (primary) vs *event / all-time* (optional). **Rank:** higher **score** (32-bit) unless a module opts into lower-better later. **Ties:** stable rule (e.g. earlier submit wins).

## Parses & profile

**Parse** = one **completed** run: Form row with **score**, **timestamp**, **frozen percentile** at submit time, **`module_id`**, **boss id**. **Abandon / early exit:** never submitted ⇒ **not a parse** — indistinguishable from never playing that boss. **No row** for bosses never completed (no gray “failed”).

**Percentile:** compare run to all submissions **for that same boss id** at submit time; **store frozen percentile** with the row so historical parses do not change when new scores arrive.

**Colors:** percentile bands → Raidbots/WCL-style tier colors (original styling; no lifted assets).

**Item level:** headline number on profile = **total count of parses** (completed world bosses / submissions), not a percentile blend.

**Profile URL:** query/hash/local storage — implementation choice. **Shows:** boss #, **`module_id`**, **32-bit score**, percentile, color; optional item level (parse count). **Privacy:** display name is public on leaderboard—state on Form.

## Module pool & content

Each registered module should be **finishable within the 30m window** for a typical player (shorter is fine). **A11y** per module as stretch. **Content list** (which `module_id`s exist) lives in code/config, not this doc—new entries automatically participate once registered in the rotation pool.

## Compliance & success

Use **supported** Google APIs / publish paths; avoid ToS-violating scraping. Minimize PII for minors (display name only; optional parental note in Form copy).

**Ship bar:** two phones same boss + **`module_id`** same window; completed runs land in Sheet with score + frozen percentile; leaderboard/profile match; abandon ⇒ no row.

## Quest list boundary

**In:** traffic from Epic QR (+ optional links). **Out:** nothing back to quest list.
