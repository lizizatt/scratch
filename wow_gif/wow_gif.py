#!/usr/bin/env python3
"""Turn WoW screenshots into a GIF, ordered by creation time.

Requires: Python 3.8+ and Pillow (pip install pillow)
For --mp4 also: pip install imageio-ffmpeg  (or have ffmpeg on PATH)

MP4 output is H.264 yuv420p, 30fps, full-color, 1080px wide by default -
what Instagram wants. Use --mp4-only to skip the GIF.

Examples:
  python wow_gif.py --mp4 --out trip.gif     # writes trip.gif and trip.mp4
  python wow_gif.py                          # phone, 540px wide, 0.5s/frame
  python wow_gif.py --mode desktop           # whole screenshots, 960px wide
  python wow_gif.py --duration 0.3 --width 720 --out trip.gif
  python wow_gif.py --src "D:\\WoW\\_forever_\\Screenshots"
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
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


def find_ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        exe = shutil.which("ffmpeg")
        if exe:
            return exe
    sys.exit("MP4 export needs ffmpeg: pip install imageio-ffmpeg (or put ffmpeg on PATH)")


def write_mp4(files, mode, width, duration, last_hold, out):
    ffmpeg = find_ffmpeg()
    width -= width % 2  # yuv420p needs even dimensions
    with tempfile.TemporaryDirectory() as tmp:
        for i, f in enumerate(files):
            print(f"\rmp4 frame [{i+1}/{len(files)}]", end="", flush=True)
            im = prep(f, mode, width)
            im.crop((0, 0, im.width, im.height - im.height % 2)).save(Path(tmp) / f"{i:05d}.png")
        print()
        cmd = [ffmpeg, "-y", "-loglevel", "error", "-framerate", str(1 / duration),
               "-i", str(Path(tmp) / "%05d.png"),
               "-vf", f"tpad=stop_mode=clone:stop_duration={last_hold},fps=30,format=yuv420p",
               "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", out]
        subprocess.run(cmd, check=True)
    print(f"Wrote {out}: {os.path.getsize(out)/1e6:.1f} MB")


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
    ap.add_argument("--mp4", action="store_true", help="also write an MP4 next to the GIF (Instagram-friendly)")
    ap.add_argument("--mp4-only", action="store_true", help="write only the MP4")
    ap.add_argument("--mp4-width", type=int, default=1080, help="MP4 width in px (default 1080)")
    args = ap.parse_args()

    src = Path(args.src)
    if not src.is_dir():
        sys.exit(f"Folder not found: {src}  (use --src)")
    files = sorted((p for p in src.iterdir() if p.suffix.lower() in EXTS), key=ctime_key)
    if not files:
        sys.exit(f"No images in {src}")

    if args.mp4 or args.mp4_only:
        write_mp4(files, args.mode, args.mp4_width, args.duration, args.last_hold,
                  str(Path(args.out).with_suffix(".mp4")))
        if args.mp4_only:
            return

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
