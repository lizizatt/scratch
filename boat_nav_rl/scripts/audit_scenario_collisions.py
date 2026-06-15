#!/usr/bin/env python3
"""Audit collision rates under naive baselines on avoid scenarios."""

from __future__ import annotations

import argparse
import math
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P
from scenario_risk import audit_naive_collisions, default_audit_workers
from scenarios import generate_all_scenarios, split_train_eval
from train import BoatNavEnv, filter_seeds_for_mode


def goal_seeking_action(env: BoatNavEnv) -> np.ndarray:
    brg, _ = P.bearing_range(env.own.x_m, env.own.y_m, env.goal_x, env.goal_y)
    dh = P.wrap_angle(brg - env.own.heading_rad) / math.pi
    cruise = P.V_MAX_MPS * 0.65
    dv = (cruise - env.own.speed_mps) / max(P.V_MAX_MPS - P.V_MIN_MPS, 1e-6)
    return np.array([float(np.clip(dh, -1, 1)), float(np.clip(dv * 2, -1, 1))], dtype=np.float32)


def hold_course_action(_env: BoatNavEnv) -> np.ndarray:
    return np.array([0.0, 0.0], dtype=np.float32)


def audit_sequential(seeds, name: str, policy_fn) -> tuple[float, float]:
    env = BoatNavEnv(
        mode="avoid",
        training_randomize=False,
        dynamics_jitter=False,
        current_enabled=False,
        contact_obs_noise_m=0.0,
        contact_obs_noise_bearing_rad=0.0,
    )
    by_cat: dict = defaultdict(lambda: {"n": 0, "coll": 0, "succ": 0})
    coll = succ = 0
    for s in seeds:
        env.reset(seed=s.seed, options={"scenario": s})
        done = False
        while not done:
            _, _, term, trunc, info = env.step(policy_fn(env))
            done = term or trunc
        by_cat[s.category]["n"] += 1
        by_cat[s.category]["coll"] += int(info["collision"])
        by_cat[s.category]["succ"] += int(info["success"])
        coll += int(info["collision"])
        succ += int(info["success"])
    _print_audit(name, len(seeds), coll, succ, by_cat)
    return coll / len(seeds), succ / len(seeds)


def audit_parallel(seeds, name: str, workers: int) -> tuple[float, float]:
    t0 = time.perf_counter()
    stats = audit_naive_collisions(seeds, workers=workers)
    elapsed = time.perf_counter() - t0
    by_cat = stats["by_category"]
    coll = stats["collisions"]
    n = stats["n"]
    print(f"=== {name} ({n} scenarios, {workers} workers, {elapsed:.1f}s) ===")
    print(f"  collision_rate={stats['collision_rate']:.1%}")
    for cat in sorted(by_cat):
        c = by_cat[cat]
        print(f"    {cat}: n={c['n']} coll={c['coll']/c['n']:.0%}")
    return stats["collision_rate"], 0.0


def _print_audit(name, n, coll, succ, by_cat) -> None:
    print(f"=== {name} ({n} scenarios) ===")
    print(f"  collision_rate={coll / n:.1%}  success_rate={succ / n:.1%}")
    for cat in sorted(by_cat):
        c = by_cat[cat]
        print(f"    {cat}: n={c['n']} coll={c['coll']/c['n']:.0%} succ={c['succ']/c['n']:.0%}")


def min_cpa_scenario(seed: P.ScenarioSeed) -> tuple[float, float]:
    own = P.VesselState(
        x_m=seed.own_x_m,
        y_m=seed.own_y_m,
        heading_rad=math.radians(seed.own_heading_deg),
        speed_mps=seed.own_speed_mps,
    )
    contacts = P.scenario_to_contacts(seed)
    own_vx, own_vy = P.own_velocity(own, None)
    best_cpa = float("inf")
    best_safe = float("inf")
    for c in contacts:
        cvx, cvy = P.contact_velocity(c)
        cpa, _ = P.compute_cpa_tcpa(own.x_m, own.y_m, own_vx, own_vy, c.x_m, c.y_m, cvx, cvy)
        safe = P.cpa_safe_distance(c.radius_m)
        best_cpa = min(best_cpa, cpa)
        best_safe = min(best_safe, safe)
    return best_cpa, best_safe


def audit_geometric_risk(seeds, name: str) -> None:
    by_cat: dict = defaultdict(lambda: {"n": 0, "lt_safe": 0})
    lt_safe = 0
    for s in seeds:
        cpa, safe = min_cpa_scenario(s)
        by_cat[s.category]["n"] += 1
        if cpa < safe:
            lt_safe += 1
            by_cat[s.category]["lt_safe"] += 1
    n = len(seeds)
    print(f"=== {name} geometric CPA < safe distance ===")
    print(f"  risky={lt_safe}/{n} ({lt_safe / n:.1%}) under hold-course kinematics")
    for cat in sorted(by_cat):
        c = by_cat[cat]
        print(f"    {cat}: {c['lt_safe']}/{c['n']} ({c['lt_safe'] / c['n']:.0%})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit scenario collision rates")
    parser.add_argument(
        "--workers",
        type=int,
        default=default_audit_workers(),
        help="Parallel workers for sim rollouts (default: AUDIT_WORKERS or CPU count)",
    )
    args = parser.parse_args()

    all_seeds = generate_all_scenarios()
    avoid = filter_seeds_for_mode(all_seeds, "avoid")
    train, ev = split_train_eval(all_seeds)
    avoid_train = filter_seeds_for_mode(train, "avoid")
    avoid_eval = filter_seeds_for_mode(ev, "avoid")

    audit_geometric_risk(avoid, "all avoid")
    print()

    print("Policy: goal-seeking (blind navigate)\n")
    if args.workers > 1:
        audit_parallel(avoid, "all avoid", args.workers)
        audit_parallel(avoid_train, "avoid train", args.workers)
        audit_parallel(avoid_eval, "avoid eval", args.workers)
    else:
        audit_sequential(avoid, "all avoid", goal_seeking_action)
        audit_sequential(avoid_train, "avoid train", goal_seeking_action)
        audit_sequential(avoid_eval, "avoid eval", goal_seeking_action)

    print("\nPolicy: hold course\n")
    audit_sequential(avoid, "all avoid", hold_course_action)


if __name__ == "__main__":
    main()
