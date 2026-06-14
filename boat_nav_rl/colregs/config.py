"""Configurable COLREGS evaluation thresholds (paper §6.2)."""

from __future__ import annotations

import json
from dataclasses import dataclass, fields
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Optional

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent / "default_config.json"


class SafetyCombineMode(str, Enum):
    RANGE_ONLY = "range_only"
    POSE_ONLY = "pose_only"
    WEIGHTED_SUM = "weighted_sum"
    MULTIPLICATIVE = "multiplicative"
    REWARD_POSE = "reward_pose"
    EFFECTIVE_RANGE = "effective_range"


@dataclass
class ColregsConfig:
    R_detect_m: float = 900.0
    R_pref_m: float = 200.0
    R_min_m: float = 80.0
    R_nm_m: float = 40.0
    alpha_13_crit_deg: float = 45.0
    alpha_14_crit_deg: float = 13.0
    alpha_15_crit_deg: float = 10.0
    alpha_c_deg: float = 80.0
    beta_c_deg: float = 80.0
    S_Rmin: float = 80.0
    S_Rnm: float = 20.0
    S_Rcol: float = 0.0
    S_max: float = 100.0
    S_max_theta: float = 1.0
    safety_combine_mode: SafetyCombineMode = SafetyCombineMode.MULTIPLICATIVE
    safety_weight_range: float = 0.5
    safety_weight_pose: float = 0.5
    pose_reward_max_frac: float = 0.2
    pose_effective_range_m: float = 50.0
    R_threshold_report: float = 70.0
    S_threshold_report: float = 70.0

    def R_col_m(self, contact_radius_m: float, own_radius_m: float) -> float:
        return own_radius_m + contact_radius_m

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for f in fields(self):
            val = getattr(self, f.name)
            if isinstance(val, Enum):
                val = val.value
            out[f.name] = val
        return out


def load_config(path: Optional[Path] = None) -> ColregsConfig:
    cfg_path = path or DEFAULT_CONFIG_PATH
    raw: Dict[str, Any] = {}
    if cfg_path.exists():
        raw = json.loads(cfg_path.read_text(encoding="utf-8"))
    kwargs: Dict[str, Any] = {}
    for f in fields(ColregsConfig):
        if f.name not in raw:
            continue
        val = raw[f.name]
        if f.name == "safety_combine_mode":
            val = SafetyCombineMode(str(val))
        kwargs[f.name] = val
    return ColregsConfig(**kwargs)
