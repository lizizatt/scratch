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
W_SMOOTH = 0.012
W_CPA = 40.0
W_CPA_SOFT = 12.0
CPA_WARNING_MULT = 2.0
W_GOAL_THREAT_STAY = 6.0
THREAT_PROGRESS_THRESH = 0.25
W_COLLISION = 100.0
W_HOLD_OVERSPEED = 3.0
W_CROSS_TRACK = 0.65
CROSS_TRACK_SCALE_M = 60.0
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

_REWARD_FIELD_MAP: Dict[str, str] = {
    "goal_progress": "w_goal_progress",
    "goal_arrival": "w_goal_arrival",
    "goal_arrival_early": "w_goal_arrival_early",
    "hold_base": "w_hold_base",
    "hold_speed": "w_hold_speed",
    "hold_center": "w_hold_center",
    "approach_slow": "w_approach_slow",
    "approach_slow_range_m": "approach_slow_range_m",
    "cpa": "w_cpa",
    "cpa_soft": "w_cpa_soft",
    "cpa_warning_mult": "cpa_warning_mult",
    "goal_threat_stay": "w_goal_threat_stay",
    "collision": "w_collision",
    "hold_overspeed": "w_hold_overspeed",
    "cross_track": "w_cross_track",
    "cross_track_scale_m": "cross_track_scale_m",
    "hold_stationary_speed_mps": "hold_stationary_speed_mps",
    "hold_at_stop_eps_mps": "hold_at_stop_eps_mps",
}


@dataclass
class RewardConfig:
    """Mutable reward weights — pass into envs instead of relying on module globals."""

    w_goal_progress: float = W_GOAL_PROGRESS
    w_goal_arrival: float = W_GOAL_ARRIVAL
    w_goal_arrival_early: float = W_GOAL_ARRIVAL_EARLY
    w_hold_base: float = W_HOLD_BASE
    w_hold_speed: float = W_HOLD_SPEED
    w_hold_center: float = W_HOLD_CENTER
    w_approach_slow: float = W_APPROACH_SLOW
    approach_slow_range_m: float = APPROACH_SLOW_RANGE_M
    w_cpa: float = W_CPA
    w_cpa_soft: float = W_CPA_SOFT
    cpa_warning_mult: float = CPA_WARNING_MULT
    w_goal_threat_stay: float = W_GOAL_THREAT_STAY
    w_collision: float = W_COLLISION
    w_hold_overspeed: float = W_HOLD_OVERSPEED
    w_cross_track: float = W_CROSS_TRACK
    cross_track_scale_m: float = CROSS_TRACK_SCALE_M
    hold_stationary_speed_mps: float = HOLD_STATIONARY_SPEED_MPS
    hold_at_stop_eps_mps: float = HOLD_AT_STOP_EPS_MPS
    w_smooth: float = W_SMOOTH
    threat_progress_thresh: float = THREAT_PROGRESS_THRESH
    reward_clip: float = REWARD_CLIP
    gated_hold: bool = True

    def to_weights_dict(self) -> Dict[str, Any]:
        return {
            "goal_progress": self.w_goal_progress,
            "goal_arrival": self.w_goal_arrival,
            "goal_arrival_early": self.w_goal_arrival_early,
            "hold_base": self.w_hold_base,
            "hold_speed": self.w_hold_speed,
            "hold_center": self.w_hold_center,
            "approach_slow": self.w_approach_slow,
            "approach_slow_range_m": self.approach_slow_range_m,
            "cpa": self.w_cpa,
            "cpa_soft": self.w_cpa_soft,
            "cpa_warning_mult": self.cpa_warning_mult,
            "goal_threat_stay": self.w_goal_threat_stay,
            "collision": self.w_collision,
            "hold_overspeed": self.w_hold_overspeed,
            "cross_track": self.w_cross_track,
            "cross_track_scale_m": self.cross_track_scale_m,
            "hold_stationary_speed_mps": self.hold_stationary_speed_mps,
            "hold_at_stop_eps_mps": self.hold_at_stop_eps_mps,
        }

    def sync_globals(self) -> None:
        """Mirror this config into module-level weight constants (legacy callers)."""
        global W_GOAL_PROGRESS, W_GOAL_ARRIVAL, W_GOAL_ARRIVAL_EARLY
        global W_HOLD_BASE, W_HOLD_SPEED, W_HOLD_CENTER, W_APPROACH_SLOW
        global APPROACH_SLOW_RANGE_M, W_CPA, W_CPA_SOFT, CPA_WARNING_MULT
        global W_GOAL_THREAT_STAY, W_COLLISION, W_HOLD_OVERSPEED, W_CROSS_TRACK
        global CROSS_TRACK_SCALE_M, HOLD_STATIONARY_SPEED_MPS, HOLD_AT_STOP_EPS_MPS
        global W_SMOOTH, THREAT_PROGRESS_THRESH, REWARD_CLIP
        W_GOAL_PROGRESS = self.w_goal_progress
        W_GOAL_ARRIVAL = self.w_goal_arrival
        W_GOAL_ARRIVAL_EARLY = self.w_goal_arrival_early
        W_HOLD_BASE = self.w_hold_base
        W_HOLD_SPEED = self.w_hold_speed
        W_HOLD_CENTER = self.w_hold_center
        W_APPROACH_SLOW = self.w_approach_slow
        APPROACH_SLOW_RANGE_M = self.approach_slow_range_m
        W_CPA = self.w_cpa
        W_CPA_SOFT = self.w_cpa_soft
        CPA_WARNING_MULT = self.cpa_warning_mult
        W_GOAL_THREAT_STAY = self.w_goal_threat_stay
        W_COLLISION = self.w_collision
        W_HOLD_OVERSPEED = self.w_hold_overspeed
        W_CROSS_TRACK = self.w_cross_track
        CROSS_TRACK_SCALE_M = self.cross_track_scale_m
        HOLD_STATIONARY_SPEED_MPS = self.hold_stationary_speed_mps
        HOLD_AT_STOP_EPS_MPS = self.hold_at_stop_eps_mps
        W_SMOOTH = self.w_smooth
        THREAT_PROGRESS_THRESH = self.threat_progress_thresh
        REWARD_CLIP = self.reward_clip


