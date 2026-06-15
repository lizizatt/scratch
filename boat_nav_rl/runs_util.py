"""Shared helpers for run listing and score selection."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

import prepare as P


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
