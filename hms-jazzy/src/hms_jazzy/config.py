"""Validated, immutable model parameters; SI units unless named otherwise."""

import math
import tomllib
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SimulationConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    mass_kg: float = Field(default=110, gt=0)
    length_m: float = Field(default=3.2, gt=0)
    width_m: float = Field(default=0.85, gt=0)
    thickness_m: float = Field(default=0.18, gt=0)
    com_height_m: float = Field(default=0.20, ge=0)
    waterplane_factor: float = Field(default=0.72, gt=0, le=1)
    water_density_kg_m3: float = Field(default=1025, gt=0)
    roll_inertia_kg_m2: float = Field(default=25, gt=0)
    pitch_inertia_kg_m2: float = Field(default=90, gt=0)
    yaw_inertia_kg_m2: float = Field(default=95, gt=0)
    thruster_arm_m: float = Field(default=0.5, ge=0.05, le=2)
    thruster_x_m: float = Field(default=-0.6)
    max_thrust_n: float = Field(default=44.482216152605, gt=0)  # 10 lbf per motor
    motor_time_constant_s: float = Field(default=0.2, ge=0)
    motor_axial_drag_coefficient: float = Field(default=0.2, ge=0)
    motor_crossflow_drag_coefficient: float = Field(default=1.0, ge=0)
    surge_linear_drag: float = Field(default=30, ge=0)
    surge_quadratic_drag: float = Field(default=80, ge=0)
    sway_linear_drag: float = Field(default=35, ge=0)
    sway_quadratic_drag: float = Field(default=90, ge=0)
    heave_linear_drag: float = Field(default=1000, ge=0)
    heave_quadratic_drag: float = Field(default=500, ge=0)
    roll_linear_drag: float = Field(default=20, ge=0)
    pitch_linear_drag: float = Field(default=80, ge=0)
    yaw_linear_drag: float = Field(default=25, ge=0)
    yaw_quadratic_drag: float = Field(default=35, ge=0)
    wave_height_m: float = Field(default=0.3, ge=0)
    wave_period_s: float = Field(default=2.4, gt=0)
    wave_direction_deg: float = Field(default=110, ge=0, lt=360)
    timestep_s: float = Field(default=0.01, ge=0.001, le=0.02)
    sensor_hz: float = Field(default=10, gt=0)
    gps_noise_m: float = Field(default=0.03, ge=0)
    heading_noise_deg: float = Field(default=0.2, ge=0)
    velocity_noise_mps: float = Field(default=0.01, ge=0)
    yaw_rate_noise_deg_s: float = Field(default=0.05, ge=0)
    origin_latitude_deg: float = Field(default=37.8, ge=-85, le=85)
    origin_longitude_deg: float = Field(default=-122.4, ge=-180, le=180)
    initial_heading_deg: float = Field(default=0, ge=0, lt=360)
    current_east_mps: float = Field(default=0, ge=-3, le=3)
    current_north_mps: float = Field(default=0, ge=-3, le=3)
    seed: int = Field(default=7, ge=0)

    @model_validator(mode="after")
    def validate_sensor_period(self) -> "SimulationConfig":
        steps = 1 / (self.sensor_hz * self.timestep_s)
        if steps < 1 or not math.isclose(steps, round(steps), abs_tol=1e-8):
            raise ValueError("sensor period must be an integer multiple of timestep_s")
        if abs(self.thruster_x_m) > self.length_m / 2:
            raise ValueError("thrusters must be mounted within the board's length")
        inertias = (self.roll_inertia_kg_m2, self.pitch_inertia_kg_m2, self.yaw_inertia_kg_m2)
        if 2 * max(inertias) > sum(inertias):
            raise ValueError("principal inertias must satisfy the triangle inequality")
        if self.equilibrium_draft_m >= self.thickness_m * 0.8:
            raise ValueError("insufficient displacement reserve for the configured loaded mass")
        return self

    @property
    def equilibrium_draft_m(self) -> float:
        return self.mass_kg / (
            self.water_density_kg_m3 * self.length_m * self.width_m * self.waterplane_factor
        )

    @property
    def thruster_z_m(self) -> float:
        return -self.com_height_m - self.thickness_m / 2 - 0.06


def load_config(path: Path | None = None) -> SimulationConfig:
    if path is None:
        return SimulationConfig()
    with path.open("rb") as stream:
        return SimulationConfig.model_validate(tomllib.load(stream))
