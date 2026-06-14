# Boat Dynamics Robustness Plan

**Status:** Partially implemented — training phases + LTI jitter in `train.py` / Train UI. Robust eval page still planned.

**Goal:** Train policies that still reach waypoints and avoid contacts when deployed on a vessel whose handling differs slightly from the sim plant used in training (different time constants, yaw-rate limits, or speed response).

---

## 1. Problem statement

Today the sim uses a fixed first-order plant (`TAU_HEADING_S`, `TAU_SPEED_S`, `MAX_YAW_RATE_RPS` in `prepare.py`). The RL policy learns against that exact dynamics model. On a real boat—or even a different sim tuning—the same `(heading*, speed*)` commands produce different trajectories.

We want **domain randomization over plant parameters** during training, then **measure generalization** on held-out dynamics draws and standard eval scenarios.

---

## 2. Proposed jitter model

### Parameters to randomize (per episode or per env reset)

| Parameter | Nominal | Suggested range | Notes |
|-----------|---------|-----------------|-------|
| `tau_heading_s` | 3.0 s | 1.5 – 6.0 | Turn responsiveness |
| `tau_speed_s` | 4.0 s | 2.0 – 8.0 | Acceleration / decel |
| `max_yaw_rate_rps` | 15°/s | 8° – 22° | Hard turn limit |
| Optional gain bias | 1.0 | 0.85 – 1.15 | Scales command→rate mapping |

**Sampling:** log-uniform or uniform in physical units; seed from `(training_seed, env_id, episode)` for reproducibility.

**Where:** extend `TransferFunctionPlant.__init__` to accept overrides; `BoatNavEnv.reset()` draws a new plant when `dynamics_randomize=True` (training only — eval uses nominal unless running robustness suite).

**Do not jitter (yet):** collision radius, contact kinematics, observation layout, reward weights.

---

## 3. Training protocol

### Phase A — Baseline (current)
- Fixed plant, train/eval scenario split (implemented).
- Gate: eval `nav_score > 0.8` on held-out scenarios at **nominal** dynamics.

### Phase B — Mild jitter
- Enable plant jitter during **train-set** rollouts only.
- Eval scoring still at **nominal** plant on **eval-set** scenarios (unchanged metric for comparability).
- Expect nominal eval score to drop initially; iterate reward / training budget.

### Phase C — Robust eval
- Add a second eval pass at **nominal** and at **N random perturbed plants** (e.g. N=5 seeds × full eval set, or subsample for speed).
- Report:
  - `nominal_eval_score`
  - `robust_eval_score` (mean over perturbed plants)
  - `robust_eval_worst` (min over perturbed plants)

### Phase D — Avoid mode
- Same jitter protocol once navigate robustness is acceptable.

---

## 4. Evaluation design

### Metrics (navigate)

| Metric | Definition |
|--------|------------|
| Success rate | Fraction of eval episodes with `final_goal_range_m < 50 m` |
| Avg goal range | Mean final distance to goal (m) |
| Robustness gap | `nominal_score − robust_mean_score` (lower is better) |
| Tail risk | 10th percentile success rate across perturbation seeds |

### Perturbation eval suite

1. **Fixed grid:** e.g. 9 combinations (slow/fast heading τ × slow/fast speed τ × low/high yaw rate).
2. **Random Monte Carlo:** 20 random draws per checkpoint; report mean ± std.
3. Store plant params used in each trace JSON for replay/debug.

### Pass criteria (proposal)

- Nominal eval: `nav_score ≥ 0.80` (unchanged MVP gate).
- Robust: `robust_eval_score ≥ 0.65` with `robustness_gap ≤ 0.15`.
- No category in eval set below 50% success at nominal dynamics.

---

## 5. Visualization plan

### 5.1 Training page (`train.html`)

- Add optional third chart pane when robust eval exists: **Robustness gap** over runs.
- Live mini-eval: show `successes/eval_episodes` (already added) plus tag `nominal` vs `robust sample`.

### 5.2 Overview (`scenarios.html`)

- Badge per scenario card: **train** / **eval** (API already exposes `split`).
- Filter: train only / eval only / all.

### 5.3 New page: **Robustness** (`robustness.html`) — recommended

```
┌─────────────────────────────────────────────────────────┐
│  Nominal vs perturbed eval — run 20260613_xxxx          │
├──────────────────────┬──────────────────────────────────┤
│  Heatmap             │  Score distribution              │
│  (τ_h × τ_v → score) │  (box plot over perturb seeds)   │
├──────────────────────┴──────────────────────────────────┤
│  Trajectory overlay: nominal plant vs worst perturb     │
│  (pick one eval scenario, side-by-side replay)          │
└─────────────────────────────────────────────────────────┘
```

**Heatmap:** 2D grid of success rate vs `(tau_heading, tau_speed)` with fixed yaw rate.

**Box plot:** success rate per perturbation seed across full eval set.

**Trajectory overlay:** reuse replay canvas; two traces same scenario, different plant params stored in trace metadata.

### 5.4 Trace schema extension (future)

Add to each episode in `eval_traces.json`:

```json
{
  "plant": {
    "tau_heading_s": 2.1,
    "tau_speed_s": 5.8,
    "max_yaw_rate_deg_s": 12.0,
    "perturbation_id": "grid_02"
  }
}
```

---

## 6. Implementation checklist (when ready)

1. **`prepare.py`** — document nominal plant; add `sample_plant_params(rng)` helper.
2. **`BoatNavEnv`** — `dynamics_randomize` flag; new plant per reset in training.
3. **`train.py`** — config toggle `DYNAMICS_JITTER = False` default; log perturbed params in train metrics when enabled.
4. **`run_eval(..., plant_overrides=None)`** — robust eval loop.
5. **`prepare.py` / CLI** — `python prepare.py --robust-grid` writes perturbation grid manifest.
6. **Viz** — robustness page + overview split badges.
7. **Tests** — plant jitter changes state evolution; eval at nominal unchanged when jitter off.

---

## 7. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Jitter too wide → never learns | Start with ±30% on τ; widen only if robust gap closes |
| Policy exploits sim-specific quirks | Keep eval on held-out scenarios + perturbed plants |
| Slower training | Jitter is cheap (same sim); robust eval runs offline after pause |
| Overfitting to jitter distribution | Hold out a **fixed** set of 5 plant draws never used in training randomization |

---

## 8. Suggested experiment order

1. Re-establish strong **nominal eval** score with expanded scenario library + train/eval split.
2. Enable **±25% τ jitter** only; compare nominal eval before/after.
3. Add **robust eval pass** on pause; track robustness gap in run history.
4. Widen jitter to full proposed ranges if gap remains small.
5. Export best checkpoint + plant sidecar for C++ stack integration tests (see `SCOPE.md`).

---

## 9. References in repo

- Plant model: `prepare.py` → `TransferFunctionPlant`
- Training env: `train.py` → `BoatNavEnv`
- Scenario splits: `scenarios.py` → `split_train_eval`, `runs/train_seeds.json`, `runs/eval_seeds.json`
- Viz replay: `viz/replay.js`, `viz/draw.js`
