# GPU-batched simulation — primary training backend

## Goal

Replace `SubprocVecEnv` (N Python processes × CPU sim) with a **single Torch batch** stepping `N` envs on CUDA. As of the 3-DOF refactor this is the **primary training path** (`VECENV_BACKEND=auto` picks `gpu` whenever CUDA is available); the CPU `BoatNavEnv` remains the eval / serving / exercise path and shares the same plant math.

## Feature status

| Feature | Status |
|---------|--------|
| `navigate` clear-water | Yes |
| `avoid` with 1–`TRAIN_MAX_CONTACTS` contacts | Yes |
| Plant — 3-DOF planar dynamics (`dynamics.py`, `PLANT_MODEL=3dof`) | Yes (default) |
| Plant — legacy first-order lag (`PLANT_MODEL=tf`) | Yes (A/B fallback) |
| Water current (per-episode sample) | Yes |
| Goal hold termination | Yes |
| Mission waypoints / relocate (delay, progress, hold-complete triggers) | Yes |
| Scenario seed replay (`train_seeds.json` sampling via `ScenarioBank`) | Yes |
| Stretch goals (~20% of eligible training episodes) | Yes |
| Per-env dynamics jitter (agile ↔ freighter envelope) | Yes |
| Contact observation noise (range + bearing) | Yes |
| Contact vessel-class diversity (dinghy / workboat / freighter radii) | Yes |
| Reward-config wiring (run-config overrides, gated hold) | Yes |
| SB3 autoreset contract (`terminal_observation`, `TimeLimit.truncated`, `episode`, `is_success` infos) | Yes |
| `all` mode | Treated as `avoid` |
| COLREGS / exercise / eval traces | Still CPU `BoatNavEnv` (by design) |

## Plant model

`dynamics.py` implements a Fossen-style 3-DOF planar model (surge `u`, sway `v`, yaw rate `r`) written once in torch:

- inertia + linear/quadratic drag on all three axes, surge–sway–yaw coupling
- rudder authority scales with flow speed (weak rudder when nearly stopped)
- thrust with limited reverse (braking) fraction
- 10 Euler substeps per 1 s control step
- inner-loop autopilot (model inversion) keeps the action ABI unchanged: the policy still commands heading/speed, and the *unsaturated* closed loop approximates the legacy `tau_heading_s` / `tau_speed_s` / `max_yaw_rate` plant, so `PlantParams`, jitter envelopes, and run-config `plant` overrides all keep working.

The CPU `BoatNavEnv` uses `PlanarDynamicsPlant` (a scalar mirror of the same math, pinned equal by `tests/test_dynamics.py`), so train/eval dynamics parity holds by construction. Sway is exposed in obs slot 5 (schema v5, see `interface/boat_nav_rl_interface.h`).

## Tensor state (per env)

Own ship (incl. sway), goal, leg start, plant τ, current, contacts `[K_max]`, mission events `[E_max]` (goal, trigger kind, trigger param, leg index), counters, episode return/length.

## API

- `BatchedBoatSim` — `reset()`, `reset_to_scenarios(seeds)` (exact replay + missions), `step(actions)` → obs `[N,85]`, rewards, terminated, truncated
- `BatchedBoatVecEnv` — SB3 `VecEnv`; numpy in/out plus SB3-standard done infos
- Enable: `VECENV_BACKEND=gpu` or `auto` + CUDA → prefers GPU when available
- Plant select: `PLANT_MODEL=3dof` (default) or `tf`

## Parity

`tests/test_sim_torch.py` compares GPU batch vs CPU `BoatNavEnv` on seeded navigate/avoid/mission-relocate/multi-leg steps (obs + reward + termination tolerance), plus feature tests for seed-bank sampling, jitter, obs noise, vessel diversity, stretch goals, and autoreset semantics. `tests/test_dynamics.py` pins the torch and scalar 3-DOF implementations to each other and checks calibration against the legacy plant envelope.

## Benchmark (RTX 3060, Python 3.8, torch 2.4.1+cu124, 2026-07)

`python scripts/bench_gpu_sim.py` (sim only) and `python scripts/bench_ppo.py` (end-to-end PPO):

| Path | Throughput |
|------|-----------|
| SubprocVecEnv sim, 64 envs | ~11k env-steps/s |
| GPU sim, 2048 envs (3-DOF plant) | ~105k env-steps/s |
| GPU sim, 4096 envs (legacy plant) | ~205k env-steps/s |
| PPO end-to-end, subproc 32 envs | ~3.2k steps/s (~310 s per 1M) |
| PPO end-to-end, GPU 1024 envs, batch 8192 | ~40–44k steps/s (~25 s per 1M) |

The PPO update (not the sim, not the numpy roundtrip) is the dominant cost.
GPU defaults (conservative for 12 GB VRAM): `N_ENVS`=512, `GPU_MAX_N_ENVS`=1024,
PPO minibatch cap 4096. Override via env vars when you have headroom.
