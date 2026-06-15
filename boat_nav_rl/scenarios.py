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

from prepare import ScenarioSeed, WORLD_BOUNDS
from scenario_templates import MissionShell, compose_scenario, default_traffic_shell, generate_encounter_grid

SINGLE_LEG = "single_leg"


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
                f"{SINGLE_LEG}/ahead",
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
                f"{SINGLE_LEG}/bearing",
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
                f"{SINGLE_LEG}/offset_start",
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
                f"{SINGLE_LEG}/heading_mismatch",
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
                f"{SINGLE_LEG}/astern",
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
                f"{SINGLE_LEG}/speed",
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
                    f"{SINGLE_LEG}/bearing_dist",
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
                    f"{SINGLE_LEG}/offset_grid",
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
                f"{SINGLE_LEG}/cross_track",
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


def _relocate_shell(
    name: str,
    seed: int,
    description: str,
    anchor_x_m: float,
    anchor_y_m: float,
    relocate_x_m: float,
    relocate_y_m: float,
    delay_sec_min: float,
    delay_sec_max: float,
    *,
    own_heading_deg: float = 0.0,
    own_speed_mps: float = 0.0,
) -> ScenarioSeed:
    """Own ship starts at the waypoint; goal moves after a random delay."""
    return ScenarioSeed(
        name=name,
        mode="navigate",
        seed=seed,
        category="clear/hold_then_go",
        description=description,
        own_heading_deg=own_heading_deg,
        own_speed_mps=own_speed_mps,
        own_x_m=anchor_x_m,
        own_y_m=anchor_y_m,
        goal_x_m=anchor_x_m,
        goal_y_m=anchor_y_m,
        goal_relocate_x_m=relocate_x_m,
        goal_relocate_y_m=relocate_y_m,
        goal_relocate_delay_sec_min=delay_sec_min,
        goal_relocate_delay_sec_max=delay_sec_max,
    )


def generate_goal_relocate_scenarios() -> List[ScenarioSeed]:
    """Navigate scenarios: hold at initial waypoint, then goal jumps elsewhere."""
    scenarios: List[ScenarioSeed] = []
    seed_counter = 6000
    delay_bands = ((3.0, 10.0), (8.0, 25.0))

    for dist in (600, 900, 1100):
        for bearing in (-90, -60, -30, 0, 30, 60, 90):
            offset_x, offset_y = _goal_from_polar(dist, bearing)
            for delay_min, delay_max in delay_bands:
                scenarios.append(
                    _relocate_shell(
                        f"nav_reloc_d{dist}_b{bearing:+d}_{int(delay_min)}_{int(delay_max)}s",
                        seed_counter,
                        (
                            f"Start at waypoint; after {delay_min:.0f}-{delay_max:.0f}s "
                            f"goal moves {dist:.0f} m @ {bearing:+d}°"
                        ),
                        0.0,
                        0.0,
                        offset_x,
                        offset_y,
                        delay_min,
                        delay_max,
                        own_heading_deg=float(np.clip(bearing * 0.4, -45, 45)),
                        own_speed_mps=0.0,
                    )
                )
                seed_counter += 1

    for ox, oy, label in ((-220, 140, "sw"), (180, -160, "ne")):
        offset_x, offset_y = _goal_from_polar(850, 25)
        scenarios.append(
            _relocate_shell(
                f"nav_reloc_{label}_850m",
                seed_counter,
                f"Start at offset anchor ({ox},{oy}); goal relocates 850 m @ 25°",
                float(ox),
                float(oy),
                float(ox) + offset_x,
                float(oy) + offset_y,
                5.0,
                20.0,
                own_heading_deg=15.0,
                own_speed_mps=0.0,
            )
        )
        seed_counter += 1

    return scenarios


def _wp_event(
    goal_x_m: float,
    goal_y_m: float,
    trigger: str,
    **kwargs: float,
) -> Dict[str, float]:
    ev: Dict[str, float] = {
        "goal_x_m": float(goal_x_m),
        "goal_y_m": float(goal_y_m),
        "trigger": trigger,  # type: ignore[assignment]
    }
    ev.update(kwargs)
    return ev


