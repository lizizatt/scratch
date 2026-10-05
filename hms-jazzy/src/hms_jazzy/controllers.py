"""Controllers depend on sampled navigation, never MuJoCo ground truth."""

import math
from dataclasses import dataclass, field
from typing import Protocol

from .navigation import NavigationSample, ThrusterCommand, heading_error


class Controller(Protocol):
    def update(self, navigation: NavigationSample, dt_s: float) -> ThrusterCommand: ...


@dataclass(frozen=True)
class HeadingHold:
    """Demonstration PD heading controller; throttle is not a speed setpoint."""

    heading_deg: float
    throttle: float = 0.35
    kp: float = 0.018
    kd: float = 0.025

    def __post_init__(self) -> None:
        if not all(math.isfinite(v) for v in (self.heading_deg, self.throttle, self.kp, self.kd)):
            raise ValueError("controller parameters must be finite")
        if not -1 <= self.throttle <= 1 or self.kp < 0 or self.kd < 0:
            raise ValueError("invalid throttle or controller gains")

    def update(self, navigation: NavigationSample, dt_s: float) -> ThrusterCommand:
        turn = self.kp * heading_error(self.heading_deg, navigation.heading_deg)
        turn -= self.kd * navigation.yaw_rate_deg_s
        turn = max(-1.0, min(1.0, turn))
        # Preserve steering authority by reducing surge before saturating either motor.
        surge = max(-1 + abs(turn), min(1 - abs(turn), self.throttle))
        return ThrusterCommand(surge + turn, surge - turn)


@dataclass(frozen=True)
class Waypoint:
    """Local ENU target relative to the simulation origin, not the current board position."""

    east_m: float
    north_m: float
    max_throttle: float = 0.5
    arrival_radius_m: float = 1.5

    def __post_init__(self) -> None:
        values = (self.east_m, self.north_m, self.max_throttle, self.arrival_radius_m)
        if not all(math.isfinite(v) for v in values):
            raise ValueError("waypoint parameters must be finite")
        if max(abs(self.east_m), abs(self.north_m)) > 10_000:
            raise ValueError("waypoint coordinates must be within +/-10000 m")
        if not 0 < self.max_throttle <= 1 or not 0.5 <= self.arrival_radius_m <= 20:
            raise ValueError("invalid waypoint throttle limit or arrival radius")

    def distance(self, navigation: NavigationSample) -> float:
        return math.hypot(self.east_m - navigation.east_m, self.north_m - navigation.north_m)


@dataclass
class GoToWaypoint:
    """Point pursuit with ground-speed braking; arrival latches neutral, not station keeping."""

    target: Waypoint
    arrived: bool = field(default=False, init=False)

    def update(self, navigation: NavigationSample, dt_s: float) -> ThrusterCommand:
        distance = self.target.distance(navigation)
        inside = distance <= self.target.arrival_radius_m
        if self.arrived or (inside and navigation.speed_mps <= 0.1):
            self.arrived = True
            return ThrusterCommand()

        # Inside the arrival circle, brake without chasing noisy bearings past the target.
        bearing = navigation.heading_deg if inside else math.degrees(math.atan2(
            self.target.east_m - navigation.east_m, self.target.north_m - navigation.north_m
        )) % 360
        alignment = max(0.0, math.cos(math.radians(heading_error(bearing, navigation.heading_deg))))
        desired_speed = 0.0 if inside else min(1.0, 0.25 * distance) * alignment
        forward_speed = 0.0 if navigation.course_deg is None else navigation.speed_mps * math.cos(
            math.radians(heading_error(navigation.course_deg, navigation.heading_deg))
        )
        limit = self.target.max_throttle
        surge = max(-limit, min(limit, 0.65 * (desired_speed - forward_speed)))
        steering = HeadingHold(bearing, throttle=surge / limit).update(navigation, dt_s)
        return ThrusterCommand(steering.port * limit, steering.starboard * limit)
