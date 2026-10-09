"""The sensor-only boundary exposed to controllers."""

import math
from dataclasses import dataclass


def heading_from_yaw(yaw_rad: float) -> float:
    return (90 - math.degrees(yaw_rad)) % 360


def yaw_from_heading(heading_deg: float) -> float:
    return math.radians(90 - heading_deg)


def heading_error(target_deg: float, actual_deg: float) -> float:
    """Shortest signed error; positive is a starboard turn."""
    return (target_deg - actual_deg + 180) % 360 - 180


@dataclass(frozen=True)
class NavigationSample:
    time_s: float
    east_m: float
    north_m: float
    latitude_deg: float
    longitude_deg: float
    heading_deg: float
    speed_mps: float
    course_deg: float | None
    yaw_rate_deg_s: float


@dataclass(frozen=True)
class ThrusterCommand:
    """Normalized port/starboard demands: -1 reverse, 0 neutral, +1 forward."""

    port: float = 0.0
    starboard: float = 0.0

    def __post_init__(self) -> None:
        for value in (self.port, self.starboard):
            if not math.isfinite(value) or not -1 <= value <= 1:
                raise ValueError("thruster commands must be finite and within [-1, 1]")
