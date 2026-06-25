"""Parallel eval rollouts and metric aggregation."""

from __future__ import annotations

import math
import os
import uuid
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
from stable_baselines3 import PPO

import prepare as P
from rewards import HOLD_AT_STOP_EPS_MPS, aggregate_episode_breakdowns

EVAL_WORKERS = int(os.environ.get("EVAL_WORKERS", str(max(1, os.cpu_count() or 4))))
EVAL_PARALLEL_MIN_SCENARIOS = int(os.environ.get("EVAL_PARALLEL_MIN_SCENARIOS", "4"))

# Partial-credit headline score — penalties reduce by ~order of magnitude, not binary zero.
COLLISION_SCORE_FACTOR = 0.15
CPA_UNSAFE_GOAL_FACTOR = 0.4
HOLD_PROGRESS_FLOOR = 0.25
HOLD_PROGRESS_WEIGHT = 0.75
DEFAULT_GOAL_HOLD_REQUIRED = 30


@dataclass
class EvalResult:
    """Consistent return type from run_eval / aggregate_eval_metrics."""

    metrics: Dict[str, Any]
    traces: List[Dict[str, Any]]


def _closest_goal_range_m(episode: Dict[str, Any]) -> float:
    candidates = [
        episode.get("min_goal_range_m"),
        episode.get("final_goal_range_m"),
    ]
    vals = [float(v) for v in candidates if v is not None]
    return min(vals) if vals else float("inf")


def approach_factor(episode: Dict[str, Any]) -> float:
    """1.0 at the goal; linear falloff to 0 at GOAL_SUCCESS_RANGE_M."""
    closest = _closest_goal_range_m(episode)
    if not math.isfinite(closest):
        return 0.0
    thresh = max(P.GOAL_SUCCESS_RANGE_M, 1e-6)
    return max(0.0, min(1.0, 1.0 - closest / thresh))


def hold_progress_factor(episode: Dict[str, Any]) -> float:
    """Partial credit for stationary hold progress inside the goal zone."""
    if episode.get("success"):
        return 1.0
    required = int(episode.get("goal_hold_required") or DEFAULT_GOAL_HOLD_REQUIRED)
    if required <= 0:
        return 1.0 if episode.get("entered_goal_zone") else 0.0
    steps = int(episode.get("goal_hold_steps") or 0)
    frac = min(1.0, steps / required)
    if episode.get("entered_goal_zone"):
        return HOLD_PROGRESS_FLOOR + HOLD_PROGRESS_WEIGHT * frac
    return HOLD_PROGRESS_WEIGHT * frac


def safety_factor(episode: Dict[str, Any], mode: str) -> float:
    """Soft penalties for collision and CPA-unsafe time in the goal zone."""
    factor = 1.0
    if episode.get("collision"):
        factor *= COLLISION_SCORE_FACTOR
    if colregs_enabled_for_mode(mode) and episode.get("cpa_unsafe_in_goal"):
        factor *= CPA_UNSAFE_GOAL_FACTOR
    return factor


def episode_mission_score(episode: Dict[str, Any], mode: str) -> float:
    """Per-episode score in [0, 1]: approach × hold × safety × energy."""
    core = approach_factor(episode) * hold_progress_factor(episode)
    safety = safety_factor(episode, mode)
    energy = float(episode.get("energy_score") or 1.0)
    return max(0.0, min(1.0, core * safety * energy))


def strict_episode_score(episode: Dict[str, Any], mode: str) -> float:
    """Legacy binary success gate × safety × energy (one episode)."""
    if not episode.get("success"):
        return 0.0
    return max(0.0, min(1.0, safety_factor(episode, mode) * float(episode.get("energy_score") or 1.0)))


def colregs_enabled_for_mode(mode: str) -> bool:
    """COLREGS scoring only applies when training/eval includes traffic."""
    return mode != "navigate"


def default_eval_workers() -> int:
    return max(1, EVAL_WORKERS)


def checkpoint_stem(path: Path | str) -> Path:
    """SB3 save/load stem — path without ``.zip`` suffix."""
    p = Path(path)
    if p.suffix.lower() == ".zip":
        return p.with_suffix("")
    return p


def checkpoint_zip_path(path: Path | str) -> Path:
    """On-disk zip written by ``model.save(stem)``."""
    return checkpoint_stem(path).with_suffix(".zip")


