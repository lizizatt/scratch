# GPU-batched simulation — prototype spec

## Goal

Replace `SubprocVecEnv` (N Python processes × CPU sim) with a **single Torch batch** stepping `N` envs on CUDA.

## Phase 1 (this prototype)

| Feature | Status |
|---------|--------|
| `navigate` clear-water | Yes |
| `avoid` with up to 4 random contacts | Yes |
| Plant LTI (nominal params) | Yes |
| Water current (per-episode sample) | Yes |
| Goal hold termination | Yes |
| Mission waypoints / relocate | No — single goal per episode |
| Scenario seed replay | No — random spawn like `_sample_training_scenario` |
| `all` mode | Treated as `avoid` |
| COLREGS / exercise | Still CPU `BoatNavEnv` |

## Tensor state (per env)

Own ship, goal, leg start, plant τ, current, contacts `[K_max]`, counters.

## API

- `BatchedBoatSim` — `reset()`, `step(actions)` → obs `[N,85]`, rewards, dones
- `BatchedBoatVecEnv` — SB3 `VecEnv`; returns numpy to PPO
- Enable: `VECENV_BACKEND=gpu` or `auto` + CUDA → prefers GPU when available

## Parity

`tests/test_sim_torch.py` compares GPU batch vs CPU `BoatNavEnv` on seeded navigate/avoid steps (obs + reward tolerance).

## Benchmark

`python scripts/bench_gpu_sim.py` — reports env steps/sec vs `SubprocVecEnv`.
