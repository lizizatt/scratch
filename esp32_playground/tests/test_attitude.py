"""Attitude filter behavior and C++/Python constant sync."""

from __future__ import annotations

import math
import re
import unittest
from pathlib import Path

from pg_attitude import (
    ALPHA,
    CAL_TARGET,
    CLAMP_DEG,
    RAD_TO_DEG,
    ComplementaryAttitudeFilter,
    ImuSample,
    simulate_constant_rate,
)

ROOT = Path(__file__).resolve().parents[1]
ATTITUDE_CPP = ROOT / "libraries" / "pg_attitude" / "src" / "attitude.cpp"
ATTITUDE_CONFIG = ROOT / "libraries" / "pg_attitude" / "src" / "attitude_config.h"

LEVEL = ImuSample(ax_g=0.0, ay_g=0.0, az_g=1.0, gx_dps=0.0, gy_dps=0.0, gz_dps=0.0)
BIAS_GX = 2.5


def _calibrate(filter_: ComplementaryAttitudeFilter, bias: ImuSample = LEVEL) -> None:
    sample = ImuSample(
        ax_g=bias.ax_g,
        ay_g=bias.ay_g,
        az_g=bias.az_g,
        gx_dps=bias.gx_dps + BIAS_GX,
        gy_dps=bias.gy_dps,
        gz_dps=bias.gz_dps,
    )
    for _ in range(CAL_TARGET):
        filter_.update(sample, 0.01)


class TestAttitudeFilter(unittest.TestCase):
    def test_calibration_consumes_cal_target_samples(self):
        f = ComplementaryAttitudeFilter()
        for i in range(CAL_TARGET - 1):
            f.update(LEVEL, 0.01)
            self.assertFalse(f.calibrated)
        f.update(LEVEL, 0.01)
        self.assertTrue(f.calibrated)

    def test_gyro_bias_averaged(self):
        f = ComplementaryAttitudeFilter()
        _calibrate(f)
        self.assertAlmostEqual(f.gyro_bias_dps[0], BIAS_GX, places=4)

    def test_level_accel_near_zero_pitch_roll(self):
        f = ComplementaryAttitudeFilter()
        _calibrate(f)
        att = simulate_constant_rate(f, LEVEL, dt_s=0.02, steps=50)
        self.assertAlmostEqual(att.pitch_deg, 0.0, delta=2.0)
        self.assertAlmostEqual(att.roll_deg, 0.0, delta=2.0)

    def test_pitch_tilts_toward_accel(self):
        f = ComplementaryAttitudeFilter()
        _calibrate(f)
        tilted = ImuSample(ax_g=0.0, ay_g=0.5, az_g=0.866, gx_dps=0.0, gy_dps=0.0, gz_dps=0.0)
        att = simulate_constant_rate(f, tilted, dt_s=0.02, steps=80)
        self.assertGreater(att.pitch_deg, 15.0)

    def test_yaw_integrates_gyro(self):
        f = ComplementaryAttitudeFilter()
        _calibrate(f)
        spinning = ImuSample(ax_g=0.0, ay_g=0.0, az_g=1.0, gx_dps=0.0, gy_dps=0.0, gz_dps=90.0)
        att = simulate_constant_rate(f, spinning, dt_s=0.1, steps=10)
        self.assertAlmostEqual(att.yaw_deg, 90.0, delta=5.0)

    def test_zero_yaw(self):
        f = ComplementaryAttitudeFilter()
        _calibrate(f)
        spinning = ImuSample(gz_dps=45.0, az_g=1.0)
        simulate_constant_rate(f, spinning, dt_s=0.1, steps=4)
        self.assertNotAlmostEqual(f.attitude.yaw_deg, 0.0, delta=0.1)
        f.zero_yaw()
        self.assertEqual(f.attitude.yaw_deg, 0.0)

    def test_pitch_clamped(self):
        f = ComplementaryAttitudeFilter()
        _calibrate(f)
        f.attitude.pitch_deg = 120.0
        f.update(LEVEL, 0.02)
        self.assertLessEqual(abs(f.attitude.pitch_deg), CLAMP_DEG + 0.01)

    def test_config_matches_cpp_header(self):
        text = ATTITUDE_CONFIG.read_text(encoding="utf-8")
        self.assertIn(f"kAttitudeAlpha = {ALPHA}f", text)
        self.assertIn(f"kAttitudeCalTarget = {CAL_TARGET}", text)
        self.assertIn(f"kAttitudeClampDeg = {CLAMP_DEG}f", text)
        self.assertIn(f"kRadToDeg = {RAD_TO_DEG}f", text)

    def test_cpp_uses_config_header(self):
        text = ATTITUDE_CPP.read_text(encoding="utf-8")
        self.assertIn('#include "attitude_config.h"', text)
        self.assertIn("kAttitudeAlpha", text)
        self.assertNotRegex(text, r"constexpr float kAlpha")


if __name__ == "__main__":
    unittest.main()
