"""Benchmark GPU-batched sim vs SubprocVecEnv rollout throughput."""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P
from batched_boat_vecenv import make_gpu_vec_env
from env_factory import make_env
from vecenv_util import make_vec_env


def bench_env(env, n_envs: int, steps: int = 500) -> float:
    obs = env.reset()
    actions = np.zeros((n_envs, 2), dtype=np.float32)
    t0 = time.perf_counter()
    for _ in range(steps):
        env.step_async(actions)
        obs, _, _, _ = env.step_wait()
    elapsed = time.perf_counter() - t0
    env.close()
    return (n_envs * steps) / elapsed


def main() -> None:
    n_envs = int(os.environ.get("BENCH_N_ENVS", "64"))
    steps = int(os.environ.get("BENCH_STEPS", "200"))
    mode = os.environ.get("BENCH_MODE", "navigate")
    print(f"Benchmark n_envs={n_envs} steps={steps} mode={mode}")

    if not P.TRAIN_SEEDS_PATH.exists():
        P.write_scenario_splits()

    factories = [make_env(mode, i) for i in range(n_envs)]
    cpu_env = make_vec_env(factories, n_envs, backend="subproc")
    cpu_sps = bench_env(cpu_env, n_envs, steps)
    print(f"  SubprocVecEnv: {cpu_sps:,.0f} env-steps/s")

    gpu_env = make_gpu_vec_env(
        n_envs=n_envs,
        mode=mode,
        device=os.environ.get("BENCH_DEVICE", "cuda"),
        current_enabled=False,
    )
    gpu_sps = bench_env(gpu_env, n_envs, steps)
    print(f"  BatchedBoatVecEnv: {gpu_sps:,.0f} env-steps/s")
    print(f"  Speedup: {gpu_sps / max(cpu_sps, 1):.1f}x")


if __name__ == "__main__":
    main()
