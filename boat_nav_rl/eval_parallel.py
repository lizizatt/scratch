"""Parallel eval rollouts and metric aggregation."""

from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
from stable_baselines3 import PPO

import prepare as P
from rewards import HOLD_AT_STOP_EPS_MPS, aggregate_episode_breakdowns

EVAL_WORKERS = int(os.environ.get("EVAL_WORKERS", str(max(1, os.cpu_count() or 4))))
EVAL_PARALLEL_MIN_SCENARIOS = int(os.environ.get("EVAL_PARALLEL_MIN_SCENARIOS", "4"))


def colregs_enabled_for_mode(mode: str) -> bool:
    """COLREGS scoring only applies when training/eval includes traffic."""
    return mode != "navigate"


def default_eval_workers() -> int:
    return max(1, EVAL_WORKERS)


def snapshot_model_for_eval(model: PPO, path: Path) -> Path:
    """Write a temporary checkpoint for worker processes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    stem = str(path.with_suffix(""))
    model.save(stem)
    return Path(f"{stem}.zip")


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
    from train import BoatNavEnv

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
    from train import BoatNavEnv

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

    snap = snapshot_path or (P.RUNS_DIR / "_eval_snapshot")
    zip_path = snapshot_model_for_eval(model, snap)
    try:
        cfg = _worker_config_dict(
            model_path=str(zip_path),
            mode=mode,
            goal_hold_sec=goal_hold_sec,
            max_episode_steps=max_episode_steps,
            current_enabled=current_enabled,
            plant_jitter=plant_jitter,
            nominal_plant=nominal_plant,
            collect_trace=collect_trace,
            collect_breakdown=collect_breakdown,
        )
        return rollout_episodes_parallel(str(zip_path), scenarios, cfg, workers=n_workers)
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
) -> Union[Dict[str, Any], Tuple[Dict[str, Any], List[Dict[str, Any]]]]:
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
    nav_score = success_rate * mean_energy_score
    avoid_score = success_rate * (1.0 - collision_rate) * mean_energy_score
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
        "nav_score": round(nav_score, 4),
        "avoid_score": round(avoid_score, 4),
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
    if collect_traces:
        return metrics, traces
    return metrics


def run_eval_from_snapshot(
    snapshot_zip: str,
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

    model = PPO.load(snapshot_zip, device="cpu")
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
        Path(snapshot_zip).unlink(missing_ok=True)