def snapshot_model_for_eval(model: PPO, path: Path) -> Path:
    """Write a temporary checkpoint for worker processes.

    Returns the **stem** path (no ``.zip``) suitable for ``PPO.load``.
    """
    stem = checkpoint_stem(path)
    stem.parent.mkdir(parents=True, exist_ok=True)
    model.save(str(stem))
    return stem


def alloc_eval_snapshot_stem(base_dir: Optional[Path] = None) -> Path:
    """Unique on-disk stem so concurrent eval jobs do not share one zip."""
    root = base_dir or (P.RUNS_DIR / "_eval_snapshots")
    root.mkdir(parents=True, exist_ok=True)
    return root / uuid.uuid4().hex


def _worker_config_dict(
    *,
    model_path: str,
    mode: str,
    goal_hold_sec: int,
    max_episode_steps: int,
    current_enabled: bool,
    plant_jitter: bool,
    nominal_plant: P.PlantParams,
    collect_trace: bool,
    collect_breakdown: bool,
) -> Dict[str, Any]:
    return {
        "model_path": model_path,
        "mode": mode,
        "goal_hold_sec": goal_hold_sec,
        "max_episode_steps": max_episode_steps,
        "current_enabled": current_enabled,
        "plant_jitter": plant_jitter,
        "nominal_plant": nominal_plant.to_dict(),
        "collect_trace": collect_trace,
        "collect_breakdown": collect_breakdown,
    }


def _eval_scenario_worker(payload: Tuple[Dict[str, Any], Dict[str, Any]]) -> Dict[str, Any]:
    """Process-pool entry: rollout one scenario (loads policy per worker process)."""
    scenario_dict, cfg = payload
    from env import BoatNavEnv

    scenario = P.ScenarioSeed(**scenario_dict)
    plant = P.plant_from_dict(cfg["nominal_plant"])
    model = PPO.load(cfg["model_path"], device="cpu")
    env = BoatNavEnv(
        mode=cfg["mode"],
        training_randomize=False,
        nominal_plant=plant,
        dynamics_jitter=bool(cfg["plant_jitter"]),
        goal_hold_sec=int(cfg["goal_hold_sec"]),
        max_episode_steps=int(cfg["max_episode_steps"]),
        current_enabled=bool(cfg["current_enabled"]),
        include_reward_breakdown=bool(cfg["collect_breakdown"]),
    )
    episode = env.rollout_episode(
        model,
        reset_seed=scenario.seed,
        scenario=scenario,
        collect_trace=bool(cfg["collect_trace"]),
    )
    episode["seed"] = scenario.seed
    episode["mode"] = cfg["mode"]
    episode["scenario_name"] = scenario.name
    episode["scenario_category"] = scenario.category
    episode["scenario_description"] = scenario.description
    return episode


def rollout_episodes_sequential(
    model: PPO,
    scenarios: List[P.ScenarioSeed],
    *,
    mode: str,
    goal_hold_sec: int,
    max_episode_steps: int,
    current_enabled: bool,
    plant_jitter: bool,
    nominal_plant: P.PlantParams,
    collect_trace: bool,
    collect_breakdown: bool,
) -> List[Dict[str, Any]]:
    from env import BoatNavEnv

    env = BoatNavEnv(
        mode=mode,
        training_randomize=False,
        nominal_plant=nominal_plant,
        dynamics_jitter=plant_jitter,
        goal_hold_sec=goal_hold_sec,
        max_episode_steps=max_episode_steps,
        current_enabled=current_enabled,
        include_reward_breakdown=collect_breakdown,
    )
    episodes: List[Dict[str, Any]] = []
    for scenario in scenarios:
        episode = env.rollout_episode(
            model,
            reset_seed=scenario.seed,
            scenario=scenario,
            collect_trace=collect_trace,
        )
        episode["seed"] = scenario.seed
        episode["mode"] = mode
        episode["scenario_name"] = scenario.name
        episode["scenario_category"] = scenario.category
        episode["scenario_description"] = scenario.description
        episodes.append(episode)
    return episodes


