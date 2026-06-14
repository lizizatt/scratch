"""
Encounter template library — spawn contacts and compose unified scenarios.

Called by scenarios.py; not edited during training experiments.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import product
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from prepare import ScenarioSeed, contact_from_polar

VESSEL_CLASSES: Dict[str, float] = {
    "dinghy": 8.0,
    "workboat": 15.0,
    "freighter": 35.0,
}
OWN_RADIUS_M = 15.0
DEFAULT_VESSEL_CLASS = "workboat"
VESSEL_CLASS_CHOICES: Tuple[str, ...] = ("dinghy", "workboat", "freighter")


@dataclass(frozen=True)
class MissionShell:
    """Own-ship start + goal; no traffic."""

    name: str
    seed: int
    category: str
    description: str
    own_heading_deg: float
    own_speed_mps: float
    own_x_m: float
    own_y_m: float
    goal_x_m: float
    goal_y_m: float


def radius_for_class(vessel_class: str) -> float:
    if vessel_class not in VESSEL_CLASSES:
        raise ValueError(f"Unknown vessel_class: {vessel_class}")
    return VESSEL_CLASSES[vessel_class]


def make_contact(
    own_x: float,
    own_y: float,
    bearing_deg: float,
    range_m: float,
    cog_deg: float,
    sog_mps: float,
    vessel_class: str = DEFAULT_VESSEL_CLASS,
) -> Dict[str, float]:
    """Place one intruder relative to own-ship position."""
    return contact_from_polar(
        own_x,
        own_y,
        bearing_deg,
        range_m,
        cog_deg,
        sog_mps,
        vessel_class=vessel_class,
    )


def spawn_stationary(
    own_x: float,
    own_y: float,
    bearing_deg: float,
    range_m: float,
    vessel_class: str = DEFAULT_VESSEL_CLASS,
    cog_deg: float = 0.0,
) -> Dict[str, float]:
    """Anchored / disabled vessel — sog=0, no special obs flag."""
    return make_contact(own_x, own_y, bearing_deg, range_m, cog_deg, 0.0, vessel_class)


def spawn_crossing(
    own_x: float,
    own_y: float,
    side: str,
    bearing_deg: float,
    range_m: float,
    cog_deg: float,
    sog_mps: float,
    vessel_class: str = DEFAULT_VESSEL_CLASS,
) -> Dict[str, float]:
    return make_contact(own_x, own_y, bearing_deg, range_m, cog_deg, sog_mps, vessel_class)


def spawn_head_on(
    own_x: float,
    own_y: float,
    range_m: float,
    sog_mps: float,
    vessel_class: str = DEFAULT_VESSEL_CLASS,
) -> Dict[str, float]:
    return make_contact(own_x, own_y, 0.0, range_m, 180.0, sog_mps, vessel_class)


def spawn_beam(
    own_x: float,
    own_y: float,
    side: str,
    range_m: float,
    sog_mps: float,
    vessel_class: str = DEFAULT_VESSEL_CLASS,
) -> Dict[str, float]:
    brg = 90.0 if side == "stbd" else -90.0
    cog = 0.0 if side == "stbd" else 180.0
    return make_contact(own_x, own_y, brg, range_m, cog, sog_mps, vessel_class)


def spawn_overtaking(
    own_x: float,
    own_y: float,
    bearing_deg: float,
    range_m: float,
    delta_sog: float,
    vessel_class: str = DEFAULT_VESSEL_CLASS,
    own_sog: float = 4.0,
) -> Dict[str, float]:
    return make_contact(own_x, own_y, bearing_deg, range_m, 0.0, own_sog + delta_sog, vessel_class)


def spawn_overtaken(
    own_x: float,
    own_y: float,
    bearing_deg: float,
    range_m: float,
    sog_mps: float,
    vessel_class: str = DEFAULT_VESSEL_CLASS,
) -> Dict[str, float]:
    return make_contact(own_x, own_y, bearing_deg, range_m, 0.0, sog_mps, vessel_class)


def compose_scenario(
    shell: MissionShell,
    contacts: Sequence[Dict[str, float]],
    traffic_category: str,
    description: str,
    *,
    name_suffix: str = "",
) -> ScenarioSeed:
    """Attach traffic to a mission shell → unified navigate scenario."""
    suffix = f"_{name_suffix}" if name_suffix else ""
    if contacts:
        category = f"traffic/{traffic_category}"
        name = f"{shell.name}{suffix}_t_{traffic_category}"
    else:
        category = f"clear/{shell.category}"
        name = shell.name
    return ScenarioSeed(
        name=name,
        mode="navigate",
        seed=shell.seed,
        category=category,
        description=description,
        own_heading_deg=shell.own_heading_deg,
        own_speed_mps=shell.own_speed_mps,
        own_x_m=shell.own_x_m,
        own_y_m=shell.own_y_m,
        goal_x_m=shell.goal_x_m,
        goal_y_m=shell.goal_y_m,
        contacts=list(contacts),
    )


def default_traffic_shell(seed: int = 2000) -> MissionShell:
    """Standard northbound mission used for most traffic templates."""
    return MissionShell(
        name="traffic_base",
        seed=seed,
        category="base",
        description="Own northbound, goal 1000 m ahead",
        own_heading_deg=0.0,
        own_speed_mps=4.0,
        own_x_m=0.0,
        own_y_m=0.0,
        goal_x_m=0.0,
        goal_y_m=1000.0,
    )


def _vessel_class_for_index(index: int) -> str:
    return VESSEL_CLASS_CHOICES[index % len(VESSEL_CLASS_CHOICES)]


def generate_encounter_grid(base: MissionShell, seed_counter: int) -> Tuple[List[ScenarioSeed], int]:
    """Parameterized encounter templates (replaces hand-written avoid grids)."""
    scenarios: List[ScenarioSeed] = []
    sid = seed_counter

    # Crossing starboard
    for i, (brg, rng_m, cog, sog) in enumerate(
        product(
            [35, 45, 60, 75, 90],
            [400, 550, 700, 850],
            [240, 270, 300],
            [2.5, 3.5, 4.5, 5.5],
        )
    ):
        vc = _vessel_class_for_index(i)
        c = spawn_crossing(base.own_x_m, base.own_y_m, "stbd", brg, rng_m, cog, sog, vc)
        scenarios.append(
            compose_scenario(
                MissionShell(**{**base.__dict__, "seed": sid}),
                [c],
                "crossing_stbd",
                f"Crossing stbd: brg {brg}° rng {rng_m}m cog {cog}° {vc}",
                name_suffix=f"xstbd{i:03d}",
            )
        )
        sid += 1

    # Crossing port
    for i, (brg, rng_m, cog, sog) in enumerate(
        product(
            [-35, -45, -60, -75, -90],
            [400, 550, 700, 850],
            [60, 90, 120],
            [2.5, 3.5, 4.5, 5.5],
        )
    ):
        vc = _vessel_class_for_index(i + 100)
        c = spawn_crossing(base.own_x_m, base.own_y_m, "port", brg, rng_m, cog, sog, vc)
        scenarios.append(
            compose_scenario(
                MissionShell(**{**base.__dict__, "seed": sid}),
                [c],
                "crossing_port",
                f"Crossing port: brg {brg}° rng {rng_m}m cog {cog}° {vc}",
                name_suffix=f"xport{i:03d}",
            )
        )
        sid += 1

    # Head-on
    for i, (rng_m, sog, own_spd) in enumerate(
        product([600, 750, 900, 1100], [3.5, 4.5, 5.5, 6.5], [4.0, 5.0])
    ):
        vc = _vessel_class_for_index(i + 200)
        shell = MissionShell(**{**base.__dict__, "seed": sid, "own_speed_mps": own_spd})
        c = spawn_head_on(shell.own_x_m, shell.own_y_m, rng_m, sog, vc)
        scenarios.append(
            compose_scenario(
                shell,
                [c],
                "head_on",
                f"Head-on: range {rng_m}m SOG {sog} m/s {vc}",
                name_suffix=f"ho{i:03d}",
            )
        )
        sid += 1

    # Stationary obstruction (sog=0 — no stationary flag in obs)
    for i, (brg, rng_m) in enumerate(
        product([0, 30, -30, 45, -45, 90, -90], [300, 450, 600, 750])
    ):
        vc = _vessel_class_for_index(i + 300)
        c = spawn_stationary(base.own_x_m, base.own_y_m, brg, rng_m, vc)
        scenarios.append(
            compose_scenario(
                MissionShell(**{**base.__dict__, "seed": sid}),
                [c],
                "stationary",
                f"Stationary: brg {brg}° rng {rng_m}m {vc}",
                name_suffix=f"stat{i:03d}",
            )
        )
        sid += 1

    # Overtaking
    for i, (brg, rng_m, dsog) in enumerate(
        product([0, 10, -10, 20, -20], [350, 500, 650, 800], [0.5, 1.0, 1.5, 2.0, 2.5])
    ):
        vc = _vessel_class_for_index(i + 400)
        c = spawn_overtaking(base.own_x_m, base.own_y_m, brg, rng_m, dsog, vc)
        scenarios.append(
            compose_scenario(
                MissionShell(**{**base.__dict__, "seed": sid}),
                [c],
                "overtaking",
                f"Overtaking: brg {brg}° rng {rng_m}m ΔV {dsog} m/s {vc}",
                name_suffix=f"ot{i:03d}",
            )
        )
        sid += 1

    # Overtaken
    for i, (brg, rng_m, sog) in enumerate(
        product([180, 165, 195, 150], [250, 400, 550, 700], [5.0, 5.5, 6.0, 6.5, 7.0])
    ):
        vc = _vessel_class_for_index(i + 500)
        c = spawn_overtaken(base.own_x_m, base.own_y_m, brg, rng_m, sog, vc)
        scenarios.append(
            compose_scenario(
                MissionShell(**{**base.__dict__, "seed": sid}),
                [c],
                "overtaken",
                f"Overtaken: astern SOG {sog} m/s {vc}",
                name_suffix=f"otn{i:03d}",
            )
        )
        sid += 1

    # Beam traffic
    for i, (side, rng_m, sog) in enumerate(
        product(("stbd", "port"), [400, 550, 700], [3.0, 4.5, 6.0])
    ):
        vc = _vessel_class_for_index(i + 600)
        c = spawn_beam(base.own_x_m, base.own_y_m, side, rng_m, sog, vc)
        scenarios.append(
            compose_scenario(
                MissionShell(**{**base.__dict__, "seed": sid}),
                [c],
                "beam",
                f"Beam {side}: rng {rng_m}m SOG {sog} m/s {vc}",
                name_suffix=f"bm{i:02d}",
            )
        )
        sid += 1

    # Close-quarters crossing
    for i, (brg, rng_m, cog) in enumerate(
        product([50, 70, -50, -70], [250, 320, 380], [250, 270, 90])
    ):
        vc = _vessel_class_for_index(i + 700)
        c = spawn_crossing(base.own_x_m, base.own_y_m, "stbd" if brg > 0 else "port", brg, rng_m, cog, 4.0, vc)
        scenarios.append(
            compose_scenario(
                MissionShell(**{**base.__dict__, "seed": sid, "own_speed_mps": 4.5}),
                [c],
                "close_quarters",
                f"Close crossing brg {brg}° rng {rng_m}m {vc}",
                name_suffix=f"cl{i:03d}",
            )
        )
        sid += 1

    # Multi-ship (random but reproducible)
    rng = np.random.default_rng(42)
    for i in range(24):
        contacts = []
        for _ in range(2):
            brg = float(rng.uniform(-80, 80))
            rng_m = float(rng.uniform(400, 800))
            cog = float(rng.uniform(0, 360))
            sog = float(rng.uniform(0.0, 5.5))
            vc = VESSEL_CLASS_CHOICES[int(rng.integers(len(VESSEL_CLASS_CHOICES)))]
            if sog < 0.3:
                contacts.append(spawn_stationary(base.own_x_m, base.own_y_m, brg, rng_m, vc, cog))
            else:
                contacts.append(make_contact(base.own_x_m, base.own_y_m, brg, rng_m, cog, sog, vc))
        shell = MissionShell(
            **{
                **base.__dict__,
                "seed": sid,
                "own_heading_deg": float(rng.uniform(-15, 15)),
            }
        )
        scenarios.append(
            compose_scenario(
                shell,
                contacts,
                "multi_2",
                f"Two contacts (seed {sid})",
                name_suffix=f"m2{i:02d}",
            )
        )
        sid += 1

    for i in range(16):
        contacts = []
        for _ in range(3):
            brg = float(rng.uniform(-90, 90))
            rng_m = float(rng.uniform(350, 750))
            cog = float(rng.uniform(0, 360))
            sog = float(rng.uniform(0.0, 5.5))
            vc = VESSEL_CLASS_CHOICES[int(rng.integers(len(VESSEL_CLASS_CHOICES)))]
            if sog < 0.3:
                contacts.append(spawn_stationary(base.own_x_m, base.own_y_m, brg, rng_m, vc, cog))
            else:
                contacts.append(make_contact(base.own_x_m, base.own_y_m, brg, rng_m, cog, sog, vc))
        shell = MissionShell(
            **{
                **base.__dict__,
                "seed": sid,
                "own_heading_deg": float(rng.uniform(-20, 20)),
            }
        )
        scenarios.append(
            compose_scenario(
                shell,
                contacts,
                "multi_3",
                f"Three contacts (seed {sid})",
                name_suffix=f"m3{i:02d}",
            )
        )
        sid += 1

    return scenarios, sid
