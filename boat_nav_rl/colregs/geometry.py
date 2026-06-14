"""COLREGS pose geometry — contact angle α and relative bearing β (paper §3)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import prepare as P


@dataclass(frozen=True)
class Pose:
    """α in [-180, 180), β in [0, 360)."""

    alpha_deg: float
    beta_deg: float


def _normalize_beta_deg(bearing_rad: float) -> float:
    deg = math.degrees(bearing_rad) % 360.0
    return deg if deg >= 0.0 else deg + 360.0


def _alpha_from_bearings(contact_to_own_brg_rad: float, contact_cog_rad: float) -> float:
    """Contact angle: ownship bearing as seen from contact, relative to contact bow."""
    alpha = math.degrees(contact_cog_rad - contact_to_own_brg_rad)
    alpha = (alpha + 180.0) % 360.0 - 180.0
    return alpha


def pose_at(
    own_x: float,
    own_y: float,
    own_heading_rad: float,
    contact_x: float,
    contact_y: float,
    contact_cog_rad: float,
) -> Pose:
    brg_to_contact, _ = P.bearing_range(own_x, own_y, contact_x, contact_y)
    brg_to_own, _ = P.bearing_range(contact_x, contact_y, own_x, own_y)
    beta = _normalize_beta_deg(brg_to_contact - own_heading_rad)
    alpha = _alpha_from_bearings(brg_to_own, contact_cog_rad)
    return Pose(alpha_deg=alpha, beta_deg=beta)


def pose_from_states(own: P.VesselState, contact: P.ContactState) -> Pose:
    return pose_at(
        own.x_m,
        own.y_m,
        own.heading_rad,
        contact.x_m,
        contact.y_m,
        contact.cog_rad,
    )


def _track_contact_state(step: Dict[str, Any], contact_idx: int) -> Optional[P.ContactState]:
    contacts = step.get("contacts") or []
    if contact_idx >= len(contacts):
        return None
    c = contacts[contact_idx]
    return P.ContactState(
        x_m=float(c["x"]),
        y_m=float(c["y"]),
        cog_rad=float(c["cog"]),
        sog_mps=float(c["sog"]),
        speed_mps=float(c["sog"]),
        radius_m=float(c.get("radius_m", P.OWN_RADIUS_M)),
        vessel_class=str(c.get("vessel_class", P.DEFAULT_VESSEL_CLASS)),
    )


def _track_own_state(step: Dict[str, Any]) -> P.VesselState:
    o = step["own"]
    return P.VesselState(
        x_m=float(o["x"]),
        y_m=float(o["y"]),
        heading_rad=float(o["heading"]),
        speed_mps=float(o["speed"]),
        cmd_heading_rad=float(o.get("cmd_heading", o["heading"])),
        cmd_speed_mps=float(o.get("cmd_speed", o["speed"])),
    )


def pose_from_step(step: Dict[str, Any], contact_idx: int = 0) -> Optional[Pose]:
    contact = _track_contact_state(step, contact_idx)
    if contact is None:
        return None
    return pose_from_states(_track_own_state(step), contact)


def pose_from_track_at_cpa(
    steps: Sequence[Dict[str, Any]],
    contact_idx: int = 0,
    *,
    water_current: Optional[P.WaterCurrent] = None,
) -> Tuple[Optional[Pose], float, float, int]:
    """Return (pose_at_cpa, r_cpa_m, t_cpa_s, step_index) from a sim trace."""
    if not steps:
        return None, float("inf"), float("inf"), 0

    cur = water_current or P.WaterCurrent()
    best_r = float("inf")
    best_idx = 0
    best_pose: Optional[Pose] = None

    for idx, step in enumerate(steps):
        own = _track_own_state(step)
        contact = _track_contact_state(step, contact_idx)
        if contact is None:
            continue
        rng = math.hypot(contact.x_m - own.x_m, contact.y_m - own.y_m)
        if rng < best_r:
            best_r = rng
            best_idx = idx
            best_pose = pose_from_states(own, contact)

    if best_pose is None:
        return None, float("inf"), float("inf"), 0

    own = _track_own_state(steps[best_idx])
    contact = _track_contact_state(steps[best_idx], contact_idx)
    assert contact is not None
    own_vx, own_vy = P.own_velocity(own, cur)
    c_vx, c_vy = P.contact_velocity(contact)
    r_cpa, tcpa = P.compute_cpa_tcpa(
        own.x_m,
        own.y_m,
        own_vx,
        own_vy,
        contact.x_m,
        contact.y_m,
        c_vx,
        c_vy,
    )
    return best_pose, r_cpa, tcpa, best_idx


def pose_at_detection(
    steps: Sequence[Dict[str, Any]],
    contact_idx: int,
    *,
    R_detect_m: float,
) -> Optional[Pose]:
    for step in steps:
        own = _track_own_state(step)
        contact = _track_contact_state(step, contact_idx)
        if contact is None:
            continue
        rng = math.hypot(contact.x_m - own.x_m, contact.y_m - own.y_m)
        if rng <= R_detect_m:
            return pose_from_states(own, contact)
    return None
