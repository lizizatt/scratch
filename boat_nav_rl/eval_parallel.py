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
from rewards import HOLD_AT_STOP_EPS_MPS, aggregate_episode_breakdowns, energy_score_from_speeds

EVAL_WORKERS = int(os.environ.get("EVAL_WORKERS", str(max(1, os.cpu_count() or 4))))
EVAL_PARALLEL_MIN_SCENARIOS = int(os.environ.get("EVAL_PARALLEL_MIN_SCENARIOS", "4"))

# Mission score v3 — adds path directness (cross-track) to favor straight legs over wide arcs.
MISSION_SCORE_VERSION = 3
COLLISION_SCORE_FACTOR = 0.08
CPA_UNSAFE_GOAL_FACTOR = 0.45
DEFAULT_GOAL_HOLD_REQUIRED = 30
APPROACH_FALLBACK_SCALE_M = 200.0
APPROACH_MIN_RANGE_WEIGHT = 0.45
APPROACH_FINAL_RANGE_WEIGHT = 0.55
ENERGY_SCORE_BLEND = 0.25
DIRECTNESS_SCORE_BLEND = 0.22
DIRECTNESS_SCORE_SCALE_M = 60.0
DIRECTNESS_MAX_SCALE_MULT = 1.25  # goal-zone efficiency only; cruise is neutral


@dataclass
class EvalResult:
    """Consistent return type from run_eval / aggregate_eval_metrics."""

    metrics: Dict[str, Any]
    traces: List[Dict[str, Any]]


def _episode_range_m(episode: Dict[str, Any], key: str) -> Optional[float]:
    val = episode.get(key)
    if val is None:
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _approach_scale_m(episode: Dict[str, Any]) -> float:
    initial = _episode_range_m(episode, "initial_goal_range_m")
    if initial is not None and initial > P.GOAL_SUCCESS_RANGE_M:
        return initial
    return APPROACH_FALLBACK_SCALE_M


def _range_quality(range_m: float, scale_m: float) -> float:
    scale = max(scale_m, P.GOAL_SUCCESS_RANGE_M, 1e-6)
    return max(0.0, min(1.0, 1.0 - range_m / scale))


def approach_factor(episode: Dict[str, Any]) -> float:
    """Geometric blend of min/final range quality — penalizes fly-bys that end far away."""
    scale = _approach_scale_m(episode)
    mn = _episode_range_m(episode, "min_goal_range_m")
    fin = _episode_range_m(episode, "final_goal_range_m")
    if mn is None and fin is None:
        return 0.0
    if mn is None:
        mn = fin
    if fin is None:
        fin = mn
    q_min = _range_quality(mn, scale)
    q_fin = _range_quality(fin, scale)
    return math.sqrt(max(0.0, q_min * q_fin))


def hold_multiplier(episode: Dict[str, Any]) -> float:
    """Hold credit only after zone entry with stationary steps; skipped if never entered."""
    if episode.get("success"):
        return 1.0
    if not episode.get("entered_goal_zone"):
        return 1.0
    steps = int(episode.get("goal_hold_steps") or 0)
    if steps <= 0:
        return 0.0
    required = int(episode.get("goal_hold_required") or DEFAULT_GOAL_HOLD_REQUIRED)
    if required <= 0:
        return 1.0
    return min(1.0, steps / required)


def hold_progress_factor(episode: Dict[str, Any]) -> float:
    """Alias for hold_multiplier (legacy name)."""
    return hold_multiplier(episode)


def _cpa_unsafe_for_scoring(episode: Dict[str, Any], mode: str) -> bool:
    if not colregs_enabled_for_mode(mode):
        return False
    if "cpa_unsafe_at_end" in episode:
        return bool(episode.get("cpa_unsafe_at_end"))
    return bool(episode.get("cpa_unsafe_in_goal"))


def safety_factor(episode: Dict[str, Any], mode: str) -> float:
    """Soft penalties for collision and CPA-unsafe at episode end."""
    factor = 1.0
    if episode.get("collision"):
        factor *= COLLISION_SCORE_FACTOR
    if _cpa_unsafe_for_scoring(episode, mode):
        factor *= CPA_UNSAFE_GOAL_FACTOR
    return factor


def energy_factor(episode: Dict[str, Any]) -> float:
    """Goal-zone stopping efficiency; en-route cruise is neutral (1.0)."""
    speeds = episode.get("goal_zone_speeds") or []
    if not speeds:
        return 1.0
    return energy_score_from_speeds(speeds)


def directness_factor(episode: Dict[str, Any]) -> float:
    """Penalize wide arcs via en-route cross-track (mean × max geometric blend)."""
    mean_ct = _episode_range_m(episode, "mean_cross_track_m")
    max_ct = _episode_range_m(episode, "max_cross_track_m")
    if mean_ct is None and max_ct is None:
        mean_ct, max_ct = _cross_track_from_trace(episode)
    if mean_ct is None and max_ct is None:
        return 1.0
    if mean_ct is None:
        mean_ct = max_ct
    if max_ct is None:
        max_ct = mean_ct
    scale = DIRECTNESS_SCORE_SCALE_M
    q_mean = _range_quality(mean_ct, scale)
    q_max = _range_quality(max_ct, scale * DIRECTNESS_MAX_SCALE_MULT)
    return math.sqrt(max(0.0, q_mean * q_max))


