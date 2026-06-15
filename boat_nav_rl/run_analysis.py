"""Summarize eval traces — especially stopping / energy behavior."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import prepare as P
from rewards import APPROACH_SLOW_RANGE_M, HOLD_AT_STOP_EPS_MPS, energy_score_from_speeds
from runs_util import score_from_metrics, score_key_for_mode


def _goal_range_m(step: Dict[str, Any]) -> float:
    own = step["own"]
    goal = step["goal"]
    dx = float(goal["x"]) - float(own["x"])
    dy = float(goal["y"]) - float(own["y"])
    return math.hypot(dx, dy)


def episode_diagnostics(episode: Dict[str, Any]) -> Dict[str, Any]:
    steps: Sequence[Dict[str, Any]] = episode.get("steps") or []
    speeds = [float(s["own"]["speed"]) for s in steps if s.get("own")]
    goal_zone_speeds = [
        float(s["own"]["speed"])
        for s in steps
        if s.get("own") and _goal_range_m(s) <= P.GOAL_SUCCESS_RANGE_M
    ]
    at_min_in_zone = [s for s in goal_zone_speeds if s <= HOLD_AT_STOP_EPS_MPS]

    return {
        "scenario_name": episode.get("scenario_name"),
        "success": bool(episode.get("success")),
        "collision": bool(episode.get("collision")),
        "energy_score": episode.get("energy_score"),
        "mean_speed_mps": round(sum(speeds) / len(speeds), 3) if speeds else None,
        "mean_goal_zone_speed_mps": (
            round(sum(goal_zone_speeds) / len(goal_zone_speeds), 3)
            if goal_zone_speeds
            else None
        ),
        "goal_zone_steps": len(goal_zone_speeds),
        "pct_goal_zone_at_min_speed": (
            round(len(at_min_in_zone) / len(goal_zone_speeds), 4)
            if goal_zone_speeds
            else None
        ),
    }


def summarize_run(run_dir: Path) -> Dict[str, Any]:
    metrics_path = run_dir / "metrics.json"
    traces_path = run_dir / "eval_traces.json"
    if not metrics_path.exists():
        raise FileNotFoundError(f"No metrics.json in {run_dir}")

    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    mode = str(metrics.get("mode", P.DEFAULT_MODE))
    score_key = score_key_for_mode(mode)

    episodes: List[Dict[str, Any]] = []
    if traces_path.exists():
        raw = json.loads(traces_path.read_text(encoding="utf-8"))
        episodes = list(raw.get("episodes") or [])

    per_ep = [episode_diagnostics(ep) for ep in episodes]
    all_speeds = [
        float(s["own"]["speed"])
        for ep in episodes
        for s in (ep.get("steps") or [])
        if s.get("own")
    ]
    goal_zone_speeds = [
        float(s["own"]["speed"])
        for ep in episodes
        for s in (ep.get("steps") or [])
        if s.get("own") and _goal_range_m(s) <= P.GOAL_SUCCESS_RANGE_M
    ]
    approach_speeds = [
        float(s["own"]["speed"])
        for ep in episodes
        for s in (ep.get("steps") or [])
        if s.get("own")
        and P.GOAL_SUCCESS_RANGE_M < _goal_range_m(s) <= APPROACH_SLOW_RANGE_M
    ]
    success_eps = [d for d in per_ep if d["success"]]
    success_zone_speeds = [
        d["mean_goal_zone_speed_mps"]
        for d in success_eps
        if d.get("mean_goal_zone_speed_mps") is not None
    ]

    def _mean(vals: List[float]) -> Optional[float]:
        return round(sum(vals) / len(vals), 3) if vals else None

    at_min = [s for s in goal_zone_speeds if s <= HOLD_AT_STOP_EPS_MPS]

    summary: Dict[str, Any] = {
        "run_id": run_dir.name,
        "mode": mode,
        "score_key": score_key,
        "score": metrics.get(score_key),
        "success_rate": metrics.get("success_rate"),
        "collision_rate": metrics.get("collision_rate"),
        "mean_energy_score": metrics.get("mean_energy_score"),
        "eval_episodes": metrics.get("eval_episodes"),
        "notes": metrics.get("notes"),
        "reward_weights": (metrics.get("config") or {}).get("reward_weights"),
        "mean_speed_mps": _mean(all_speeds),
        "mean_approach_speed_mps": _mean(approach_speeds),
        "mean_goal_zone_speed_mps": _mean(goal_zone_speeds),
        "curriculum_phase": (metrics.get("config") or {}).get("curriculum_phase"),
        "gated_hold": (metrics.get("config") or {}).get("gated_hold"),
        "pct_goal_zone_at_min_speed": (
            round(len(at_min) / len(goal_zone_speeds), 4) if goal_zone_speeds else None
        ),
        "mean_success_goal_zone_speed_mps": _mean(success_zone_speeds),
        "trace_energy_score": (
            round(energy_score_from_speeds(all_speeds), 4) if all_speeds else None
        ),
        "episodes_with_goal_zone_steps": sum(
            1 for d in per_ep if (d.get("goal_zone_steps") or 0) > 0
        ),
    }
    return summary