_ACTIVE_REWARD_CONFIG = RewardConfig()


def get_reward_config() -> RewardConfig:
    """Snapshot of current module-level weights (tests may patch globals directly)."""
    return RewardConfig(
        w_goal_progress=W_GOAL_PROGRESS,
        w_goal_arrival=W_GOAL_ARRIVAL,
        w_goal_arrival_early=W_GOAL_ARRIVAL_EARLY,
        w_hold_base=W_HOLD_BASE,
        w_hold_speed=W_HOLD_SPEED,
        w_hold_center=W_HOLD_CENTER,
        w_approach_slow=W_APPROACH_SLOW,
        approach_slow_range_m=APPROACH_SLOW_RANGE_M,
        w_cpa=W_CPA,
        w_cpa_soft=W_CPA_SOFT,
        cpa_warning_mult=CPA_WARNING_MULT,
        w_goal_threat_stay=W_GOAL_THREAT_STAY,
        w_collision=W_COLLISION,
        w_hold_overspeed=W_HOLD_OVERSPEED,
        w_cross_track=W_CROSS_TRACK,
        cross_track_scale_m=CROSS_TRACK_SCALE_M,
        hold_stationary_speed_mps=HOLD_STATIONARY_SPEED_MPS,
        hold_at_stop_eps_mps=HOLD_AT_STOP_EPS_MPS,
        w_smooth=W_SMOOTH,
        threat_progress_thresh=THREAT_PROGRESS_THRESH,
        reward_clip=REWARD_CLIP,
        gated_hold=_ACTIVE_REWARD_CONFIG.gated_hold,
    )


