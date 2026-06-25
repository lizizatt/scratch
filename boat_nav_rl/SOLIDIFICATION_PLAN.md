# Website solidification plan

**Project:** `boat_nav_rl` viz + API (`serve.py`, `training_job`, `exercise.py`, `viz/*.js`)  
**Goal:** Fix correctness bugs, race conditions, and thin test coverage that make the site feel buggy.

## Status legend

- [x] Done
- [ ] Not started
- [~] In progress

---

## Executive summary

| Layer | Health | Notes |
|-------|--------|-------|
| `prepare.py` / `env.py` / rewards | Good | Strong unit test coverage |
| HTTP API | Improving | Integration tests for lifecycle + validation |
| `training_job` lifecycle | Improving | PID file, unbuffered logs, corrupt metrics handling |
| `viz/*.js` | Improving | Stale-state and race fixes; no JS unit tests yet |
| Exercise backend | Improving | Session lock, run_id validation, model cache cap |

---

## Already fixed (prior sessions)

- [x] Budget ignored from UI (`train.py` stale import of `TRAIN_BUDGET_SEC`)
- [x] Budget persisted in `run_config.json`
- [x] Training presets, snapshot interval, navigate-first defaults

---

## P0 — Critical (execute first)

### Backend

| ID | Issue | Files | Status |
|----|-------|-------|--------|
| B1 | Run ID path traversal | `runs_util.py`, `serve.py`, `training_job.py`, `exercise.py` | [x] |
| B2 | Exercise session races under `ThreadingHTTPServer` | `exercise.py`, `serve.py` | [x] |
| B4 | Duplicate training after server restart | `training_job.py` (PID file) | [x] |
| B5 | Unlocked JSON state files | `train_job_state.py` (atomic write) | [x] |
| B6 | Subprocess log buffering | `training_job.py` (`python -u`) | [x] |
| B7 | `training_history()` crashes on corrupt metrics | `training_job.py` | [x] |
| B8 | Unbounded POST bodies | `serve.py` | [x] |
| E3 | Silent goal reject | `exercise.py`, `serve.py` | [x] |

### Frontend

| ID | Issue | Files | Status |
|----|-------|-------|--------|
| F1 | Preset curriculum fields stick after manual edit | `train.js` | [x] |
| F2 | Resume auto-selects latest run | `train.js` | [x] |
| F3 | History row click doesn't sync reward weights | `train.js` | [x] |
| F4 | Montage race on hover | `train.js` | [x] |
| F5 | Exercise overlapping API calls | `exercise.js` | [x] |
| F6 | `innerHTML` with user notes (XSS) | `train.js`, `api.js` | [x] |
| U1 | `renderCharts()` at 60fps during training | `train.js` | [x] |

### Tests (P0)

| ID | Test | Status |
|----|------|--------|
| T1 | `validate_run_id` rejects traversal | [x] |
| T2 | `apply_run_config` budget + snapshot interval | [x] |
| T3 | `training_history` skips corrupt metrics | [x] |
| T4 | `GET /api/runs/{id}` rejects bad id | [x] |
| T5 | Exercise goal returns error when rejected | [x] |

---

## P1 — Solidification (next)

### API validation

- [x] `parse_float`, `parse_bool`, `parse_run_id` in `api_parse.py`
- [x] Validate exercise goal/intruder floats (400 not 500)
- [x] Validate `device` enum at HTTP layer
- [x] Validate `curriculum_phase` int
- [x] Cap COLREGS `steps` array length

### Training job / status

- [x] `read_status()` read file inside `_lock`
- [x] `startTraining` disable button until POST returns
- [x] Cap `_model_cache` LRU in `exercise.py`

### Frontend

- [x] Cheaper live-metrics diff than full `JSON.stringify`
- [x] Replay: cancel stale COLREGS requests (sequence guard)
- [x] Optional chaining on `data.traces?.episodes` in scenarios/replay
- [x] Escape user strings in scenarios/replay

### Exercise ↔ training alignment

- [x] Skip `_sample_training_scenario` when `training_randomize=False` on reset
- [x] Sync `env.mission` on exercise `set_goal`
- [x] Load `reward_weights` from run into Exercise env

---

## P2 — Polish

- [x] API version check in `api.js` vs `/api/health`
- [x] Document single global exercise session (subtitle on exercise.html)
- [x] Remove dead `state.running` in `exercise.js`
- [x] Montage scrubber disabled until run loaded
- [x] Serve `index.html` / `scenarios.html` in API static tests
- [x] Frontend unit tests (extract `getTrainingPayload` etc.)
- [x] Replay URL: consistent `episode=0` for episode 0

---

## Implementation order

```
B1 → B6 → F1/F2/F3 → B2/E3 → P0 tests → B4/B5/B7/B8 → F4/F5/F6/U1
```

---

## Verification

```bash
cd boat_nav_rl
python run_tests.py
```

Manual smoke:

1. Train page: change mode after preset → curriculum fields cleared from payload
2. Resume defaults to "Fresh start"
3. Hover history rows → montage doesn't flicker wrong run
4. Exercise: rapid stepping doesn't desync vessels
5. Restart `serve.py` during training → cannot start duplicate job
