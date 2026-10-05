"""Fixed-step 6DOF MuJoCo dynamics with distributed buoyancy and water-relative drag."""

import math
from dataclasses import dataclass

import mujoco
import numpy as np

from .config import SimulationConfig
from .navigation import NavigationSample, ThrusterCommand, heading_from_yaw, yaw_from_heading
from .water import GRAVITY, Water

NEUTRAL = ThrusterCommand()


def model_xml(c: SimulationConfig) -> str:
    return f"""<mujoco model="HMS Jazzy">
  <compiler angle="radian"/>
  <option timestep="{c.timestep_s}" gravity="0 0 -{GRAVITY}" integrator="Euler"/>
  <statistic extent="12"/>
  <visual><headlight ambient="0.5 0.5 0.5"/></visual>
  <asset>
    <texture name="grid" type="2d" builtin="checker" width="512" height="512"
      rgb1="0.035 0.14 0.18" rgb2="0.05 0.19 0.23"/>
    <material name="water" texture="grid" texrepeat="50 50" texuniform="true"/>
  </asset>
  <default><geom contype="0" conaffinity="0"/></default>
  <worldbody>
    <light pos="0 0 15"/>
    <geom name="water" type="plane" size="100 100 1" material="water"/>
    <body name="board">
      <freejoint name="pose"/>
      <inertial pos="0 0 0" mass="{c.mass_kg}"
        diaginertia="{c.roll_inertia_kg_m2} {c.pitch_inertia_kg_m2}
        {c.yaw_inertia_kg_m2}"/>
      <geom name="hull" type="ellipsoid"
        size="{c.length_m / 2} {c.width_m / 2} {c.thickness_m / 2}"
        pos="0 0 {-c.com_height_m}"
        rgba="0.9 0.89 0.79 1"/>
      <geom name="deck" type="box" size="{c.length_m * 0.25} {c.width_m * 0.3} 0.02"
        pos="-0.12 0 {-c.com_height_m + c.thickness_m / 2}" rgba="0.08 0.3 0.3 1"/>
      <geom name="bow" type="sphere" size="0.08"
        pos="{c.length_m * 0.4} 0 {-c.com_height_m + c.thickness_m / 2}"
        rgba="1 0.56 0.28 1"/>
      <geom name="port_motor" type="capsule" size="0.085 0.18" euler="0 1.570796 0"
        pos="{c.thruster_x_m} {c.thruster_arm_m} {c.thruster_z_m}" rgba="0.95 0.35 0.3 1"/>
      <geom name="starboard_motor" type="capsule" size="0.085 0.18" euler="0 1.570796 0"
        pos="{c.thruster_x_m} {-c.thruster_arm_m} {c.thruster_z_m}" rgba="0.2 0.8 0.65 1"/>
      <site name="port" pos="{c.thruster_x_m} {c.thruster_arm_m} {c.thruster_z_m}" size="0.03"/>
      <site name="starboard" size="0.03"
        pos="{c.thruster_x_m} {-c.thruster_arm_m} {c.thruster_z_m}"/>
    </body>
  </worldbody>
  <actuator>
    <motor name="port" site="port" gear="{c.max_thrust_n} 0 0 0 0 0" ctrlrange="-1 1"/>
    <motor name="starboard" site="starboard" gear="{c.max_thrust_n} 0 0 0 0 0"
      ctrlrange="-1 1"/>
  </actuator>
</mujoco>"""


@dataclass(frozen=True)
class GroundTruth:
    east_m: float
    north_m: float
    heading_deg: float
    speed_mps: float
    up_m: float
    roll_deg: float
    pitch_deg: float
    quaternion_wxyz: tuple[float, float, float, float]


