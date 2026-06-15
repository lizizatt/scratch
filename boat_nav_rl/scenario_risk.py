"""Scenario collision-risk helpers for audits and tests."""

from __future__ import annotations

import math
import os
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

import prepare as P
from prepare import ScenarioSeed


def min_hold_course_cpa(seed: ScenarioSeed) -> Tuple[float, float]:
    """Return (min_cpa_m, min_safe_cpa_m) for constant own heading/speed."""
    own = P.VesselState(
        x_m=seed.own_x_m,
        y_m=seed.own_y_m,
        heading_rad=math.radians(seed.own_heading_deg),
        speed_mps=seed.own_speed_mps,
    )
    contacts = P.scenario_to_contacts(seed)
    own_vx, own_vy = P.own_velocity(own, None)
    min_cpa = float("inf")
    min_safe = float("inf")
    for c in contacts:
        cvx, cvy = P.contact_velocity(c)
        cpa, _ = P.compute_cpa_tcpa(own.x_m, own.y_m, own_vx, own_vy, c.x_m, c.y_m, cvx, cvy)
        safe = P.cpa_safe_distance(c.radius_m)
        min_cpa = min(min_cpa, cpa)
        min_safe = min(min_safe, safe)
    return min_cpa, min_safe


def is_kinematically_risky(seed: ScenarioSeed) -> bool:
    cpa, safe = min_hold_course_cpa(seed)
    return cpa < safe


def naive_goal_seeking_action(env) -> np.ndarray:
    """Blind navigate: steer toward goal at cruise speed (no avoidance)."""
    brg, _ = P.bearing_range(env.own.x_m, env.own.y_m, env.goal_x, env.goal_y)
    dh = P.wrap_angle(brg - env.own.heading_rad) / math.pi
    cruise = P.V_MAX_MPS * 0.65
    dv = (cruise - env.own.speed_mps) / max(P.V_MAX_MPS - P.V_MIN_MPS, 1e-6)
    return np.array(
        [float(np.clip(dh, -1.0, 1.0)), float(np.clip(dv * 2.0, -1.0, 1.0))],
        dtype=np.float32,
    )


def rollout_collides(
    seed: ScenarioSeed,
    policy_fn: Callable = naive_goal_seeking_action,
    *,
    env=None,
) -> bool:
    from train import BoatNavEnv

    owned = env is None
    if owned:
        env = BoatNavEnv(
            mode="avoid",
            training_randomize=False,
            dynamics_jitter=False,
            current_enabled=False,
            contact_obs_noise_m=0.0,
            contact_obs_noise_bearing_rad=0.0,
        )
    env.reset(seed=seed.seed, options={"scenario": seed})
    done = False
    while not done:
        _, _, term, trunc, info = env.step(policy_fn(env))
        done = term or trunc
    return bool(info["collision"])


def _parallel_rollout_result(seed: ScenarioSeed) -> Tuple[str, int, int]:
    """Worker entry point: (category, collision, success)."""
    from train import BoatNavEnv

    env = BoatNavEnv(
        mode="avoid",
        training_randomize=False,
        dynamics_jitter=False,
        current_enabled=False,
        contact_obs_noise_m=0.0,
        contact_obs_noise_bearing_rad=0.0,
    )
    env.reset(seed=seed.seed, options={"scenario": seed})
    done = False
    while not done:
        _, _, term, trunc, info = env.step(naive_goal_seeking_action(env))
        done = term or trunc
    return seed.category, int(info["collision"]), int(info["success"])


def default_audit_workers() -> int:
    return max(1, int(os.environ.get("AUDIT_WORKERS", str(os.cpu_count() or 4))))


def audit_kinematic_risk(seeds: Sequence[ScenarioSeed]) -> Dict[str, object]:
    by_cat: Dict[str, Dict[str, int]] = defaultdict(lambda: {"n": 0, "risky": 0})
    risky = 0
    for s in seeds:
        by_cat[s.category]["n"] += 1
        if is_kinematically_risky(s):
            risky += 1
            by_cat[s.category]["risky"] += 1
    n = len(seeds)
    return {
        "n": n,
        "risky": risky,
        "risk_rate": risky / n if n else 0.0,
        "by_category": dict(by_cat),
    }


def audit_naive_collisions(
    seeds: Sequence[ScenarioSeed],
    policy_fn: Callable = naive_goal_seeking_action,
    *,
    env=None,
    workers: Optional[int] = None,
) -> Dict[str, object]:
    if policy_fn is not naive_goal_seeking_action:
        workers = 1
    if workers is None:
        workers = default_audit_workers()
    workers = max(1, int(workers))

    by_cat: Dict[str, Dict[str, int]] = defaultdict(lambda: {"n": 0, "coll": 0})
    coll = 0

    if workers <= 1 or len(seeds) < 8 or env is not None:
        for s in seeds:
            hit = rollout_collides(s, policy_fn, env=env)
            by_cat[s.category]["n"] += 1
            by_cat[s.category]["coll"] += int(hit)
            coll += int(hit)
    else:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            for category, hit, _succ in pool.map(_parallel_rollout_result, seeds, chunksize=8):
                by_cat[category]["n"] += 1
                by_cat[category]["coll"] += hit
                coll += hit

    n = len(seeds)
    return {
        "n": n,
        "collisions": coll,
        "collision_rate": coll / n if n else 0.0,
        "by_category": dict(by_cat),
    }


def seeds_for_category(seeds: Iterable[ScenarioSeed], category_suffix: str) -> List[ScenarioSeed]:
    return [s for s in seeds if s.category.endswith(category_suffix) or category_suffix in s.category]
