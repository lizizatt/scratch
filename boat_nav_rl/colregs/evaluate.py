"""Post-mission COLREGS evaluation from sim traces."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

import prepare as P

from colregs.config import ColregsConfig, load_config
from colregs.entry import RuleAssignment, assign_rule_from_category, assign_rule_from_pose
from colregs.geometry import Pose, pose_at_detection, pose_from_track_at_cpa
from colregs.safety import analyze_safety


@dataclass
class EncounterResult:
    contact_index: int
    rule: RuleAssignment
    r_cpa_m: float
    tcpa_s: float
    pose_0: Optional[Pose]
    pose_cpa: Optional[Pose]
    safety_S: float
    protocol_R: float
    t_cpa_step: int
    collision: bool
    breakdown: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "contact_index": self.contact_index,
            "rule_id": self.rule.rule_id,
            "own_role": self.rule.own_role,
            "r_cpa_m": round(self.r_cpa_m, 2),
            "tcpa_s": round(self.tcpa_s, 2) if self.tcpa_s != float("inf") else None,
            "pose_0": (
                {"alpha_deg": round(self.pose_0.alpha_deg, 1), "beta_deg": round(self.pose_0.beta_deg, 1)}
                if self.pose_0
                else None
            ),
            "pose_cpa": (
                {
                    "alpha_deg": round(self.pose_cpa.alpha_deg, 1),
                    "beta_deg": round(self.pose_cpa.beta_deg, 1),
                }
                if self.pose_cpa
                else None
            ),
            "safety_S": round(self.safety_S, 2),
            "protocol_R": round(self.protocol_R, 2),
            "t_cpa_step": self.t_cpa_step,
            "collision": self.collision,
            "breakdown": {k: round(v, 4) for k, v in self.breakdown.items()},
        }


def _contact_radius_from_step(step: Dict[str, Any], contact_idx: int) -> float:
    contacts = step.get("contacts") or []
    if contact_idx >= len(contacts):
        return P.OWN_RADIUS_M
    return float(contacts[contact_idx].get("radius_m", P.OWN_RADIUS_M))


def _had_collision(steps: Sequence[Dict[str, Any]], contact_idx: int, own_radius_m: float) -> bool:
    for step in steps:
        own = P.VesselState(
            x_m=float(step["own"]["x"]),
            y_m=float(step["own"]["y"]),
            heading_rad=float(step["own"]["heading"]),
            speed_mps=float(step["own"]["speed"]),
        )
        contacts = step.get("contacts") or []
        if contact_idx >= len(contacts):
            continue
        c = contacts[contact_idx]
        contact = P.ContactState(
            x_m=float(c["x"]),
            y_m=float(c["y"]),
            cog_rad=float(c["cog"]),
            sog_mps=float(c["sog"]),
            speed_mps=float(c["sog"]),
            radius_m=float(c.get("radius_m", P.OWN_RADIUS_M)),
            vessel_class=str(c.get("vessel_class", P.DEFAULT_VESSEL_CLASS)),
        )
        if P.check_collision(own, [contact], own_radius_m):
            return True
    return False


def evaluate_contact_encounter(
    steps: Sequence[Dict[str, Any]],
    contact_idx: int,
    cfg: ColregsConfig,
    *,
    scenario_category: str = "",
    own_radius_m: float = P.OWN_RADIUS_M,
) -> Optional[EncounterResult]:
    if not steps:
        return None
    if not (steps[0].get("contacts") or []) or contact_idx >= len(steps[0]["contacts"]):
        return None

    pose_cpa, r_cpa, tcpa, t_idx = pose_from_track_at_cpa(steps, contact_idx)
    pose_0 = pose_at_detection(steps, contact_idx, R_detect_m=cfg.R_detect_m)
    contact_r = _contact_radius_from_step(steps[0], contact_idx)
    collision = _had_collision(steps, contact_idx, own_radius_m)

    rule = assign_rule_from_category(scenario_category)
    if rule is None and pose_0 is not None:
        rule = assign_rule_from_pose(pose_0, cfg)
    if rule is None:
        rule = assign_rule_from_pose(pose_0 or pose_cpa or Pose(0.0, 0.0), cfg)

    safety_s = analyze_safety(
        r_cpa,
        pose_cpa,
        cfg,
        contact_radius_m=contact_r,
        own_radius_m=own_radius_m,
    )
    if collision:
        safety_s = 0.0

    # Protocol score: safety-led MVP; full R16–R17 maneuver parsing in phase P3.
    protocol_r = safety_s
    breakdown = {"safety_base": safety_s / 100.0}

    return EncounterResult(
        contact_index=contact_idx,
        rule=rule,
        r_cpa_m=r_cpa,
        tcpa_s=tcpa,
        pose_0=pose_0,
        pose_cpa=pose_cpa,
        safety_S=safety_s,
        protocol_R=protocol_r,
        t_cpa_step=t_idx,
        collision=collision,
        breakdown=breakdown,
    )


def evaluate_trace(
    steps: Sequence[Dict[str, Any]],
    cfg: Optional[ColregsConfig] = None,
    *,
    scenario_category: str = "",
    own_radius_m: float = P.OWN_RADIUS_M,
) -> List[EncounterResult]:
    cfg = cfg or load_config()
    if not steps:
        return []
    n_contacts = len(steps[0].get("contacts") or [])
    return [
        enc
        for i in range(n_contacts)
        if (enc := evaluate_contact_encounter(
            steps,
            i,
            cfg,
            scenario_category=scenario_category,
            own_radius_m=own_radius_m,
        ))
        is not None
    ]


def evaluate_episode(
    episode: Dict[str, Any],
    cfg: Optional[ColregsConfig] = None,
) -> Dict[str, Any]:
    """Score one eval episode dict (must include 'steps' when traced)."""
    steps = episode.get("steps") or []
    category = str(episode.get("scenario_category", ""))
    encounters = evaluate_trace(steps, cfg, scenario_category=category)
    if not encounters:
        return {
            "encounters": [],
            "mean_safety_S": None,
            "mean_protocol_R": None,
            "min_safety_S": None,
            "violations_below_S_threshold": 0,
            "violations_below_R_threshold": 0,
        }

    cfg = cfg or load_config()
    safety_vals = [e.safety_S for e in encounters]
    protocol_vals = [e.protocol_R for e in encounters]
    return {
        "encounters": [e.to_dict() for e in encounters],
        "mean_safety_S": round(sum(safety_vals) / len(safety_vals), 2),
        "mean_protocol_R": round(sum(protocol_vals) / len(protocol_vals), 2),
        "min_safety_S": round(min(safety_vals), 2),
        "violations_below_S_threshold": sum(1 for s in safety_vals if s < cfg.S_threshold_report),
        "violations_below_R_threshold": sum(1 for r in protocol_vals if r < cfg.R_threshold_report),
        "by_rule": _rollup_by_rule(encounters),
    }


def _rollup_by_rule(encounters: Sequence[EncounterResult]) -> Dict[str, float]:
    buckets: Dict[str, List[float]] = {}
    for enc in encounters:
        buckets.setdefault(enc.rule.rule_id, []).append(enc.protocol_R)
    return {k: round(sum(v) / len(v), 2) for k, v in buckets.items()}


def rollup_episodes(episode_scores: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    safety = [e["mean_safety_S"] for e in episode_scores if e.get("mean_safety_S") is not None]
    protocol = [e["mean_protocol_R"] for e in episode_scores if e.get("mean_protocol_R") is not None]
    by_rule: Dict[str, List[float]] = {}
    for ep in episode_scores:
        for rule, val in (ep.get("by_rule") or {}).items():
            by_rule.setdefault(rule, []).append(val)
    return {
        "colregs_mean_safety": round(sum(safety) / len(safety), 4) if safety else None,
        "colregs_mean_protocol": round(sum(protocol) / len(protocol), 4) if protocol else None,
        "colregs_by_rule": {k: round(sum(v) / len(v), 4) for k, v in by_rule.items()},
        "colregs_episodes_scored": len(safety),
    }
