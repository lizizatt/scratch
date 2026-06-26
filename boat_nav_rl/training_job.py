#!/usr/bin/env python3
"""Launch and monitor training jobs from the viz server."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from vecenv_util import recommended_n_envs
import prepare as P
from runs_util import safe_run_dir, score_from_metrics, validate_run_id

ROOT = Path(__file__).resolve().parent
RUNS_DIR = ROOT / "runs"
TRAIN_SCRIPT = ROOT / "train.py"
JOB_DIR = RUNS_DIR / "_training"
STATUS_PATH = JOB_DIR / "status.json"
LOG_PATH = JOB_DIR / "current.log"
CANCEL_FLAG_PATH = JOB_DIR / "cancel.flag"
LIVE_METRICS_PATH = JOB_DIR / "live_metrics.json"
RUN_CONFIG_PATH = JOB_DIR / "run_config.json"
PID_PATH = JOB_DIR / "train.pid"

_lock = threading.Lock()
_process: Optional[subprocess.Popen] = None


def _atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(str(tmp), str(path))


def _pid_alive(pid: int) -> bool:
    """Return whether process `pid` is running (cross-platform, Windows-safe)."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        # OpenProcess succeeds only when the PID exists; avoids Python 3.8
        # SystemError from os.kill(pid, 0) on stale/recycled PIDs.
        SYNCHRONIZE = 0x00100000
        handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        return False
    try:
        os.kill(pid, 0)
    except (OSError, SystemError):
        return False
    return True


