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
    subproc_n = int(os.environ.get("BENCH_SUBPROC_ENVS", "32"))
    gpu_n = int(os.environ.get("BENCH_GPU_ENVS", os.environ.get("BENCH_N_ENVS", "1024")))
    steps = int(os.environ.get("BENCH_STEPS", "100"))
    mode = os.environ.get("BENCH_MODE", "navigate")
    gpu_only = os.environ.get("BENCH_GPU_ONLY", "").strip().lower() in ("1", "true", "yes")
    print(f"Benchmark subproc_n={subproc_n} gpu_n={gpu_n} steps={steps} mode={mode} plant={P.PLANT_MODEL}")

    if not P.TRAIN_SEEDS_PATH.exists():
        P.write_scenario_splits()

    cpu_sps = None
    if not gpu_only:
        factories = [make_env(mode, i) for i in range(subproc_n)]
        cpu_env = make_vec_env(factories, subproc_n, backend="subproc")
        cpu_sps = bench_env(cpu_env, subproc_n, steps)
        print(f"  SubprocVecEnv ({subproc_n} envs): {cpu_sps:,.0f} env-steps/s")

    gpu_env = make_gpu_vec_env(
        n_envs=gpu_n,
        mode=mode,
        device=os.environ.get("BENCH_DEVICE", "cuda"),
        current_enabled=False,
    )
    gpu_sps = bench_env(gpu_env, gpu_n, steps)
    print(f"  BatchedBoatVecEnv ({gpu_n} envs): {gpu_sps:,.0f} env-steps/s")
    if cpu_sps is not None:
        per_env_cpu = cpu_sps / subproc_n
        per_env_gpu = gpu_sps / gpu_n
        print(f"  Per-env throughput: subproc {per_env_cpu:,.0f}  gpu {per_env_gpu:,.0f}  ({per_env_gpu / max(per_env_cpu, 1):.1f}x)")


if __name__ == "__main__":
    main()