def set_reward_config(cfg: RewardConfig) -> None:
    global _ACTIVE_REWARD_CONFIG
    _ACTIVE_REWARD_CONFIG = cfg
    cfg.sync_globals()


def set_gated_hold_on_config(enabled: bool) -> None:
    global _ACTIVE_REWARD_CONFIG
    _ACTIVE_REWARD_CONFIG.gated_hold = bool(enabled)


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
    return get_reward_config().to_weights_dict()


def apply_reward_overrides(overrides: Dict[str, Any]) -> Dict[str, Any]:
    """Apply reward weight overrides and return the keys that were applied."""
    cfg = get_reward_config()
    applied: Dict[str, Any] = {}
    for key, raw in overrides.items():
        if key in _DEPRECATED_CONFIG_KEYS:
            if key in _LEGACY_CONFIG_ALIASES:
                key = _LEGACY_CONFIG_ALIASES[key]
            else:
                continue
        field = _REWARD_FIELD_MAP.get(key)
        if field is None:
            continue
        value = float(raw)
        setattr(cfg, field, value)
        applied[key] = value
    if applied:
        set_reward_config(cfg)
    return applied


def reward_config_from_overrides(
    overrides: Optional[Dict[str, Any]] = None,
    *,
    gated_hold: Optional[bool] = None,
) -> RewardConfig:
    """Build a RewardConfig without mutating module globals."""
    cfg = get_reward_config()
    if overrides:
        for key, raw in overrides.items():
            if key in _DEPRECATED_CONFIG_KEYS:
                if key in _LEGACY_CONFIG_ALIASES:
                    key = _LEGACY_CONFIG_ALIASES[key]
                else:
                    continue
            field = _REWARD_FIELD_MAP.get(key)
            if field is None:
                continue
            setattr(cfg, field, float(raw))
    if gated_hold is not None:
        cfg.gated_hold = bool(gated_hold)
    return cfg


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


def set_gated_hold_enabled(enabled: bool) -> None:
    set_gated_hold_on_config(enabled)


def gated_hold_enabled() -> bool:
    return get_reward_config().gated_hold


def is_hold_stationary(speed_mps: float, *, reward_config: Optional[RewardConfig] = None) -> bool:
    """True when speed is low enough to count toward the goal hold timer."""
    cfg = reward_config or get_reward_config()
    if not cfg.gated_hold:
        return True
    return speed_mps <= cfg.hold_stationary_speed_mps


def hold_overspeed_penalty(
    speed_mps: float, *, reward_config: Optional[RewardConfig] = None
) -> float:
    cfg = reward_config or get_reward_config()
    if not cfg.gated_hold or is_hold_stationary(speed_mps, reward_config=cfg):
        return 0.0
    excess = speed_mps - cfg.hold_stationary_speed_mps
    return -cfg.w_hold_overspeed * excess / max(P.V_MAX_MPS, 1e-6)


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
    *,
    reward_config: Optional[RewardConfig] = None,
) -> ContactStepMetrics:
    """Single pass: range, CPA, collision, and shaping penalties."""
    cfg = reward_config or get_reward_config()
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
            cpa_penalty += cfg.w_cpa * frac
            threat = max(threat, min(1.0, frac))
        elif cpa_m < safe * cfg.cpa_warning_mult:
            span = safe * (cfg.cpa_warning_mult - 1.0)
            warn_frac = (safe * cfg.cpa_warning_mult - cpa_m) / max(span, 1e-6)
            cpa_penalty += cfg.w_cpa_soft * warn_frac
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
    *,
    reward_config: Optional[RewardConfig] = None,
) -> float:
    """Penalty for lateral offset from the start→goal track (quadratic in meters/scale)."""
    cfg = reward_config or get_reward_config()
    if cfg.w_cross_track <= 0.0:
        return 0.0
    ct_m = P.cross_track_m(leg_start_x, leg_start_y, goal_x, goal_y, own_x, own_y)
    norm = ct_m / max(cfg.cross_track_scale_m, 1e-6)
    return -cfg.w_cross_track * norm * norm


