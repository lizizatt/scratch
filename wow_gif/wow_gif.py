#!/usr/bin/env python3
"""Turn WoW screenshots into a GIF, ordered by creation time.

Requires: Python 3.8+ and Pillow (pip install pillow)

Examples:
  python wow_gif.py                          # phone, 540px wide, 0.5s/frame
  python wow_gif.py --mode desktop           # whole screenshots, 960px wide
  python wow_gif.py --duration 0.3 --width 720 --out trip.gif
  python wow_gif.py --src "D:\\WoW\\_forever_\\Screenshots"
"""
import argparse
import os
import sys
from pathlib import Path

from PIL import Image

DEFAULT_SRC = r"C:\Program Files (x86)\World of Warcraft\_forever_\Screenshots"
EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tga", ".webp"}
PHONE_RATIO = 9 / 16  # width / height
# Defaults chosen to balance quality and size
DEFAULT_WIDTH = {"phone": 405, "desktop": 720}


def ctime_key(p: Path):
    return p.stat().st_ctime


def prep(path: Path, mode: str, width: int) -> Image.Image:
    im = Image.open(path).convert("RGB")
    if mode == "phone":
        w, h = im.size
        new_w = round(h * PHONE_RATIO)
        if new_w < w:
            left = (w - new_w) // 2
            im = im.crop((left, 0, left + new_w, h))
    height = round(im.height * width / im.width)
    return im.resize((width, height), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=DEFAULT_SRC, help="screenshots folder")
    ap.add_argument("--out", default="wow_journey.gif", help="output GIF path")
    ap.add_argument("--mode", choices=["phone", "desktop"], default="phone",
                    help="phone = 9:16 center slice, desktop = whole screenshot")
    ap.add_argument("--duration", type=float, default=0.5, help="seconds per frame (default 0.5)")
    ap.add_argument("--width", type=int, help="output width in px (default 540 phone / 960 desktop)")
    ap.add_argument("--colors", type=int, default=128, help="palette size 2-256 (lower = smaller file)")
    ap.add_argument("--last-hold", type=float, default=1.5, help="extra seconds to hold the last frame")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.is_dir():
        sys.exit(f"Folder not found: {src}  (use --src)")
    files = sorted((p for p in src.iterdir() if p.suffix.lower() in EXTS), key=ctime_key)
    if not files:
        sys.exit(f"No images in {src}")

    width = args.width or DEFAULT_WIDTH[args.mode]
    frames = []
    for i, f in enumerate(files, 1):
        print(f"\r[{i}/{len(files)}] {f.name}", end="", flush=True)
        im = prep(f, args.mode, width)
        frames.append(im.quantize(colors=args.colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG))
    print()

    ms = max(20, round(args.duration * 1000))
    durations = [ms] * len(frames)
    durations[-1] += round(args.last_hold * 1000)
    frames[0].save(args.out, save_all=True, append_images=frames[1:], duration=durations,
                   loop=0, optimize=True, disposal=1)
    print(f"Wrote {args.out}: {len(frames)} frames, {frames[0].size[0]}x{frames[0].size[1]}, "
          f"{os.path.getsize(args.out)/1e6:.1f} MB")


if __name__ == "__main__":
    main()
