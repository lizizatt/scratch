"""Training job paths and live-metrics state shared by train.py and callbacks."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent
RUNS_DIR = ROOT / "runs"
JOB_DIR = RUNS_DIR / "_training"
STATUS_PATH = JOB_DIR / "status.json"
CANCEL_FLAG_PATH = JOB_DIR / "cancel.flag"
LIVE_METRICS_PATH = JOB_DIR / "live_metrics.json"
LIVE_METRICS_MAX_POINTS = int(os.environ.get("LIVE_METRICS_MAX_POINTS", "500"))


def is_cancel_requested() -> bool:
    return CANCEL_FLAG_PATH.exists()


def clear_cancel_flag() -> None:
    if CANCEL_FLAG_PATH.exists():
        CANCEL_FLAG_PATH.unlink()


def live_eval_extras(metrics: Dict[str, Any]) -> Dict[str, Any]:
    extras: Dict[str, Any] = {}
    for key in (
        "success_rate",
        "mean_speed_mps",
        "mean_goal_zone_speed_mps",
        "pct_goal_zone_at_min_speed",
    ):
        if metrics.get(key) is not None:
            extras[key] = metrics[key]
    bd = metrics.get("reward_breakdown_mean") or metrics.get("reward_breakdown")
    if bd:
        extras["reward_breakdown"] = bd
    return extras


def update_job_status(**fields: Any) -> None:
    JOB_DIR.mkdir(parents=True, exist_ok=True)
    current: Dict[str, Any] = {"running": True, "state": "running"}
    if STATUS_PATH.exists():
        try:
            current.update(json.loads(STATUS_PATH.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            pass
    current.update(fields)
    STATUS_PATH.write_text(json.dumps(current, indent=2), encoding="utf-8")


def append_live_metric(
    run_id: str,
    mode: str,
    timesteps: int,
    elapsed_sec: float,
    score: float,
    avg_final_goal_range_m: float,
    *,
    successes: int = 0,
    eval_episodes: int = 0,
    scenario_names: Optional[List[str]] = None,
    eval_metrics: Optional[Dict[str, Any]] = None,
) -> None:
    JOB_DIR.mkdir(parents=True, exist_ok=True)
    payload: Dict[str, Any] = {"run_id": run_id, "mode": mode, "series": []}
    if LIVE_METRICS_PATH.exists():
        try:
            payload = json.loads(LIVE_METRICS_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    point: Dict[str, Any] = {
        "t_sec": round(elapsed_sec, 1),
        "timesteps": timesteps,
        "score": round(score, 4),
        "avg_final_goal_range_m": round(avg_final_goal_range_m, 2),
        "successes": successes,
        "eval_episodes": eval_episodes,
        "live": True,
    }
    if scenario_names:
        point["scenario_names"] = scenario_names
    if eval_metrics:
        for key, val in eval_metrics.items():
            if val is not None:
                point[key] = val
    series = payload.setdefault("series", [])
    series.append(point)
    if len(series) > LIVE_METRICS_MAX_POINTS:
        payload["series"] = series[-LIVE_METRICS_MAX_POINTS:]
    LIVE_METRICS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    update_job_status(
        live_score=round(score, 4),
        live_avg_goal_range_m=round(avg_final_goal_range_m, 2),
        live_timesteps=timesteps,
        live_elapsed_sec=round(elapsed_sec, 1),
        live_successes=successes,
        live_eval_episodes=eval_episodes,
    )
