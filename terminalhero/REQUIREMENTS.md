# TerminalHero — Requirements Document

## Overview

A Python terminal rhythm game that plays Clone Hero `.chart` files in the terminal. The player hits notes using the `1`–`5` keys as a guitar fretboard.

---

## Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| Terminal UI | `curses` (stdlib) | Low-level control over rendering, input, color |
| Audio playback | `pygame.mixer` | Simple, cross-platform, supports `.opus` via SDL2 |
| Chart parsing | Custom parser | `.chart` uses `{}` brace-delimited sections — not INI; no suitable PyPI library exists |
| Song metadata | `configparser` (stdlib) | `song.ini` is standard INI format (section header is lowercase `[song]`) |
| Timing | `time.perf_counter` | High-resolution clock for note hit windows |

---

## Project Structure
Take a l
```
terminalhero/
├── main.py               # Entry point
├── REQUIREMENTS.md
├── game/
│   ├── __init__.py
│   ├── chart_parser.py   # Parses notes.chart → note events
│   ├── song_loader.py    # Scans Tracks/ folder, reads song.ini
│   ├── audio.py          # Wraps pygame.mixer for playback
│   ├── screens/
│   │   ├── song_select.py    # Song list UI
│   │   ├── gameplay.py       # Main game loop / renderer
│   │   └── pause_menu.py     # Pause overlay
│   └── engine/
│       ├── note.py           # Note data model
│       ├── hit_detector.py   # Timing window logic
│       └── scorer.py         # Score / multiplier / streak
└── Tracks/
    └── <Song Name>/
        ├── notes.chart
        ├── song.ini
        └── song.opus
```

---

## Screens & Flow

```
Launch → Song Select → [Count-In] → Gameplay → Results
                                        ↕
                                   Pause Menu → Resume / Restart / Exit to Song Select
```

---

## 1. Song Select Screen

**Input:**
- `↑` / `↓` — move selection
- `Enter` or `Space` — choose song
- `q` or `Esc` — quit game

**Behavior:**
- On launch, scan `Tracks/` for subdirectories containing both `notes.chart` and `song.ini`.
- Display a scrollable list: `Artist – Title` sourced from `song.ini` (`artist`, `name` keys).
- Highlight the selected entry.
- Show a footer with key hints.

---

## 2. Chart Parsing (`chart_parser.py`)

### File Format

`.chart` is a plain-text format with `{}` brace-delimited sections. It is **not** INI — `configparser` cannot parse it. Use a custom line-by-line parser.

Example structure:
```
[Song]
{
  Resolution = 192
  Offset = 0
  MusicStream = "song.ogg"
}
[SyncTrack]
{
  0 = TS 4
  0 = B 182000
  1536 = B 178000
}
[ExpertSingle]
{
  1536 = N 0 0
  1536 = N 6 0
  7680 = N 4 240
  7680 = S 2 1776
}
```

### Key Sections

**`[Song]`**
- `Resolution` — ticks per beat (this chart: `192`)
- `Offset` — audio start offset in seconds (float)
- `MusicStream` — filename hint (e.g. `"song.ogg"`), but the **actual audio file may differ** (this track ships `song.opus`). Always scan the directory for a real audio file and fall back to `MusicStream` only if needed.
- `Year` is stored as `", 2020"` (quoted with a leading comma) — strip quotes and the leading `, ` when displaying.

**`[SyncTrack]`**
- `<tick> = TS <numerator>` — time signature (for display only)
- `<tick> = B <bpm_millionths>` — tempo event; BPM = value / 1000. Multiple events per chart (this chart has 9 BPM changes) — tick→second conversion must walk the full list.

**`[Events]`**
- `<tick> = E "section <name>"` — section labels (for future display / scrolling section names)

**`[ExpertSingle]`** — main note track

| Event | Meaning |
|---|---|
| `<tick> = N 0–4 <sustain>` | Fret note, lane 0–4 → keys 1–5 |
| `<tick> = N 5 <sustain>` | Open note (strum with no fret held) |
| `<tick> = N 6 0` | Force-HOPO modifier for note at this tick |
| `<tick> = N 7 0` | Tap modifier for note at this tick |
| `<tick> = S 2 <length>` | Star power phrase |
| `<tick> = E solo` | Solo section start |
| `<tick> = E soloend` | Solo section end |

**Critical:** lanes 6 and 7 are **modifiers**, not frets. They appear at the same tick as a real fret note. The parser must group events by tick, attach modifiers to their corresponding note, and never emit a standalone lane-6/7 Note object.

### Parsing Algorithm

1. Read file line-by-line; track current section name between `[Section]` / `{` / `}` markers.
2. For each data line inside a section, split on ` = ` to get `(tick, rest)`.
3. Accumulate by section into raw dicts/lists.
4. Post-process `[ExpertSingle]`: group all events at the same tick; attach force/tap flags to fret/open notes; emit `Note` objects only for lanes 0–5.

### Data Model