def _read_pid_file() -> Optional[int]:
    if not PID_PATH.exists():
        return None
    try:
        return int(PID_PATH.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def _clear_pid_file() -> None:
    if PID_PATH.exists():
        PID_PATH.unlink()


def _reconcile_stale_job() -> None:
    """Mark orphaned in-progress status after server restart."""
    pid = _read_pid_file()
    if pid is not None and _pid_alive(pid):
        return
    _clear_pid_file()
    if not STATUS_PATH.exists():
        return
    try:
        data = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return
    if data.get("state") in ("running", "cancelling"):
        data["running"] = False
        data["state"] = "interrupted"
        data["error"] = "Server restarted while training was in progress"
        _atomic_write_json(STATUS_PATH, data)


def _write_status(payload: Dict[str, Any]) -> None:
    _atomic_write_json(STATUS_PATH, payload)


def read_live_metrics() -> Dict[str, Any]:
    if not LIVE_METRICS_PATH.exists():
        return {"series": []}
    try:
        return json.loads(LIVE_METRICS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"series": []}


def read_status() -> Dict[str, Any]:
    _reconcile_stale_job()
    with _lock:
        if not STATUS_PATH.exists():
            data: Dict[str, Any] = {"running": False, "state": "idle"}
        else:
            try:
                data = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                data = {"running": False, "state": "idle"}
        pid = _read_pid_file()
        if _process is not None and _process.poll() is None:
            data["running"] = True
        elif pid is not None and _pid_alive(pid):
            data["running"] = True
        elif data.get("state") == "running":
            data["running"] = False
            if _process is not None and _process.poll() not in (None, 0):
                if data.get("state") != "cancelled":
                    data["state"] = "failed"
                    data["exit_code"] = _process.returncode
        data["live_metrics"] = read_live_metrics()
        return data


def read_log_tail(max_bytes: int = 12000) -> str:
    if not LOG_PATH.exists():
        return ""
    data = LOG_PATH.read_bytes()
    if len(data) > max_bytes:
        data = data[-max_bytes:]
    return data.decode("utf-8", errors="replace")


def is_running() -> bool:
    _reconcile_stale_job()
    with _lock:
        if _process is not None and _process.poll() is None:
            return True
        pid = _read_pid_file()
        return pid is not None and _pid_alive(pid)


def start_training(
    mode: str = P.DEFAULT_MODE,
    budget_sec: int = 600,
    resume_run_id: Optional[str] = None,
    notes: str = "",
    n_envs: int = recommended_n_envs(),
    device: str = "auto",
    dynamics_jitter: bool = False,
    robust_eval_enabled: bool = False,
    plant: Optional[Dict[str, Any]] = None,
    goal_hold_sec: int = 30,
    current_enabled: bool = False,
    montage_enabled: bool = False,
    reward_weights: Optional[Dict[str, Any]] = None,
    gated_hold: Optional[bool] = None,
    scenario_category_prefixes: Optional[List[str]] = None,
    curriculum_phase: Optional[int] = None,
    snapshot_interval_min: int = 0,
) -> Dict[str, Any]:
    global _process

    _reconcile_stale_job()
    with _lock:
        if _process is not None and _process.poll() is None:
            return {"ok": False, "error": "Training already running"}
        pid = _read_pid_file()
        if pid is not None and _pid_alive(pid):
            return {"ok": False, "error": f"Training already running (pid {pid})"}

        if resume_run_id:
            resume_run_id = validate_run_id(resume_run_id)
            ckpt = safe_run_dir(resume_run_id) / "model.zip"
            if not ckpt.exists():
                return {"ok": False, "error": f"No checkpoint for run {resume_run_id}"}

        JOB_DIR.mkdir(parents=True, exist_ok=True)
        LOG_PATH.write_text("", encoding="utf-8")
        if CANCEL_FLAG_PATH.exists():
            CANCEL_FLAG_PATH.unlink()
        if LIVE_METRICS_PATH.exists():
            LIVE_METRICS_PATH.unlink()
        started_at = datetime.now(timezone.utc).isoformat()

        run_cfg = {
            "dynamics_jitter": dynamics_jitter,
            "robust_eval_enabled": bool(robust_eval_enabled),
            "plant": plant or {},
            "goal_hold_sec": max(0, int(goal_hold_sec)),
            "current_enabled": bool(current_enabled),
            "montage_enabled": bool(montage_enabled),
            "budget_sec": max(1, int(budget_sec)),
        }
        if reward_weights:
            run_cfg["reward_weights"] = reward_weights
        if gated_hold is not None:
            run_cfg["gated_hold"] = bool(gated_hold)
        if scenario_category_prefixes:
            run_cfg["scenario_category_prefixes"] = list(scenario_category_prefixes)
        if curriculum_phase is not None:
            run_cfg["curriculum_phase"] = int(curriculum_phase)
        snap_min = max(0, int(snapshot_interval_min))
        if snap_min > 0:
            run_cfg["snapshot_interval_min"] = snap_min
        JOB_DIR.mkdir(parents=True, exist_ok=True)
        RUN_CONFIG_PATH.write_text(json.dumps(run_cfg, indent=2), encoding="utf-8")

        cmd = [
            sys.executable,
            "-u",
            str(TRAIN_SCRIPT),
            "--mode",
            mode,
            "--budget",
            str(budget_sec),
            "--n-envs",
            str(n_envs),
            "--notes",
            notes or "ui training",
        ]
        if resume_run_id:
            cmd.extend(["--resume", resume_run_id])
        if device:
            cmd.extend(["--device", device])
        cmd.extend(["--run-config", str(RUN_CONFIG_PATH)])

        _write_status(
            {
                "running": True,
                "state": "running",
                "started_at": started_at,
                "mode": mode,
                "budget_sec": budget_sec,
                "resume_run_id": resume_run_id,
                "notes": notes,
                "device": device,
                "dynamics_jitter": dynamics_jitter,
                "robust_eval_enabled": run_cfg["robust_eval_enabled"],
                "nominal_plant": run_cfg.get("plant"),
                "goal_hold_sec": run_cfg["goal_hold_sec"],
                "current_enabled": run_cfg["current_enabled"],
                "montage_enabled": run_cfg["montage_enabled"],
                "reward_weights": run_cfg.get("reward_weights"),
                "gated_hold": run_cfg.get("gated_hold"),
                "snapshot_interval_min": run_cfg.get("snapshot_interval_min", 0),
            }
        )

        log_fp = open(LOG_PATH, "a", encoding="utf-8")
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        _process = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=log_fp,
            stderr=subprocess.STDOUT,
            env=env,
        )
        PID_PATH.write_text(str(_process.pid), encoding="utf-8")

        def _wait() -> None:
            global _process
            exit_code = _process.wait()
            log_fp.close()
            _clear_pid_file()
            status = read_status()
            status["running"] = False
            if status.get("state") != "cancelled":
                status["state"] = "completed" if exit_code == 0 else "failed"
                status["exit_code"] = exit_code
            status["finished_at"] = datetime.now(timezone.utc).isoformat()
            _write_status(status)
            with _lock:
                _process = None

        threading.Thread(target=_wait, daemon=True).start()

    return {"ok": True, "started_at": started_at}


