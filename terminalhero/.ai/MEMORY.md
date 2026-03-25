# TerminalHero — AI Session Memory

## Project
Python terminal rhythm game playing Clone Hero `.chart` files. Curses UI, pygame audio.

- **Venv:** `.venv/` (Python 3.12.3, pygame ≥ 2.5, pytest 9.0.2)
- **Entry point:** `main.py` (`--tracks` arg, defaults to `Tracks/`)
- **Tests:** 226 passing, `pytest -q` ~0.18s
- **Real track:** `Tracks/Husky by the Geek.../` — `notes.chart`, `song.ini`, `song.opus`

## Architecture

```
game/
  chart_parser.py     # {} block parser → ChartData; ticks_to_seconds via BPM events
  song_loader.py      # Scans Tracks/, prefers .opus→.ogg→.mp3→.wav
  audio.py            # AudioPlayer; wall-clock timing via perf_counter, not pygame pos
  engine/
    note.py           # Note dataclass; sustain_end_s via set_sustain_end()
    hit_detector.py   # Per-lane miss/hit; last_hit_note set on hit
    scorer.py         # Score/streak/multiplier(max 4×)/grade(S≥95,A≥80,B≥65,C≥50)
    sustain_tracker.py# Hold detection; KEY_RELEASE_S=0.6s; trickle 25pts/sec
  screens/
    song_select.py    # compute_scroll(), visible_slice()
    gameplay.py       # Main loop; SCROLL_WINDOW_S=1.0; input BEFORE sustains.update()
    pause_menu.py     # PauseChoice enum: RESUME/RESTART/EXIT_TO_SELECT
    results.py        # Grade + per-quality counts
```

## Key Constants
| Constant | Value | File |
|---|---|---|
| `PERFECT_WINDOW_S` | ±0.070s | hit_detector.py |
| `GOOD_WINDOW_S` | ±0.150s | hit_detector.py |
| `SCROLL_WINDOW_S` | 1.0s | gameplay.py |
| `FLASH_FRAMES` | 18 | gameplay.py |
| `JUDGMENT_FRAMES` | 30 | gameplay.py |
| `KEY_RELEASE_S` | 0.6s | sustain_tracker.py |
| `SUSTAIN_PTS_PER_SEC` | 25.0 | sustain_tracker.py |

## Recent Fixes (sustain debugging)
1. `KEY_RELEASE_S` 0.12→0.6s — OS initial key-repeat delay is ~300-500ms
2. Input loop now runs **before** `sustains.update()` in gameplay.py (ordering fix)
3. Pre-hit sustain tails: `▓` half-width bar (was `│`, same as lane separator)
4. Active (held) sustain tails: `█` full-width column to strikezone

## Gotchas
- `song.ini` uses lowercase `[song]` section — configparser needs `optionxform = str` workaround skipped; uses `read_dict` pattern
- Real chart has `MusicStream='song.ogg'` but file is `song.opus` — loader uses discovery, ignores ini value
- All pygame mocked via `sys.modules` in tests; `time.perf_counter` mocked via `FakeClock`
- `.chart` parser is custom (`{}` blocks), not INI-compatible

## Stretch Goals (not yet done)
- HOPO/tap auto-strum mechanics
- Star power activation
- Solo section bonus scoring
- Section name overlay during play
- `config.ini` for scroll speed / hit window user config
