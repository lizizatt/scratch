"""Render eval trace montages to PNG (optional post-eval step)."""

from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover - optional dependency
    Image = None  # type: ignore
    ImageDraw = None  # type: ignore
    ImageFont = None  # type: ignore

from eval_parallel import episode_mission_score

# Match viz/scoring.js palette
BG = (8, 16, 28)
GRID = (21, 32, 51)
GOAL = (69, 212, 131)
OWN = (58, 166, 255)
OWN_TRAIL = (107, 124, 255)
CONTACT = (255, 107, 107)
START = (159, 212, 255)
FAIL = (143, 163, 191)
SCORE_GOOD = (69, 212, 131)
SCORE_MID = (240, 192, 64)
SCORE_BAD = (255, 107, 107)


def _score_color(score: float) -> Tuple[int, int, int]:
    if score >= 0.8:
        return SCORE_GOOD
    if score >= 0.4:
        return SCORE_MID
    return SCORE_BAD


def _episode_score(episode: dict) -> float:
    if episode.get("mission_score") is not None:
        return float(episode["mission_score"])
    mode = episode.get("mode") or "navigate"
    return episode_mission_score(episode, mode)


def _draw_score_badge(draw: Any, x0: int, y0: int, w: int, score: float) -> None:
    text = f"{round(score * 100)}%"
    color = _score_color(score)
    tw = len(text) * 6 + 8
    box_h = 14
    bx = x0 + w - tw - 3
    by = y0 + 3
    draw.rectangle([bx, by, bx + tw, by + box_h], fill=BG)
    draw.text((bx + 4, by + 1), text, fill=color)


def _compute_bounds(steps: Sequence[dict], pad: float = 60.0) -> Tuple[float, float, float, float]:
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for step in steps:
        for key in ("own", "goal"):
            p = step[key]
            min_x = min(min_x, p["x"])
            max_x = max(max_x, p["x"])
            min_y = min(min_y, p["y"])
            max_y = max(max_y, p["y"])
        for c in step.get("contacts") or []:
            min_x = min(min_x, c["x"])
            max_x = max(max_x, c["x"])
            min_y = min(min_y, c["y"])
            max_y = max(max_y, c["y"])
    if not math.isfinite(min_x):
        return (-500.0, 500.0, -500.0, 500.0)
    return (min_x - pad, max_x + pad, min_y - pad, max_y + pad)


def _project(x: float, y: float, bounds: Tuple[float, float, float, float], w: int, h: int) -> Tuple[int, int]:
    min_x, max_x, min_y, max_y = bounds
    sx = int((x - min_x) / max(max_x - min_x, 1e-6) * w)
    sy = int(h - (y - min_y) / max(max_y - min_y, 1e-6) * h)
    return sx, sy


def _draw_frame(
    draw: Any,
    episode: dict,
    step_idx: int,
    x0: int,
    y0: int,
    w: int,
    h: int,
    *,
    show_trail: bool = True,
    show_outcome: bool = False,
    show_score: bool = False,
) -> None:
    steps = episode.get("steps") or []
    if not steps:
        draw.rectangle([x0, y0, x0 + w, y0 + h], fill=BG)
        return

    idx = min(max(step_idx, 0), len(steps) - 1)
    bounds = _compute_bounds(steps, pad=60.0)
    draw.rectangle([x0, y0, x0 + w, y0 + h], fill=BG)

    goal = steps[0]["goal"]
    gx, gy = _project(goal["x"], goal["y"], bounds, w, h)
    draw.ellipse([x0 + gx - 3, y0 + gy - 3, x0 + gx + 3, y0 + gy + 3], fill=GOAL)

    if show_trail:
        pts = []
        for s in steps[: idx + 1]:
            sx, sy = _project(s["own"]["x"], s["own"]["y"], bounds, w, h)
            pts.append((x0 + sx, y0 + sy))
        if len(pts) >= 2:
            draw.line(pts, fill=OWN_TRAIL, width=1)

    step = steps[idx]
    for c in step.get("contacts") or []:
        cx, cy = _project(c["x"], c["y"], bounds, w, h)
        draw.ellipse([x0 + cx - 2, y0 + cy - 2, x0 + cx + 2, y0 + cy + 2], fill=CONTACT)

    ox, oy = _project(step["own"]["x"], step["own"]["y"], bounds, w, h)
    draw.ellipse([x0 + ox - 3, y0 + oy - 3, x0 + ox + 3, y0 + oy + 3], fill=OWN)

    if show_outcome:
        label = "COLL" if episode.get("collision") else "OK" if episode.get("success") else "—"
        color = CONTACT if episode.get("collision") else GOAL if episode.get("success") else FAIL
        draw.text((x0 + 4, y0 + 4), label, fill=color)
    if show_score:
        _draw_score_badge(draw, x0, y0, w, _episode_score(episode))


def _draw_trajectory(
    draw: Any,
    episode: dict,
    x0: int,
    y0: int,
    w: int,
    h: int,
) -> None:
    steps = episode.get("steps") or []
    if not steps:
        draw.rectangle([x0, y0, x0 + w, y0 + h], fill=BG)
        return

    bounds = _compute_bounds(steps, pad=60.0)
    draw.rectangle([x0, y0, x0 + w, y0 + h], fill=BG)

    goal = steps[0]["goal"]
    gx, gy = _project(goal["x"], goal["y"], bounds, w, h)
    draw.ellipse([x0 + gx - 4, y0 + gy - 4, x0 + gx + 4, y0 + gy + 4], fill=GOAL)

    trail = []
    for s in steps:
        sx, sy = _project(s["own"]["x"], s["own"]["y"], bounds, w, h)
        trail.append((x0 + sx, y0 + sy))
    if len(trail) >= 2:
        draw.line(trail, fill=OWN_TRAIL, width=1)

    sx0, sy0 = trail[0]
    sx1, sy1 = trail[-1]
    draw.ellipse([sx0 - 2, sy0 - 2, sx0 + 2, sy0 + 2], fill=START)
    draw.ellipse([sx1 - 3, sy1 - 3, sx1 + 3, sy1 + 3], fill=OWN)

    label = "COLL" if episode.get("collision") else "OK" if episode.get("success") else "—"
    color = CONTACT if episode.get("collision") else GOAL if episode.get("success") else FAIL
    draw.text((x0 + 4, y0 + 4), label, fill=color)
    _draw_score_badge(draw, x0, y0, w, _episode_score(episode))