def cancel_training() -> Dict[str, Any]:
    global _process

    with _lock:
        if _process is None or _process.poll() is not None:
            return {"ok": False, "error": "No training run in progress"}

        JOB_DIR.mkdir(parents=True, exist_ok=True)
        CANCEL_FLAG_PATH.write_text("1", encoding="utf-8")
        current: Dict[str, Any] = {"running": True, "state": "cancelling"}
        if STATUS_PATH.exists():
            try:
                current.update(json.loads(STATUS_PATH.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, OSError):
                pass
        current["state"] = "cancelling"
        _write_status(current)

    return {"ok": True, "message": "Pause requested — saving checkpoint after current step"}


def training_history(limit: int = 200) -> Dict[str, Any]:
    runs = sorted(
        [
            p
            for p in RUNS_DIR.iterdir()
            if p.is_dir()
            and p.name != "_training"
            and (p / "metrics.json").exists()
        ],
        key=lambda p: p.name,
    )
    if limit:
        runs = runs[-limit:]

    series = []
    for run_dir in runs:
        metrics_path = run_dir / "metrics.json"
        try:
            metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        mode = metrics.get("mode", P.DEFAULT_MODE)
        score = score_from_metrics(metrics)
        avg_rng = metrics.get("avg_final_goal_range_m")
        if avg_rng is None:
            traces_path = run_dir / "eval_traces.json"
            if traces_path.exists():
                traces = json.loads(traces_path.read_text(encoding="utf-8"))
                ranges = [
                    ep.get("final_goal_range_m")
                    for ep in traces.get("episodes", [])
                    if ep.get("final_goal_range_m") is not None
                ]
                if ranges:
                    avg_rng = round(sum(ranges) / len(ranges), 2)
        series.append(
            {
                "run_id": run_dir.name,
                "mode": mode,
                "nav_score": metrics.get("nav_score"),
                "avoid_score": metrics.get("avoid_score"),
                "score": score,
                "success_rate": metrics.get("success_rate"),
                "collision_rate": metrics.get("collision_rate"),
                "avg_final_goal_range_m": avg_rng,
                "mean_goal_zone_speed_mps": metrics.get("mean_goal_zone_speed_mps"),
                "pct_goal_zone_at_min_speed": metrics.get("pct_goal_zone_at_min_speed"),
                "reward_breakdown_mean": metrics.get("reward_breakdown_mean"),
                "reward_weights": (metrics.get("config") or {}).get("reward_weights"),
                "gated_hold": (metrics.get("config") or {}).get("gated_hold"),
                "notes": metrics.get("notes", ""),
                "parent_run_id": metrics.get("parent_run_id"),
                "train_session": metrics.get("train_session", 1),
                "cumulative_train_sec": metrics.get("cumulative_train_sec"),
                "train_elapsed_sec": metrics.get("train_elapsed_sec"),
            }
        )

    return {"runs": series, "count": len(series)}