def _clip_to_bounds(x: float, y: float, margin: float = 80.0) -> Tuple[float, float]:
    return (
        float(np.clip(x, WORLD_BOUNDS["min_x"] + margin, WORLD_BOUNDS["max_x"] - margin)),
        float(np.clip(y, WORLD_BOUNDS["min_y"] + margin, WORLD_BOUNDS["max_y"] - margin)),
    )


def generate_exercise_sampler_scenarios(count: int = 60, seed_start: int = 8000) -> List[ScenarioSeed]:
    """Random own/goal pairs across Exercise world bounds."""
    rng = np.random.default_rng(seed_start)
    scenarios: List[ScenarioSeed] = []
    for i in range(count):
        ox, oy = _clip_to_bounds(
            float(rng.uniform(WORLD_BOUNDS["min_x"], WORLD_BOUNDS["max_x"])),
            float(rng.uniform(WORLD_BOUNDS["min_y"], WORLD_BOUNDS["max_y"])),
        )
        gx, gy = ox, oy
        for _ in range(30):
            gx, gy = _clip_to_bounds(
                float(rng.uniform(WORLD_BOUNDS["min_x"], WORLD_BOUNDS["max_x"])),
                float(rng.uniform(WORLD_BOUNDS["min_y"], WORLD_BOUNDS["max_y"])),
            )
            if math.hypot(gx - ox, gy - oy) >= 400.0:
                break
        brg = math.degrees(math.atan2(gx - ox, gy - oy))
        scenarios.append(
            ScenarioSeed(
                name=f"exercise_sampler_{i:03d}",
                mode="navigate",
                seed=seed_start + i,
                category="clear/exercise_sampler",
                description=f"Exercise bounds leg {math.hypot(gx - ox, gy - oy):.0f} m @ {brg:.0f}°",
                own_heading_deg=float(np.clip(brg + rng.uniform(-25, 25), -180, 180)),
                own_speed_mps=float(rng.uniform(2.5, 5.0)),
                own_x_m=ox,
                own_y_m=oy,
                goal_x_m=gx,
                goal_y_m=gy,
            )
        )
    return scenarios


def generate_exercise_spawn_scenarios() -> List[ScenarioSeed]:
    """Match Exercise default spawns with forward-hemisphere goals."""
    starts = [(-500.0, -250.0), (-500.0, 0.0), (-500.0, 250.0)]
    scenarios: List[ScenarioSeed] = []
    seed_counter = 8500
    bearings = (-30, 0, 30, 60)
    dists = (500, 700, 900)
    for sx, sy in starts:
        for dist in dists:
            for bearing in bearings:
                gx, gy = sx + dist * math.sin(math.radians(bearing)), sy + dist * math.cos(
                    math.radians(bearing)
                )
                scenarios.append(
                    ScenarioSeed(
                        name=f"exercise_spawn_{int(sx)}_{int(sy)}_{dist}m_b{bearing:+d}",
                        mode="navigate",
                        seed=seed_counter,
                        category="clear/exercise_spawn",
                        description=f"Exercise spawn ({sx:.0f},{sy:.0f}) → {dist} m @ {bearing:+d}°",
                        own_heading_deg=float(bearing),
                        own_speed_mps=3.5,
                        own_x_m=sx,
                        own_y_m=sy,
                        goal_x_m=gx,
                        goal_y_m=gy,
                    )
                )
                seed_counter += 1
    return scenarios


