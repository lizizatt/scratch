"""Best-checkpoint tracking and resume path resolution."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Dict, Optional

BEST_MODEL_DIRNAME = "best_model"
BEST_METRICS_NAME = "best_metrics.json"
FINAL_MODEL_DIRNAME = "model"
SNAPSHOTS_DIRNAME = "snapshots"


def best_model_path(run_dir: Path) -> Path:
    return run_dir / BEST_MODEL_DIRNAME


def best_metrics_path(run_dir: Path) -> Path:
    return run_dir / BEST_METRICS_NAME


def resolve_resume_checkpoint(run_dir: Path, *, prefer_best: bool = True) -> Path:
    """Return path to load for --resume (prefers best_model when present)."""
    if prefer_best:
        best = best_model_path(run_dir)
        if best.with_suffix(".zip").exists():
            return best.with_suffix(".zip")
        if (run_dir / f"{BEST_MODEL_DIRNAME}.zip").exists():
            return run_dir / f"{BEST_MODEL_DIRNAME}.zip"
        if best.exists():
            return best
    final = run_dir / FINAL_MODEL_DIRNAME
    if final.with_suffix(".zip").exists():
        return final.with_suffix(".zip")
    return final


def load_best_metrics(run_dir: Path) -> Optional[Dict[str, Any]]:
    path = best_metrics_path(run_dir)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def save_best_checkpoint(
    run_dir: Path,
    model: Any,
    summary: Dict[str, Any],
    *,
    timesteps: int,
    elapsed_sec: float,
) -> None:
    """Persist best policy snapshot and metadata."""
    run_dir.mkdir(parents=True, exist_ok=True)
    dest = best_model_path(run_dir)
    model.save(str(dest))
    payload = {
        "summary": summary,
        "timesteps": timesteps,
        "elapsed_sec": round(elapsed_sec, 1),
    }
    best_metrics_path(run_dir).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def copy_best_to_final(run_dir: Path) -> bool:
    """Copy best_model.zip over model.zip when promoting best for export."""
    best_zip = run_dir / f"{BEST_MODEL_DIRNAME}.zip"
    final_zip = run_dir / f"{FINAL_MODEL_DIRNAME}.zip"
    if not best_zip.exists():
        return False
    shutil.copy2(best_zip, final_zip)
    meta = load_best_metrics(run_dir)
    if meta:
        sidecar = run_dir / "metrics_best.json"
        sidecar.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return True


def snapshots_dir(run_dir: Path) -> Path:
    return run_dir / SNAPSHOTS_DIRNAME


def save_periodic_snapshot(
    run_dir: Path,
    model: Any,
    *,
    elapsed_sec: float,
    timesteps: int,
    index: int,
) -> Path:
    """Write a numbered PPO checkpoint under runs/<id>/snapshots/."""
    snap_dir = snapshots_dir(run_dir)
    snap_dir.mkdir(parents=True, exist_ok=True)
    mins = max(0, int(round(elapsed_sec / 60.0)))
    stem = snap_dir / f"snapshot_{index:03d}_{mins:04d}m"
    model.save(str(stem))
    zip_path = stem.with_suffix(".zip")
    meta = {
        "elapsed_sec": round(elapsed_sec, 1),
        "elapsed_min": mins,
        "timesteps": timesteps,
        "index": index,
    }
    stem.with_suffix(".meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return zip_path
