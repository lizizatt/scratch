"""Vectorized environment sizing and PPO rollout batch helpers."""

from __future__ import annotations

import os
import sys
from typing import Any, Callable, List, Optional, Sequence

from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv, VecEnv

# Cap parallel env processes (each runs a full Python interpreter on Windows spawn).
MAX_N_ENVS = int(os.environ.get("MAX_N_ENVS", "64"))
GPU_MAX_N_ENVS = int(os.environ.get("GPU_MAX_N_ENVS", "1024"))
MIN_N_ENVS = 1
ENVS_PER_CORE = int(os.environ.get("ENVS_PER_CORE", "4"))
MIN_ROLLOUT_STEPS = int(os.environ.get("MIN_ROLLOUT_STEPS", "2048"))
MIN_STEPS_PER_ENV = int(os.environ.get("MIN_STEPS_PER_ENV", "32"))
VECENV_BACKEND = os.environ.get("VECENV_BACKEND", "auto").strip().lower()


def _cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except ImportError:
        return False


def cpu_count() -> int:
    return os.cpu_count() or 8


def max_n_envs(backend: Optional[str] = None) -> int:
    normalized = (backend or VECENV_BACKEND).strip().lower()
    if normalized == "gpu":
        cap = GPU_MAX_N_ENVS
    elif normalized == "auto" and _cuda_available():
        cap = GPU_MAX_N_ENVS
    else:
        cap = MAX_N_ENVS
    return max(MIN_N_ENVS, cap)


def recommended_n_envs() -> int:
    """Default parallel env count: ~4× logical cores (CPU) or 512 (GPU)."""
    chosen = resolve_vecenv_backend(32, VECENV_BACKEND)
    if chosen == "gpu":
        return min(max_n_envs("gpu"), 512)
    cores = cpu_count()
    target = max(8, cores * ENVS_PER_CORE)
    return min(max_n_envs("subproc"), target)


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
    """Scale PPO minibatch with rollout size on GPU for better utilization.

    Measured on RTX 3060: the PPO update is kernel-launch-bound for this small
    MLP; larger minibatches help but VRAM caps apply on 12 GB cards.
    """
    rollout_total = max(1, int(rollout_total))
    if device == "cuda":
        return min(max(base, 256, rollout_total // 16), 4096)
    return base


def resolve_vecenv_backend(n_envs: int, backend: str = VECENV_BACKEND) -> str:
    n_envs = max(1, int(n_envs))
    normalized = (backend or "auto").strip().lower()
    if normalized not in ("auto", "subproc", "dummy", "gpu"):
        raise ValueError(f"Unknown VECENV_BACKEND {backend!r} — use auto, subproc, dummy, or gpu")
    if n_envs <= 1 and normalized != "gpu":
        return "dummy"
    if normalized == "auto":
        if _cuda_available() and n_envs >= 4:
            return "gpu"
        return "subproc"
    return normalized


def make_vec_env(
    factories: Sequence[Callable[[], Any]],
    n_envs: int,
    backend: str = VECENV_BACKEND,
    *,
    mode: str = "navigate",
    device: Optional[str] = None,
    goal_hold_sec: int = 0,
    max_episode_steps: Optional[int] = None,
    current_enabled: bool = False,
    train_seeds: Optional[Sequence[Any]] = None,
    nominal_plant: Optional[Any] = None,
    dynamics_jitter: bool = False,
    contact_obs_noise_m: float = 0.0,
    contact_obs_noise_bearing_rad: float = 0.0,
    train_max_contacts: int = 4,
    reward_config: Optional[Any] = None,
) -> VecEnv:
    n_envs = max(1, int(n_envs))
    chosen = resolve_vecenv_backend(n_envs, backend)
    if chosen == "gpu":
        from batched_boat_vecenv import make_gpu_vec_env

        return make_gpu_vec_env(
            n_envs=n_envs,
            mode=mode,
            device=device,
            goal_hold_sec=goal_hold_sec,
            max_episode_steps=max_episode_steps,
            current_enabled=current_enabled,
            train_seeds=list(train_seeds) if train_seeds else None,
            nominal_plant=nominal_plant,
            dynamics_jitter=dynamics_jitter,
            contact_obs_noise_m=contact_obs_noise_m,
            contact_obs_noise_bearing_rad=contact_obs_noise_bearing_rad,
            train_max_contacts=train_max_contacts,
            reward_config=reward_config,
        )
    if chosen == "dummy":
        return DummyVecEnv(list(factories))
    start_method = "spawn" if sys.platform == "win32" else "fork"
    return SubprocVecEnv(list(factories), start_method=start_method)


def training_perf_defaults() -> dict[str, Any]:
    n = recommended_n_envs()
    rollout = rollout_steps_total(n)
    backend = resolve_vecenv_backend(n)
    note = (
        "Rollouts on GPU (BatchedBoatVecEnv); PPO policy updates on CUDA."
        if backend == "gpu"
        else "Rollouts run on CPU (SubprocVecEnv); PPO policy updates use GPU when available."
    )
    return {
        "cpu_count": cpu_count(),
        "recommended_n_envs": n,
        "max_n_envs": max_n_envs(backend),
        "envs_per_core": ENVS_PER_CORE,
        "rollout_steps_total": rollout,
        "steps_per_env": steps_per_env(n),
        "vecenv_backend": backend,
        "cuda_available": _cuda_available(),
        "note": note,
    }
