#!/usr/bin/env python3
"""Render a visual grid of all generated scenarios for QA."""

from __future__ import annotations

import argparse
import math
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Install Pillow: pip install Pillow") from exc

import prepare as P
from scenarios import generate_all_scenarios

ROOT = Path(__file__).resolve().parent
DEFAULT_OUT = ROOT / "runs" / "scenario_overview.png"

BG = (8, 16, 28)
GRID = (21, 32, 51)
OWN = (58, 166, 255)
GOAL = (69, 212, 131)
CONTACT_COLORS = {
    "dinghy": (255, 180, 107),
    "workboat": (255, 107, 107),
    "freighter": (255, 80, 160),
}
LABEL = (143, 163, 191)
VELOCITY = (107, 200, 255)


def _bounds_for_scenario(scenario: P.ScenarioSeed, pad: float = 80.0) -> Tuple[float, float, float, float]:
    xs = [scenario.own_x_m, scenario.goal_x_m]
    ys = [scenario.own_y_m, scenario.goal_y_m]
    for c in scenario.contacts:
        xs.append(c["x_m"])
        ys.append(c["y_m"])
    return (min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad)


def _project(
    x: float,
    y: float,
    bounds: Tuple[float, float, float, float],
    w: int,
    h: int,
) -> Tuple[int, int]:
    min_x, max_x, min_y, max_y = bounds
    sx = int((x - min_x) / max(max_x - min_x, 1e-6) * (w - 1))
    sy = int((h - 1) - (y - min_y) / max(max_y - min_y, 1e-6) * (h - 1))
    return sx, sy


def draw_scenario(
    draw: ImageDraw.ImageDraw,
    scenario: P.ScenarioSeed,
    x0: int,
    y0: int,
    size: int,
) -> None:
    bounds = _bounds_for_scenario(scenario)
    draw.rectangle([x0, y0, x0 + size, y0 + size], fill=BG, outline=GRID)

    gx, gy = _project(scenario.goal_x_m, scenario.goal_y_m, bounds, size, size)
    draw.ellipse(
        [x0 + gx - 2, y0 + gy - 2, x0 + gx + 2, y0 + gy + 2],
        fill=GOAL,
    )

    for c in scenario.contacts:
        vc = c.get("vessel_class", P.DEFAULT_VESSEL_CLASS)
        color = CONTACT_COLORS.get(vc, CONTACT_COLORS["workboat"])
        radius_m = float(c.get("radius_m", P.radius_for_class(vc)))
        cx, cy = _project(c["x_m"], c["y_m"], bounds, size, size)
        scale = size / max(bounds[1] - bounds[0], bounds[3] - bounds[2], 1.0)
        r_px = max(2, int(radius_m * scale * 0.35))
        draw.ellipse(
            [x0 + cx - r_px, y0 + cy - r_px, x0 + cx + r_px, y0 + cy + r_px],
            outline=color,
            width=1,
        )
        sog = float(c.get("sog_mps", 0.0))
        if sog > 0.2:
            cog = math.radians(float(c.get("cog_deg", 0.0)))
            dx = int(8 * math.sin(cog))
            dy = int(-8 * math.cos(cog))
            draw.line(
                [x0 + cx, y0 + cy, x0 + cx + dx, y0 + cy + dy],
                fill=VELOCITY,
                width=1,
            )

    ox, oy = _project(scenario.own_x_m, scenario.own_y_m, bounds, size, size)
    hdg = math.radians(scenario.own_heading_deg)
    dx = int(10 * math.sin(hdg))
    dy = int(-10 * math.cos(hdg))
    draw.line([x0 + ox, y0 + oy, x0 + ox + dx, y0 + oy + dy], fill=OWN, width=1)
    draw.ellipse([x0 + ox - 3, y0 + oy - 3, x0 + ox + 3, y0 + oy + 3], fill=OWN)


def render_overview(
    scenarios: Sequence[P.ScenarioSeed],
    out_path: Path,
    *,
    thumb_size: int = 72,
    cols: int = 32,
    margin: int = 4,
    header_h: int = 36,
) -> Path:
    n = len(scenarios)
    cols = max(1, cols)
    rows = int(math.ceil(n / cols))
    width = margin + cols * (thumb_size + margin)
    height = header_h + margin + rows * (thumb_size + margin)
    img = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(img)

    draw.text(
        (8, 8),
        f"Scenario overview - {n} scenarios | green=goal blue=own | "
        f"orange/red/pink=dinghy/workboat/freighter",
        fill=LABEL,
    )

    for i, scenario in enumerate(scenarios):
        row, col = divmod(i, cols)
        x0 = margin + col * (thumb_size + margin)
        y0 = header_h + margin + row * (thumb_size + margin)
        draw_scenario(draw, scenario, x0, y0, thumb_size)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    return out_path


def render_category_samples(
    scenarios: Sequence[P.ScenarioSeed],
    out_path: Path,
    *,
    thumb_size: int = 160,
    margin: int = 8,
) -> Path:
    """One representative scenario per category (easier to inspect)."""
    by_cat: Dict[str, P.ScenarioSeed] = {}
    for s in scenarios:
        by_cat.setdefault(s.category, s)
    cats = sorted(by_cat.keys())
    cols = min(4, max(1, len(cats)))
    rows = int(math.ceil(len(cats) / cols))
    label_h = 18
    cell_h = thumb_size + label_h + margin
    width = margin + cols * (thumb_size + margin)
    height = margin + rows * cell_h
    img = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(img)

    for i, cat in enumerate(cats):
        row, col = divmod(i, cols)
        x0 = margin + col * (thumb_size + margin)
        y0 = margin + row * cell_h
        draw.text((x0, y0), cat, fill=LABEL)
        draw_scenario(draw, by_cat[cat], x0, y0 + label_h, thumb_size)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Render scenario library overview PNGs")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--categories-out", type=Path, default=ROOT / "runs" / "scenario_categories.png")
    parser.add_argument("--thumb", type=int, default=72)
    parser.add_argument("--cols", type=int, default=32)
    args = parser.parse_args()

    scenarios = generate_all_scenarios()
    full = render_overview(scenarios, args.out, thumb_size=args.thumb, cols=args.cols)
    cats = render_category_samples(scenarios, args.categories_out)
    print(f"Wrote {len(scenarios)} scenarios")
    print(f"  full grid  -> {full}")
    print(f"  by category -> {cats}")


if __name__ == "__main__":
    main()
