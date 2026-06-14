"""
Boat navigation RL training — edit the CONFIG section, then run:

    python prepare.py   # once
    python train.py
    python serve.py     # visualization at http://localhost:8765
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import gymnasium as gym
import numpy as np
from gymnasium import spaces
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback, CallbackList
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv

import prepare as P
from colregs.evaluate import evaluate_episode, rollup_episodes
from device_util import configure_training_backend, resolve_device, torch_device_info
from policy_infer import safe_model_predict

ROOT = Path(__file__).resolve().parent
RUNS_DIR = ROOT / "runs"
JOB_DIR = RUNS_DIR / "_training"
STATUS_PATH = JOB_DIR / "status.json"
CANCEL_FLAG_PATH = JOB_DIR / "cancel.flag"
LIVE_METRICS_PATH = JOB_DIR / "live_metrics.json"

# =============================================================================
# CONFIG — edit this section between experiments
# =============================================================================
MODE = "navigate"  # "navigate" (clear) | "avoid" (traffic) | "all"

TRAIN_BUDGET_SEC = int(os.environ.get("TRAIN_BUDGET_SEC", "600"))
N_ENVS = int(os.environ.get("N_ENVS", "8"))
DEVICE = os.environ.get("TRAIN_DEVICE", "auto")
EVAL_EPISODES = int(os.environ.get("EVAL_EPISODES", "0"))  # 0 = full eval set at end
LIVE_EVAL_SCENARIOS = int(os.environ.get("LIVE_EVAL_SCENARIOS", "6"))
LIVE_EVAL_INTERVAL_SEC = float(os.environ.get("LIVE_EVAL_INTERVAL_SEC", "45.0"))
LIVE_METRICS_MAX_POINTS = int(os.environ.get("LIVE_METRICS_MAX_POINTS", "500"))
ROBUST_EVAL_SAMPLES = int(os.environ.get("ROBUST_EVAL_SAMPLES", "5"))
ROBUST_EVAL_SCENARIOS = int(os.environ.get("ROBUST_EVAL_SCENARIOS", "12"))

DYNAMICS_JITTER = os.environ.get("DYNAMICS_JITTER", "0") == "1"
ROBUST_EVAL_ENABLED = os.environ.get("ROBUST_EVAL_ENABLED", "0") == "1"
GOAL_HOLD_SEC = int(os.environ.get("GOAL_HOLD_SEC", str(P.DEFAULT_GOAL_HOLD_SEC)))
CURRENT_ENABLED = os.environ.get("CURRENT_ENABLED", "1") == "1"
MONTAGE_ENABLED = os.environ.get("MONTAGE_ENABLED", "0") == "1"
MONTAGE_MAX_EPISODES = int(os.environ.get("MONTAGE_MAX_EPISODES", "48"))
MONTAGE_STEP_COLS = int(os.environ.get("MONTAGE_STEP_COLS", "12"))
NOMINAL_PLANT = P.plant_from_dict(P.PLANT_NOMINAL)

NET_ARCH: List[int] = [256, 256]
LEARNING_RATE = 3e-4
N_STEPS = 2048
BATCH_SIZE = 256
GAMMA = 0.99

# Reward weights
W_GOAL_PROGRESS = 3.0
W_GOAL_REACHED = 50.0
W_GOAL_HOLD = 1.0
W_GOAL_EARLY = 8.0  # bonus on first zone entry, scaled by how quickly we got there
W_TIME = 0.04  # per-step cost until hold completes (discourages detours)
W_SPEED_TRACK = 0.05  # en-route cruise tracking only
W_HOLD_STATION = 1.0  # reward low speed while holding at waypoint
W_HOLD_CENTER = 0.6  # penalize drifting off waypoint center while in zone
W_SMOOTH = 0.02
W_CPA = 10.0  # hard CPA penalty — must exceed per-step hold stack when unsafe
W_CPA_SOFT = 3.0  # shaping before crossing safe CPA distance
CPA_WARNING_MULT = 2.0  # soft penalty when cpa < safe * this and TCPA in horizon
W_ESCAPE_GOAL = 12.0  # bonus for opening range from waypoint while threatened
W_GOAL_THREAT_STAY = 6.0  # per-step penalty for remaining at waypoint under threat
HOLD_THREAT_DAMP = 1.0  # at threat=1, hold rewards scale to zero
THREAT_PROGRESS_THRESH = 0.25  # above this, retreat from waypoint is rewarded not penalized
W_COLLISION = 100.0
CRUISE_SPEED_FRAC = 0.65  # target fraction of V_MAX while en route
REWARD_CLIP = 150.0

# Contact sensing noise (training only — eval uses zero)
CONTACT_OBS_NOISE_M = float(os.environ.get("CONTACT_OBS_NOISE_M", str(P.CONTACT_OBS_NOISE_M)))
CONTACT_OBS_NOISE_BEARING_RAD = float(
    os.environ.get("CONTACT_OBS_NOISE_BEARING_RAD", str(P.CONTACT_OBS_NOISE_BEARING_RAD))
)
CONTACT_OBS_NOISE_EVAL = os.environ.get("CONTACT_OBS_NOISE_EVAL", "0") == "1"
TRAIN_MAX_CONTACTS = int(os.environ.get("TRAIN_MAX_CONTACTS", "4"))

NOTES = "baseline"

VIZ_PORT = 8765

_EVAL_SEEDS_CACHE: Dict[str, List[P.ScenarioSeed]] = {}
_TRAIN_SEEDS_CACHE: Dict[str, List[P.ScenarioSeed]] = {}
_VESSEL_CLASS_CHOICES = tuple(P.VESSEL_CLASSES.keys())
# =============================================================================


def contact_threat_and_cpa_penalty(
    own: P.VesselState,
    contacts: List[P.ContactState],
    water_current: P.WaterCurrent,
    own_radius_m: float,
) -> Tuple[float, float]:
    """Return (cpa_penalty, threat_level in [0,1]) for active encounter horizon."""
    if not contacts:
        return 0.0, 0.0

    own_vx, own_vy = P.own_velocity(own, water_current)
    cpa_penalty = 0.0
    threat = 0.0
    for c in contacts:
        c_vx, c_vy = P.contact_velocity(c)
        cpa_m, tcpa = P.compute_cpa_tcpa(
            own.x_m,
            own.y_m,
            own_vx,
            own_vy,
            c.x_m,
            c.y_m,
            c_vx,
            c_vy,
        )
        safe = P.cpa_safe_distance(c.radius_m, own_radius_m)
        if tcpa < 0.0 or tcpa > P.CPA_HORIZON_S:
            continue
        if cpa_m < safe:
            frac = (safe - cpa_m) / safe
            cpa_penalty += W_CPA * frac
            threat = max(threat, min(1.0, frac))
        elif cpa_m < safe * CPA_WARNING_MULT:
            span = safe * (CPA_WARNING_MULT - 1.0)
            warn_frac = (safe * CPA_WARNING_MULT - cpa_m) / max(span, 1e-6)
            cpa_penalty += W_CPA_SOFT * warn_frac
            threat = max(threat, min(1.0, 0.5 * warn_frac))
    return cpa_penalty, threat


def filter_seeds_for_mode(seeds: List[P.ScenarioSeed], mode: str) -> List[P.ScenarioSeed]:
    if mode == "all":
        return list(seeds)
    if mode == "avoid":
        return [s for s in seeds if s.contacts]
    return [s for s in seeds if not s.contacts]


def score_key_for_mode(mode: str) -> str:
    return "avoid_score" if mode == "avoid" else "nav_score"


def load_parent_metrics(resume_run_id: str) -> Dict[str, Any]:
    path = RUNS_DIR / resume_run_id / "metrics.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def is_cancel_requested() -> bool:
    return CANCEL_FLAG_PATH.exists()


def clear_cancel_flag() -> None:
    if CANCEL_FLAG_PATH.exists():
        CANCEL_FLAG_PATH.unlink()


def append_live_metric(
    run_id: str,
    mode: str,
    timesteps: int,
    elapsed_sec: float,
    score: float,
    avg_final_goal_range_m: float,
    *,
    successes: int = 0,
    eval_episodes: int = 0,
    scenario_names: Optional[List[str]] = None,
) -> None:
    JOB_DIR.mkdir(parents=True, exist_ok=True)
    payload: Dict[str, Any] = {"run_id": run_id, "mode": mode, "series": []}
    if LIVE_METRICS_PATH.exists():
        try:
            payload = json.loads(LIVE_METRICS_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    point: Dict[str, Any] = {
        "t_sec": round(elapsed_sec, 1),
        "timesteps": timesteps,
        "score": round(score, 4),
        "avg_final_goal_range_m": round(avg_final_goal_range_m, 2),
        "successes": successes,
        "eval_episodes": eval_episodes,
        "live": True,
    }
    if scenario_names:
        point["scenario_names"] = scenario_names
    series = payload.setdefault("series", [])
    series.append(point)
    if len(series) > LIVE_METRICS_MAX_POINTS:
        payload["series"] = series[-LIVE_METRICS_MAX_POINTS:]
    LIVE_METRICS_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    update_job_status(
        live_score=round(score, 4),
        live_avg_goal_range_m=round(avg_final_goal_range_m, 2),
        live_timesteps=timesteps,
        live_elapsed_sec=round(elapsed_sec, 1),
        live_successes=successes,
        live_eval_episodes=eval_episodes,
    )


def update_job_status(**fields: Any) -> None:
    JOB_DIR.mkdir(parents=True, exist_ok=True)
    current: Dict[str, Any] = {"running": True, "state": "running"}
    if STATUS_PATH.exists():
        try:
            current.update(json.loads(STATUS_PATH.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            pass
    current.update(fields)
    STATUS_PATH.write_text(json.dumps(current, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Boat nav RL training")
    parser.add_argument("--mode", choices=("navigate", "avoid", "all"), default=None)
    parser.add_argument("--budget", type=int, default=None, help="Training budget seconds")
    parser.add_argument("--n-envs", type=int, default=None)
    parser.add_argument("--resume", type=str, default=None, help="Run id to continue from")
    parser.add_argument("--notes", type=str, default=None)
    parser.add_argument(
        "--device",
        choices=("auto", "cuda", "cpu"),
        default=None,
        help="PyTorch device for policy training (env sim stays on CPU)",
    )
    parser.add_argument(
        "--dynamics-jitter",
        action="store_true",
        default=None,
        help="Randomize plant params each training episode (agile↔freighter)",
    )
    parser.add_argument("--no-dynamics-jitter", action="store_true", default=None)
    parser.add_argument(
        "--robust-eval",
        action="store_true",
        default=None,
        help="Run extra perturbed-plant eval pass after training",
    )
    parser.add_argument("--run-config", type=str, default=None, help="JSON run config from UI")
    return parser.parse_args()


def load_run_config(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def apply_run_config(cfg: Dict[str, Any]) -> None:
    global DYNAMICS_JITTER, ROBUST_EVAL_ENABLED, NOMINAL_PLANT, GOAL_HOLD_SEC, CURRENT_ENABLED
    global MONTAGE_ENABLED, MONTAGE_MAX_EPISODES, MONTAGE_STEP_COLS
    if "dynamics_jitter" in cfg:
        DYNAMICS_JITTER = bool(cfg["dynamics_jitter"])
    elif cfg.get("phase") in ("jitter", "robust"):
        DYNAMICS_JITTER = True
    if "robust_eval_enabled" in cfg:
        ROBUST_EVAL_ENABLED = bool(cfg["robust_eval_enabled"])
    elif cfg.get("phase") == "robust":
        ROBUST_EVAL_ENABLED = True
    if cfg.get("plant"):
        NOMINAL_PLANT = P.plant_from_dict(cfg["plant"])
    if "goal_hold_sec" in cfg:
        GOAL_HOLD_SEC = max(0, int(cfg["goal_hold_sec"]))
    if "current_enabled" in cfg:
        CURRENT_ENABLED = bool(cfg["current_enabled"])
    if "montage_enabled" in cfg:
        MONTAGE_ENABLED = bool(cfg["montage_enabled"])
    if "montage_max_episodes" in cfg:
        MONTAGE_MAX_EPISODES = max(1, int(cfg["montage_max_episodes"]))
    if "montage_step_cols" in cfg:
        MONTAGE_STEP_COLS = max(2, int(cfg["montage_step_cols"]))


def apply_args(args: argparse.Namespace) -> Optional[str]:
    global MODE, TRAIN_BUDGET_SEC, N_ENVS, NOTES, DEVICE, DYNAMICS_JITTER, ROBUST_EVAL_ENABLED, NOMINAL_PLANT
    global GOAL_HOLD_SEC, CURRENT_ENABLED, MONTAGE_ENABLED
    resume_id = args.resume
    if args.run_config:
        apply_run_config(load_run_config(Path(args.run_config)))
    if args.mode is not None:
        MODE = args.mode
    if args.budget is not None:
        TRAIN_BUDGET_SEC = args.budget
    if args.n_envs is not None:
        N_ENVS = args.n_envs
    if args.notes is not None:
        NOTES = args.notes
    if args.device is not None:
        DEVICE = args.device
    if args.no_dynamics_jitter:
        DYNAMICS_JITTER = False
    elif args.dynamics_jitter:
        DYNAMICS_JITTER = True
    if getattr(args, "robust_eval", None):
        ROBUST_EVAL_ENABLED = True
    return resume_id


class BoatNavEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(
        self,
        mode: str = "navigate",
        scenario: Optional[P.ScenarioSeed] = None,
        training_randomize: bool = True,
        train_seeds: Optional[List[P.ScenarioSeed]] = None,
        nominal_plant: Optional[P.PlantParams] = None,
        dynamics_jitter: bool = False,
        goal_hold_sec: int = P.DEFAULT_GOAL_HOLD_SEC,
        current_enabled: bool = True,
        continuous: bool = False,
        contact_obs_noise_m: float = 0.0,
        contact_obs_noise_bearing_rad: float = 0.0,
        own_radius_m: float = P.OWN_RADIUS_M,
    ) -> None:
        super().__init__()
        self.mode = mode
        self.scenario = scenario
        self.training_randomize = training_randomize
        self.continuous = continuous
        self.train_seeds = train_seeds or []
        self.nominal_plant = nominal_plant or P.plant_from_dict(P.PLANT_NOMINAL)
        self.dynamics_jitter = dynamics_jitter
        self.goal_hold_sec = max(0, int(goal_hold_sec))
        self.goal_hold_steps_required = self.goal_hold_sec if self.goal_hold_sec > 0 else 1
        self.current_enabled = current_enabled
        self.contact_obs_noise_m = max(0.0, float(contact_obs_noise_m))
        self.contact_obs_noise_bearing_rad = max(0.0, float(contact_obs_noise_bearing_rad))
        self.own_radius_m = float(own_radius_m)
        self.episode_plant = self.nominal_plant
        self.water_current = P.WaterCurrent()
        self.goal_hold_steps = 0
        self.max_steps = P.MAX_STEPS + self.goal_hold_sec

        self.plant = self.nominal_plant.to_plant()
        self.own = P.VesselState()
        self.contacts: List[P.ContactState] = []
        self.goal_x = 0.0
        self.goal_y = 0.0
        self.origin_x = 0.0
        self.origin_y = 0.0
        self.step_count = 0
        self.initial_goal_range = 0.0
        self.prev_goal_range = 0.0
        self.prev_action = np.zeros(2, dtype=np.float32)
        self.rng = np.random.default_rng(0)
        self._obs = np.zeros(P.OBS_DIM, dtype=np.float32)

        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(P.OBS_DIM,), dtype=np.float32
        )
        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(2,), dtype=np.float32)

    def _obs_noise_kwargs(self) -> Dict[str, Any]:
        return {
            "contact_noise_m": self.contact_obs_noise_m,
            "contact_noise_bearing_rad": self.contact_obs_noise_bearing_rad,
            "rng": self.rng,
        }

    def _train_max_contacts(self) -> int:
        return max(1, min(TRAIN_MAX_CONTACTS, P.N_MAX_CONTACTS))

    def _spawn_random_contact(self) -> P.ContactState:
        brg_deg = float(self.rng.uniform(-90, 90))
        rng_m = float(self.rng.uniform(350, 900))
        cog_deg = float(self.rng.uniform(0, 360))
        sog = float(self.rng.uniform(0.0, 5.5))
        vessel_class = _VESSEL_CLASS_CHOICES[
            int(self.rng.integers(len(_VESSEL_CLASS_CHOICES)))
        ]
        cdict = P.contact_from_polar(
            self.own.x_m,
            self.own.y_m,
            brg_deg,
            rng_m,
            cog_deg,
            sog,
            vessel_class=vessel_class,
        )
        return P.ContactState(
            x_m=cdict["x_m"],
            y_m=cdict["y_m"],
            cog_rad=math.radians(cdict["cog_deg"]),
            sog_mps=cdict["sog_mps"],
            speed_mps=cdict["speed_mps"],
            radius_m=cdict["radius_m"],
            vessel_class=vessel_class,
        )

    def _apply_train_contact_count(self) -> None:
        """Randomize active contacts to Uniform{1..TRAIN_MAX_CONTACTS} when training traffic."""
        if not self.training_randomize or self.mode not in ("avoid", "all"):
            return
        max_n = self._train_max_contacts()
        target_n = int(self.rng.integers(1, max_n + 1))
        if len(self.contacts) > target_n:
            pick = self.rng.choice(len(self.contacts), size=target_n, replace=False)
            self.contacts = [self.contacts[int(i)] for i in sorted(pick)]
        while len(self.contacts) < target_n:
            self.contacts.append(self._spawn_random_contact())

    def _sample_training_scenario(self) -> None:
        if self.train_seeds:
            scenario = self.train_seeds[int(self.rng.integers(len(self.train_seeds)))]
            self._load_scenario(scenario)
            return

        self.own = P.VesselState()
        self.own.heading_rad = math.radians(float(self.rng.uniform(-45, 45)))
        self.own.speed_mps = float(self.rng.uniform(2.5, 5.5))
        self.own.cmd_heading_rad = self.own.heading_rad
        self.own.cmd_speed_mps = self.own.speed_mps

        self.origin_x = self.own.x_m
        self.origin_y = self.own.y_m

        angle = float(self.rng.uniform(-math.pi / 3, math.pi / 3))
        dist = float(self.rng.uniform(500, 1200))
        self.goal_x = self.own.x_m + dist * math.sin(angle)
        self.goal_y = self.own.y_m + dist * math.cos(angle)

        self.contacts = []
        if self.mode in ("avoid", "all") and not self.train_seeds:
            n = int(self.rng.integers(1, self._train_max_contacts() + 1))
            for _ in range(n):
                self.contacts.append(self._spawn_random_contact())

    def _load_scenario(self, scenario: P.ScenarioSeed) -> None:
        self.own = P.VesselState(
            x_m=scenario.own_x_m,
            y_m=scenario.own_y_m,
            heading_rad=math.radians(scenario.own_heading_deg),
            speed_mps=scenario.own_speed_mps,
            cmd_heading_rad=math.radians(scenario.own_heading_deg),
            cmd_speed_mps=scenario.own_speed_mps,
        )
        self.origin_x = self.own.x_m
        self.origin_y = self.own.y_m
        self.goal_x = scenario.goal_x_m
        self.goal_y = scenario.goal_y_m
        self.contacts = P.scenario_to_contacts(scenario)
        self._apply_train_contact_count()

    def _assign_episode_plant(self) -> None:
        if self.dynamics_jitter:
            self.episode_plant = P.sample_plant_params(self.rng)
        else:
            self.episode_plant = self.nominal_plant
        self.plant = self.episode_plant.to_plant()

    def _assign_episode_current(self) -> None:
        if self.current_enabled:
            self.water_current = P.sample_water_current(self.rng)
        else:
            self.water_current = P.WaterCurrent()

    def reset(
        self, *, seed: Optional[int] = None, options: Optional[dict] = None
    ) -> Tuple[np.ndarray, dict]:
        super().reset(seed=seed)
        if seed is not None:
            self.rng = np.random.default_rng(seed)

        self._assign_episode_plant()
        self._assign_episode_current()

        scenario = None
        if options and "scenario" in options:
            scenario = options["scenario"]
        elif self.scenario is not None:
            scenario = self.scenario

        if scenario is not None:
            self._load_scenario(scenario)
        elif self.training_randomize:
            self._sample_training_scenario()
        else:
            self._sample_training_scenario()

        self.step_count = 0
        self.goal_hold_steps = 0
        self.initial_goal_range = P.goal_range(self.own, self.goal_x, self.goal_y)
        self.prev_goal_range = self.initial_goal_range
        self.prev_action = np.zeros(2, dtype=np.float32)

        obs = P.pack_observation(
            self.own,
            self.goal_x,
            self.goal_y,
            has_goal=True,
            contacts=self.contacts,
            origin_x=self.origin_x,
            origin_y=self.origin_y,
            current=self.water_current,
            out=self._obs,
            **self._obs_noise_kwargs(),
        )
        info = {
            "plant": self.episode_plant.to_dict(),
            "current": self.water_current.to_dict(),
        }
        return obs, info

    def step(self, action: np.ndarray, *, advance_contacts: bool = True) -> Tuple[np.ndarray, float, bool, bool, dict]:
        cmd_h, cmd_v = P.action_to_command(action)
        self.plant.apply_command(self.own, cmd_h, cmd_v)
        self.plant.step(self.own, P.DT_S)
        P.apply_water_current(self.own, self.water_current, P.DT_S)

        if advance_contacts:
            for c in self.contacts:
                c.step(P.DT_S)

        self.step_count += 1
        curr_goal_range = P.goal_range(self.own, self.goal_x, self.goal_y)
        min_rng = float("inf")
        min_cpa = float("inf")
        collision = False
        if self.contacts:
            min_rng = P.min_contact_range(self.own, self.contacts)
            collision = P.check_collision(self.own, self.contacts, self.own_radius_m)
            own_vx, own_vy = P.own_velocity(self.own, self.water_current)
            for c in self.contacts:
                c_vx, c_vy = P.contact_velocity(c)
                cpa_m, tcpa = P.compute_cpa_tcpa(
                    self.own.x_m,
                    self.own.y_m,
                    own_vx,
                    own_vy,
                    c.x_m,
                    c.y_m,
                    c_vx,
                    c_vy,
                )
                min_cpa = min(min_cpa, cpa_m)
        in_goal_zone = curr_goal_range < P.GOAL_SUCCESS_RANGE_M
        cpa_penalty, threat = contact_threat_and_cpa_penalty(
            self.own, self.contacts, self.water_current, self.own_radius_m
        )

        reward = 0.0
        if not in_goal_zone:
            reward -= W_TIME

        progress_scale = 1.0 + min(
            curr_goal_range / max(self.initial_goal_range, 1.0), 1.0
        )
        retreat_m = max(0.0, curr_goal_range - self.prev_goal_range)
        approach_m = max(0.0, self.prev_goal_range - curr_goal_range)
        if in_goal_zone and threat >= THREAT_PROGRESS_THRESH:
            # Threat at waypoint: reward opening range, do not punish leaving to avoid
            reward += W_GOAL_PROGRESS * retreat_m * progress_scale / 100.0
            reward += W_ESCAPE_GOAL * threat * retreat_m / 100.0
        else:
            progress = approach_m - retreat_m
            reward += W_GOAL_PROGRESS * progress * progress_scale / 100.0

        if in_goal_zone:
            hold_scale = max(0.0, 1.0 - HOLD_THREAT_DAMP * threat)
            if self.goal_hold_steps == 0:
                reward += W_GOAL_REACHED * hold_scale
                if self.max_steps > 0:
                    reward += W_GOAL_EARLY * hold_scale * max(
                        0.0, 1.0 - self.step_count / self.max_steps
                    )
            self.goal_hold_steps += 1
            reward += W_GOAL_HOLD * hold_scale
            speed_norm = (self.own.speed_mps - P.V_MIN_MPS) / max(
                P.V_MAX_MPS - P.V_MIN_MPS, 1e-6
            )
            reward += W_HOLD_STATION * hold_scale * max(0.0, 1.0 - speed_norm)
            reward -= W_HOLD_CENTER * hold_scale * (
                curr_goal_range / P.GOAL_SUCCESS_RANGE_M
            )
            if threat >= THREAT_PROGRESS_THRESH:
                reward -= W_GOAL_THREAT_STAY * threat
        else:
            self.goal_hold_steps = 0
            cruise = P.V_MAX_MPS * CRUISE_SPEED_FRAC
            reward -= W_SPEED_TRACK * abs(self.own.speed_mps - cruise) / P.V_MAX_MPS

        action_delta = float(np.linalg.norm(action - self.prev_action))
        reward -= W_SMOOTH * action_delta
        self.prev_action[:] = action

        reward -= cpa_penalty
        if collision:
            reward -= W_COLLISION

        reward = float(np.clip(reward, -REWARD_CLIP, REWARD_CLIP))
        if not math.isfinite(reward):
            reward = 0.0

        self.prev_goal_range = curr_goal_range

        hold_complete = self.goal_hold_steps >= self.goal_hold_steps_required
        if self.continuous:
            terminated = False
            truncated = False
        else:
            terminated = collision or hold_complete
            truncated = self.step_count >= self.max_steps
        success = hold_complete and not collision

        obs = P.pack_observation(
            self.own,
            self.goal_x,
            self.goal_y,
            has_goal=True,
            contacts=self.contacts,
            origin_x=self.origin_x,
            origin_y=self.origin_y,
            current=self.water_current,
            out=self._obs,
            **self._obs_noise_kwargs(),
        )
        info = {
            "goal_range_m": curr_goal_range,
            "min_range_m": min_rng,
            "min_cpa_m": min_cpa if self.contacts else None,
            "collision": collision,
            "success": success,
            "goal_hold_steps": self.goal_hold_steps,
            "goal_hold_required": self.goal_hold_steps_required,
            "in_goal_zone": in_goal_zone,
        }
        return obs, reward, terminated, truncated, info

    def rollout_episode(
        self,
        model: PPO,
        *,
        max_steps: Optional[int] = None,
        reset_seed: Optional[int] = None,
        scenario: Optional[P.ScenarioSeed] = None,
        collect_trace: bool = True,
    ) -> Dict[str, Any]:
        if max_steps is None:
            max_steps = self.max_steps
        seed = reset_seed
        if seed is None and scenario is not None:
            seed = scenario.seed
        elif seed is None and self.scenario is not None:
            seed = self.scenario.seed

        reset_options = {"scenario": scenario} if scenario is not None else None
        obs, _ = self.reset(seed=seed, options=reset_options)

        steps: List[Dict[str, Any]] = []
        if collect_trace:
            steps.append(
                P.snapshot_step(0, self.own, self.goal_x, self.goal_y, self.contacts)
            )

        collision = False
        success = False
        final_goal_range_m = P.goal_range(self.own, self.goal_x, self.goal_y)

        for _t in range(1, max_steps + 1):
            action, _ = safe_model_predict(model, obs, deterministic=True)
            obs, _, terminated, truncated, info = self.step(action)
            final_goal_range_m = info["goal_range_m"]
            if collect_trace:
                steps.append(
                    P.snapshot_step(
                        self.step_count, self.own, self.goal_x, self.goal_y, self.contacts
                    )
                )
            collision = collision or info["collision"]
            success = info["success"]
            if terminated or truncated:
                break

        scenario_ref = scenario or self.scenario
        result: Dict[str, Any] = {
            "collision": collision,
            "success": success,
            "final_goal_range_m": final_goal_range_m,
            "scenario_name": scenario_ref.name if scenario_ref else "random",
            "scenario_category": scenario_ref.category if scenario_ref else "random",
            "scenario_description": scenario_ref.description if scenario_ref else "",
            "scenario_seed": scenario_ref.seed if scenario_ref else None,
            "plant": self.episode_plant.to_dict(),
            "current": self.water_current.to_dict(),
        }
        if collect_trace:
            result["steps"] = steps
        return result

    def rollout_trace(
        self,
        model: PPO,
        max_steps: Optional[int] = None,
        reset_seed: Optional[int] = None,
    ) -> Dict[str, Any]:
        return self.rollout_episode(
            model,
            max_steps=max_steps,
            reset_seed=reset_seed,
            collect_trace=True,
        )


class TimeBudgetCallback(BaseCallback):
    def __init__(self, budget_sec: float, verbose: int = 0):
        super().__init__(verbose)
        self.budget_sec = budget_sec
        self.start_time = 0.0
        self.cancelled = False

    def _on_training_start(self) -> None:
        self.start_time = time.time()

    def _on_step(self) -> bool:
        if is_cancel_requested():
            self.cancelled = True
            return False
        return (time.time() - self.start_time) < self.budget_sec


class LiveMetricsCallback(BaseCallback):
    """Periodic mini-eval on a random eval-set subset (same thread as training — no overlap)."""

    def __init__(
        self,
        model_holder: Dict[str, Any],
        mode: str,
        run_id: str,
        interval_sec: float = LIVE_EVAL_INTERVAL_SEC,
        max_scenarios: int = LIVE_EVAL_SCENARIOS,
    ) -> None:
        super().__init__()
        self.model_holder = model_holder
        self.mode = mode
        self.run_id = run_id
        self.interval_sec = interval_sec
        self.max_scenarios = max_scenarios
        self.start_time = 0.0
        self.last_eval_time = 0.0
        self.eval_tick = 0

    def _on_training_start(self) -> None:
        self.start_time = time.time()
        self.last_eval_time = self.start_time

    def _on_step(self) -> bool:
        if is_cancel_requested():
            return False
        now = time.time()
        if now - self.last_eval_time < self.interval_sec:
            return True
        self.last_eval_time = now
        self.eval_tick += 1
        model = self.model_holder.get("model")
        if model is None:
            return True
        try:
            metrics = run_eval(
                model,
                self.mode,
                max_scenarios=self.max_scenarios,
                sample_seed=self.num_timesteps + self.eval_tick * 10007,
                collect_traces=False,
            )
            score = metrics[score_key_for_mode(self.mode)]
            append_live_metric(
                self.run_id,
                self.mode,
                self.num_timesteps,
                now - self.start_time,
                score,
                metrics.get("avg_final_goal_range_m") or 0.0,
                successes=int(round(metrics.get("success_rate", 0) * metrics.get("eval_episodes", 0))),
                eval_episodes=metrics.get("eval_episodes", 0),
                scenario_names=metrics.get("scenario_names"),
            )
        except Exception as exc:
            print(f"[live-eval] skipped: {exc}")
        return True


def train_seeds_for_mode(mode: str) -> List[P.ScenarioSeed]:
    if mode in _TRAIN_SEEDS_CACHE:
        return _TRAIN_SEEDS_CACHE[mode]
    seeds = filter_seeds_for_mode(P.load_train_seeds(), mode)
    if not seeds:
        raise RuntimeError(f"No train seeds for mode={mode}. Run prepare.py first.")
    _TRAIN_SEEDS_CACHE[mode] = seeds
    return seeds


def make_env(
    mode: str,
    seed_offset: int = 0,
    train_seeds: Optional[List[P.ScenarioSeed]] = None,
    nominal_plant: Optional[P.PlantParams] = None,
    dynamics_jitter: bool = False,
    goal_hold_sec: int = P.DEFAULT_GOAL_HOLD_SEC,
    current_enabled: bool = True,
    contact_obs_noise_m: float = 0.0,
    contact_obs_noise_bearing_rad: float = 0.0,
):
    seeds = train_seeds if train_seeds is not None else train_seeds_for_mode(mode)
    plant = nominal_plant or NOMINAL_PLANT

    def _init():
        env = BoatNavEnv(
            mode=mode,
            training_randomize=True,
            train_seeds=seeds,
            nominal_plant=plant,
            dynamics_jitter=dynamics_jitter,
            goal_hold_sec=goal_hold_sec,
            current_enabled=current_enabled,
            contact_obs_noise_m=contact_obs_noise_m,
            contact_obs_noise_bearing_rad=contact_obs_noise_bearing_rad,
        )
        env.reset(seed=seed_offset)
        return env

    return _init


def create_run_dir() -> Path:
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    latest = RUNS_DIR / "latest"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    try:
        latest.symlink_to(run_dir.name, target_is_directory=True)
    except OSError:
        (RUNS_DIR / "latest.txt").write_text(run_dir.name, encoding="utf-8")
    return run_dir


def eval_seeds_for_mode(mode: str) -> List[P.ScenarioSeed]:
    if mode in _EVAL_SEEDS_CACHE:
        return _EVAL_SEEDS_CACHE[mode]
    seeds = filter_seeds_for_mode(P.load_eval_seeds(), mode)
    if not seeds:
        raise RuntimeError(f"No eval seeds for mode={mode}. Run prepare.py first.")
    _EVAL_SEEDS_CACHE[mode] = seeds
    return seeds


def make_vec_env(factories: List[Any], n_envs: int):
    if n_envs <= 1:
        return DummyVecEnv(factories)
    start_method = "spawn" if sys.platform == "win32" else "fork"
    return SubprocVecEnv(factories, start_method=start_method)


def run_eval(
    model: PPO,
    mode: str,
    max_scenarios: Optional[int] = None,
    sample_seed: Optional[int] = None,
    eval_plant: Optional[P.PlantParams] = None,
    dynamics_jitter: Optional[bool] = None,
    current_enabled: Optional[bool] = None,
    collect_traces: bool = True,
) -> Any:
    seeds = eval_seeds_for_mode(mode)
    if max_scenarios is not None and max_scenarios < len(seeds):
        rng = np.random.default_rng(sample_seed if sample_seed is not None else 0)
        picks = rng.choice(len(seeds), size=max_scenarios, replace=False)
        seeds = [seeds[i] for i in sorted(int(x) for x in picks)]
    cur_enabled = CURRENT_ENABLED if current_enabled is None else current_enabled
    if eval_plant is not None:
        plant_jitter = False
        nominal_plant = eval_plant
    else:
        nominal_plant = NOMINAL_PLANT
        plant_jitter = True  # eval always samples agile↔freighter per scenario
    if dynamics_jitter is not None:
        plant_jitter = dynamics_jitter
    traces: List[Dict[str, Any]] = []
    colregs_episode_scores: List[Dict[str, Any]] = []
    successes = 0
    collisions = 0
    final_ranges: List[float] = []

    env = BoatNavEnv(
        mode=mode,
        training_randomize=False,
        nominal_plant=nominal_plant,
        dynamics_jitter=plant_jitter,
        goal_hold_sec=GOAL_HOLD_SEC,
        current_enabled=cur_enabled,
    )

    for scenario in seeds:
        episode = env.rollout_episode(
            model,
            reset_seed=scenario.seed,
            scenario=scenario,
            collect_trace=collect_traces,
        )
        episode["seed"] = scenario.seed
        episode["mode"] = mode
        episode["scenario_name"] = scenario.name
        episode["scenario_category"] = scenario.category
        episode["scenario_description"] = scenario.description
        if collect_traces:
            traces.append(episode)
            if episode.get("steps"):
                colregs = evaluate_episode(episode)
                episode["colregs"] = colregs
                if colregs.get("mean_safety_S") is not None:
                    colregs_episode_scores.append(colregs)
        if episode["success"]:
            successes += 1
        if episode["collision"]:
            collisions += 1
        rng_val = episode.get("final_goal_range_m")
        if rng_val is not None:
            final_ranges.append(float(rng_val))

    episodes = len(seeds)
    success_rate = successes / episodes if episodes else 0.0
    collision_rate = collisions / episodes if episodes else 0.0
    nav_score = success_rate
    avoid_score = success_rate * (1.0 - collision_rate)
    final_ranges_arr = final_ranges
    avg_final_goal_range_m = float(np.mean(final_ranges_arr)) if final_ranges_arr else None
    median_final_goal_range_m = float(np.median(final_ranges_arr)) if final_ranges_arr else None

    eval_seed_list = eval_seeds_for_mode(mode)
    metrics = {
        "mode": mode,
        "eval_episodes": episodes,
        "eval_scenarios": episodes,
        "success_rate": round(success_rate, 4),
        "collision_rate": round(collision_rate, 4),
        "nav_score": round(nav_score, 4),
        "avoid_score": round(avoid_score, 4),
        "avg_final_goal_range_m": round(avg_final_goal_range_m, 2) if avg_final_goal_range_m is not None else None,
        "median_final_goal_range_m": round(median_final_goal_range_m, 2) if median_final_goal_range_m is not None else None,
        "goal_success_threshold_m": P.GOAL_SUCCESS_RANGE_M,
        "eval_scenario_count": len(eval_seed_list),
        "train_scenario_count": len(train_seeds_for_mode(mode)),
        "scenario_names": [s.name for s in seeds],
        "eval_dynamics_jitter": plant_jitter,
        "eval_current_enabled": cur_enabled,
        "eval_nominal_plant": nominal_plant.to_dict(),
        "eval_plant": nominal_plant.to_dict(),  # legacy field
    }
    if colregs_episode_scores:
        metrics.update(rollup_episodes(colregs_episode_scores))
    if collect_traces:
        return metrics, traces
    return metrics


def run_robust_eval(model: PPO, mode: str) -> Dict[str, Any]:
    """Sample random plants (agile↔freighter) and score on eval scenario subsets."""
    score_key = score_key_for_mode(mode)
    scores: List[float] = []
    plant_records: List[Dict[str, float]] = []
    for i in range(ROBUST_EVAL_SAMPLES):
        rng = np.random.default_rng(9001 + i)
        plant = P.sample_plant_params(rng)
        metrics = run_eval(
            model,
            mode,
            max_scenarios=ROBUST_EVAL_SCENARIOS,
            sample_seed=8000 + i,
            eval_plant=plant,
            collect_traces=False,
        )
        scores.append(float(metrics[score_key]))
        plant_records.append(plant.to_dict())
    arr = np.array(scores, dtype=np.float64)
    return {
        "robust_eval_score": round(float(arr.mean()), 4),
        "robust_eval_worst": round(float(arr.min()), 4),
        "robust_eval_samples": ROBUST_EVAL_SAMPLES,
        "robust_eval_scenarios_per_sample": ROBUST_EVAL_SCENARIOS,
        "robust_eval_plants": plant_records,
    }


def write_run_outputs(
    run_dir: Path,
    metrics: Dict[str, Any],
    traces: List[Dict[str, Any]],
    train_metrics: Dict[str, Any],
    model: PPO,
    resume_run_id: Optional[str] = None,
    parent_metrics: Optional[Dict[str, Any]] = None,
) -> None:
    parent_metrics = parent_metrics or {}
    train_session = int(parent_metrics.get("train_session", 1)) + 1 if resume_run_id else 1
    prev_cumulative = float(parent_metrics.get("cumulative_train_sec", 0) or 0)
    elapsed = float(train_metrics.get("train_elapsed_sec", 0) or 0)

    payload = {
        **metrics,
        **train_metrics,
        "notes": NOTES,
        "parent_run_id": resume_run_id,
        "train_session": train_session,
        "cumulative_train_sec": round(prev_cumulative + elapsed, 1),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "mode": MODE,
            "net_arch": NET_ARCH,
            "learning_rate": LEARNING_RATE,
            "n_envs": N_ENVS,
            "device": train_metrics.get("device"),
            "dynamics_jitter": train_metrics.get("dynamics_jitter"),
            "robust_eval_enabled": train_metrics.get("robust_eval_enabled"),
            "nominal_plant": train_metrics.get("nominal_plant"),
            "goal_hold_sec": train_metrics.get("goal_hold_sec"),
            "current_enabled": train_metrics.get("current_enabled"),
            "montage_enabled": MONTAGE_ENABLED,
            "train_max_contacts": TRAIN_MAX_CONTACTS,
            "reward_weights": {
                "goal_progress": W_GOAL_PROGRESS,
                "goal_reached": W_GOAL_REACHED,
                "goal_early": W_GOAL_EARLY,
                "time_en_route": W_TIME,
                "hold_station": W_HOLD_STATION,
                "hold_center": W_HOLD_CENTER,
                "cpa": W_CPA,
                "cpa_soft": W_CPA_SOFT,
                "cpa_warning_mult": CPA_WARNING_MULT,
                "escape_goal": W_ESCAPE_GOAL,
                "goal_threat_stay": W_GOAL_THREAT_STAY,
                "hold_threat_damp": HOLD_THREAT_DAMP,
                "collision": W_COLLISION,
            },
        },
        "viz_url": f"http://localhost:{VIZ_PORT}/scenarios.html?run={run_dir.name}",
    }
    (run_dir / "metrics.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (run_dir / "eval_traces.json").write_text(
        json.dumps({"episodes": traces}, separators=(",", ":")), encoding="utf-8"
    )
    model.save(str(run_dir / "model"))

    if MONTAGE_ENABLED and traces:
        try:
            import render_montage as RM

            montage_meta = RM.write_eval_montages(
                run_dir,
                traces,
                max_episodes=MONTAGE_MAX_EPISODES,
                step_cols=MONTAGE_STEP_COLS,
            )
            payload["montage"] = montage_meta
            (run_dir / "metrics.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
            print(
                f"[montage] wrote step + trajectory PNGs in {montage_meta['montage_sec']}s "
                f"({montage_meta['step_montage']['episodes_shown']}/"
                f"{montage_meta['step_montage']['episodes_total']} episodes)"
            )
        except Exception as exc:
            print(f"[montage] skipped: {exc}")


def main() -> None:
    args = parse_args()
    resume_run_id = apply_args(args)

    if not P.EVAL_SEEDS_PATH.exists() or not P.TRAIN_SEEDS_PATH.exists():
        P.write_scenario_splits()

    parent_metrics = load_parent_metrics(resume_run_id) if resume_run_id else {}
    clear_cancel_flag()
    LIVE_METRICS_PATH.unlink(missing_ok=True)
    run_dir = create_run_dir()
    train_start = time.time()

    device = resolve_device(DEVICE)
    configure_training_backend(device)
    batch_size = max(BATCH_SIZE, 512) if device == "cuda" else BATCH_SIZE
    gpu_info = torch_device_info()

    print(f"[train] mode={MODE} budget={TRAIN_BUDGET_SEC}s n_envs={N_ENVS} run={run_dir.name}")
    print(
        f"[train] vec={'subproc' if N_ENVS > 1 else 'dummy'} "
        f"dynamics_jitter={DYNAMICS_JITTER} robust_eval={ROBUST_EVAL_ENABLED} "
        f"hold={GOAL_HOLD_SEC}s current={CURRENT_ENABLED} live_eval={LIVE_EVAL_SCENARIOS}@{LIVE_EVAL_INTERVAL_SEC}s"
    )
    print(f"[train] device={device} batch_size={batch_size}", end="")
    if device == "cuda" and gpu_info.get("cuda_device"):
        print(f" ({gpu_info['cuda_device']})", end="")
    print()
    if resume_run_id:
        print(f"[train] resuming from runs/{resume_run_id}")

    update_job_status(
        run_id=run_dir.name,
        mode=MODE,
        resume_run_id=resume_run_id,
        dynamics_jitter=DYNAMICS_JITTER,
        robust_eval_enabled=ROBUST_EVAL_ENABLED,
        nominal_plant=NOMINAL_PLANT.to_dict(),
        goal_hold_sec=GOAL_HOLD_SEC,
        current_enabled=CURRENT_ENABLED,
        montage_enabled=MONTAGE_ENABLED,
    )

    train_seeds = train_seeds_for_mode(MODE)
    factories = [
        make_env(
            MODE,
            i,
            train_seeds=train_seeds,
            nominal_plant=NOMINAL_PLANT,
            dynamics_jitter=DYNAMICS_JITTER,
            goal_hold_sec=GOAL_HOLD_SEC,
            current_enabled=CURRENT_ENABLED,
            contact_obs_noise_m=CONTACT_OBS_NOISE_M,
            contact_obs_noise_bearing_rad=CONTACT_OBS_NOISE_BEARING_RAD,
        )
        for i in range(N_ENVS)
    ]
    env = make_vec_env(factories, N_ENVS)

    model_holder: Dict[str, Any] = {}
    if resume_run_id:
        checkpoint = RUNS_DIR / resume_run_id / "model"
        model = PPO.load(str(checkpoint), env=env, device=device)
        print(f"[train] loaded checkpoint {checkpoint}")
    else:
        model = PPO(
            "MlpPolicy",
            env,
            learning_rate=LEARNING_RATE,
            n_steps=N_STEPS // max(N_ENVS, 1),
            batch_size=batch_size,
            gamma=GAMMA,
            max_grad_norm=0.5,
            device=device,
            policy_kwargs={"net_arch": dict(pi=NET_ARCH, vf=NET_ARCH)},
            verbose=1,
        )
    model_holder["model"] = model

    budget_cb = TimeBudgetCallback(TRAIN_BUDGET_SEC)
    live_cb = LiveMetricsCallback(model_holder, MODE, run_dir.name)
    callback = CallbackList([budget_cb, live_cb])
    model.learn(total_timesteps=int(1e9), callback=callback, progress_bar=True)
    env.close()

    elapsed = time.time() - train_start
    cancelled = is_cancel_requested() or budget_cb.cancelled
    if cancelled:
        print("[train] paused/cancelled by user")

    eval_limit = EVAL_EPISODES if EVAL_EPISODES > 0 else None
    eval_metrics, traces = run_eval(model, MODE, max_scenarios=eval_limit, collect_traces=True)
    if ROBUST_EVAL_ENABLED:
        eval_metrics.update(run_robust_eval(model, MODE))
        print(
            f"[train] robust_eval score={eval_metrics.get('robust_eval_score')} "
            f"worst={eval_metrics.get('robust_eval_worst')}"
        )

    write_run_outputs(
        run_dir,
        eval_metrics,
        traces,
        {
            "train_budget_sec": TRAIN_BUDGET_SEC,
            "train_elapsed_sec": round(elapsed, 1),
            "cancelled": cancelled,
            "device": device,
            "batch_size": batch_size,
            "dynamics_jitter": DYNAMICS_JITTER,
            "robust_eval_enabled": ROBUST_EVAL_ENABLED,
            "nominal_plant": NOMINAL_PLANT.to_dict(),
            "goal_hold_sec": GOAL_HOLD_SEC,
            "current_enabled": CURRENT_ENABLED,
            "montage_enabled": MONTAGE_ENABLED,
        },
        model,
        resume_run_id=resume_run_id,
        parent_metrics=parent_metrics,
    )

    score_key = "nav_score" if MODE == "navigate" else "avoid_score"
    score = eval_metrics[score_key]
    avg_rng = eval_metrics.get("avg_final_goal_range_m")
    clear_cancel_flag()
    update_job_status(
        running=False,
        state="cancelled" if cancelled else "completed",
        run_id=run_dir.name,
        score=score,
        avg_final_goal_range_m=avg_rng,
    )
    print(
        f"[experiment] {score_key}={score:.3f}  avg_goal_range={avg_rng}m  "
        f"elapsed={elapsed:.0f}s  run=runs/{run_dir.name}"
    )
    print(f"[viz] Train:     http://localhost:{VIZ_PORT}/train.html")
    print(f"[viz] Overview:  http://localhost:{VIZ_PORT}/scenarios.html?run={run_dir.name}")
    print(f"[viz] Replay:    http://localhost:{VIZ_PORT}/?run={run_dir.name}")


if __name__ == "__main__":
    main()