def compute_step_reward(
    inp: StepRewardInput,
    *,
    include_breakdown: bool = True,
    reward_config: Optional[RewardConfig] = None,
) -> StepRewardOutput:
    """Compute clipped step reward and optional named breakdown components."""
    cfg = reward_config or get_reward_config()
    breakdown = _BreakdownSink(include_breakdown)
    reward = 0.0
    goal_hold_steps = inp.goal_hold_steps

    progress_scale = 1.0 + min(
        inp.curr_goal_range / max(inp.initial_goal_range, 1.0), 1.0
    )
    retreat_m = max(0.0, inp.curr_goal_range - inp.prev_goal_range)
    approach_m = max(0.0, inp.prev_goal_range - inp.curr_goal_range)

    if inp.in_goal_zone and (inp.cpa_unsafe or inp.threat >= cfg.threat_progress_thresh):
        threat_mult = 1.0 + max(inp.threat, 1.0 if inp.cpa_unsafe else 0.0)
        prog = cfg.w_goal_progress * retreat_m * progress_scale * threat_mult / 100.0
        reward += prog
        breakdown["progress"] = prog
    else:
        prog = cfg.w_goal_progress * (approach_m - retreat_m) * progress_scale / 100.0
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
            reward_config=cfg,
        )
        reward += cross
        breakdown["cross_track"] = cross

    if inp.in_goal_zone:
        hold_allowed = not inp.cpa_unsafe
        if hold_allowed:
            stationary = is_hold_stationary(inp.own.speed_mps, reward_config=cfg)
            if stationary:
                if goal_hold_steps == 0:
                    arrival = cfg.w_goal_arrival
                    if inp.max_steps > 0:
                        arrival += cfg.w_goal_arrival_early * max(
                            0.0, 1.0 - inp.step_count / inp.max_steps
                        )
                    reward += arrival
                    breakdown["goal_arrival"] = arrival
                goal_hold_steps += 1
                hold_speed = cfg.w_hold_base + cfg.w_hold_speed * _slow_bonus(inp.own.speed_mps)
                center = -cfg.w_hold_center * (
                    inp.curr_goal_range / P.GOAL_SUCCESS_RANGE_M
                )
                reward += hold_speed + center
                breakdown["hold_speed"] = hold_speed
                breakdown["hold_center"] = center
            else:
                overspeed = hold_overspeed_penalty(inp.own.speed_mps, reward_config=cfg)
                reward += overspeed
                breakdown["hold_overspeed"] = overspeed
        if inp.cpa_unsafe or inp.threat >= cfg.threat_progress_thresh:
            stay_threat = max(inp.threat, 1.0 if inp.cpa_unsafe else 0.0)
            stay = -cfg.w_goal_threat_stay * stay_threat
            reward += stay
            breakdown["goal_threat_stay"] = stay
    else:
        goal_hold_steps = 0
        slow_bonus = _slow_bonus(inp.own.speed_mps)
        if inp.curr_goal_range < cfg.approach_slow_range_m:
            prox = 1.0 - inp.curr_goal_range / cfg.approach_slow_range_m
            approach = cfg.w_approach_slow * prox * slow_bonus
            reward += approach
            breakdown["approach_slow"] = approach

    smooth = -cfg.w_smooth * float(np.linalg.norm(inp.action - inp.prev_action))
    reward += smooth
    breakdown["smooth"] = smooth

    reward -= inp.cpa_penalty
    breakdown["cpa"] = -inp.cpa_penalty

    if inp.collision:
        reward -= cfg.w_collision
        breakdown["collision"] = -cfg.w_collision

    reward = float(np.clip(reward, -cfg.reward_clip, cfg.reward_clip))
    if not math.isfinite(reward):
        reward = 0.0

    return StepRewardOutput(
        reward=reward,
        goal_hold_steps=goal_hold_steps,
        breakdown=breakdown.as_dict(),
    )
