"""Step reward shaping for BoatNavEnv — weights and computation."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

import prepare as P

# --- Weights (tune between experiments via train.py CONFIG re-exports) ---
W_GOAL_PROGRESS = 3.0
W_GOAL_ARRIVAL = 50.0
W_GOAL_ARRIVAL_EARLY = 8.0
W_HOLD_BASE = 2.0
W_HOLD_SPEED = 3.0
W_HOLD_CENTER = 0.6
W_APPROACH_SLOW = 0.35
APPROACH_SLOW_RANGE_M = 200.0
W_SMOOTH = 0.02
W_CPA = 40.0
W_CPA_SOFT = 12.0
CPA_WARNING_MULT = 2.0
W_GOAL_THREAT_STAY = 6.0
THREAT_PROGRESS_THRESH = 0.25
W_COLLISION = 100.0
W_HOLD_OVERSPEED = 3.0
W_CROSS_TRACK = 0.0
CROSS_TRACK_SCALE_M = 100.0
HOLD_STATIONARY_SPEED_MPS = 0.15
HOLD_AT_STOP_EPS_MPS = 0.1
REWARD_CLIP = 400.0

# Keys emitted in step reward breakdown (order for dashboards).
REWARD_BREAKDOWN_KEYS: Tuple[str, ...] = (
    "progress",
    "cross_track",
    "approach_slow",
    "goal_arrival",
    "hold_speed",
    "hold_center",
    "hold_overspeed",
    "goal_threat_stay",
    "smooth",
    "cpa",
    "collision",
)

_SPEED_DENOM = max(P.V_MAX_MPS - P.V_MIN_MPS, 1e-6)

_DEPRECATED_CONFIG_KEYS = frozenset(
    {
        "energy",
        "energy_en_route_frac",
        "time_en_route",
        "speed_track",
        "goal_direct",
        "goal_direct_range_thresh_m",
        "escape_goal",
        "approach_cruise_taper",
        "goal_reached",
        "goal_early",
        "goal_hold",
        "hold_station",
    }
)

_LEGACY_CONFIG_ALIASES: Dict[str, str] = {
    "goal_reached": "goal_arrival",
    "goal_early": "goal_arrival_early",
    "goal_hold": "hold_base",
    "hold_station": "hold_speed",
}


@dataclass
class ContactStepMetrics:
    min_range_m: float
    min_cpa_m: Optional[float]
    collision: bool
    cpa_penalty: float
    threat: float
    cpa_unsafe: bool = False


@dataclass
class StepRewardInput:
    own: P.VesselState
    goal_x: float
    goal_y: float
    water_current: P.WaterCurrent
    curr_goal_range: float
    initial_goal_range: float
    prev_goal_range: float
    goal_hold_steps: int
    step_count: int
    max_steps: int
    action: np.ndarray
    prev_action: np.ndarray
    in_goal_zone: bool
    threat: float
    cpa_penalty: float
    collision: bool
    cpa_unsafe: bool = False
    leg_start_x: float = 0.0
    leg_start_y: float = 0.0


@dataclass
class StepRewardOutput:
    reward: float
    goal_hold_steps: int
    breakdown: Dict[str, float] = field(default_factory=dict)


class _BreakdownSink:
    """No-op dict writer when reward breakdown is disabled (training hot path)."""

    __slots__ = ("_active", "_data")

    def __init__(self, active: bool) -> None:
        self._active = active
        self._data: Dict[str, float] = {} if active else {}

    def __setitem__(self, key: str, value: float) -> None:
        if self._active:
            self._data[key] = value

    def as_dict(self) -> Dict[str, float]:
        return self._data


def reward_weights_dict() -> Dict[str, Any]:
    return {
        "goal_progress": W_GOAL_PROGRESS,
        "goal_arrival": W_GOAL_ARRIVAL,
        "goal_arrival_early": W_GOAL_ARRIVAL_EARLY,
        "hold_base": W_HOLD_BASE,
        "hold_speed": W_HOLD_SPEED,
        "hold_center": W_HOLD_CENTER,
        "approach_slow": W_APPROACH_SLOW,
        "approach_slow_range_m": APPROACH_SLOW_RANGE_M,
        "cpa": W_CPA,
        "cpa_soft": W_CPA_SOFT,
        "cpa_warning_mult": CPA_WARNING_MULT,
        "goal_threat_stay": W_GOAL_THREAT_STAY,
        "collision": W_COLLISION,
        "hold_overspeed": W_HOLD_OVERSPEED,
        "cross_track": W_CROSS_TRACK,
        "cross_track_scale_m": CROSS_TRACK_SCALE_M,
        "hold_stationary_speed_mps": HOLD_STATIONARY_SPEED_MPS,
        "hold_at_stop_eps_mps": HOLD_AT_STOP_EPS_MPS,
    }


_REWARD_CONFIG_MAP: Dict[str, Tuple[str, type]] = {
    "goal_progress": ("W_GOAL_PROGRESS", float),
    "goal_arrival": ("W_GOAL_ARRIVAL", float),
    "goal_arrival_early": ("W_GOAL_ARRIVAL_EARLY", float),
    "hold_base": ("W_HOLD_BASE", float),
    "hold_speed": ("W_HOLD_SPEED", float),
    "hold_center": ("W_HOLD_CENTER", float),
    "approach_slow": ("W_APPROACH_SLOW", float),
    "approach_slow_range_m": ("APPROACH_SLOW_RANGE_M", float),
    "cpa": ("W_CPA", float),
    "cpa_soft": ("W_CPA_SOFT", float),
    "cpa_warning_mult": ("CPA_WARNING_MULT", float),
    "goal_threat_stay": ("W_GOAL_THREAT_STAY", float),
    "collision": ("W_COLLISION", float),
    "hold_overspeed": ("W_HOLD_OVERSPEED", float),
    "cross_track": ("W_CROSS_TRACK", float),
    "cross_track_scale_m": ("CROSS_TRACK_SCALE_M", float),
    "hold_stationary_speed_mps": ("HOLD_STATIONARY_SPEED_MPS", float),
    "hold_at_stop_eps_mps": ("HOLD_AT_STOP_EPS_MPS", float),
}


def apply_reward_overrides(overrides: Dict[str, Any]) -> Dict[str, Any]:
    """Apply reward weight overrides in-process (for CLI / agent iteration)."""
    applied: Dict[str, Any] = {}
    g = globals()
    for key, raw in overrides.items():
        if key in _DEPRECATED_CONFIG_KEYS:
            if key in _LEGACY_CONFIG_ALIASES:
                key = _LEGACY_CONFIG_ALIASES[key]
            else:
                continue
        spec = _REWARD_CONFIG_MAP.get(key)
        if spec is None:
            continue
        name, cast = spec
        value = cast(raw)
        g[name] = value
        applied[key] = value
    return applied


def aggregate_episode_breakdowns(episodes: Sequence[Dict[str, Any]]) -> Dict[str, float]:
    """Mean per-step reward component across eval episodes."""
    buckets: Dict[str, List[float]] = {}
    for ep in episodes:
        bd = ep.get("mean_reward_breakdown") or {}
        for key, val in bd.items():
            buckets.setdefault(key, []).append(float(val))
    return {k: round(sum(vals) / len(vals), 4) for k, vals in buckets.items() if vals}


def _speed_norm(speed_mps: float) -> float:
    return (speed_mps - P.V_MIN_MPS) / _SPEED_DENOM


def _slow_bonus(speed_mps: float) -> float:
    return max(0.0, 1.0 - _speed_norm(speed_mps)) ** 2


_GATED_HOLD_ENABLED = True


def set_gated_hold_enabled(enabled: bool) -> None:
    global _GATED_HOLD_ENABLED
    _GATED_HOLD_ENABLED = bool(enabled)


def gated_hold_enabled() -> bool:
    return _GATED_HOLD_ENABLED


def is_hold_stationary(speed_mps: float) -> bool:
    """True when speed is low enough to count toward the goal hold timer."""
    if not _GATED_HOLD_ENABLED:
        return True
    return speed_mps <= HOLD_STATIONARY_SPEED_MPS


def hold_overspeed_penalty(speed_mps: float) -> float:
    if not _GATED_HOLD_ENABLED or is_hold_stationary(speed_mps):
        return 0.0
    excess = speed_mps - HOLD_STATIONARY_SPEED_MPS
    return -W_HOLD_OVERSPEED * excess / max(P.V_MAX_MPS, 1e-6)


def speed_energy_fraction(speed_mps: float) -> float:
    """Normalized propulsion-energy proxy in [0, 1] (quadratic in speed). Used for eval scoring only."""
    n = _speed_norm(speed_mps)
    return n * n


def energy_score_from_speeds(speeds: Sequence[float]) -> float:
    """1.0 at minimum speed; decreases toward 0 at maximum speed."""
    if not speeds:
        return 1.0
    mean_frac = sum(speed_energy_fraction(s) for s in speeds) / len(speeds)
    return max(0.0, 1.0 - mean_frac)


def energy_score_from_trace(steps: Sequence[Dict[str, Any]]) -> float:
    speeds = [
        float(s["own"]["speed"])
        for s in steps
        if isinstance(s.get("own"), dict) and "speed" in s["own"]
    ]
    return energy_score_from_speeds(speeds)


def contact_step_metrics(
    own: P.VesselState,
    contacts: List[P.ContactState],
    water_current: P.WaterCurrent,
    own_radius_m: float,
) -> ContactStepMetrics:
    """Single pass: range, CPA, collision, and shaping penalties."""
    if not contacts:
        return ContactStepMetrics(
            min_range_m=float("inf"),
            min_cpa_m=None,
            collision=False,
            cpa_penalty=0.0,
            threat=0.0,
            cpa_unsafe=False,
        )

    min_rng = P.min_contact_range(own, contacts)
    collision = P.check_collision(own, contacts, own_radius_m)
    own_vx, own_vy = P.own_velocity(own, water_current)
    cpa_penalty = 0.0
    threat = 0.0
    cpa_unsafe = False
    min_cpa = float("inf")

    for c in contacts:
        c_vx, c_vy = P.contact_velocity(c)
        cpa_m, tcpa = P.compute_cpa_tcpa(
            own.x_m,
            own.y_m,
            own_vx,
            own_vy,
            c.x_m,
            c.y_m,
            c_vx,
            c_vy,
        )
        min_cpa = min(min_cpa, cpa_m)
        safe = P.cpa_safe_distance(c.radius_m, own_radius_m)
        if tcpa < 0.0 or tcpa > P.CPA_HORIZON_S:
            continue
        if cpa_m < safe:
            cpa_unsafe = True
            frac = (safe - cpa_m) / safe
            cpa_penalty += W_CPA * frac
            threat = max(threat, min(1.0, frac))
        elif cpa_m < safe * CPA_WARNING_MULT:
            span = safe * (CPA_WARNING_MULT - 1.0)
            warn_frac = (safe * CPA_WARNING_MULT - cpa_m) / max(span, 1e-6)
            cpa_penalty += W_CPA_SOFT * warn_frac
            threat = max(threat, min(1.0, 0.5 * warn_frac))

    return ContactStepMetrics(
        min_range_m=min_rng,
        min_cpa_m=min_cpa,
        collision=collision,
        cpa_penalty=cpa_penalty,
        threat=threat,
        cpa_unsafe=cpa_unsafe,
    )


def contact_threat_and_cpa_penalty(
    own: P.VesselState,
    contacts: List[P.ContactState],
    water_current: P.WaterCurrent,
    own_radius_m: float,
) -> Tuple[float, float]:
    metrics = contact_step_metrics(own, contacts, water_current, own_radius_m)
    return metrics.cpa_penalty, metrics.threat


def cross_track_step_penalty(
    leg_start_x: float,
    leg_start_y: float,
    goal_x: float,
    goal_y: float,
    own_x: float,
    own_y: float,
) -> float:
    """Penalty for lateral offset from the start→goal track (quadratic in meters/scale)."""
    if W_CROSS_TRACK <= 0.0:
        return 0.0
    ct_m = P.cross_track_m(leg_start_x, leg_start_y, goal_x, goal_y, own_x, own_y)
    norm = ct_m / max(CROSS_TRACK_SCALE_M, 1e-6)
    return -W_CROSS_TRACK * norm * norm


def compute_step_reward(
    inp: StepRewardInput,
    *,
    include_breakdown: bool = True,
) -> StepRewardOutput:
    """Compute clipped step reward and optional named breakdown components."""
    breakdown = _BreakdownSink(include_breakdown)
    reward = 0.0
    goal_hold_steps = inp.goal_hold_steps

    progress_scale = 1.0 + min(
        inp.curr_goal_range / max(inp.initial_goal_range, 1.0), 1.0
    )
    retreat_m = max(0.0, inp.curr_goal_range - inp.prev_goal_range)
    approach_m = max(0.0, inp.prev_goal_range - inp.curr_goal_range)

    if inp.in_goal_zone and (inp.cpa_unsafe or inp.threat >= THREAT_PROGRESS_THRESH):
        threat_mult = 1.0 + max(inp.threat, 1.0 if inp.cpa_unsafe else 0.0)
        prog = W_GOAL_PROGRESS * retreat_m * progress_scale * threat_mult / 100.0
        reward += prog
        breakdown["progress"] = prog
    else:
        prog = W_GOAL_PROGRESS * (approach_m - retreat_m) * progress_scale / 100.0
        reward += prog
        breakdown["progress"] = prog

    if not inp.in_goal_zone:
        cross = cross_track_step_penalty(
            inp.leg_start_x,
            inp.leg_start_y,
            inp.goal_x,
            inp.goal_y,
            inp.own.x_m,
            inp.own.y_m,
        )
        reward += cross
        breakdown["cross_track"] = cross

    if inp.in_goal_zone:
        hold_allowed = not inp.cpa_unsafe
        if hold_allowed:
            stationary = is_hold_stationary(inp.own.speed_mps)
            if stationary:
                if goal_hold_steps == 0:
                    arrival = W_GOAL_ARRIVAL
                    if inp.max_steps > 0:
                        arrival += W_GOAL_ARRIVAL_EARLY * max(
                            0.0, 1.0 - inp.step_count / inp.max_steps
                        )
                    reward += arrival
                    breakdown["goal_arrival"] = arrival
                goal_hold_steps += 1
                hold_speed = W_HOLD_BASE + W_HOLD_SPEED * _slow_bonus(inp.own.speed_mps)
                center = -W_HOLD_CENTER * (
                    inp.curr_goal_range / P.GOAL_SUCCESS_RANGE_M
                )
                reward += hold_speed + center
                breakdown["hold_speed"] = hold_speed
                breakdown["hold_center"] = center
            else:
                overspeed = hold_overspeed_penalty(inp.own.speed_mps)
                reward += overspeed
                breakdown["hold_overspeed"] = overspeed
        if inp.cpa_unsafe or inp.threat >= THREAT_PROGRESS_THRESH:
            stay_threat = max(inp.threat, 1.0 if inp.cpa_unsafe else 0.0)
            stay = -W_GOAL_THREAT_STAY * stay_threat
            reward += stay
            breakdown["goal_threat_stay"] = stay
    else:
        goal_hold_steps = 0
        slow_bonus = _slow_bonus(inp.own.speed_mps)
        if inp.curr_goal_range < APPROACH_SLOW_RANGE_M:
            prox = 1.0 - inp.curr_goal_range / APPROACH_SLOW_RANGE_M
            approach = W_APPROACH_SLOW * prox * slow_bonus
            reward += approach
            breakdown["approach_slow"] = approach

    smooth = -W_SMOOTH * float(np.linalg.norm(inp.action - inp.prev_action))
    reward += smooth
    breakdown["smooth"] = smooth

    reward -= inp.cpa_penalty
    breakdown["cpa"] = -inp.cpa_penalty

    if inp.collision:
        reward -= W_COLLISION
        breakdown["collision"] = -W_COLLISION

    reward = float(np.clip(reward, -REWARD_CLIP, REWARD_CLIP))
    if not math.isfinite(reward):
        reward = 0.0

    return StepRewardOutput(
        reward=reward,
        goal_hold_steps=goal_hold_steps,
        breakdown=breakdown.as_dict(),
    )
