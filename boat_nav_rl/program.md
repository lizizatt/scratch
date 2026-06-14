# Boat Nav RL — Experiment program

Lightweight playbook for human or agent iteration. Inspired by [autoresearch](https://github.com/karpathy/autoresearch): **fixed time budget, one metric, one file to edit.**

## Setup (once)

```bash
cd boat_nav_rl
pip install -r requirements.txt
python prepare.py
python run_tests.py
```

`prepare.py` writes `runs/eval_seeds.json`. Do not edit it by hand.

## Run an experiment

1. Edit **`train.py` only** (rewards, network size, `mode`, PPO knobs).
2. Run:

```bash
python train.py
```

Training stops after **10 minutes** wall clock, then runs fixed eval episodes.

3. **Open visualization** (must use the server — not `file://`):

```bash
python serve.py
```

Restart `serve.py` after code updates. See [TESTING.md](TESTING.md) for full smoke checklist.

| Page | URL | Purpose |
|------|-----|---------|
| **Train** | http://127.0.0.1:8765/train.html | Continue training, progress charts |
| **Overview** | http://127.0.0.1:8765/scenarios.html | Grid of all scenario trajectories (thumbnail cards) |
| **Replay** | http://127.0.0.1:8765/ | Step-through single episode |

Training prints direct links to both. Click any overview card to jump into replay for that scenario.

4. Read metrics:

```bash
cat runs/latest/metrics.json   # or runs/<run_id>/metrics.json on Windows
```

4. **Keep** the change if the metric improved; **revert** `train.py` if not.

## Scenario library

Regenerate after changing `scenarios.py`:

```bash
python prepare.py
```

Produces **~126 scenarios** programmatically (23 navigate, 103 avoid). Eval runs **every scenario in the active mode** once per training run.

Categories include: `ahead`, `bearing`, `crossing_stbd`, `crossing_port`, `head_on`, `overtaking`, `multi_2`, `multi_3`, etc.

| Mode | Flag in `train.py` | Optimize |
|------|-------------------|----------|
| Navigate | `mode = "navigate"` | **`nav_score`** ↑ — fraction of eval episodes within 50 m of goal |
| Avoid | `mode = "avoid"` | **`avoid_score`** ↑ — goal success × (1 − collision rate) |

Do not compare runs across modes. Get `nav_score > 0.8` before switching to avoid.

## What you may change in `train.py`

- Reward weights (goal progress, CPA, collision, smoothness)
- Policy net `[256, 256]` → `[128, 128]` etc.
- `n_envs`, learning rate, PPO clip range
- `mode` (`navigate` / `avoid`)
- Contact count cap (1–3 in MVP)

## What you must not change

- **`prepare.py`** — obs layout, eval seeds, transfer-function defaults
- Eval scenario files used for scoring (fair comparison across experiments)
- **`TRAIN_BUDGET_SEC`** — keep at 600 unless documenting a new baseline

## If stuck

- **Spins in circles:** increase heading lag penalty; check action scaling.
- **Never reaches goal:** increase goal progress reward; reduce speed penalty.
- **Mode B collisions:** raise CPA weight before collision penalty; verify contacts move on COG/SOG.
- **Metric flat after 5 runs:** try larger net or `n_envs`; watch replay — metric lies if goal spawn is trivial.

## Log format

Each run directory should contain:

- `metrics.json` — mode, scores, git-less notes field
- `eval_traces.json` — for browser replay
- `model.zip` — optional SB3 weights

Add a one-line note in `metrics.json` `"notes"` describing what you changed.
