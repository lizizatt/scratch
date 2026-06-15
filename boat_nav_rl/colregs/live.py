"""Real-time and prefix-trace COLREGS scoring for live UI."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence

import prepare as P

from colregs.config import ColregsConfig, load_config
from colregs.entry import assign_rule_from_category, assign_rule_from_pose
from colregs.geometry import pose_from_states
from colregs.trace_io import contact_from_step, own_from_step
from colregs.safety import analyze_safety, safety_pose_score, safety_range_score


def _step_own(step: Dict[str, Any]) -> P.VesselState:
    return own_from_step(step)


def _step_contact(step: Dict[str, Any], contact_idx: int) -> Optional[P.ContactState]:
    return contact_from_step(step, contact_idx)


def contact_live_status(
    step: Dict[str, Any],
    contact_idx: int,
    cfg: ColregsConfig,
    *,
    own_radius_m: float = P.OWN_RADIUS_M,
    water_current: Optional[P.WaterCurrent] = None,
) -> Optional[Dict[str, Any]]:
    """Instantaneous safety and geometry for one contact (paper Eq 2)."""
    own = _step_own(step)
    contact = _step_contact(step, contact_idx)
    if contact is None:
        return None

    cur = water_current or P.WaterCurrent()
    rng = math.hypot(contact.x_m - own.x_m, contact.y_m - own.y_m)
    pose = pose_from_states(own, contact)
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
    collision = P.check_collision(own, [contact], own_radius_m)
    safety_s = analyze_safety(
        r_cpa,
        pose,
        cfg,
        contact_radius_m=contact.radius_m,
        own_radius_m=own_radius_m,
    )
    if collision:
        safety_s = 0.0

    rule = assign_rule_from_pose(pose, cfg)
    s_r = safety_range_score(r_cpa, cfg, contact_radius_m=contact.radius_m, own_radius_m=own_radius_m)
    s_theta = safety_pose_score(pose, cfg) * cfg.S_max

    return {
        "contact_index": contact_idx,
        "range_m": round(rng, 1),
        "r_cpa_m": round(r_cpa, 1),
        "tcpa_s": round(tcpa, 1) if math.isfinite(tcpa) else None,
        "pose": {"alpha_deg": round(pose.alpha_deg, 1), "beta_deg": round(pose.beta_deg, 1)},
        "rule_id": rule.rule_id,
        "own_role": rule.own_role,
        "safety_S": round(safety_s, 1),
        "breakdown": {
            "S_r": round(s_r, 1),
            "S_theta": round(s_theta, 1),
            "collision": collision,
        },
    }


def live_status_for_step(
    step: Dict[str, Any],
    cfg: Optional[ColregsConfig] = None,
    *,
    own_radius_m: float = P.OWN_RADIUS_M,
) -> Dict[str, Any]:
    cfg = cfg or load_config()
    contacts = step.get("contacts") or []
    live = [
        status
        for i in range(len(contacts))
        if (status := contact_live_status(step, i, cfg, own_radius_m=own_radius_m)) is not None
    ]
    safety_vals = [c["safety_S"] for c in live]
    mean_s = round(sum(safety_vals) / len(safety_vals), 1) if safety_vals else None
    return {
        "live_contacts": live,
        "mean_live_safety_S": mean_s,
        # MVP: protocol mirrors safety until R16–R17 maneuver parsing lands.
        "mean_live_protocol_R": mean_s,
    }
