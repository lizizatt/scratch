"""Rule entry heuristics — Algorithm 3 (paper §4.1)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from colregs.config import ColregsConfig
from colregs.geometry import Pose


@dataclass(frozen=True)
class RuleAssignment:
    rule_id: str
    own_role: str  # give_way | stand_on | both_give_way | none


def _beta180(beta_deg: float) -> float:
    b = beta_deg
    if b > 180.0:
        b -= 360.0
    return b


def _alpha360(alpha_deg: float) -> float:
    a = alpha_deg
    if a < 0.0:
        a += 360.0
    return a


def assign_rule_from_pose(pose: Pose, cfg: ColregsConfig) -> RuleAssignment:
    """Determine applicable COLREGS rule set from initial pose Θ_0."""
    beta0 = pose.beta_deg
    alpha0 = pose.alpha_deg
    beta180 = _beta180(beta0)
    alpha360 = _alpha360(alpha0)

    if 112.5 < beta0 < 247.5 and abs(alpha0) < cfg.alpha_13_crit_deg:
        return RuleAssignment("R13/17", "stand_on")
    if (
        112.5 < alpha360 < 247.5
        and abs(beta180) < cfg.alpha_13_crit_deg
    ):
        return RuleAssignment("R13/16", "give_way")
    if abs(beta180) < cfg.alpha_14_crit_deg and abs(alpha0) < cfg.alpha_14_crit_deg:
        return RuleAssignment("R14", "both_give_way")
    if (
        0.0 < beta0 < 112.5
        and alpha0 > -112.5
        and alpha0 < cfg.alpha_15_crit_deg
    ):
        return RuleAssignment("R15/16", "give_way")
    if (
        0.0 < alpha360 < 112.5
        and (beta180 - 112.5) > -112.5
        and beta180 < cfg.alpha_15_crit_deg
    ):
        return RuleAssignment("R15/17", "stand_on")
    return RuleAssignment("R_cpa", "none")


def assign_rule_from_category(category: str) -> Optional[RuleAssignment]:
    """Fallback when only scenario category is known (eval traces)."""
    cat = category.lower()
    if "head_on" in cat:
        return RuleAssignment("R14", "both_give_way")
    if "crossing_stbd" in cat or "crossing_port" in cat or "close_quarters" in cat:
        return RuleAssignment("R15/16", "give_way")
    if "overtaking" in cat and "overtaken" not in cat:
        return RuleAssignment("R13/16", "give_way")
    if "overtaken" in cat:
        return RuleAssignment("R13/17", "stand_on")
    if "beam" in cat:
        return RuleAssignment("R_cpa", "none")
    if "multi" in cat:
        return RuleAssignment("R_cpa", "none")
    return None
