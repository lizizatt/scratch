"""Persist training run artifacts (metrics, traces, checkpoints)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from stable_baselines3 import PPO

import train_config as C
from rewards import gated_hold_enabled, reward_weights_dict
from train_job_state import RUNS_DIR


def load_parent_metrics(resume_run_id: str) -> Dict[str, Any]:
    path = RUNS_DIR / resume_run_id / "metrics.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def create_run_dir() -> Path:
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    latest = RUNS_DIR / "latest"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    try:
        latest.symlink_to(run_dir.name, target_is_directory=True)
    except OSError:
        (RUNS_DIR / "latest.txt").write_text(run_dir.name, encoding="utf-8")
    return run_dir


def write_run_outputs(
    run_dir: Path,
    metrics: Dict[str, Any],
    traces: List[Dict[str, Any]],
    train_metrics: Dict[str, Any],
    model: PPO,
    resume_run_id: Optional[str] = None,
    parent_metrics: Optional[Dict[str, Any]] = None,
) -> None:
    parent_metrics = parent_metrics or {}
    train_session = int(parent_metrics.get("train_session", 1)) + 1 if resume_run_id else 1
    prev_cumulative = float(parent_metrics.get("cumulative_train_sec", 0) or 0)
    elapsed = float(train_metrics.get("train_elapsed_sec", 0) or 0)

    payload = {
        **metrics,
        **train_metrics,
        "notes": C.NOTES,
        "parent_run_id": resume_run_id,
        "train_session": train_session,
        "cumulative_train_sec": round(prev_cumulative + elapsed, 1),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "mode": C.MODE,
            "net_arch": C.NET_ARCH,
            "learning_rate": C.LEARNING_RATE,
            "n_envs": C.N_ENVS,
            "rollout_steps_total": train_metrics.get("rollout_steps_total"),
            "steps_per_env": train_metrics.get("steps_per_env"),
            "vecenv_backend": train_metrics.get("vecenv_backend"),
            "device": train_metrics.get("device"),
            "dynamics_jitter": train_metrics.get("dynamics_jitter"),
            "robust_eval_enabled": train_metrics.get("robust_eval_enabled"),
            "nominal_plant": train_metrics.get("nominal_plant"),
            "goal_hold_sec": train_metrics.get("goal_hold_sec"),
            "max_steps": train_metrics.get("max_steps"),
            "current_enabled": train_metrics.get("current_enabled"),
            "montage_enabled": C.MONTAGE_ENABLED,
            "snapshot_interval_sec": train_metrics.get("snapshot_interval_sec"),
            "train_max_contacts": C.TRAIN_MAX_CONTACTS,
            "reward_weights": reward_weights_dict(),
            "curriculum_phase": C.CURRICULUM_PHASE,
            "gated_hold": gated_hold_enabled(),
            "scenario_category_prefixes": list(C.SCENARIO_CATEGORY_PREFIXES),
        },
        "viz_url": f"http://localhost:{C.VIZ_PORT}/scenarios.html?run={run_dir.name}",
    }
    (run_dir / "metrics.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (run_dir / "eval_traces.json").write_text(
        json.dumps({"episodes": traces}, separators=(",", ":")), encoding="utf-8"
    )
    model.save(str(run_dir / "model"))

    if C.MONTAGE_ENABLED and traces:
        try:
            import render_montage as RM

            montage_meta = RM.write_eval_montages(
                run_dir,
                traces,
                max_episodes=C.MONTAGE_MAX_EPISODES,
                step_cols=C.MONTAGE_STEP_COLS,
            )
            payload["montage"] = montage_meta
            (run_dir / "metrics.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
            print(
                f"[montage] wrote step + trajectory PNGs in {montage_meta['montage_sec']}s "
                f"({montage_meta['step_montage']['episodes_shown']}/"
                f"{montage_meta['step_montage']['episodes_total']} episodes)"
            )
        except Exception as exc:
            print(f"[montage] skipped: {exc}")
