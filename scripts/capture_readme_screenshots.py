#!/usr/bin/env python3
"""Render README screenshots for single-file terminal toys (no interactive capture)."""

from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "screenshots"

BG = (12, 12, 12)
FG = (220, 220, 220)
RED = (220, 60, 60)
YELLOW = (230, 200, 60)
GREEN = (80, 220, 120)
CYAN = (100, 200, 255)


def _font(size: int = 15) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if os.name == "nt":
        for name in ("consola.ttf", "cascadiamono.ttf", "lucon.ttf"):
            path = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def _cell_size(font: ImageFont.ImageFont) -> tuple[int, int]:
    bbox = font.getbbox("M")
    return max(bbox[2] - bbox[0], 8), max(bbox[3] - bbox[1] + 4, 16)


def terminal_image(
    grid: list[list[tuple[str, tuple[int, int, int] | None]]],
    *,
    title: str = "",
    cols: int = 72,
    rows: int = 22,
) -> Image.Image:
    font = _font()
    cell_w, cell_h = _cell_size(font)
    pad = 12
    w = cols * cell_w + pad * 2
    h = rows * cell_h + pad * 2 + (20 if title else 0)
    img = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(img)
    y0 = pad + (20 if title else 0)
    if title:
        draw.text((pad, pad), title, fill=(140, 140, 140), font=font)
    for r, row in enumerate(grid):
        x = pad
        y = y0 + r * cell_h
        for char, color in row:
            draw.text((x, y), char, fill=color or FG, font=font)
            x += cell_w
    return img


def _blank(cols: int, rows: int) -> list[list[tuple[str, tuple[int, int, int] | None]]]:
    return [[(" ", None) for _ in range(cols)] for _ in range(rows)]


def _put(grid, r: int, c: int, text: str, color: tuple[int, int, int] | None = None) -> None:
    for i, ch in enumerate(text):
        if 0 <= c + i < len(grid[0]):
            grid[r][c + i] = (ch, color)


def capture_blep() -> None:
    cols, rows = 72, 22
    g = _blank(cols, rows)
    _put(g, 0, 0, "blm simulator 2021 - Phase 2", RED)
    _put(g, 0, cols - 28, "<3 <3 <3 moved: 42.0, survived: 7.0 (x1.5)", YELLOW)
    px, py = 36, 12
    mage = [" /\\", "/**\\", "|oo|", "\\__/"]
    for i, line in enumerate(mage):
        _put(g, py - 3 + i, px - 1, line, FG)
    explosions = [(18, 6, 4, YELLOW), (50, 8, 5, RED), (28, 16, 6, YELLOW), (55, 14, 4, RED)]
    for ex, ey, rad, color in explosions:
        for yy in range(max(0, ey - rad), min(rows, ey + rad + 1)):
            for xx in range(max(0, ex - rad), min(cols, ex + rad + 1)):
                if math.hypot(xx - ex, yy - ey) < rad:
                    g[yy][xx] = ("*" if color == RED else "o", color)
    _put(g, rows - 2, 2, "WASD move · dodge AoE · stand still for sigil multiplier", (120, 120, 120))
    terminal_image(g, title="blep", cols=cols, rows=rows).save(OUT / "blep.png")


def capture_type() -> None:
    cols, rows = 60, 18
    g = _blank(cols, rows)
    lines = ["type", "in the", "terminal"]
    mid = rows // 2 - len(lines) // 2
    for i, line in enumerate(lines):
        start = (cols - len(line)) // 2
        _put(g, mid + i, start, line, FG)
    _put(g, rows - 2, 2, "centered live text · backspace edits", (120, 120, 120))
    terminal_image(g, title="type", cols=cols, rows=rows).save(OUT / "type.png")


def capture_epiano() -> None:
    cols, rows = 52, 16
    g = _blank(cols, rows)
    banner = [
        "╔═══════════════════════════════════════════╗",
        "║             Python E-Piano                 ║",
        "╚═══════════════════════════════════════════╝",
        "",
        "Keys:",
        "  1 - 8: Piano keys (C through High C)",
        "  +/-  : Change instrument preset",
        "  Ctrl+C: Quit",
        "",
        "Current soundfont: soundfont_sm64.sf2",
        "Current preset: 0",
    ]
    for i, line in enumerate(banner):
        _put(g, 1 + i, 2, line, CYAN if i < 3 else FG)
    terminal_image(g, title="epiano", cols=cols, rows=rows).save(OUT / "epiano.png")


def capture_flight_train() -> None:
    import pygame as pg

    pg.init()
    pg.font.init()
    size = (640, 480)
    screen = pg.Surface(size)
    white = (255, 240, 200)
    black = (20, 20, 40)
    gray = (100, 100, 120)
    screen.fill(gray)
    cx, cy = size[0] / 2, size[1] / 2
    rad = size[1] / 5
    for pos in [(cx * 7 / 4, cy / 2), (cx, cy / 2), (cx, cy * 3 / 2)]:
        pg.draw.circle(screen, black, [int(p) for p in pos], int(rad), 3)
        pg.draw.circle(screen, white, [int(p) for p in pos], int(rad - 8), 2)
    font = pg.font.SysFont("consolas", 18)
    screen.blit(font.render("flight-train — WIP pygame IFR gauges", True, white), (16, 16))
    screen.blit(font.render("pitch / roll / heading placeholders", True, (180, 180, 200)), (16, 40))
    pg.image.save(screen, str(OUT / "flight-train.png"))
    pg.quit()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    capture_blep()
    capture_type()
    capture_epiano()
    capture_flight_train()
    print(f"Wrote screenshots to {OUT}")


if __name__ == "__main__":
    main()
