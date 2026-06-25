"""Policy evaluation rollouts and metric aggregation."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
from stable_baselines3 import PPO

import prepare as P
import train_config as C
from eval_parallel import (
    EvalResult,
    aggregate_eval_metrics,
    colregs_enabled_for_mode,
    rollout_episodes,
)
from runs_util import score_key_for_mode
from scenario_seeds import eval_seeds_for_mode, train_seeds_for_mode


def run_eval(
    model: PPO,
    mode: str,
    max_scenarios: Optional[int] = None,
    sample_seed: Optional[int] = None,
    eval_plant: Optional[P.PlantParams] = None,
    dynamics_jitter: Optional[bool] = None,
    current_enabled: Optional[bool] = None,
    collect_traces: bool = True,
    collect_breakdown: bool = True,
    workers: Optional[int] = None,
) -> EvalResult:
    seeds = eval_seeds_for_mode(mode)
    if max_scenarios is not None and max_scenarios < len(seeds):
        rng = np.random.default_rng(sample_seed if sample_seed is not None else 0)
        picks = rng.choice(len(seeds), size=max_scenarios, replace=False)
        seeds = [seeds[i] for i in sorted(int(x) for x in picks)]
    cur_enabled = C.CURRENT_ENABLED if current_enabled is None else current_enabled
    if eval_plant is not None:
        plant_jitter = False
        nominal_plant = eval_plant
    else:
        nominal_plant = C.NOMINAL_PLANT
        plant_jitter = False
    if dynamics_jitter is not None:
        plant_jitter = dynamics_jitter

    episode_results = rollout_episodes(
        model,
        seeds,
        mode=mode,
        goal_hold_sec=C.GOAL_HOLD_SEC,
        max_episode_steps=C.MAX_EPISODE_STEPS,
        current_enabled=cur_enabled,
        plant_jitter=plant_jitter,
        nominal_plant=nominal_plant,
        collect_trace=collect_traces,
        collect_breakdown=collect_breakdown,
        workers=workers,
    )
    return aggregate_eval_metrics(
        episode_results,
        seeds,
        mode,
        eval_seed_list_count=len(eval_seeds_for_mode(mode)),
        train_scenario_count=len(train_seeds_for_mode(mode)),
        plant_jitter=plant_jitter,
        current_enabled=cur_enabled,
        nominal_plant=nominal_plant,
        collect_traces=collect_traces,
        colregs_enabled=colregs_enabled_for_mode(mode),
    )


def run_robust_eval(model: PPO, mode: str) -> Dict[str, Any]:
    """Sample random plants (agile↔freighter) and score on eval scenario subsets."""
    score_key = score_key_for_mode(mode)
    scores: List[float] = []
    plant_records: List[Dict[str, float]] = []
    for i in range(C.ROBUST_EVAL_SAMPLES):
        rng = np.random.default_rng(9001 + i)
        plant = P.sample_plant_params(rng)
        metrics = run_eval(
            model,
            mode,
            max_scenarios=C.ROBUST_EVAL_SCENARIOS,
            sample_seed=8000 + i,
            eval_plant=plant,
            collect_traces=False,
        ).metrics
        scores.append(float(metrics[score_key]))
        plant_records.append(plant.to_dict())
    arr = np.array(scores, dtype=np.float64)
    return {
        "robust_eval_score": round(float(arr.mean()), 4),
        "robust_eval_worst": round(float(arr.min()), 4),
        "robust_eval_samples": C.ROBUST_EVAL_SAMPLES,
        "robust_eval_scenarios_per_sample": C.ROBUST_EVAL_SCENARIOS,
        "robust_eval_plants": plant_records,
    }
