"""
Fixed constants, observation layout, transfer-function plant, and eval seeds.

Do not edit during autoresearch-style experiments — change train.py instead.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parent
RUNS_DIR = ROOT / "runs"
TRAIN_SEEDS_PATH = RUNS_DIR / "train_seeds.json"
EVAL_SEEDS_PATH = RUNS_DIR / "eval_seeds.json"
SCENARIO_MANIFEST_PATH = RUNS_DIR / "scenario_manifest.json"
TRAIN_SPLIT_FRAC = 0.65
SPLIT_RNG_SEED = 42

# --- Simulation constants (fixed) ---
DT_S = 1.0
MAX_STEPS = 300
N_MAX_CONTACTS = 8
MVP_MAX_ACTIVE_CONTACTS = 4  # legacy alias; train.py uses TRAIN_MAX_CONTACTS

GOAL_SUCCESS_RANGE_M = 50.0
COLLISION_RADIUS_M = 20.0  # legacy alias ≈ workboat diameter
CPA_SAFE_RANGE_M = 80.0  # legacy fixed threshold (superseded by size-aware CPA)
CPA_MARGIN_M = 30.0
CPA_HORIZON_S = 120.0

VESSEL_CLASSES: Dict[str, float] = {
    "dinghy": 8.0,
    "workboat": 15.0,
    "freighter": 35.0,
}
OWN_RADIUS_M = VESSEL_CLASSES["workboat"]
DEFAULT_VESSEL_CLASS = "workboat"
RADIUS_SCALE_M = max(VESSEL_CLASSES.values())

# Default sensing noise (overridden in train.py CONFIG during training)
CONTACT_OBS_NOISE_M = 5.0
CONTACT_OBS_NOISE_BEARING_RAD = 0.03

V_MIN_MPS = 0.0  # literal stop allowed (all-stop command)
V_MAX_MPS = 8.0
CURRENT_MAX_MPS = 0.5  # max water current speed (m/s)
DEFAULT_GOAL_HOLD_SEC = 30
DEFAULT_MODE = "avoid"  # "navigate" | "avoid" | "all"

# Shared world extent (Exercise sandbox + exercise_sampler scenarios).
WORLD_BOUNDS = {
    "min_x": -1200.0,
    "max_x": 1200.0,
    "min_y": -900.0,
    "max_y": 900.0,
}
HEADING_MIN_RAD = -math.pi
HEADING_MAX_RAD = math.pi

TAU_HEADING_S = 3.0
TAU_SPEED_S = 4.0
MAX_YAW_RATE_RPS = math.radians(15.0)

# Agile craft ↔ slow freighter envelope for domain-randomization (LTI per episode).
PLANT_AGILE = {"tau_heading_s": 1.5, "tau_speed_s": 2.0, "max_yaw_rate_deg_s": 22.0}
PLANT_NOMINAL = {"tau_heading_s": TAU_HEADING_S, "tau_speed_s": TAU_SPEED_S, "max_yaw_rate_deg_s": 15.0}
PLANT_FREIGHTER = {"tau_heading_s": 8.0, "tau_speed_s": 10.0, "max_yaw_rate_deg_s": 6.0}

# Normalization scales for observations
POS_SCALE_M = 2000.0
RANGE_SCALE_M = 2000.0
SPEED_SCALE_MPS = V_MAX_MPS
YAW_RATE_SCALE_RPS = MAX_YAW_RATE_RPS

# Flat observation layout — must match interface/boat_nav_rl_interface.h (BNRL_SCHEMA_VERSION).
OBS_SCHEMA_VERSION = 3
OBS_OWN_DIM = 6
OBS_CURRENT_DIM = 3
OBS_CONTACT_DIM = 7
OBS_GOAL_DIM = 3
OBS_MASK_OFFSET = OBS_OWN_DIM + OBS_CURRENT_DIM + N_MAX_CONTACTS * OBS_CONTACT_DIM
OBS_GOAL_OFFSET = OBS_MASK_OFFSET + N_MAX_CONTACTS
OBS_HAS_GOAL_OFFSET = OBS_GOAL_OFFSET + OBS_GOAL_DIM
OBS_DIM = OBS_HAS_GOAL_OFFSET + 1  # 77


def wrap_angle(rad: float) -> float:
    while rad > math.pi:
        rad -= 2.0 * math.pi
    while rad < -math.pi:
        rad += 2.0 * math.pi
    return rad


def velocity_from_cog(cog_rad: float, speed_mps: float) -> Tuple[float, float]:
    """Course 0 = north, clockwise positive -> (vx east, vy north)."""
    vx = speed_mps * math.sin(cog_rad)
    vy = speed_mps * math.cos(cog_rad)
    return vx, vy


@dataclass
class ContactState:
    x_m: float
    y_m: float
    cog_rad: float
    sog_mps: float
    speed_mps: float
    radius_m: float = OWN_RADIUS_M
    vessel_class: str = DEFAULT_VESSEL_CLASS

    def step(self, dt: float) -> None:
        vx, vy = velocity_from_cog(self.cog_rad, self.sog_mps)
        self.x_m += vx * dt
        self.y_m += vy * dt


def radius_for_class(vessel_class: str) -> float:
    return VESSEL_CLASSES.get(vessel_class, OWN_RADIUS_M)


def own_velocity(own: VesselState, current: Optional[WaterCurrent] = None) -> Tuple[float, float]:
    """Ground velocity (m/s east, north) including water current."""
    cur = current or WaterCurrent()
    vx = own.speed_mps * math.sin(own.heading_rad) + cur.vx_mps
    vy = own.speed_mps * math.cos(own.heading_rad) + cur.vy_mps
    return vx, vy


def contact_velocity(contact: ContactState) -> Tuple[float, float]:
    return velocity_from_cog(contact.cog_rad, contact.sog_mps)


def compute_cpa_tcpa(
    own_x: float,
    own_y: float,
    own_vx: float,
    own_vy: float,
    contact_x: float,
    contact_y: float,
    contact_vx: float,
    contact_vy: float,
) -> Tuple[float, float]:
    """Return (cpa_distance_m, tcpa_s). tcpa=inf when relative speed ≈ 0."""
    rx = contact_x - own_x
    ry = contact_y - own_y
    vx = contact_vx - own_vx
    vy = contact_vy - own_vy
    v2 = vx * vx + vy * vy
    if v2 < 1e-8:
        return math.hypot(rx, ry), float("inf")
    tcpa = -(rx * vx + ry * vy) / v2
    cpa_x = rx + vx * tcpa
    cpa_y = ry + vy * tcpa
    return math.hypot(cpa_x, cpa_y), tcpa


def cpa_safe_distance(
    contact_radius_m: float,
    own_radius_m: float = OWN_RADIUS_M,
    margin_m: float = CPA_MARGIN_M,
) -> float:
    return own_radius_m + contact_radius_m + margin_m


@dataclass
class VesselState:
    x_m: float = 0.0
    y_m: float = 0.0
    heading_rad: float = 0.0
    speed_mps: float = 3.0
    yaw_rate_rps: float = 0.0
    cmd_heading_rad: float = 0.0
    cmd_speed_mps: float = 3.0

    def copy(self) -> "VesselState":
        return VesselState(
            x_m=self.x_m,
            y_m=self.y_m,
            heading_rad=self.heading_rad,
            speed_mps=self.speed_mps,
            yaw_rate_rps=self.yaw_rate_rps,
            cmd_heading_rad=self.cmd_heading_rad,
            cmd_speed_mps=self.cmd_speed_mps,
        )


@dataclass
class PlantParams:
    """First-order heading/speed plant — constant (LTI) for entire episode."""

    tau_heading_s: float = TAU_HEADING_S
    tau_speed_s: float = TAU_SPEED_S
    max_yaw_rate_deg_s: float = 15.0

    @property
    def max_yaw_rate_rps(self) -> float:
        return math.radians(self.max_yaw_rate_deg_s)

    def to_plant(self) -> "TransferFunctionPlant":
        return TransferFunctionPlant(
            tau_heading_s=self.tau_heading_s,
            tau_speed_s=self.tau_speed_s,
            max_yaw_rate_rps=self.max_yaw_rate_rps,
        )

    def to_dict(self) -> Dict[str, float]:
        return {
            "tau_heading_s": round(self.tau_heading_s, 3),
            "tau_speed_s": round(self.tau_speed_s, 3),
            "max_yaw_rate_deg_s": round(self.max_yaw_rate_deg_s, 2),
        }


def plant_from_dict(data: Dict[str, Any]) -> PlantParams:
    return PlantParams(
        tau_heading_s=float(data.get("tau_heading_s", TAU_HEADING_S)),
        tau_speed_s=float(data.get("tau_speed_s", TAU_SPEED_S)),
        max_yaw_rate_deg_s=float(data.get("max_yaw_rate_deg_s", 15.0)),
    )


def default_plant_config() -> Dict[str, Any]:
    return {
        "nominal": PlantParams().to_dict(),
        "agile": dict(PLANT_AGILE),
        "freighter": dict(PLANT_FREIGHTER),
        "jitter_envelope": {
            "tau_heading_s": [PLANT_AGILE["tau_heading_s"], PLANT_FREIGHTER["tau_heading_s"]],
            "tau_speed_s": [PLANT_AGILE["tau_speed_s"], PLANT_FREIGHTER["tau_speed_s"]],
            "max_yaw_rate_deg_s": [PLANT_FREIGHTER["max_yaw_rate_deg_s"], PLANT_AGILE["max_yaw_rate_deg_s"]],
        },
        "goal_hold_sec_default": DEFAULT_GOAL_HOLD_SEC,
        "default_mode": DEFAULT_MODE,
        "sim_constants": {
            "vessel_classes": dict(VESSEL_CLASSES),
            "own_radius_m": OWN_RADIUS_M,
            "cpa_margin_m": CPA_MARGIN_M,
            "goal_success_range_m": GOAL_SUCCESS_RANGE_M,
            "max_episode_steps_default": MAX_STEPS,
            "dt_s": DT_S,
            "v_min_mps": V_MIN_MPS,
            "v_max_mps": V_MAX_MPS,
        },
        "current_max_mps": CURRENT_MAX_MPS,
    }


def sample_plant_params(rng: np.random.Generator) -> PlantParams:
    """Sample LTI params for one episode — agile (fast) to freighter (slow)."""
    return PlantParams(
        tau_heading_s=float(
            rng.uniform(PLANT_AGILE["tau_heading_s"], PLANT_FREIGHTER["tau_heading_s"])
        ),
        tau_speed_s=float(rng.uniform(PLANT_AGILE["tau_speed_s"], PLANT_FREIGHTER["tau_speed_s"])),
        max_yaw_rate_deg_s=float(
            rng.uniform(PLANT_FREIGHTER["max_yaw_rate_deg_s"], PLANT_AGILE["max_yaw_rate_deg_s"])
        ),
    )


class TransferFunctionPlant:
    """First-order lag from commanded heading/speed to achieved state."""

    def __init__(
        self,
        tau_heading_s: float = TAU_HEADING_S,
        tau_speed_s: float = TAU_SPEED_S,
        max_yaw_rate_rps: float = MAX_YAW_RATE_RPS,
    ) -> None:
        self.tau_heading_s = tau_heading_s
        self.tau_speed_s = tau_speed_s
        self.max_yaw_rate_rps = max_yaw_rate_rps

    def apply_command(self, state: VesselState, heading_rad: float, speed_mps: float) -> None:
        state.cmd_heading_rad = wrap_angle(heading_rad)
        state.cmd_speed_mps = float(np.clip(speed_mps, V_MIN_MPS, V_MAX_MPS))

    def step(self, state: VesselState, dt: float) -> None:
        heading_err = wrap_angle(state.cmd_heading_rad - state.heading_rad)
        desired_yaw_rate = heading_err / max(self.tau_heading_s, 1e-3)
        desired_yaw_rate = float(np.clip(desired_yaw_rate, -self.max_yaw_rate_rps, self.max_yaw_rate_rps))
        state.yaw_rate_rps = desired_yaw_rate
        state.heading_rad = wrap_angle(state.heading_rad + state.yaw_rate_rps * dt)

        speed_err = state.cmd_speed_mps - state.speed_mps
        speed_rate = speed_err / max(self.tau_speed_s, 1e-3)
        state.speed_mps = float(np.clip(state.speed_mps + speed_rate * dt, V_MIN_MPS, V_MAX_MPS))

        vx = state.speed_mps * math.sin(state.heading_rad)
        vy = state.speed_mps * math.cos(state.heading_rad)
        state.x_m += vx * dt
        state.y_m += vy * dt


@dataclass
class WaterCurrent:
    """Constant water current for one episode (LTI) — drift added to position each step."""

    vx_mps: float = 0.0
    vy_mps: float = 0.0

    @property
    def speed_mps(self) -> float:
        return math.hypot(self.vx_mps, self.vy_mps)

    @property
    def direction_rad(self) -> float:
        return math.atan2(self.vx_mps, self.vy_mps) if self.speed_mps > 1e-9 else 0.0

    def to_dict(self) -> Dict[str, float]:
        return {
            "vx_mps": round(self.vx_mps, 4),
            "vy_mps": round(self.vy_mps, 4),
            "speed_mps": round(self.speed_mps, 4),
            "direction_deg": round(math.degrees(self.direction_rad), 1),
        }


def sample_water_current(rng: np.random.Generator) -> WaterCurrent:
    """Uniform speed in [0, CURRENT_MAX] and random direction (0=north, cw+)."""
    speed = float(rng.uniform(0.0, CURRENT_MAX_MPS))
    direction = float(rng.uniform(-math.pi, math.pi))
    return WaterCurrent(
        vx_mps=speed * math.sin(direction),
        vy_mps=speed * math.cos(direction),
    )


def apply_water_current(state: VesselState, current: WaterCurrent, dt: float) -> None:
    state.x_m += current.vx_mps * dt
    state.y_m += current.vy_mps * dt


def bearing_range(own_x: float, own_y: float, tgt_x: float, tgt_y: float) -> Tuple[float, float]:
    dx = tgt_x - own_x
    dy = tgt_y - own_y
    rng = math.hypot(dx, dy)
    bearing = math.atan2(dx, dy)  # 0=north, cw positive
    return bearing, rng


def cross_track_m(
    leg_start_x: float,
    leg_start_y: float,
    leg_end_x: float,
    leg_end_y: float,
    point_x: float,
    point_y: float,
) -> float:
    """Perpendicular distance from point to the infinite line leg_start -> leg_end."""
    dx = leg_end_x - leg_start_x
    dy = leg_end_y - leg_start_y
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq < 1e-6:
        return math.hypot(point_x - leg_start_x, point_y - leg_start_y)
    return abs((point_x - leg_start_x) * dy - (point_y - leg_start_y) * dx) / math.sqrt(seg_len_sq)


def action_to_command(action: np.ndarray) -> Tuple[float, float]:
    """Map normalized [-1, 1] actions to heading and speed."""
    a0, a1 = float(action[0]), float(action[1])
    heading = wrap_angle(a0 * math.pi)
    speed = V_MIN_MPS + (a1 + 1.0) * 0.5 * (V_MAX_MPS - V_MIN_MPS)
    return heading, speed


def pack_observation(
    own: VesselState,
    goal_x: float,
    goal_y: float,
    has_goal: bool,
    contacts: Sequence[ContactState],
    origin_x: float,
    origin_y: float,
    current: Optional[WaterCurrent] = None,
    out: Optional[np.ndarray] = None,
    *,
    contact_noise_m: float = 0.0,
    contact_noise_bearing_rad: float = 0.0,
    rng: Optional[np.random.Generator] = None,
) -> np.ndarray:
    obs = out if out is not None else np.zeros(OBS_DIM, dtype=np.float32)
    if out is not None:
        obs.fill(0.0)

    # Own ship (6)
    obs[0] = wrap_angle(own.heading_rad) / math.pi
    obs[1] = own.speed_mps / SPEED_SCALE_MPS
    obs[2] = own.yaw_rate_rps / YAW_RATE_SCALE_RPS
    obs[3] = (own.x_m - origin_x) / POS_SCALE_M
    obs[4] = (own.y_m - origin_y) / POS_SCALE_M
    obs[5] = 0.0  # reserved

    # Water current (3) — uses wind slots: speed, sin(dir), cos(dir)
    cur = current or WaterCurrent()
    obs[6] = cur.speed_mps / max(CURRENT_MAX_MPS, 1e-6)
    obs[7] = math.sin(cur.direction_rad)
    obs[8] = math.cos(cur.direction_rad)

    # Contacts sorted by sensed range (noise applied to observations only)
    indexed: List[Tuple[float, ContactState]] = []
    noise_rng = rng
    for c in contacts:
        brg, rng_dist = bearing_range(own.x_m, own.y_m, c.x_m, c.y_m)
        if noise_rng is not None and (contact_noise_m > 0.0 or contact_noise_bearing_rad > 0.0):
            brg = wrap_angle(
                brg + float(noise_rng.normal(0.0, contact_noise_bearing_rad))
            )
            rng_dist = max(0.0, rng_dist + float(noise_rng.normal(0.0, contact_noise_m)))
        indexed.append((rng_dist, c, brg))
    indexed.sort(key=lambda t: t[0])

    base = 9
    for slot in range(N_MAX_CONTACTS):
        offset = base + slot * 7
        if slot < len(indexed):
            rng_dist, c, brg = indexed[slot]
            obs[offset + 0] = math.sin(brg)
            obs[offset + 1] = math.cos(brg)
            obs[offset + 2] = min(rng_dist / RANGE_SCALE_M, 1.0)
            obs[offset + 3] = math.sin(c.cog_rad)
            obs[offset + 4] = math.cos(c.cog_rad)
            obs[offset + 5] = c.sog_mps / SPEED_SCALE_MPS
            obs[offset + 6] = c.radius_m / RADIUS_SCALE_M
            obs[base + N_MAX_CONTACTS * 7 + slot] = 1.0  # mask
        else:
            obs[base + N_MAX_CONTACTS * 7 + slot] = 0.0

    goal_base = base + N_MAX_CONTACTS * 7 + N_MAX_CONTACTS
    if has_goal:
        g_brg, g_rng = bearing_range(own.x_m, own.y_m, goal_x, goal_y)
        obs[goal_base + 0] = math.sin(g_brg)
        obs[goal_base + 1] = math.cos(g_brg)
        obs[goal_base + 2] = min(g_rng / RANGE_SCALE_M, 1.0)
        obs[goal_base + 3] = 1.0
    else:
        obs[goal_base + 3] = 0.0

    return sanitize_observation(obs)


def sanitize_observation(obs: np.ndarray) -> np.ndarray:
    """Ensure finite, bounded observations for the policy network."""
    np.nan_to_num(obs, copy=False, nan=0.0, posinf=1.0, neginf=-1.0)
    np.clip(obs, -10.0, 10.0, out=obs)
    return obs


@dataclass
class ScenarioSeed:
    name: str
    mode: str
    seed: int
    own_heading_deg: float
    own_speed_mps: float
    own_x_m: float
    own_y_m: float
    goal_x_m: float
    goal_y_m: float
    contacts: List[Dict[str, float]] = field(default_factory=list)
    category: str = "uncategorized"
    description: str = ""
    # Optional waypoint schedule (see mission.py). Legacy relocate fields still supported.
    waypoint_events: List[Dict[str, Any]] = field(default_factory=list)
    goal_relocate_x_m: Optional[float] = None
    goal_relocate_y_m: Optional[float] = None
    goal_relocate_delay_sec_min: Optional[float] = None
    goal_relocate_delay_sec_max: Optional[float] = None


def contact_from_polar(
    own_x: float,
    own_y: float,
    bearing_deg: float,
    range_m: float,
    cog_deg: float,
    sog_mps: float,
    vessel_class: str = DEFAULT_VESSEL_CLASS,
) -> Dict[str, float]:
    brg = math.radians(bearing_deg)
    cx = own_x + range_m * math.sin(brg)
    cy = own_y + range_m * math.cos(brg)
    radius_m = radius_for_class(vessel_class)
    return {
        "x_m": cx,
        "y_m": cy,
        "cog_deg": cog_deg,
        "sog_mps": sog_mps,
        "speed_mps": sog_mps,
        "vessel_class": vessel_class,
        "radius_m": radius_m,
    }


def build_eval_seeds() -> List[ScenarioSeed]:
    from scenarios import generate_all_scenarios, split_train_eval

    _, eval_seeds = split_train_eval(generate_all_scenarios())
    return eval_seeds


def build_train_seeds() -> List[ScenarioSeed]:
    from scenarios import generate_all_scenarios, split_train_eval

    train_seeds, _ = split_train_eval(generate_all_scenarios())
    return train_seeds


def write_scenario_splits(
    train_path: Path = TRAIN_SEEDS_PATH,
    eval_path: Path = EVAL_SEEDS_PATH,
    manifest_path: Path = SCENARIO_MANIFEST_PATH,
) -> Tuple[Path, Path, Path]:
    from scenarios import generate_all_scenarios, scenario_summary, split_train_eval

    all_seeds = generate_all_scenarios()
    train_seeds, eval_seeds = split_train_eval(all_seeds)
    train_path.parent.mkdir(parents=True, exist_ok=True)
    train_path.write_text(json.dumps([asdict(s) for s in train_seeds], indent=2), encoding="utf-8")
    eval_path.write_text(json.dumps([asdict(s) for s in eval_seeds], indent=2), encoding="utf-8")
    manifest = {
        "version": 5,
        "vessel_classes": dict(VESSEL_CLASSES),
        "own_radius_m": OWN_RADIUS_M,
        "cpa_margin_m": CPA_MARGIN_M,
        "cpa_horizon_s": CPA_HORIZON_S,
        "train_split_frac": TRAIN_SPLIT_FRAC,
        "split_rng_seed": SPLIT_RNG_SEED,
        "total_scenarios": len(all_seeds),
        "train_count": len(train_seeds),
        "eval_count": len(eval_seeds),
        "train_summary": scenario_summary(train_seeds),
        "eval_summary": scenario_summary(eval_seeds),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return train_path, eval_path, manifest_path


def write_eval_seeds(path: Path = EVAL_SEEDS_PATH) -> Path:
    _, eval_path, _ = write_scenario_splits(eval_path=path)
    return eval_path


def _load_seed_list(raw: object) -> List[ScenarioSeed]:
    if isinstance(raw, dict):
        raw = raw.get("scenarios", raw.get("eval", []))
    seeds: List[ScenarioSeed] = []
    for item in raw:
        item.setdefault("category", "uncategorized")
        item.setdefault("description", "")
        item.setdefault("waypoint_events", [])
        seeds.append(ScenarioSeed(**item))
    return seeds


def load_train_seeds(path: Path = TRAIN_SEEDS_PATH) -> List[ScenarioSeed]:
    if not path.exists():
        write_scenario_splits()
    raw = json.loads(path.read_text(encoding="utf-8"))
    return _load_seed_list(raw)


def load_eval_seeds(path: Path = EVAL_SEEDS_PATH) -> List[ScenarioSeed]:
    if not path.exists():
        write_scenario_splits()
    raw = json.loads(path.read_text(encoding="utf-8"))
    return _load_seed_list(raw)


def scenario_to_contacts(scenario: ScenarioSeed) -> List[ContactState]:
    contacts: List[ContactState] = []
    for c in scenario.contacts:
        vessel_class = c.get("vessel_class", DEFAULT_VESSEL_CLASS)
        radius_m = float(c.get("radius_m", radius_for_class(vessel_class)))
        contacts.append(
            ContactState(
                x_m=c["x_m"],
                y_m=c["y_m"],
                cog_rad=math.radians(c["cog_deg"]),
                sog_mps=c["sog_mps"],
                speed_mps=c.get("speed_mps", c["sog_mps"]),
                radius_m=radius_m,
                vessel_class=vessel_class,
            )
        )
    return contacts


def min_contact_range(own: VesselState, contacts: Sequence[ContactState]) -> float:
    if not contacts:
        return float("inf")
    return min(math.hypot(c.x_m - own.x_m, c.y_m - own.y_m) for c in contacts)


def check_collision(
    own: VesselState,
    contacts: Sequence[ContactState],
    own_radius_m: float = OWN_RADIUS_M,
) -> bool:
    for c in contacts:
        if math.hypot(c.x_m - own.x_m, c.y_m - own.y_m) < own_radius_m + c.radius_m:
            return True
    return False


def goal_range(own: VesselState, goal_x: float, goal_y: float) -> float:
    return math.hypot(goal_x - own.x_m, goal_y - own.y_m)


def goal_range_xy(own_x: float, own_y: float, goal_x: float, goal_y: float) -> float:
    return math.hypot(goal_x - own_x, goal_y - own_y)


def snapshot_step(
    t: int,
    own: VesselState,
    goal_x: float,
    goal_y: float,
    contacts: Sequence[ContactState],
) -> Dict[str, Any]:
    return {
        "t": t,
        "own": {
            "x": own.x_m,
            "y": own.y_m,
            "heading": own.heading_rad,
            "speed": own.speed_mps,
            "cmd_heading": own.cmd_heading_rad,
            "cmd_speed": own.cmd_speed_mps,
        },
        "goal": {"x": goal_x, "y": goal_y},
        "contacts": [
            {
                "x": c.x_m,
                "y": c.y_m,
                "cog": c.cog_rad,
                "sog": c.sog_mps,
                "radius_m": c.radius_m,
                "vessel_class": c.vessel_class,
            }
            for c in contacts
        ],
        "min_range_m": min_contact_range(own, contacts) if contacts else None,
        "goal_range_m": goal_range(own, goal_x, goal_y),
    }


def main() -> None:
    from scenarios import scenario_summary

    train_path, eval_path, manifest_path = write_scenario_splits()
    train_seeds = load_train_seeds(train_path)
    eval_seeds = load_eval_seeds(eval_path)
    print(f"Wrote {len(train_seeds)} train + {len(eval_seeds)} eval scenarios")
    print(f"  train -> {train_path}")
    print(f"  eval  -> {eval_path}")
    print(f"  manifest -> {manifest_path}")
    print("Train summary:")
    for key, count in sorted(scenario_summary(train_seeds).items()):
        print(f"  {key}: {count}")
    print("Eval summary:")
    for key, count in sorted(scenario_summary(eval_seeds).items()):
        print(f"  {key}: {count}")


if __name__ == "__main__":
    main()
