"""Complementary attitude filter — Python reference for tuning and tests.

Algorithm matches libraries/pg_attitude/src/attitude.cpp (see attitude_config.h).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Must match attitude_config.h
ALPHA = 0.98
CAL_TARGET = 80
CLAMP_DEG = 89.0
RAD_TO_DEG = 57.2957795


@dataclass
class ImuSample:
    ax_g: float = 0.0
    ay_g: float = 0.0
    az_g: float = 1.0
    gx_dps: float = 0.0
    gy_dps: float = 0.0
    gz_dps: float = 0.0


@dataclass
class Attitude:
    pitch_deg: float = 0.0
    roll_deg: float = 0.0
    yaw_deg: float = 0.0


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


class ComplementaryAttitudeFilter:
    """Gyro bias calibration then complementary pitch/roll + gyro yaw."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.attitude = Attitude()
        self._have_gyro_bias = False
        self._cal_samples = 0
        self._gx_bias = 0.0
        self._gy_bias = 0.0
        self._gz_bias = 0.0

    def zero_yaw(self) -> None:
        self.attitude.yaw_deg = 0.0

    @property
    def calibrated(self) -> bool:
        return self._have_gyro_bias

    @property
    def gyro_bias_dps(self) -> tuple[float, float, float]:
        return (self._gx_bias, self._gy_bias, self._gz_bias)

    def update(self, sample: ImuSample, dt_s: float) -> Attitude:
        if not self._have_gyro_bias:
            self._gx_bias += sample.gx_dps
            self._gy_bias += sample.gy_dps
            self._gz_bias += sample.gz_dps
            self._cal_samples += 1
            if self._cal_samples >= CAL_TARGET:
                self._gx_bias /= CAL_TARGET
                self._gy_bias /= CAL_TARGET
                self._gz_bias /= CAL_TARGET
                self._have_gyro_bias = True
            return self.attitude

        gx = sample.gx_dps - self._gx_bias
        gy = sample.gy_dps - self._gy_bias
        gz = sample.gz_dps - self._gz_bias

        accel_pitch = (
            math.atan2(sample.ay_g, math.sqrt(sample.ax_g ** 2 + sample.az_g ** 2))
            * RAD_TO_DEG
        )
        accel_roll = math.atan2(-sample.ax_g, sample.az_g) * RAD_TO_DEG

        self.attitude.pitch_deg = (
            ALPHA * (self.attitude.pitch_deg + gx * dt_s)
            + (1.0 - ALPHA) * accel_pitch
        )
        self.attitude.roll_deg = (
            ALPHA * (self.attitude.roll_deg + gy * dt_s)
            + (1.0 - ALPHA) * accel_roll
        )
        self.attitude.yaw_deg += gz * dt_s

        self.attitude.pitch_deg = _clamp(self.attitude.pitch_deg, -CLAMP_DEG, CLAMP_DEG)
        self.attitude.roll_deg = _clamp(self.attitude.roll_deg, -CLAMP_DEG, CLAMP_DEG)
        return self.attitude


def simulate_constant_rate(
    filter_: ComplementaryAttitudeFilter,
    sample: ImuSample,
    *,
    dt_s: float,
    steps: int,
) -> Attitude:
    """Run filter for N steps at fixed dt (handy for tuning scripts)."""
    att = filter_.attitude
    for _ in range(steps):
        att = filter_.update(sample, dt_s)
    return att