def _cross_track_from_trace(episode: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    """Fallback for traces saved before cross-track stats were recorded."""
    steps = episode.get("steps") or []
    if len(steps) < 2:
        return None, None
    start = steps[0]
    goal = start.get("goal") or {}
    leg_x = float((start.get("own") or {}).get("x", 0.0))
    leg_y = float((start.get("own") or {}).get("y", 0.0))
    goal_x = float(goal.get("x", 0.0))
    goal_y = float(goal.get("y", 0.0))
    samples: List[float] = []
    for step in steps[1:]:
        own = step.get("own") or {}
        gr = math.hypot(goal_x - float(own.get("x", 0.0)), goal_y - float(own.get("y", 0.0)))
        if gr < P.GOAL_SUCCESS_RANGE_M:
            continue
        samples.append(
            P.cross_track_m(leg_x, leg_y, goal_x, goal_y, float(own.get("x", 0.0)), float(own.get("y", 0.0)))
        )
    if not samples:
        return None, None
    return float(sum(samples) / len(samples)), float(max(samples))


def episode_mission_score(episode: Dict[str, Any], mode: str) -> float:
    """Per-episode score in [0, 1]: approach × hold × safety × directness × energy."""
    approach = approach_factor(episode)
    hold = hold_multiplier(episode)
    safety = safety_factor(episode, mode)
    directness = directness_factor(episode)
    energy = energy_factor(episode)
    core = approach * hold * safety
    direct_blend = (1.0 - DIRECTNESS_SCORE_BLEND) + DIRECTNESS_SCORE_BLEND * directness
    energy_blend = (1.0 - ENERGY_SCORE_BLEND) + ENERGY_SCORE_BLEND * energy
    return max(0.0, min(1.0, core * direct_blend * energy_blend))


def episode_mission_score_breakdown(episode: Dict[str, Any], mode: str) -> Dict[str, float]:
    """Component factors for debugging / montage tooltips."""
    approach = approach_factor(episode)
    hold = hold_multiplier(episode)
    safety = safety_factor(episode, mode)
    directness = directness_factor(episode)
    energy = energy_factor(episode)
    direct_blend = (1.0 - DIRECTNESS_SCORE_BLEND) + DIRECTNESS_SCORE_BLEND * directness
    energy_blend = (1.0 - ENERGY_SCORE_BLEND) + ENERGY_SCORE_BLEND * energy
    return {
        "approach": round(approach, 4),
        "hold": round(hold, 4),
        "safety": round(safety, 4),
        "directness": round(directness, 4),
        "directness_blend": round(direct_blend, 4),
        "energy": round(energy, 4),
        "energy_blend": round(energy_blend, 4),
        "mission": round(episode_mission_score(episode, mode), 4),
    }


def strict_episode_score(episode: Dict[str, Any], mode: str) -> float:
    """Legacy binary success gate × safety × energy (one episode)."""
    if not episode.get("success"):
        return 0.0
    return max(0.0, min(1.0, safety_factor(episode, mode) * energy_factor(episode)))


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


_WORKER_MODEL: Optional[PPO] = None
_WORKER_MODEL_PATH: Optional[str] = None


def _init_eval_worker(model_path: str) -> None:
    global _WORKER_MODEL, _WORKER_MODEL_PATH
    _WORKER_MODEL_PATH = model_path
    _WORKER_MODEL = PPO.load(model_path, device="cpu")


def _eval_scenario_worker(payload: Tuple[Dict[str, Any], Dict[str, Any]]) -> Dict[str, Any]:
    """Process-pool entry: rollout one scenario (reuses model loaded in worker init)."""
    global _WORKER_MODEL, _WORKER_MODEL_PATH
    scenario_dict, cfg = payload
    from env import BoatNavEnv

    scenario = P.ScenarioSeed(**scenario_dict)
    plant = P.plant_from_dict(cfg["nominal_plant"])
    model_path = cfg["model_path"]
    if _WORKER_MODEL is None or _WORKER_MODEL_PATH != model_path:
        _WORKER_MODEL_PATH = model_path
        _WORKER_MODEL = PPO.load(model_path, device="cpu")
    model = _WORKER_MODEL
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
    with ProcessPoolExecutor(
        max_workers=workers,
        initializer=_init_eval_worker,
        initargs=(model_path,),
    ) as pool:
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
        episode["mission_score"] = round(episode_mission_score(episode, mode), 4)
        episode["mission_score_version"] = MISSION_SCORE_VERSION
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
    from eval_runner import run_eval

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
