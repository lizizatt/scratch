"""Vectorized environment sizing and PPO rollout batch helpers."""

from __future__ import annotations

import os
import sys
from typing import Any, Callable, List, Sequence

from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv, VecEnv

# Cap parallel env processes (each runs a full Python interpreter on Windows spawn).
MAX_N_ENVS = int(os.environ.get("MAX_N_ENVS", "64"))
MIN_N_ENVS = 1
ENVS_PER_CORE = int(os.environ.get("ENVS_PER_CORE", "4"))
MIN_ROLLOUT_STEPS = int(os.environ.get("MIN_ROLLOUT_STEPS", "4096"))
MIN_STEPS_PER_ENV = int(os.environ.get("MIN_STEPS_PER_ENV", "64"))
VECENV_BACKEND = os.environ.get("VECENV_BACKEND", "auto").strip().lower()


def cpu_count() -> int:
    return os.cpu_count() or 8


def max_n_envs() -> int:
    return max(MIN_N_ENVS, MAX_N_ENVS)


def recommended_n_envs() -> int:
    """Default parallel env count: ~4× logical cores, clamped to [8, MAX_N_ENVS]."""
    cores = cpu_count()
    target = max(8, cores * ENVS_PER_CORE)
    return min(max_n_envs(), target)


def rollout_steps_total(n_envs: int) -> int:
    """Total env steps collected per PPO update (split across parallel envs)."""
    override = os.environ.get("ROLLOUT_STEPS")
    base = int(override) if override else MIN_ROLLOUT_STEPS
    n_envs = max(1, int(n_envs))
    return max(base, n_envs * MIN_STEPS_PER_ENV)


def steps_per_env(n_envs: int) -> int:
    n_envs = max(1, int(n_envs))
    return max(1, rollout_steps_total(n_envs) // n_envs)


def ppo_batch_size(device: str, rollout_total: int, *, base: int = 256) -> int:
    """Scale PPO minibatch with rollout size on GPU for better utilization."""
    rollout_total = max(1, int(rollout_total))
    if device == "cuda":
        return min(max(base, 512, rollout_total // 8), 2048)
    return base


def resolve_vecenv_backend(n_envs: int, backend: str = VECENV_BACKEND) -> str:
    n_envs = max(1, int(n_envs))
    normalized = (backend or "auto").strip().lower()
    if normalized not in ("auto", "subproc", "dummy"):
        raise ValueError(f"Unknown VECENV_BACKEND {backend!r} — use auto, subproc, or dummy")
    if n_envs <= 1:
        return "dummy"
    if normalized == "auto":
        # SubprocVecEnv wins for n>=4 on Windows/Linux for this env (~7k steps/s @ n=32).
        return "subproc"
    return normalized


def make_vec_env(factories: Sequence[Callable[[], Any]], n_envs: int, backend: str = VECENV_BACKEND) -> VecEnv:
    n_envs = max(1, int(n_envs))
    chosen = resolve_vecenv_backend(n_envs, backend)
    if chosen == "dummy":
        return DummyVecEnv(list(factories))
    start_method = "spawn" if sys.platform == "win32" else "fork"
    return SubprocVecEnv(list(factories), start_method=start_method)


def training_perf_defaults() -> dict[str, Any]:
    n = recommended_n_envs()
    rollout = rollout_steps_total(n)
    return {
        "cpu_count": cpu_count(),
        "recommended_n_envs": n,
        "max_n_envs": max_n_envs(),
        "envs_per_core": ENVS_PER_CORE,
        "rollout_steps_total": rollout,
        "steps_per_env": steps_per_env(n),
        "vecenv_backend": resolve_vecenv_backend(n),
        "note": "Rollouts run on CPU (SubprocVecEnv); PPO policy updates use GPU when available.",
    }