```python
@dataclass
class Note:
    tick: int
    lane: int          # 0–4 (fret), 5 (open)
    sustain_ticks: int
    time_s: float      # pre-computed from tick via tempo map
    is_hopo: bool = False
    is_tap: bool = False
    hit: bool = False
    missed: bool = False
```

### Tick → Second Conversion

Walk the sorted BPM event list. For each segment between two tempo events, compute elapsed seconds = `(tick_delta / resolution) * (60 / bpm)`. Accumulate to get absolute `time_s` for each note.

### `song.ini` Schema

`configparser` handles this file correctly. Section header is lowercase `[song]` — access as `config['song']`. Useful keys:

| Key | Type | Notes |
|---|---|---|
| `name` | str | Song title |
| `artist` | str | Artist name |
| `album` | str | Album |
| `genre` | str | Genre |
| `year` | str | Plain year, e.g. `2020` |
| `charter` | str | Chart author |
| `song_length` | int (ms) | Total duration |
| `diff_guitar` | int | Difficulty 0–6 (show as stars) |
| `preview_start_time` | int (ms) | Preview offset (future use) |
| `loading_phrase` | str | Flavour text (show on count-in screen) |

---

## 3. Gameplay Screen

### Layout (terminal rows, top-to-bottom)

```
┌─────────────────────────────────┐
│  Song Title          Score: 0   │  ← header
│  Streak: 0x    Multiplier: 1x   │
├─────────────────────────────────┤
│                                 │
│  [scrolling note highway here]  │  ← highway (fills most of screen)
│                                 │
├─────────────────────────────────┤
│  [=====STRIKEZONE═══════════]   │  ← fixed hit line (near bottom)
│   1    2    3    4    5         │  ← fret labels
└─────────────────────────────────┘
```

### Rendering

- The highway scrolls downward: notes are rendered as colored blocks (`█` or `▓`) in their lane column.
- Each of the 5 lanes maps to an equal-width column across the terminal width.
- Notes travel from top → strikezone over a configurable `scroll_time` (e.g. 2 seconds of look-ahead visible on screen).
- Sustained notes render as a vertical bar below the note head.
- At the strikezone, each lane lights up briefly on a successful hit.

### Input

| Key | Action |
|---|---|
| `1`–`5` | Hit fret lane 1–5 |
| `Esc` | Open pause menu |

Input is non-blocking (`curses` `nodelay` mode). Each frame, read all pending keys.

### Timing Windows (hit detection)

| Result | Window |
|---|---|
| Perfect | ±35 ms |
| Good | ±75 ms |
| Miss | note passes strikezone |

Only the nearest upcoming note in a lane is eligible for a hit.

### Count-In

Before audio starts, display a 3-2-1 countdown (1 second per beat) centered on screen, then start `pygame.mixer` playback and begin the game clock.

---

## 4. Scoring

| Event | Points |
|---|---|
| Perfect hit | 100 × multiplier |
| Good hit | 50 × multiplier |
| Miss | 0, streak resets |

- **Streak:** consecutive hits without a miss.
- **Multiplier:** `min(4, 1 + streak // 10)` — caps at 4×.
- Display running score, streak, and multiplier in the header.

---

## 5. Pause Menu

Triggered by `Esc` during gameplay. Audio pauses immediately.

Options (navigate with `↑`/`↓`, confirm with `Enter`):
- **Resume** — unpause audio and game clock
- **Restart** — re-parse chart, restart audio from beginning
- **Exit to Song Select** — stop audio, return to song list

---

## 6. Results Screen

Shown when the chart ends (all notes passed).

Displays:
- Final score
- Hit counts: Perfect / Good / Miss
- Max streak
- A letter grade: S / A / B / C / F based on hit percentage

Press any key to return to Song Select.

---

## 7. Audio (`audio.py`)

```python
# Wraps pygame.mixer
def load(path: str) -> None
def play() -> None
def pause() -> None
def unpause() -> None
def stop() -> None
def get_pos_s() -> float   # current playback position in seconds
```

> **Note:** `pygame.mixer` supports `.opus` only if the SDL2_mixer build includes Opus support (most do). Fallback: shell out to `ffplay -nodisp -autoexit` as a subprocess, with timing tracked via `perf_counter`.

---

## 8. Configuration (future / stretch)

- `config.ini` or CLI flags for scroll speed, hit window size, starting difficulty (`ExpertSingle` vs `HardSingle` etc.)
- Open note rendering (lane 5) — strum bar across all lanes with no fret color
- Star power activation — collect phrases (`S 2` events), activate with a key combo for 2× score
- Solo section bonus scoring (`E solo` / `E soloend`)
- HOPO / tap mechanics — auto-strum if previous note was hit (lane 6 / lane 7 modifiers)
- Section name overlay while playing (from `[Events]`)

---

## Implementation Order

1. `song_loader.py` + `chart_parser.py` — get data in
2. `song_select.py` — basic curses list navigation
3. `audio.py` + count-in
4. `gameplay.py` rendering (static notes, no input)
5. `hit_detector.py` + input loop
6. `scorer.py` + header display
7. `pause_menu.py`
8. Results screen
9. Polish: colors, animations, sustains
