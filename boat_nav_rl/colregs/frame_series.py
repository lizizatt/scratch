"""Incremental COLREGS frame scoring for replay scrubber (O(n) not O(n²))."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Set

import prepare as P

from colregs.config import ColregsConfig, load_config
from colregs.entry import RuleAssignment, assign_rule_from_category, assign_rule_from_pose
from colregs.evaluate import EncounterResult, _rollup_by_rule
from colregs.geometry import Pose, pose_from_states
from colregs.live import live_status_for_step
from colregs.safety import analyze_safety
from colregs.trace_io import contact_from_step, contact_radius_from_step, own_from_step


@dataclass
class _RollingContact:
    contact_index: int
    contact_radius_m: float
    pose_0: Optional[Pose] = None
    best_cpa_m: float = field(default_factory=lambda: float("inf"))
    best_tcpa_s: float = field(default_factory=lambda: float("inf"))
    best_cpa_step: int = 0
    best_pose_cpa: Optional[Pose] = None
    collision: bool = False


class RollingEncounterTracker:
    """Update encounter state one step at a time instead of re-scoring prefixes."""

    def __init__(
        self,
        cfg: ColregsConfig,
        *,
        scenario_category: str = "",
        own_radius_m: float = P.OWN_RADIUS_M,
        water_current: Optional[P.WaterCurrent] = None,
    ) -> None:
        self.cfg = cfg
        self.scenario_category = scenario_category
        self.own_radius_m = own_radius_m
        self.water_current = water_current or P.WaterCurrent()
        self._contacts: Dict[int, _RollingContact] = {}

    def ingest_step(self, step_idx: int, step: Dict[str, Any]) -> None:
        own = own_from_step(step)
        contacts = step.get("contacts") or []
        for i in range(len(contacts)):
            rolling = self._contacts.setdefault(
                i,
                _RollingContact(
                    contact_index=i,
                    contact_radius_m=contact_radius_from_step(step, i),
                ),
            )
            contact = contact_from_step(step, i)
            if contact is None:
                continue
            if P.check_collision(own, [contact], self.own_radius_m):
                rolling.collision = True

            rng = math.hypot(contact.x_m - own.x_m, contact.y_m - own.y_m)
            if rolling.pose_0 is None and rng <= self.cfg.R_detect_m:
                rolling.pose_0 = pose_from_states(own, contact)

            own_vx, own_vy = P.own_velocity(own, self.water_current)
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
            if r_cpa < rolling.best_cpa_m:
                rolling.best_cpa_m = r_cpa
                rolling.best_tcpa_s = tcpa
                rolling.best_cpa_step = step_idx
                rolling.best_pose_cpa = pose_from_states(own, contact)

    def _encounter_result(self, rolling: _RollingContact) -> Optional[EncounterResult]:
        if rolling.best_pose_cpa is None and rolling.pose_0 is None:
            return None

        rule = assign_rule_from_category(self.scenario_category)
        if rule is None and rolling.pose_0 is not None:
            rule = assign_rule_from_pose(rolling.pose_0, self.cfg)
        if rule is None:
            rule = assign_rule_from_pose(
                rolling.pose_0 or rolling.best_pose_cpa or Pose(0.0, 0.0),
                self.cfg,
            )

        safety_s = analyze_safety(
            rolling.best_cpa_m,
            rolling.best_pose_cpa,
            self.cfg,
            contact_radius_m=rolling.contact_radius_m,
            own_radius_m=self.own_radius_m,
        )
        if rolling.collision:
            safety_s = 0.0

        protocol_r = safety_s
        return EncounterResult(
            contact_index=rolling.contact_index,
            rule=rule,
            r_cpa_m=rolling.best_cpa_m,
            tcpa_s=rolling.best_tcpa_s,
            pose_0=rolling.pose_0,
            pose_cpa=rolling.best_pose_cpa,
            safety_S=safety_s,
            protocol_R=protocol_r,
            t_cpa_step=rolling.best_cpa_step,
            collision=rolling.collision,
            breakdown={"safety_base": safety_s / 100.0},
        )

    def rollup(self) -> Dict[str, Any]:
        encounters = [
            enc
            for rolling in self._contacts.values()
            if (enc := self._encounter_result(rolling)) is not None
        ]
        if not encounters:
            return {
                "encounters": [],
                "mean_safety_S": None,
                "mean_protocol_R": None,
                "min_safety_S": None,
                "violations_below_S_threshold": 0,
                "violations_below_R_threshold": 0,
                "by_rule": {},
            }

        safety_vals = [e.safety_S for e in encounters]
        protocol_vals = [e.protocol_R for e in encounters]
        return {
            "encounters": [e.to_dict() for e in encounters],
            "mean_safety_S": round(sum(safety_vals) / len(safety_vals), 2),
            "mean_protocol_R": round(sum(protocol_vals) / len(protocol_vals), 2),
            "min_safety_S": round(min(safety_vals), 2),
            "violations_below_S_threshold": sum(
                1 for s in safety_vals if s < self.cfg.S_threshold_report
            ),
            "violations_below_R_threshold": sum(
                1 for r in protocol_vals if r < self.cfg.R_threshold_report
            ),
            "by_rule": _rollup_by_rule(encounters),
        }


def frame_score_series(
    steps: Sequence[Dict[str, Any]],
    *,
    scenario_category: str = "",
    cfg: Optional[ColregsConfig] = None,
    stride: int = 1,
) -> List[Dict[str, Any]]:
    """Precompute COLREGS rollup at each replay frame in one O(n) pass."""
    if not steps:
        return []

    stride = max(1, int(stride))
    cfg = cfg or load_config()
    indices: List[int] = list(range(0, len(steps), stride))
    if indices[-1] != len(steps) - 1:
        indices.append(len(steps) - 1)
    sample_frames: Set[int] = set(indices)

    tracker = RollingEncounterTracker(
        cfg,
        scenario_category=scenario_category,
    )
    series: List[Dict[str, Any]] = []

    for step_idx, step in enumerate(steps):
        tracker.ingest_step(step_idx, step)
        if step_idx not in sample_frames:
            continue
        rollup = tracker.rollup()
        live = live_status_for_step(step, cfg=cfg)
        series.append(
            {
                "frame": step_idx,
                "mean_safety_S": rollup.get("mean_safety_S"),
                "mean_protocol_R": rollup.get("mean_protocol_R"),
                "min_safety_S": rollup.get("min_safety_S"),
                "by_rule": rollup.get("by_rule") or {},
                "encounters": rollup.get("encounters") or [],
                "live": live,
            }
        )

    return series


def frame_score_series_naive(
    steps: Sequence[Dict[str, Any]],
    *,
    scenario_category: str = "",
    cfg: Optional[ColregsConfig] = None,
    stride: int = 1,
) -> List[Dict[str, Any]]:
    """Reference O(n²) implementation — for tests only."""
    from colregs.evaluate import evaluate_steps

    if not steps:
        return []
    stride = max(1, int(stride))
    cfg = cfg or load_config()
    indices = list(range(0, len(steps), stride))
    if indices[-1] != len(steps) - 1:
        indices.append(len(steps) - 1)
    series: List[Dict[str, Any]] = []
    for i in indices:
        rollup = evaluate_steps(steps[: i + 1], scenario_category=scenario_category, cfg=cfg)
        live = live_status_for_step(steps[i], cfg=cfg)
        series.append(
            {
                "frame": i,
                "mean_safety_S": rollup.get("mean_safety_S"),
                "mean_protocol_R": rollup.get("mean_protocol_R"),
                "min_safety_S": rollup.get("min_safety_S"),
                "by_rule": rollup.get("by_rule") or {},
                "encounters": rollup.get("encounters") or [],
                "live": live,
            }
        )
    return series
