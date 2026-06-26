#!/usr/bin/env python3
"""Explore attitude filter tuning offline (matches firmware pg_attitude)."""

import argparse
import math
import sys

from pg_attitude import (
    ALPHA,
    CAL_TARGET,
    ComplementaryAttitudeFilter,
    ImuSample,
    simulate_constant_rate,
)


def main() -> int:
    p = argparse.ArgumentParser(description="Offline attitude filter tuning")
    p.add_argument("--pitch-deg", type=float, default=0.0, help="static pitch from gravity (deg)")
    p.add_argument("--roll-deg", type=float, default=0.0, help="static roll from gravity (deg)")
    p.add_argument("--yaw-rate", type=float, default=0.0, help="constant yaw rate (dps)")
    p.add_argument("--dt", type=float, default=0.02, help="sample period (s)")
    p.add_argument("--steps", type=int, default=200, help="steps after calibration")
    p.add_argument("--alpha", type=float, default=None, help="override ALPHA (not persisted)")
    args = p.parse_args()

    if args.alpha is not None:
        import pg_attitude as pa

        pa.ALPHA = args.alpha

    pitch_r = math.radians(args.pitch_deg)
    roll_r = math.radians(args.roll_deg)
    ax = -math.sin(roll_r)
    ay = math.sin(pitch_r) * math.cos(roll_r)
    az = math.cos(pitch_r) * math.cos(roll_r)

    static = ImuSample(
        ax_g=ax,
        ay_g=ay,
        az_g=az,
        gx_dps=0.0,
        gy_dps=0.0,
        gz_dps=args.yaw_rate,
    )

    filt = ComplementaryAttitudeFilter()
    for _ in range(CAL_TARGET):
        filt.update(static, args.dt)

    att = simulate_constant_rate(filt, static, dt_s=args.dt, steps=args.steps)
    print(f"alpha={ALPHA} cal={CAL_TARGET} dt={args.dt} steps={args.steps}")
    print(
        f"attitude  pitch={att.pitch_deg:+.2f}  roll={att.roll_deg:+.2f}  yaw={att.yaw_deg:+.2f}"
    )
    print(f"target    pitch={args.pitch_deg:+.2f}  roll={args.roll_deg:+.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
