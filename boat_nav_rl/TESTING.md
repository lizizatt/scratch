# Boat Nav RL — Testing

Solid foundation checklist: run these before iterating on training or viz.

## Quick verify (30 seconds)

```powershell
cd boat_nav_rl
python run_tests.py
```

All tests must pass. This covers:

- Observation layout (77 dims)
- Scenario library generation
- Transfer-function plant
- Gym env reset/step
- **All `/api/*` endpoints return JSON** (not HTML)
- Viz static assets present
- **Node unit tests** for extracted viz logic (`viz/util.js`, `train_form.js`, `api_queue.js`) when `node` is on PATH

### JavaScript unit tests only

```powershell
node --test tests/js/*.test.mjs
```

## Full manual smoke (5–10 minutes)

### 1. One-time setup

```powershell
pip install -r requirements.txt
python prepare.py
```

Expect ~126 scenarios written to `runs/eval_seeds.json`.

### 2. Start the viz server (required for browser UI)

```powershell
python serve.py
```

**Important:** Pages must be opened via the server URLs, not by double-clicking HTML files (`file://` breaks API calls and causes the `Unexpected token '<'` error).

| Page | URL |
|------|-----|
| Train | http://127.0.0.1:8765/train.html |
| Overview | http://127.0.0.1:8765/scenarios.html |
| Replay | http://127.0.0.1:8765/ |

If you updated code, **restart `serve.py`** — an old process won't have `/api/history` or `/api/train/status`.

### 3. API health check

```powershell
python -c "import urllib.request, json; print(json.load(urllib.request.urlopen('http://127.0.0.1:8765/api/health')))"
```

Expected: `{"ok": true, "api_version": 1, ...}`

If you get HTML or connection refused, the server isn't running or is stale.

### 4. Short training run

```powershell
python train.py --budget 30 --n-envs 2 --notes "smoke test"
```

Expect: `runs/<timestamp>/metrics.json`, `eval_traces.json`, `model.zip`, and console lines with `nav_score` and `avg_goal_range`.

### 5. Resume training

```powershell
python train.py --resume <run_id> --budget 30 --notes "smoke resume"
```

Expect: `parent_run_id` set in new `metrics.json`, `train_session` incremented.

### 6. Browser workflow

1. Open **Train** page — charts and history table load (no red error in footer)
2. Click **Continue latest run** with 1-minute budget — log panel updates
3. Open **Overview** — thumbnail grid for latest run
4. Click a card — **Replay** opens that scenario

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Unexpected token '<'` | Open via `http://127.0.0.1:8765/...`, restart `serve.py` |
| Train page stuck on "Idle" | Check terminal running `serve.py`; hit Refresh |
| `No checkpoint for run` | Run must finish and produce `model.zip` before resume |
| Tests fail on `load_eval_seeds` | Run `python prepare.py` first |

## CI-style one-liner

```powershell
python prepare.py; python run_tests.py
```
