"""COLREGS pose geometry — contact angle α and relative bearing β (paper §3)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import prepare as P
from colregs.trace_io import contact_from_step, contact_radius_from_step, own_from_step


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
    return contact_from_step(step, contact_idx)


def _track_own_state(step: Dict[str, Any]) -> P.VesselState:
    return own_from_step(step)


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
    best_cpa = float("inf")
    best_idx = 0
    best_pose: Optional[Pose] = None
    best_tcpa = float("inf")

    for idx, step in enumerate(steps):
        own = own_from_step(step)
        contact = contact_from_step(step, contact_idx)
        if contact is None:
            continue
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
        if r_cpa < best_cpa:
            best_cpa = r_cpa
            best_idx = idx
            best_pose = pose_from_states(own, contact)
            best_tcpa = tcpa

    if best_pose is None:
        return None, float("inf"), float("inf"), 0
    return best_pose, best_cpa, best_tcpa, best_idx


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
