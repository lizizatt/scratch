"""Safety scoring S(r_cpa, Θ_cpa) — paper §3, Eq 1–11."""

from __future__ import annotations

import math
from typing import Optional

from colregs.config import ColregsConfig, SafetyCombineMode
from colregs.geometry import Pose


def _lerp(x: float, x0: float, x1: float, y0: float, y1: float) -> float:
    if x1 <= x0:
        return y1
    t = (x - x0) / (x1 - x0)
    return y0 + t * (y1 - y0)


def safety_range_score(
    r_cpa_m: float,
    cfg: ColregsConfig,
    *,
    contact_radius_m: float,
    own_radius_m: float,
) -> float:
    """Piecewise-linear S_r (Fig 6)."""
    r_col = cfg.R_col_m(contact_radius_m, own_radius_m)
    r = max(0.0, r_cpa_m)
    if r >= cfg.R_pref_m:
        return cfg.S_max
    if r >= cfg.R_min_m:
        return _lerp(r, cfg.R_min_m, cfg.R_pref_m, cfg.S_Rmin, cfg.S_max)
    if r >= cfg.R_nm_m:
        return _lerp(r, cfg.R_nm_m, cfg.R_min_m, cfg.S_Rnm, cfg.S_Rmin)
    if r >= r_col:
        return _lerp(r, r_col, cfg.R_nm_m, cfg.S_Rcol, cfg.S_Rnm)
    return cfg.S_Rcol


def _pose_axis_score(angle_deg: float, cutoff_deg: float) -> float:
    cutoff_rad = math.radians(abs(cutoff_deg))
    angle_rad = math.radians(abs(angle_deg))
    if cutoff_rad < 1e-6:
        return 1.0
    if angle_rad >= cutoff_rad:
        return 1.0
    denom = 1.0 - math.cos(cutoff_rad)
    if abs(denom) < 1e-8:
        return 1.0
    return (1.0 - math.cos(angle_rad)) / denom


def safety_pose_score(pose: Pose, cfg: ColregsConfig) -> float:
    """S_Θ from Eq 4–6; returns fraction in [0, S_max_theta]."""
    beta_for_pose = pose.beta_deg
    if beta_for_pose > 180.0:
        beta_for_pose -= 360.0
    s_alpha = _pose_axis_score(pose.alpha_deg, cfg.alpha_c_deg)
    s_beta = _pose_axis_score(beta_for_pose, cfg.beta_c_deg)
    return cfg.S_max_theta * s_alpha * s_beta


def analyze_safety(
    r_cpa_m: float,
    pose: Optional[Pose],
    cfg: ColregsConfig,
    *,
    contact_radius_m: float,
    own_radius_m: float,
) -> float:
    """Combined safety score S in [0, 100] (paper Eq 1–11)."""
    s_r = safety_range_score(
        r_cpa_m,
        cfg,
        contact_radius_m=contact_radius_m,
        own_radius_m=own_radius_m,
    )
    if pose is None:
        return s_r

    s_theta = safety_pose_score(pose, cfg)
    mode = cfg.safety_combine_mode

    if mode == SafetyCombineMode.RANGE_ONLY:
        return s_r
    if mode == SafetyCombineMode.POSE_ONLY:
        return cfg.S_max * s_theta
    if mode == SafetyCombineMode.WEIGHTED_SUM:
        return cfg.safety_weight_range * s_r + cfg.safety_weight_pose * (cfg.S_max * s_theta)
    if mode == SafetyCombineMode.MULTIPLICATIVE:
        return (s_r / cfg.S_max) * (s_theta / max(cfg.S_max_theta, 1e-6)) * cfg.S_max
    if mode == SafetyCombineMode.REWARD_POSE:
        boosted = s_r * (1.0 + s_theta * cfg.pose_reward_max_frac)
        return min(boosted, cfg.S_max)
    if mode == SafetyCombineMode.EFFECTIVE_RANGE:
        r_eff = r_cpa_m + s_theta * cfg.pose_effective_range_m
        return safety_range_score(
            r_eff,
            cfg,
            contact_radius_m=contact_radius_m,
            own_radius_m=own_radius_m,
        )
    return s_r