def rollout_episodes_parallel(
    model_path: str,
    scenarios: List[P.ScenarioSeed],
    cfg: Dict[str, Any],
    *,
    workers: int,
) -> List[Dict[str, Any]]:
    payloads = [(asdict(s), cfg) for s in scenarios]
    chunksize = max(1, len(payloads) // (workers * 4))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_eval_scenario_worker, payloads, chunksize=chunksize))


def rollout_episodes(
    model: PPO,
    scenarios: List[P.ScenarioSeed],
    *,
    mode: str,
    goal_hold_sec: int,
    max_episode_steps: int,
    current_enabled: bool,
    plant_jitter: bool,
    nominal_plant: P.PlantParams,
    collect_trace: bool,
    collect_breakdown: bool,
    workers: Optional[int] = None,
    snapshot_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    n_workers = default_eval_workers() if workers is None else max(1, int(workers))
    if n_workers <= 1 or len(scenarios) < EVAL_PARALLEL_MIN_SCENARIOS:
        return rollout_episodes_sequential(
            model,
            scenarios,
            mode=mode,
            goal_hold_sec=goal_hold_sec,
            max_episode_steps=max_episode_steps,
            current_enabled=current_enabled,
            plant_jitter=plant_jitter,
            nominal_plant=nominal_plant,
            collect_trace=collect_trace,
            collect_breakdown=collect_breakdown,
        )

    snap = snapshot_path or alloc_eval_snapshot_stem()
    stem = snapshot_model_for_eval(model, snap)
    zip_path = checkpoint_zip_path(stem)
    try:
        cfg = _worker_config_dict(
            model_path=str(stem),
            mode=mode,
            goal_hold_sec=goal_hold_sec,
            max_episode_steps=max_episode_steps,
            current_enabled=current_enabled,
            plant_jitter=plant_jitter,
            nominal_plant=nominal_plant,
            collect_trace=collect_trace,
            collect_breakdown=collect_breakdown,
        )
        return rollout_episodes_parallel(str(stem), scenarios, cfg, workers=n_workers)
    finally:
        zip_path.unlink(missing_ok=True)


def aggregate_eval_metrics(
    episode_results: List[Dict[str, Any]],
    seeds: List[P.ScenarioSeed],
    mode: str,
    *,
    eval_seed_list_count: int,
    train_scenario_count: int,
    plant_jitter: bool,
    current_enabled: bool,
    nominal_plant: P.PlantParams,
    collect_traces: bool,
    colregs_enabled: Optional[bool] = None,
) -> EvalResult:
    if colregs_enabled is None:
        colregs_enabled = colregs_enabled_for_mode(mode)

    traces: List[Dict[str, Any]] = []
    colregs_episode_scores: List[Dict[str, Any]] = []
    successes = 0
    collisions = 0
    cpa_violations_in_goal = 0
    final_ranges: List[float] = []
    energy_scores: List[float] = []
    speed_samples: List[float] = []
    goal_zone_speed_samples: List[float] = []
    zone_entries = 0

    if colregs_enabled and collect_traces:
        from colregs.evaluate import evaluate_episode, rollup_episodes
    else:
        evaluate_episode = None  # type: ignore
        rollup_episodes = None  # type: ignore

    for episode in episode_results:
        if collect_traces:
            traces.append(episode)
            if (
                colregs_enabled
                and evaluate_episode is not None
                and episode.get("steps")
            ):
                colregs = evaluate_episode(episode)
                episode["colregs"] = colregs
                if colregs.get("mean_safety_S") is not None:
                    colregs_episode_scores.append(colregs)
        if episode.get("success"):
            successes += 1
        if episode.get("collision"):
            collisions += 1
        if episode.get("cpa_unsafe_in_goal"):
            cpa_violations_in_goal += 1
        rng_val = episode.get("final_goal_range_m")
        if rng_val is not None:
            final_ranges.append(float(rng_val))
        es = episode.get("energy_score")
        if es is not None:
            energy_scores.append(float(es))
        if episode.get("entered_goal_zone"):
            zone_entries += 1
        ms = episode.get("mean_speed_mps")
        if ms is not None:
            speed_samples.append(float(ms))
        gz_speeds = episode.get("goal_zone_speeds") or []
        goal_zone_speed_samples.extend(float(s) for s in gz_speeds)

    episodes = len(seeds)
    success_rate = successes / episodes if episodes else 0.0
    collision_rate = collisions / episodes if episodes else 0.0
    mean_energy_score = float(np.mean(energy_scores)) if energy_scores else 1.0
    mission_scores = [episode_mission_score(ep, mode) for ep in episode_results]
    mean_mission_score = float(np.mean(mission_scores)) if mission_scores else 0.0
    strict_nav = success_rate * mean_energy_score
    strict_avoid = success_rate * (1.0 - collision_rate) * mean_energy_score
    nav_score = mean_mission_score if mode == "navigate" else strict_nav
    avoid_score = mean_mission_score if mode == "avoid" else strict_avoid
    avg_final_goal_range_m = float(np.mean(final_ranges)) if final_ranges else None
    median_final_goal_range_m = float(np.median(final_ranges)) if final_ranges else None
    at_min_goal_zone = [s for s in goal_zone_speed_samples if s <= HOLD_AT_STOP_EPS_MPS]

    metrics: Dict[str, Any] = {
        "mode": mode,
        "eval_episodes": episodes,
        "eval_scenarios": episodes,
        "success_rate": round(success_rate, 4),
        "collision_rate": round(collision_rate, 4),
        "cpa_violation_in_goal_rate": round(cpa_violations_in_goal / episodes, 4) if episodes else 0.0,
        "mean_energy_score": round(mean_energy_score, 4),
        "mean_speed_mps": round(float(np.mean(speed_samples)), 3) if speed_samples else None,
        "mean_goal_zone_speed_mps": (
            round(float(np.mean(goal_zone_speed_samples)), 3) if goal_zone_speed_samples else None
        ),
        "pct_goal_zone_at_min_speed": (
            round(len(at_min_goal_zone) / len(goal_zone_speed_samples), 4)
            if goal_zone_speed_samples
            else None
        ),
        "episodes_with_goal_zone_steps": zone_entries,
        "reward_breakdown_mean": aggregate_episode_breakdowns(episode_results),
        "mean_mission_score": round(mean_mission_score, 4),
        "nav_score": round(nav_score, 4),
        "avoid_score": round(avoid_score, 4),
        "nav_score_strict": round(strict_nav, 4),
        "avoid_score_strict": round(strict_avoid, 4),
        "avg_final_goal_range_m": round(avg_final_goal_range_m, 2) if avg_final_goal_range_m is not None else None,
        "median_final_goal_range_m": (
            round(median_final_goal_range_m, 2) if median_final_goal_range_m is not None else None
        ),
        "goal_success_threshold_m": P.GOAL_SUCCESS_RANGE_M,
        "eval_scenario_count": eval_seed_list_count,
        "train_scenario_count": train_scenario_count,
        "scenario_names": [s.name for s in seeds],
        "eval_dynamics_jitter": plant_jitter,
        "eval_current_enabled": current_enabled,
        "eval_nominal_plant": nominal_plant.to_dict(),
        "eval_plant": nominal_plant.to_dict(),
        "eval_parallel_workers": default_eval_workers(),
    }
    if colregs_episode_scores and rollup_episodes is not None:
        metrics.update(rollup_episodes(colregs_episode_scores))
    return EvalResult(metrics=metrics, traces=traces if collect_traces else [])


def run_eval_from_snapshot(
    snapshot_stem: str,
    mode: str,
    max_scenarios: Optional[int] = None,
    sample_seed: Optional[int] = None,
    eval_plant: Optional[P.PlantParams] = None,
    dynamics_jitter: Optional[bool] = None,
    current_enabled: Optional[bool] = None,
    collect_traces: bool = True,
    collect_breakdown: bool = True,
    workers: Optional[int] = None,
) -> Any:
    """Load policy from snapshot path and run eval (for async background thread)."""
    from train import run_eval

    stem = checkpoint_stem(snapshot_stem)
    zip_path = checkpoint_zip_path(stem)
    model = PPO.load(str(stem), device="cpu")
    try:
        return run_eval(
            model,
            mode,
            max_scenarios=max_scenarios,
            sample_seed=sample_seed,
            eval_plant=eval_plant,
            dynamics_jitter=dynamics_jitter,
            current_enabled=current_enabled,
            collect_traces=collect_traces,
            collect_breakdown=collect_breakdown,
            workers=workers,
        )
    finally:
        zip_path.unlink(missing_ok=True)
