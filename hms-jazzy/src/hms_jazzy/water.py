"""Deterministic two-component deep-water waves; SI, ENU, navigation bearings."""

import math
from dataclasses import asdict, dataclass

import numpy as np

from .config import SimulationConfig

GRAVITY = 9.81


@dataclass(frozen=True)
class WaveComponent:
    amplitude_m: float
    wave_number_rad_m: float
    omega_rad_s: float
    east: float
    north: float
    phase_rad: float


class Water:
    def __init__(self, config: SimulationConfig):
        self.height_m = config.wave_height_m
        self.period_s = config.wave_period_s
        self.direction_deg = config.wave_direction_deg
        self.components = []
        # The second, smaller crossing train prevents perfectly single-axis rocking.
        for scale, period_scale, offset, phase in [(1, 1, 0, 0), (0.35, 1.3, 65, 1.7)]:
            omega = 2 * math.pi / self.period_s / period_scale
            wave_number = omega * (omega / GRAVITY)
            amplitude = self.height_m * scale / 2
            if not all(math.isfinite(value) for value in (omega, wave_number, amplitude * omega)):
                raise ValueError("wave coefficients exceed floating-point range")
            angle = math.radians(self.direction_deg + offset)
            self.components.append(WaveComponent(
                amplitude, wave_number, omega,
                math.sin(angle), math.cos(angle), phase,
            ))

    def sample(self, points: np.ndarray, time_s: float) -> tuple[np.ndarray, np.ndarray]:
        """Surface elevation and wave orbital velocity at world-space points (N×3).

        Direction is propagation TOWARD, not the meteorological 'from' convention.
        Current is added by the caller; wave-current refraction/advection is omitted.
        """
        height = np.zeros(len(points))
        velocity = np.zeros_like(points, dtype=float)
        for wave in self.components:
            phase = wave.wave_number_rad_m * (points[:, 0] * wave.east + points[:, 1] * wave.north)
            phase -= wave.omega_rad_s * time_s - wave.phase_rad
            cs, sn = np.cos(phase), np.sin(phase)
            height += wave.amplitude_m * cs
            orbital = wave.amplitude_m * wave.omega_rad_s * np.exp(
                wave.wave_number_rad_m * np.minimum(points[:, 2], 0)
            )
            velocity[:, 0] += orbital * cs * wave.east
            velocity[:, 1] += orbital * cs * wave.north
            velocity[:, 2] += orbital * sn
        return height, velocity

    def snapshot(self) -> dict:
        return {
            "height_m": self.height_m, "period_s": self.period_s,
            "direction_deg": self.direction_deg,
            "components": [asdict(component) for component in self.components],
        }
