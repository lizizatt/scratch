"""Shared helpers for run listing and score selection."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, Optional

import prepare as P

_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class InvalidRunIdError(ValueError):
    """Run id failed format or path-safety checks."""


def validate_run_id(run_id: str) -> str:
    """Reject traversal and unsafe run directory names."""
    if not run_id or not isinstance(run_id, str):
        raise InvalidRunIdError("run id required")
    run_id = run_id.strip()
    if not run_id or run_id in (".", ".."):
        raise InvalidRunIdError("invalid run id")
    if "/" in run_id or "\\" in run_id or ".." in run_id:
        raise InvalidRunIdError("invalid run id")
    if not _RUN_ID_RE.match(run_id):
        raise InvalidRunIdError("invalid run id")
    return run_id


def safe_run_dir(run_id: str, runs_dir: Optional[Path] = None) -> Path:
    """Resolve run_id to a directory guaranteed under runs_dir."""
    root = (runs_dir or Path(__file__).resolve().parent / "runs").resolve()
    safe_id = validate_run_id(run_id)
    run_dir = (root / safe_id).resolve()
    try:
        run_dir.relative_to(root)
    except ValueError as exc:
        raise InvalidRunIdError("invalid run id") from exc
    return run_dir


def score_key_for_mode(mode: str) -> str:
    return "avoid_score" if mode == "avoid" else "nav_score"


def score_from_metrics(metrics: Dict[str, Any]) -> Optional[float]:
    mode = str(metrics.get("mode", P.DEFAULT_MODE))
    return metrics.get(score_key_for_mode(mode))


def latest_run_id(runs_dir: Optional[Path] = None) -> Optional[str]:
    """Most recent completed run with metrics.json."""
    root = runs_dir or Path(__file__).resolve().parent / "runs"
    if not root.exists():
        return None
    latest_link = root / "latest"
    if latest_link.is_symlink() or latest_link.is_dir():
        if latest_link.exists():
            return latest_link.name
    latest_txt = root / "latest.txt"
    if latest_txt.exists():
        name = latest_txt.read_text(encoding="utf-8").strip()
        if name:
            return name
    runs = sorted(
        [
            p.name
            for p in root.iterdir()
            if p.is_dir()
            and p.name not in ("_training",)
            and (p / "metrics.json").exists()
        ],
        reverse=True,
    )
    return runs[0] if runs else None