class Simulator:
    def __init__(self, config: SimulationConfig | None = None) -> None:
        self.config = config or SimulationConfig()
        self.model = mujoco.MjModel.from_xml_string(model_xml(self.config))
        self.data = mujoco.MjData(self.model)
        self._board_id = self.model.body("board").id
        c = self.config
        self._columns = np.array([
          [x, y, -c.com_height_m - c.thickness_m / 2]
          for x in (np.arange(5) + 0.5) * c.length_m / 5 - c.length_m / 2
          for y in (np.arange(3) + 0.5) * c.width_m / 3 - c.width_m / 2
        ])
        self._column_area = c.length_m * c.width_m * c.waterplane_factor / len(self._columns)
        self._sensor_steps = round(1 / (self.config.sensor_hz * self.config.timestep_s))
        self.reset()

    @property
    def time_s(self) -> float:
        return self._steps * self.config.timestep_s

    @property
    def truth(self) -> GroundTruth:
        rotation = self.data.body("board").xmat.reshape(3, 3)
        yaw = math.atan2(rotation[1, 0], rotation[0, 0])
        return GroundTruth(
            float(self.data.qpos[0]), float(self.data.qpos[1]),
            heading_from_yaw(yaw),
            float(np.linalg.norm(self.data.qvel[:2])),
            float(self.data.qpos[2]),
            math.degrees(math.atan2(rotation[2, 1], rotation[2, 2])),
            math.degrees(math.asin(np.clip(-rotation[2, 0], -1, 1))),
            tuple(float(value) for value in self.data.qpos[3:7]),
        )

    def reset(self, heading_deg: float | None = None) -> None:
        heading = self.config.initial_heading_deg if heading_deg is None else heading_deg
        if not math.isfinite(heading):
            raise ValueError("heading must be finite")
        mujoco.mj_resetData(self.model, self.data)
        self.data.qpos[2] = (
          self.config.com_height_m + self.config.thickness_m / 2
          - self.config.equilibrium_draft_m
        )
        yaw = yaw_from_heading(heading)
        self.data.qpos[3:7] = [math.cos(yaw / 2), 0, 0, math.sin(yaw / 2)]
        self._steps = 0
        self.water = Water(self.config)
        self._motor_lag = np.zeros(2)
        self._rng = np.random.default_rng(self.config.seed)
        self.current_east_mps = self.config.current_east_mps
        self.current_north_mps = self.config.current_north_mps
        self.command = ThrusterCommand()
        mujoco.mj_forward(self.model, self.data)
        self.navigation = self._sample_navigation()

    def set_current(self, east_mps: float, north_mps: float) -> None:
        if not all(math.isfinite(v) and -3 <= v <= 3 for v in (east_mps, north_mps)):
            raise ValueError("current components must be finite and within [-3, 3] m/s")
        self.current_east_mps, self.current_north_mps = east_mps, north_mps

    def cut_thrust(self) -> None:
        """Immediately remove motor demand and lag state, without removing vessel momentum."""
        self.command = ThrusterCommand()
        self._motor_lag[:] = 0
        self.data.ctrl[:] = 0
        mujoco.mj_forward(self.model, self.data)

    def set_waves(self, height_m: float, period_s: float, direction_deg: float) -> None:
        parameters = SimulationConfig.model_validate({
            **self.config.model_dump(), "wave_height_m": height_m,
            "wave_period_s": period_s, "wave_direction_deg": direction_deg,
        })
        self.water = Water(parameters)

    def set_motor_strength(self, max_thrust_n: float) -> None:
      """Change both motors' force scale and cut thrust without resetting motion or water."""
      parameters = SimulationConfig.model_validate({
        **self.config.model_dump(), "max_thrust_n": max_thrust_n,
      })
      self.cut_thrust()
      self.model.actuator_gear[:, 0] = parameters.max_thrust_n
      self.config = parameters
      mujoco.mj_forward(self.model, self.data)

    def _motor_water_loads(self, rotation: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
      """Passive capsule drag as world force/torque about the loaded COM."""
      c = self.config
      points = self.data.site_xpos
      offsets = points - self.data.qpos[:3]
      elevation, flow = self.water.sample(points, self.time_s)
      flow += [self.current_east_mps, self.current_north_mps, 0]
      omega = rotation @ self.data.qvel[3:6]
      relative = (self.data.qvel[:3] + np.cross(omega, offsets) - flow) @ rotation
      radius, half_length = self.model.geom("port_motor").size[:2]
      axial_area = math.pi * radius**2
      crossflow_area = 4 * radius * half_length + axial_area
      drag = np.empty_like(relative)
      drag[:, 0] = -0.5 * c.water_density_kg_m3 * c.motor_axial_drag_coefficient * (
        axial_area * relative[:, 0] * np.abs(relative[:, 0])
      )
      # The circular cross-section must not prefer body Y over body Z.
      crossflow_speed = np.linalg.norm(relative[:, 1:], axis=1, keepdims=True)
      drag[:, 1:] = -0.5 * c.water_density_kg_m3 * c.motor_crossflow_drag_coefficient * (
        crossflow_area * crossflow_speed * relative[:, 1:]
      )
      # Linear wetted-area proxy over the tilted capsule's vertical extent.
      half_height = radius + half_length * abs(rotation[2, 0])
      wet = np.clip((elevation - points[:, 2] + half_height) / (2 * half_height), 0, 1)
      drag = (drag * wet[:, None]) @ rotation.T
      return drag.sum(axis=0), np.cross(offsets, drag).sum(axis=0)

    def _water_loads(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        c = self.config
        rotation = self.data.body("board").xmat.reshape(3, 3)
        offsets = self._columns @ rotation.T
        points = self.data.qpos[:3] + offsets
        elevation, flow = self.water.sample(points, self.time_s)
        depth = np.clip(elevation - points[:, 2], 0, c.thickness_m)
        buoyancy = np.zeros_like(points)
        buoyancy[:, 2] = c.water_density_kg_m3 * GRAVITY * self._column_area * depth
        flow += [self.current_east_mps, self.current_north_mps, 0]
        omega = rotation @ self.data.qvel[3:6]
        relative = (self.data.qvel[:3] + np.cross(omega, offsets) - flow) @ rotation
        linear = np.array([c.surge_linear_drag, c.sway_linear_drag, c.heave_linear_drag])
        quadratic = np.array([
            c.surge_quadratic_drag, c.sway_quadratic_drag, c.heave_quadratic_drag,
        ])
        wet = np.clip(depth / c.equilibrium_draft_m, 0, 2)
        drag = (-linear * relative - quadratic * relative * np.abs(relative))
        drag = (drag * wet[:, None] / len(points)) @ rotation.T
        angular_drag = -np.array([
            c.roll_linear_drag, c.pitch_linear_drag, c.yaw_linear_drag,
        ]) * self.data.qvel[3:6]
        angular_drag[2] -= c.yaw_quadratic_drag * self.data.qvel[5] * abs(self.data.qvel[5])
        drag_torque = np.cross(offsets, drag).sum(axis=0) + rotation @ angular_drag * wet.mean()
        motor_force, motor_torque = self._motor_water_loads(rotation)
        return (
            buoyancy.sum(axis=0), np.cross(offsets, buoyancy).sum(axis=0),
          drag.sum(axis=0) + motor_force, drag_torque + motor_torque,
        )

    def drag_force(self) -> np.ndarray:
        """Generalized drag (world XYZ force, body XYZ torque), excluding buoyancy/gravity."""
        mujoco.mj_forward(self.model, self.data)
        _, _, force, torque = self._water_loads()
        rotation = self.data.body("board").xmat.reshape(3, 3)
        return np.concatenate((force, rotation.T @ torque))

    def step(self, command: ThrusterCommand = NEUTRAL, steps: int = 1) -> None:
        if not isinstance(steps, int) or steps < 0:
            raise ValueError("steps must be a nonnegative integer")
        self.command = command
        tau = self.config.motor_time_constant_s
        alpha = -math.expm1(-self.config.timestep_s / tau) if tau else 1.0
        demand = np.array([command.port, command.starboard])
        for _ in range(steps):
            mujoco.mj_forward(self.model, self.data)
            self._motor_lag += alpha * (demand - self._motor_lag)
            motor_points = self.data.site_xpos
            surface, _ = self.water.sample(motor_points, self.time_s)
            # A simple ventilation proxy: thrust fades as the 12 cm propeller emerges.
            immersion = np.clip((surface - motor_points[:, 2] + 0.06) / 0.12, 0, 1)
            self.data.ctrl[:] = self._motor_lag * immersion
            buoyancy, buoyancy_torque, drag, drag_torque = self._water_loads()
            self.data.qfrc_applied[:] = 0
            mujoco.mj_applyFT(
                self.model, self.data, buoyancy + drag, buoyancy_torque + drag_torque,
                self.data.qpos[:3], self._board_id, self.data.qfrc_applied,
            )
            mujoco.mj_step(self.model, self.data)
            self._steps += 1
            if not np.all(np.isfinite(self.data.qpos)) or not math.isclose(
                float(self.data.time), self.time_s, abs_tol=1e-6
            ):
                raise RuntimeError("simulation diverged; reset and review model parameters")
            if self._steps % self._sensor_steps == 0:
                mujoco.mj_forward(self.model, self.data)
                self.navigation = self._sample_navigation()
        # mj_step integrates qpos after computing Cartesian poses; refresh for consumers.
        mujoco.mj_forward(self.model, self.data)

    def _sample_navigation(self) -> NavigationSample:
        c = self.config
        east, north = self.data.qpos[:2] + self._rng.normal(0, c.gps_noise_m, 2)
        ve, vn = self.data.qvel[:2] + self._rng.normal(0, c.velocity_noise_mps, 2)
        speed = math.hypot(ve, vn)
        latitude = c.origin_latitude_deg + math.degrees(north / 6_378_137)
        longitude = c.origin_longitude_deg + math.degrees(
            east / (6_378_137 * math.cos(math.radians(c.origin_latitude_deg)))
        )
        heading = (self.truth.heading_deg + self._rng.normal(0, c.heading_noise_deg)) % 360
        rotation = self.data.body("board").xmat.reshape(3, 3)
        forward = rotation[:, 0]
        forward_dot = np.cross(rotation @ self.data.qvel[3:6], forward)
        # Derivative of the projected bow azimuth, not body-Z spin when tilted.
        rate = -math.degrees(
          (forward[0] * forward_dot[1] - forward[1] * forward_dot[0])
          / max(forward[0] ** 2 + forward[1] ** 2, 1e-8)
        )
        rate += self._rng.normal(0, c.yaw_rate_noise_deg_s)
        return NavigationSample(
            self.time_s, float(east), float(north), latitude, (longitude + 180) % 360 - 180,
            float(heading), speed,
            math.degrees(math.atan2(ve, vn)) % 360 if speed >= 0.05 else None,
            float(rate),
        )
