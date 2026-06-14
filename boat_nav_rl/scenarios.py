"""
Programmatic scenario library generator.

Mission shells (clear navigation) + traffic templates (unified mode).
Called by prepare.py — not edited during training experiments.
"""

from __future__ import annotations

import math
from collections import defaultdict
from itertools import product
from typing import Dict, List, Tuple

import numpy as np

from prepare import ScenarioSeed
from scenario_templates import MissionShell, compose_scenario, default_traffic_shell, generate_encounter_grid


def _goal_from_polar(dist_m: float, bearing_deg: float) -> Tuple[float, float]:
    brg = math.radians(bearing_deg)
    return dist_m * math.sin(brg), dist_m * math.cos(brg)


def _clear_shell(
    name: str,
    seed: int,
    category: str,
    description: str,
    own_heading_deg: float,
    own_speed_mps: float,
    own_x_m: float,
    own_y_m: float,
    goal_x_m: float,
    goal_y_m: float,
) -> ScenarioSeed:
    shell = MissionShell(
        name=name,
        seed=seed,
        category=category,
        description=description,
        own_heading_deg=own_heading_deg,
        own_speed_mps=own_speed_mps,
        own_x_m=own_x_m,
        own_y_m=own_y_m,
        goal_x_m=goal_x_m,
        goal_y_m=goal_y_m,
    )
    return compose_scenario(shell, [], category, description)


def generate_mission_shells() -> List[ScenarioSeed]:
    """Navigate-only scenarios (no contacts)."""
    scenarios: List[ScenarioSeed] = []
    seed_counter = 1000

    for dist in (500, 700, 900, 1100, 1300):
        scenarios.append(
            _clear_shell(
                f"nav_ahead_{dist}m",
                seed_counter,
                "ahead",
                f"Goal {dist} m ahead, own ship northbound",
                0,
                4.0,
                0,
                0,
                0,
                float(dist),
            )
        )
        seed_counter += 1

    for bearing in (-90, -60, -30, 30, 60, 90, 135):
        dist = 900.0
        gx, gy = _goal_from_polar(dist, bearing)
        scenarios.append(
            _clear_shell(
                f"nav_bearing_{bearing:+d}",
                seed_counter,
                "bearing",
                f"Goal at {bearing}° / {dist:.0f} m",
                0,
                4.0,
                0,
                0,
                gx,
                gy,
            )
        )
        seed_counter += 1

    for ox, oy, label in ((-250, 150, "sw"), (200, -180, "ne"), (-400, -300, "nw")):
        scenarios.append(
            _clear_shell(
                f"nav_start_{label}",
                seed_counter,
                "offset_start",
                f"Start ({ox},{oy}), goal north",
                15 if ox < 0 else -10,
                3.5,
                float(ox),
                float(oy),
                float(ox) * 0.2,
                float(oy) + 900,
            )
        )
        seed_counter += 1

    for hdg in (-45, -20, 20, 45, 90, 135):
        scenarios.append(
            _clear_shell(
                f"nav_hdg_{hdg:+d}",
                seed_counter,
                "heading_mismatch",
                f"Initial heading {hdg}°, goal ahead-right",
                float(hdg),
                4.0,
                0,
                0,
                400,
                900,
            )
        )
        seed_counter += 1

    for dist in (500, 800, 1100):
        scenarios.append(
            _clear_shell(
                f"nav_astern_{dist}m",
                seed_counter,
                "astern",
                f"Goal {dist} m astern",
                0,
                4.0,
                0,
                0,
                0,
                -float(dist),
            )
        )
        seed_counter += 1

    for dist, spd in product((600, 900, 1200), (2.5, 4.0, 5.5, 7.0)):
        scenarios.append(
            _clear_shell(
                f"nav_ahead_spd{spd:.1f}_{dist}m",
                seed_counter,
                "speed",
                f"Goal {dist} m ahead at {spd} m/s",
                0,
                spd,
                0,
                0,
                0,
                float(dist),
            )
        )
        seed_counter += 1

    for dist in (700, 1000, 1300):
        for bearing in (-120, -45, 0, 45, 120, 150):
            gx, gy = _goal_from_polar(dist, bearing)
            scenarios.append(
                _clear_shell(
                    f"nav_brg{bearing:+d}_d{dist}",
                    seed_counter,
                    "bearing_dist",
                    f"Goal bearing {bearing}° at {dist} m",
                    0,
                    4.0,
                    0,
                    0,
                    gx,
                    gy,
                )
            )
            seed_counter += 1

    for ox in (-500, -250, 0, 250, 500):
        for oy in (-300, 0, 300):
            if ox == 0 and oy == 0:
                continue
            gx = ox * 0.15
            gy = oy + 950
            scenarios.append(
                _clear_shell(
                    f"nav_grid_{ox:+d}_{oy:+d}",
                    seed_counter,
                    "offset_grid",
                    f"Start ({ox},{oy}) → goal ({gx:.0f},{gy:.0f})",
                    float(np.clip(ox * 0.03, -30, 30)),
                    3.8,
                    float(ox),
                    float(oy),
                    gx,
                    gy,
                )
            )
            seed_counter += 1

    for dist, side in product((800, 1100), ("port", "stbd")):
        gx = -dist if side == "port" else dist
        scenarios.append(
            _clear_shell(
                f"nav_cross_{side}_{dist}m",
                seed_counter,
                "cross_track",
                f"Goal {side} abeam at {dist} m",
                0,
                4.5,
                0,
                0,
                float(gx),
                500,
            )
        )
        seed_counter += 1

    return scenarios


def generate_traffic_scenarios() -> List[ScenarioSeed]:
    base = default_traffic_shell(seed=2000)
    scenarios, _ = generate_encounter_grid(base, seed_counter=2000)
    return scenarios


def generate_all_scenarios() -> List[ScenarioSeed]:
    return generate_mission_shells() + generate_traffic_scenarios()


def scenario_summary(scenarios: List[ScenarioSeed]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for s in scenarios:
        counts[s.category] = counts.get(s.category, 0) + 1
    return counts


def split_train_eval(
    scenarios: List[ScenarioSeed],
    train_frac: float = 0.65,
    rng_seed: int = 42,
) -> Tuple[List[ScenarioSeed], List[ScenarioSeed]]:
    """Stratified split by category — at least one eval scenario per category."""
    rng = np.random.default_rng(rng_seed)
    buckets: Dict[str, List[ScenarioSeed]] = defaultdict(list)
    for s in scenarios:
        buckets[s.category].append(s)

    train: List[ScenarioSeed] = []
    eval_seeds: List[ScenarioSeed] = []
    for key in sorted(buckets.keys()):
        group = list(buckets[key])
        rng.shuffle(group)
        if len(group) == 1:
            train.append(group[0])
            continue
        n_train = max(1, int(round(len(group) * train_frac)))
        n_train = min(n_train, len(group) - 1)
        train.extend(group[:n_train])
        eval_seeds.extend(group[n_train:])
    return train, eval_seeds