def generate_multi_leg_scenarios() -> List[ScenarioSeed]:
    """Two- and three-leg chains with hold between waypoints."""
    rng = np.random.default_rng(9000)
    scenarios: List[ScenarioSeed] = []
    seed_counter = 9000

    for n_legs in (2, 3):
        for i in range(25 if n_legs == 2 else 15):
            ox, oy = _clip_to_bounds(float(rng.uniform(-400, 400)), float(rng.uniform(-300, 300)))
            legs: List[Tuple[float, float]] = []
            cx, cy = ox, oy
            for _ in range(n_legs):
                bearing = float(rng.uniform(-80, 80))
                dist = float(rng.uniform(450, 900))
                cx += dist * math.sin(math.radians(bearing))
                cy += dist * math.cos(math.radians(bearing))
                cx, cy = _clip_to_bounds(cx, cy)
                legs.append((cx, cy))
            events = [_wp_event(legs[0][0], legs[0][1], "start")]
            for lx, ly in legs[1:]:
                events.append(_wp_event(lx, ly, "hold_complete"))
            scenarios.append(
                ScenarioSeed(
                    name=f"multi_leg_{n_legs}x_{i:02d}",
                    mode="navigate",
                    seed=seed_counter,
                    category="clear/multi_leg",
                    description=f"{n_legs}-leg chain starting ({ox:.0f},{oy:.0f})",
                    own_heading_deg=float(rng.uniform(-30, 30)),
                    own_speed_mps=float(rng.uniform(3.0, 4.5)),
                    own_x_m=ox,
                    own_y_m=oy,
                    goal_x_m=legs[0][0],
                    goal_y_m=legs[0][1],
                    waypoint_events=events,
                )
            )
            seed_counter += 1
    return scenarios


def generate_reassign_scenarios() -> List[ScenarioSeed]:
    """Goal changes mid-transit or shortly after entering the hold zone."""
    scenarios: List[ScenarioSeed] = []
    seed_counter = 9500

    for dist in (700, 900, 1100):
        for bearing in (-60, -30, 0, 30, 60):
            gx1, gy1 = _goal_from_polar(dist, bearing)
            for rng_offset in (40, 70):
                gx2, gy2 = _goal_from_polar(dist * 0.9, bearing + rng_offset)
                scenarios.append(
                    ScenarioSeed(
                        name=f"reassign_enroute_d{dist}_b{bearing:+d}_o{rng_offset}",
                        mode="navigate",
                        seed=seed_counter,
                        category="clear/reassign_enroute",
                        description=f"En-route reassign at ~50% progress toward first goal",
                        own_heading_deg=float(np.clip(bearing * 0.3, -40, 40)),
                        own_speed_mps=4.0,
                        own_x_m=0.0,
                        own_y_m=0.0,
                        goal_x_m=gx1,
                        goal_y_m=gy1,
                        waypoint_events=[
                            _wp_event(gx1, gy1, "start"),
                            _wp_event(
                                gx2,
                                gy2,
                                "progress_frac",
                                progress_frac_min=0.35,
                                progress_frac_max=0.65,
                            ),
                        ],
                    )
                )
                seed_counter += 1

    for dist, bearing in product((600, 850), (-45, 0, 45)):
        gx1, gy1 = _goal_from_polar(dist, bearing)
        gx2, gy2 = _goal_from_polar(750, bearing + 55)
        scenarios.append(
            ScenarioSeed(
                name=f"reassign_inhold_d{dist}_b{bearing:+d}",
                mode="navigate",
                seed=seed_counter,
                category="clear/reassign_in_hold",
                description="Near goal; new waypoint after 5–18 s (Exercise-style re-click)",
                own_heading_deg=float(bearing),
                own_speed_mps=3.5,
                own_x_m=gx1 * 0.12,
                own_y_m=gy1 * 0.88,
                goal_x_m=gx1,
                goal_y_m=gy1,
                waypoint_events=[
                    _wp_event(gx1, gy1, "start"),
                    _wp_event(gx2, gy2, "delay_sec", delay_sec_min=5.0, delay_sec_max=18.0),
                ],
            )
        )
        seed_counter += 1

    return scenarios


def generate_traffic_scenarios() -> List[ScenarioSeed]:
    base = default_traffic_shell(seed=2000)
    scenarios, _ = generate_encounter_grid(base, seed_counter=2000)
    return scenarios


def generate_all_scenarios() -> List[ScenarioSeed]:
    return (
        generate_mission_shells()
        + generate_goal_relocate_scenarios()
        + generate_exercise_sampler_scenarios()
        + generate_exercise_spawn_scenarios()
        + generate_multi_leg_scenarios()
        + generate_reassign_scenarios()
        + generate_traffic_scenarios()
    )


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
