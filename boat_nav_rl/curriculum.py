"""Staged training curriculum — phases, seed filters, exit gates, state."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import prepare as P

ROOT = Path(__file__).resolve().parent
CURRICULUM_DIR = ROOT / "runs" / "curriculum"
STATE_PATH = CURRICULUM_DIR / "state.json"
EXPERIMENTS_DIR = ROOT / "experiments"


@dataclass(frozen=True)
class PhaseSpec:
    phase_id: int
    name: str
    mode: str
    budget_sec: int
    reward_config: str
    scenario_prefixes: Tuple[str, ...] = ()
    gated_hold: bool = False
    exit: Dict[str, Any] = field(default_factory=dict)
    notes_suffix: str = ""


PHASES: Tuple[PhaseSpec, ...] = (
    PhaseSpec(
        phase_id=0,
        name="navigate_clear",
        mode="navigate",
        budget_sec=2400,
        reward_config="phase0_nav.json",
        gated_hold=True,
        exit={
            "success_rate_min": 0.75,
            "mean_speed_mps_min": 4.0,
            "mean_speed_mps_max": 6.5,
            "mean_goal_zone_speed_mps_max": 0.35,
            "pct_goal_zone_at_min_speed_min": 0.50,
        },
        notes_suffix="curriculum phase0 navigate hold + exercise waypoints",
    ),
    PhaseSpec(
        phase_id=1,
        name="avoid_reach_zone",
        mode="avoid",
        budget_sec=1200,
        reward_config="phase1_avoid_reach.json",
        scenario_prefixes=(
            "traffic/crossing_stbd",
            "traffic/crossing_port",
            "traffic/beam",
            "traffic/stationary",
            "traffic/overtaking",
        ),
        gated_hold=False,
        exit={
            "zone_entry_rate_min": 0.5,
            "collision_rate_max": 0.10,
            "mean_speed_mps_min": 5.0,
            "success_rate_min": 0.15,
        },
        notes_suffix="curriculum phase1 avoid reach",
    ),
    PhaseSpec(
        phase_id=2,
        name="approach_decel",
        mode="avoid",
        budget_sec=1200,
        reward_config="phase2_approach.json",
        scenario_prefixes=(
            "traffic/crossing_stbd",
            "traffic/crossing_port",
            "traffic/beam",
            "traffic/stationary",
            "traffic/overtaking",
            "traffic/close_quarters",
            "traffic/multi_2",
        ),
        gated_hold=False,
        exit={
            "zone_entry_rate_min": 0.45,
            "mean_approach_speed_mps_max": 3.0,
            "collision_rate_max": 0.12,
        },
        notes_suffix="curriculum phase2 approach decel",
    ),
    PhaseSpec(
        phase_id=3,
        name="literal_stop_hold",
        mode="avoid",
        budget_sec=2400,
        reward_config="phase3_literal_stop.json",
        scenario_prefixes=(),  # full avoid eval
        gated_hold=True,
        exit={
            "zone_entry_rate_min": 0.4,
            "pct_goal_zone_at_min_speed_min": 0.5,
            "mean_goal_zone_speed_mps_max": 0.5,
            "success_rate_min": 0.10,
        },
        notes_suffix="curriculum phase3 literal stop",
    ),
    PhaseSpec(
        phase_id=4,
        name="full_avoid_polish",
        mode="avoid",
        budget_sec=3600,
        reward_config="phase3_literal_stop.json",
        scenario_prefixes=(),
        gated_hold=True,
        exit={
            "success_rate_min": 0.15,
            "collision_rate_max": 0.05,
            "mean_goal_zone_speed_mps_max": 0.25,
            "zone_entry_rate_min": 0.5,
        },
        notes_suffix="curriculum phase4 polish",
    ),
)


def _merged_preset_reward_weights(reward_config_file: str) -> Dict[str, Any]:
    """Baseline reward weights with experiment JSON overrides applied."""
    from rewards import RewardConfig

    weights = RewardConfig().to_weights_dict()
    cfg_path = EXPERIMENTS_DIR / reward_config_file
    if cfg_path.exists():
        loaded = json.loads(cfg_path.read_text(encoding="utf-8"))
        weights.update(loaded.get("reward_weights", {}))
    return weights


def _phase_preset_dict(phase: PhaseSpec, *, preset_id: str, label: str, description: str) -> Dict[str, Any]:
    return {
        "id": preset_id,
        "label": label,
        "description": description,
        "mode": phase.mode,
        "budget_sec": phase.budget_sec,
        "goal_hold_sec": P.DEFAULT_GOAL_HOLD_SEC,
        "gated_hold": phase.gated_hold,
        "current_enabled": False,
        "dynamics_jitter": False,
        "robust_eval_enabled": False,
        "montage_enabled": False,
        "reward_weights": _merged_preset_reward_weights(phase.reward_config),
        "scenario_category_prefixes": list(phase.scenario_prefixes) or None,
        "curriculum_phase": phase.phase_id,
        "notes": phase.notes_suffix,
    }


def list_ui_training_presets() -> List[Dict[str, Any]]:
    """Presets for the train UI — quick start plus curriculum phases 0–1."""
    p0 = get_phase(0)
    p1 = get_phase(1)
    return [
        {
            "id": "quick_start",
            "label": "Quick start (recommended)",
            "description": "Navigate in clear water — 30 min, 15 s hold, phase-0 reward shaping.",
            "mode": "navigate",
            "budget_sec": 1800,
            "goal_hold_sec": P.DEFAULT_GOAL_HOLD_SEC_UI,
            "gated_hold": True,
            "current_enabled": False,
            "dynamics_jitter": False,
            "robust_eval_enabled": False,
            "montage_enabled": False,
            "reward_weights": _merged_preset_reward_weights(p0.reward_config),
            "scenario_category_prefixes": None,
            "curriculum_phase": None,
            "snapshot_interval_min": 30,
            "notes": "quick start navigate",
        },
        _phase_preset_dict(
            p0,
            preset_id="phase0",
            label="Curriculum phase 0 — Navigate",
            description="Full phase 0: 40 min, 30 s gated hold, all navigate scenarios.",
        ),
        _phase_preset_dict(
            p1,
            preset_id="phase1",
            label="Curriculum phase 1 — Avoid reach",
            description="Reach the goal zone in traffic — 20 min, gated hold off, subset of avoid scenarios.",
        ),
    ]


def get_phase(phase_id: int) -> PhaseSpec:
    for p in PHASES:
        if p.phase_id == phase_id:
            return p
    raise KeyError(f"Unknown curriculum phase {phase_id}")


def filter_seeds_by_prefix(
    seeds: Sequence[P.ScenarioSeed],
    prefixes: Sequence[str],
) -> List[P.ScenarioSeed]:
    if not prefixes:
        return list(seeds)
    out: List[P.ScenarioSeed] = []
    for s in seeds:
        cat = s.category
        if any(cat == p or cat.startswith(p + "/") or cat.startswith(p) for p in prefixes):
            out.append(s)
    return out


def default_state() -> Dict[str, Any]:
    return {
        "current_phase": 0,
        "checkpoints": {str(p.phase_id): None for p in PHASES},
        "history": [],
    }


def load_state() -> Dict[str, Any]:
    if not STATE_PATH.exists():
        return default_state()
    data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    base = default_state()
    base.update(data)
    base.setdefault("checkpoints", default_state()["checkpoints"])
    for p in PHASES:
        base["checkpoints"].setdefault(str(p.phase_id), None)
    return base


def save_state(state: Dict[str, Any]) -> None:
    CURRICULUM_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def resume_for_phase(state: Dict[str, Any], phase_id: int) -> Optional[str]:
    if phase_id <= 0:
        return None
    prev = str(phase_id - 1)
    ckpt = state.get("checkpoints", {}).get(prev)
    return ckpt if ckpt else None


def build_run_config(phase: PhaseSpec) -> Dict[str, Any]:
    cfg_path = EXPERIMENTS_DIR / phase.reward_config
    merged: Dict[str, Any] = {}
    if cfg_path.exists():
        loaded = json.loads(cfg_path.read_text(encoding="utf-8"))
        merged.update(loaded)
    merged["curriculum_phase"] = phase.phase_id
    merged["curriculum_name"] = phase.name
    merged["gated_hold"] = phase.gated_hold
    if phase.scenario_prefixes:
        merged["scenario_category_prefixes"] = list(phase.scenario_prefixes)
    merged["curriculum_eval_interval_sec"] = 120
    merged["curriculum_eval_max_scenarios"] = 0 if phase.phase_id == 0 else 48
    merged["curriculum_early_stop"] = True
    return merged


def _zone_entry_rate(summary: Dict[str, Any]) -> Optional[float]:
    eval_eps = summary.get("eval_episodes") or 0
    with_zone = summary.get("episodes_with_goal_zone_steps") or 0
    if not eval_eps:
        return None
    return with_zone / eval_eps


def check_exit(phase: PhaseSpec, summary: Dict[str, Any]) -> Tuple[bool, List[str]]:
    reasons: List[str] = []
    ok = True
    ex = phase.exit

    def _check(key: str, val: Optional[float], op: str, limit: float, label: str) -> None:
        nonlocal ok
        if val is None:
            ok = False
            reasons.append(f"FAIL missing {label}")
            return
        passed = val >= limit if op == "min" else val <= limit
        mark = "PASS" if passed else "FAIL"
        reasons.append(f"{mark} {label}: {val} ({op} {limit})")
        if not passed:
            ok = False

    if "success_rate_min" in ex:
        _check("sr", summary.get("success_rate"), "min", ex["success_rate_min"], "success_rate")
    if "collision_rate_max" in ex:
        _check("cr", summary.get("collision_rate"), "max", ex["collision_rate_max"], "collision_rate")
    if "mean_speed_mps_min" in ex:
        _check("spd", summary.get("mean_speed_mps"), "min", ex["mean_speed_mps_min"], "mean_speed_mps")
    if "mean_speed_mps_max" in ex:
        _check("spd", summary.get("mean_speed_mps"), "max", ex["mean_speed_mps_max"], "mean_speed_mps")
    if "zone_entry_rate_min" in ex:
        _check("zer", _zone_entry_rate(summary), "min", ex["zone_entry_rate_min"], "zone_entry_rate")
    if "mean_approach_speed_mps_max" in ex:
        _check(
            "ap",
            summary.get("mean_approach_speed_mps"),
            "max",
            ex["mean_approach_speed_mps_max"],
            "mean_approach_speed_mps",
        )
    if "mean_goal_zone_speed_mps_max" in ex:
        val = summary.get("mean_goal_zone_speed_mps")
        if val is None:
            ok = False
            reasons.append("FAIL missing mean_goal_zone_speed_mps")
        else:
            passed = val <= ex["mean_goal_zone_speed_mps_max"]
            mark = "PASS" if passed else "FAIL"
            reasons.append(f"{mark} mean_goal_zone_speed_mps: {val} (max {ex['mean_goal_zone_speed_mps_max']})")
            if not passed:
                ok = False
    if "pct_goal_zone_at_min_speed_min" in ex:
        val = summary.get("pct_goal_zone_at_min_speed")
        if val is None:
            ok = False
            reasons.append("FAIL missing pct_goal_zone_at_min_speed")
        else:
            passed = val >= ex["pct_goal_zone_at_min_speed_min"]
            mark = "PASS" if passed else "FAIL"
            reasons.append(
                f"{mark} pct_goal_zone_at_min_speed: {val} (min {ex['pct_goal_zone_at_min_speed_min']})"
            )
            if not passed:
                ok = False

    # Anti-crawl guard for avoid phases
    if phase.mode == "avoid" and phase.phase_id >= 1:
        zer = _zone_entry_rate(summary)
        spd = summary.get("mean_speed_mps")
        if zer is not None and zer < 0.15 and spd is not None and spd < 2.5:
            ok = False
            reasons.append("FAIL crawl lock-in (zone_entry < 0.15 and mean_speed < 2.5)")

    return ok, reasons


def metrics_to_summary(metrics: Dict[str, Any]) -> Dict[str, Any]:
    eval_eps = int(metrics.get("eval_episodes") or 0)
    zone = metrics.get("episodes_with_goal_zone_steps")
    if zone is None and eval_eps:
        zone = 0
    return {
        "success_rate": metrics.get("success_rate"),
        "collision_rate": metrics.get("collision_rate"),
        "mean_speed_mps": metrics.get("mean_speed_mps"),
        "mean_energy_score": metrics.get("mean_energy_score"),
        "avg_final_goal_range_m": metrics.get("avg_final_goal_range_m"),
        "episodes_with_goal_zone_steps": zone,
        "eval_episodes": eval_eps,
        "zone_entry_rate": (float(zone) / eval_eps) if eval_eps and zone is not None else None,
        "mean_goal_zone_speed_mps": metrics.get("mean_goal_zone_speed_mps"),
        "pct_goal_zone_at_min_speed": metrics.get("pct_goal_zone_at_min_speed"),
        "reward_breakdown_mean": metrics.get("reward_breakdown_mean"),
        "score": metrics.get("avoid_score") if metrics.get("mode") == "avoid" else metrics.get("nav_score"),
    }


def summary_meets_speed_bounds(phase: PhaseSpec, summary: Dict[str, Any]) -> bool:
    spd = summary.get("mean_speed_mps")
    if spd is None:
        return True
    ex = phase.exit
    if "mean_speed_mps_min" in ex and spd < ex["mean_speed_mps_min"]:
        return False
    if "mean_speed_mps_max" in ex and spd > ex["mean_speed_mps_max"]:
        return False
    return True


def is_summary_better(
    phase: PhaseSpec,
    candidate: Dict[str, Any],
    best: Optional[Dict[str, Any]],
) -> bool:
    if not summary_meets_speed_bounds(phase, candidate):
        return False
    if best is None:
        return (candidate.get("success_rate") or 0) > 0 or (candidate.get("zone_entry_rate") or 0) > 0
    c_pass, _ = check_exit(phase, candidate)
    b_pass, _ = check_exit(phase, best)
    if c_pass and not b_pass:
        return True
    if b_pass and not c_pass:
        return False
    c_sr = float(candidate.get("success_rate") or 0)
    b_sr = float(best.get("success_rate") or 0)
    if abs(c_sr - b_sr) > 1e-6:
        return c_sr > b_sr
    c_z = float(candidate.get("zone_entry_rate") or 0)
    b_z = float(best.get("zone_entry_rate") or 0)
    if abs(c_z - b_z) > 1e-6:
        return c_z > b_z
    c_gz = float(candidate.get("mean_goal_zone_speed_mps") or 1e9)
    b_gz = float(best.get("mean_goal_zone_speed_mps") or 1e9)
    if abs(c_gz - b_gz) > 1e-3:
        return c_gz < b_gz
    c_stop = float(candidate.get("pct_goal_zone_at_min_speed") or 0)
    b_stop = float(best.get("pct_goal_zone_at_min_speed") or 0)
    if abs(c_stop - b_stop) > 1e-4:
        return c_stop > b_stop
    c_rng = float(candidate.get("avg_final_goal_range_m") or 1e9)
    b_rng = float(best.get("avg_final_goal_range_m") or 1e9)
    return c_rng < b_rng


def record_run(state: Dict[str, Any], phase: PhaseSpec, run_id: str, summary: Dict[str, Any], passed: bool) -> None:
    entry = {
        "phase": phase.phase_id,
        "phase_name": phase.name,
        "run_id": run_id,
        "passed": passed,
        "summary": {
            k: summary.get(k)
            for k in (
                "success_rate",
                "collision_rate",
                "mean_speed_mps",
                "mean_goal_zone_speed_mps",
                "pct_goal_zone_at_min_speed",
                "episodes_with_goal_zone_steps",
                "eval_episodes",
                "score",
            )
        },
    }
    state.setdefault("history", []).append(entry)
    if passed:
        state["checkpoints"][str(phase.phase_id)] = run_id
        state["current_phase"] = min(phase.phase_id + 1, PHASES[-1].phase_id)
    save_state(state)
