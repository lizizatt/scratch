#!/usr/bin/env python3
"""Smoke check: GCODE → MIDI runs and produces a valid file."""
import sys
import subprocess
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    # Prefer calibration GCODE if present
    for name in ["data/ground_truth/calibration.gcode", "data/Bench.gcode"]:
        gcode = root / name
        if gcode.exists():
            break
    else:
        print("Skip: no data/ground_truth/calibration.gcode or data/Bench.gcode")
        return 0

    out = root / "verify_out.mid"
    cmd = [sys.executable, str(root / "cli.py"), "gcode", str(gcode), "-o", str(out)]
    try:
        r = subprocess.run(cmd, cwd=str(root), capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        print("FAIL: timeout")
        return 1
    except Exception as e:
        print(f"FAIL: {e}")
        return 1

    if r.returncode != 0:
        print(f"FAIL: {r.stderr or r.stdout}")
        return 1
    if not out.exists() or out.stat().st_size == 0:
        print("FAIL: no output MIDI")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