def _pick_step_indices(max_steps: int, num_cols: int) -> List[int]:
    if max_steps <= 1 or num_cols <= 1:
        return [0]
    if num_cols >= max_steps:
        return list(range(max_steps))
    indices = [int(round(i * (max_steps - 1) / (num_cols - 1))) for i in range(num_cols)]
    return sorted(set(indices))


def _subsample_episodes(episodes: Sequence[dict], max_episodes: int) -> List[dict]:
    if max_episodes <= 0 or len(episodes) <= max_episodes:
        return list(episodes)
    stride = max(1, len(episodes) // max_episodes)
    picked = list(episodes[::stride][:max_episodes])
    return picked


def render_step_montage(
    episodes: Sequence[dict],
    out_path: Path,
    *,
    max_episodes: int = 48,
    step_cols: int = 12,
    cell_w: int = 96,
    cell_h: int = 72,
    margin: int = 8,
    label_h: int = 22,
) -> Dict[str, Any]:
    """One PNG: rows = scenarios, columns = subsampled timesteps."""
    if Image is None:
        raise RuntimeError("Pillow is required for montage export (pip install Pillow)")

    picked = _subsample_episodes(episodes, max_episodes)
    if not picked:
        raise ValueError("no episodes to render")

    max_steps = max(len(ep.get("steps") or []) for ep in picked)
    step_indices = _pick_step_indices(max_steps, step_cols)

    header_h = label_h + margin
    col_label_w = 36
    width = col_label_w + margin + len(step_indices) * (cell_w + margin)
    height = header_h + len(picked) * (cell_h + margin) + margin
    img = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(img)

    draw.text((margin, margin), "t ->", fill=FAIL)
    for ci, step_idx in enumerate(step_indices):
        x = col_label_w + margin + ci * (cell_w + margin)
        draw.text((x + 4, margin), f"{step_idx}", fill=FAIL)

    for ri, ep in enumerate(picked):
        y = header_h + ri * (cell_h + margin)
        name = (ep.get("scenario_name") or f"ep{ri}")[:14]
        draw.text((margin, y + cell_h // 2 - 6), name, fill=FAIL)
        steps = ep.get("steps") or []
        for ci, global_step in enumerate(step_indices):
            if not steps:
                continue
            local_idx = min(global_step, len(steps) - 1)
            x = col_label_w + margin + ci * (cell_w + margin)
            _draw_frame(
                draw,
                ep,
                local_idx,
                x,
                y,
                cell_w,
                cell_h,
                show_score=ci == len(step_indices) - 1,
            )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, optimize=True)
    return {
        "path": str(out_path),
        "episodes_shown": len(picked),
        "episodes_total": len(episodes),
        "step_columns": len(step_indices),
        "max_steps": max_steps,
        "width_px": width,
        "height_px": height,
    }


def render_trajectory_montage(
    episodes: Sequence[dict],
    out_path: Path,
    *,
    max_episodes: int = 64,
    cols: int = 8,
    cell_w: int = 160,
    cell_h: int = 120,
    margin: int = 6,
) -> Dict[str, Any]:
    """Grid of full-trajectory thumbnails (overview-style)."""
    if Image is None:
        raise RuntimeError("Pillow is required for montage export (pip install Pillow)")

    picked = _subsample_episodes(episodes, max_episodes)
    if not picked:
        raise ValueError("no episodes to render")

    grid_cols = min(cols, len(picked))
    grid_rows = int(math.ceil(len(picked) / grid_cols))
    width = margin + grid_cols * (cell_w + margin)
    height = margin + grid_rows * (cell_h + margin)
    img = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(img)

    for i, ep in enumerate(picked):
        col = i % grid_cols
        row = i // grid_cols
        x = margin + col * (cell_w + margin)
        y = margin + row * (cell_h + margin)
        _draw_trajectory(draw, ep, x, y, cell_w, cell_h)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, optimize=True)
    return {
        "path": str(out_path),
        "episodes_shown": len(picked),
        "episodes_total": len(episodes),
        "width_px": width,
        "height_px": height,
    }


def write_eval_montages(
    run_dir: Path,
    traces: Sequence[dict],
    *,
    max_episodes: int = 48,
    step_cols: int = 12,
) -> Dict[str, Any]:
    """Write step + trajectory montages; returns timing and metadata."""
    t0 = time.perf_counter()
    step_meta = render_step_montage(
        traces,
        run_dir / "eval_step_montage.png",
        max_episodes=max_episodes,
        step_cols=step_cols,
    )
    traj_meta = render_trajectory_montage(
        traces,
        run_dir / "eval_trajectory_montage.png",
        max_episodes=max(max_episodes, 64),
    )
    elapsed = time.perf_counter() - t0
    meta = {
        "montage_sec": round(elapsed, 2),
        "step_montage": step_meta,
        "trajectory_montage": traj_meta,
    }
    (run_dir / "montage_meta.json").write_text(
        __import__("json").dumps(meta, indent=2),
        encoding="utf-8",
    )
    return meta
