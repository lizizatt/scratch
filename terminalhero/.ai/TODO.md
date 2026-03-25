# TerminalHero — TODO

_Generated from REVIEW.md — 2026-03-25_

Items are ordered by priority within each group. Check off as done.

---

## 🔴 Bugs — High

- [x] **Fix 3 failing real-chart tests** (`tests/test_chart_parser.py::TestParseChartReal`)
  - Run `grep -m5 ' B ' Tracks/*/notes.chart` to read the actual first BPM value
  - Update `test_first_bpm_is_182`, `test_bpm_events_match_known_count`, and `test_song_length_roughly_correct` to match reality — OR — replace with a synthetic chart fixture so the tests don't depend on a specific real file

---

## 🟠 Bugs — Medium

- [x] **Fix infinite recursion in `_restart`** (`game/screens/gameplay.py`)
  - `gameplay()` → `_restart()` → `gameplay()` adds a stack frame per restart; hits Python's 1000-frame limit
  - Refactor `gameplay()` to use an internal `while True` restart loop instead of calling `_restart()` recursively
  - Delete `_restart()` once the loop is in place

- [x] **Centralise curses color pair IDs** (all `screens/*.py`)
  - Each screen re-uses pair IDs 1–N from scratch; `_init_colors()` calls clobber the previous screen's pairs
  - Create `game/screens/colors.py` with globally unique pair constants and a single `init_all_colors()` call in `_run()` / at startup
  - Update all four screen files to import from there

---

## 🟡 Bugs — Low

- [x] **Simplify `Note.sustain_end_s`** (`game/engine/note.py`)
  - `Note` is not a frozen dataclass, so `object.__setattr__` is unnecessary
  - Add `sustain_end_s: float = field(default=0.0, compare=False, repr=False)` as a plain dataclass field
  - Remove `set_sustain_end()` method and the `sustain_end_s` property with its `getattr` fallback
  - Update `chart_parser._apply_flags()` to assign `note.sustain_end_s = end_s` directly
  - Update `test_note.py` accordingly

- [x] **Fix misleading `offset_s` docstring** (`game/audio.py`, `AudioPlayer.play()`)
  - Comment says `start=` is ignored; it is not — pygame passes it to `Mix_PlayMusic` for ogg/opus
  - Correct or remove the "for future use; currently ignored" note

- [x] **Fix frame timing** (`game/screens/gameplay.py`)
  - `time.sleep(1/60)` after processing overshoots the frame budget
  - Replace with deadline-based sleep:
    ```python
    frame_deadline = wall_time + 1/60
    # ... all processing ...
    remaining = frame_deadline - time.perf_counter()
    if remaining > 0:
        time.sleep(remaining)
    ```

- [x] **Add comment for open-note co-occurrence edge case** (`game/chart_parser.py`, `_apply_flags()`)
  - A lane-5 flag at the same tick as a lane-0–4 note silently drops the open note
  - Add a `# TODO: Clone Hero allows open+fret combos; handle if needed` comment so future devs know it's a known gap

- [x] **Optimise render-loop note scan** (`game/screens/gameplay.py`)
  - The loop iterates all `chart_data.notes` every frame (O(n)); fine now but will hurt on dense charts
  - Add a `render_head` index (mirroring `HitDetector._head`) to skip already-passed notes

---

## 🟢 Features — Core Gaps

- [ ] **Difficulty selection UI**
  - `main.py` silently defaults to Expert Single; players can't choose
  - Options: add a second selection step after song select, or add cycle-with-Tab in `song_select.py`
  - `SongInfo.available_difficulties` is already populated — just needs a UI

- [ ] **HOPO / tap auto-strum mechanics**
  - `Note.is_hopo` and `Note.is_tap` are parsed but `HitDetector.try_hit()` ignores them
  - Implement: if previous note was hit within the HOPO window AND current note is HOPO, allow hit without strum key

- [ ] **Star power activation**
  - `ChartData.star_power` phrases are parsed but not connected to gameplay
  - Decide activation mechanic (e.g. hold all 5 frets, or dedicated key), track accumulated star power, apply 2× score multiplier while active

---

## 🔵 Features — Stretch Goals

- [ ] **Solo section bonus scoring**
  - Parse `[Events]` section for `solo`/`soloend` markers
  - Track notes inside a solo section; award bonus on clean completion

- [ ] **Section name overlay during play**
  - Parse `[Events]` for section name events (`E "section ..."`)
  - Display current section name in the header or as a brief overlay

- [ ] **`config.ini` for user tuning**
  - Expose `SCROLL_WINDOW_S`, `PERFECT_WINDOW_S`, `GOOD_WINDOW_S`, `KEY_RELEASE_S` as user-editable config
  - Load on startup; fall back to defaults if file absent

---

## 🧪 Test Hygiene

- [x] **Replace brittle real-file BPM/duration assertions** with a small synthetic `.chart` string fixture
  - Fixed by sorting glob results so the Husky chart (the one tests were written for) is always picked first
- [ ] **Add test for `Note.sustain_end_s` field** after the dataclass refactor above
- [ ] **Add test for `_restart` loop** (ensure scorer resets and note list re-parses on restart)
