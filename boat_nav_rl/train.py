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
from vecenv_util import (
    make_vec_env,
    ppo_batch_size,
    recommended_n_envs,
    rollout_steps_total,
    steps_per_env,
    training_perf_defaults,
)

import prepare as P
from checkpoint_util import (
    copy_best_to_final,
    load_best_metrics,
    resolve_resume_checkpoint,
    save_best_checkpoint,
)
from async_eval import AsyncEvalRunner
from eval_parallel import (
    aggregate_eval_metrics,
    colregs_enabled_for_mode,
    rollout_episodes,
    run_eval_from_snapshot,
    snapshot_model_for_eval,
)
from curriculum import filter_seeds_by_prefix, get_phase, is_summary_better, metrics_to_summary, check_exit
from device_util import configure_training_backend, resolve_device, torch_device_info
from mission import MissionTransition, NavigationMission
from policy_infer import safe_model_predict
from rewards import (
    REWARD_CLIP,
    StepRewardInput,
    W_CPA,
    W_CPA_SOFT,
    W_GOAL_ARRIVAL,
    W_GOAL_ARRIVAL_EARLY,
    W_GOAL_PROGRESS,
    W_GOAL_THREAT_STAY,
    W_HOLD_BASE,
    W_HOLD_CENTER,
    W_HOLD_SPEED,
    W_APPROACH_SLOW,
    APPROACH_SLOW_RANGE_M,
    CPA_WARNING_MULT,
    THREAT_PROGRESS_THRESH,
    W_COLLISION,
    W_SMOOTH,
    apply_reward_overrides,
    compute_step_reward,
    contact_step_metrics,
    contact_threat_and_cpa_penalty,
    energy_score_from_speeds,
    energy_score_from_trace,
    HOLD_AT_STOP_EPS_MPS,
    reward_weights_dict,
    set_gated_hold_enabled,
    gated_hold_enabled,
)
from runs_util import score_key_for_mode

ROOT = Path(__file__).resolve().parent
RUNS_DIR = ROOT / "runs"
JOB_DIR = RUNS_DIR / "_training"
STATUS_PATH = JOB_DIR / "status.json"
CANCEL_FLAG_PATH = JOB_DIR / "cancel.flag"
LIVE_METRICS_PATH = JOB_DIR / "live_metrics.json"

# =============================================================================
# CONFIG — edit this section between experiments
# =============================================================================
MODE = P.DEFAULT_MODE  # "navigate" (clear) | "avoid" (traffic) | "all"

TRAIN_BUDGET_SEC = int(os.environ.get("TRAIN_BUDGET_SEC", "600"))
N_ENVS = int(os.environ.get("N_ENVS", str(recommended_n_envs())))
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
MAX_EPISODE_STEPS = int(os.environ.get("MAX_STEPS", str(P.MAX_STEPS)))
CURRENT_ENABLED = os.environ.get("CURRENT_ENABLED", "1") == "1"
MONTAGE_ENABLED = os.environ.get("MONTAGE_ENABLED", "0") == "1"
MONTAGE_MAX_EPISODES = int(os.environ.get("MONTAGE_MAX_EPISODES", "48"))
MONTAGE_STEP_COLS = int(os.environ.get("MONTAGE_STEP_COLS", "12"))
NOMINAL_PLANT = P.plant_from_dict(P.PLANT_NOMINAL)

NET_ARCH: List[int] = [256, 256]
LEARNING_RATE = 3e-4
BATCH_SIZE = 256
GAMMA = 0.99

# Contact sensing noise (training only — eval uses zero)
CONTACT_OBS_NOISE_M = float(os.environ.get("CONTACT_OBS_NOISE_M", str(P.CONTACT_OBS_NOISE_M)))
CONTACT_OBS_NOISE_BEARING_RAD = float(
    os.environ.get("CONTACT_OBS_NOISE_BEARING_RAD", str(P.CONTACT_OBS_NOISE_BEARING_RAD))
)
TRAIN_MAX_CONTACTS = int(os.environ.get("TRAIN_MAX_CONTACTS", "4"))

NOTES = "baseline"

VIZ_PORT = 8765

_EVAL_SEEDS_CACHE: Dict[tuple, List[P.ScenarioSeed]] = {}
_TRAIN_SEEDS_CACHE: Dict[tuple, List[P.ScenarioSeed]] = {}
CURRICULUM_PHASE: Optional[int] = None
SCENARIO_CATEGORY_PREFIXES: List[str] = []
CURRICULUM_EVAL_INTERVAL_SEC = 120.0
CURRICULUM_EVAL_MAX_SCENARIOS = 0
CURRICULUM_EARLY_STOP = False
CURRICULUM_EARLY_STOPPED = False
_VESSEL_CLASS_CHOICES = tuple(P.VESSEL_CLASSES.keys())
# =============================================================================


def _seed_cache_key(mode: str) -> tuple:
    return (mode, tuple(SCENARIO_CATEGORY_PREFIXES))


def apply_scenario_prefix_filter(seeds: List[P.ScenarioSeed]) -> List[P.ScenarioSeed]:
    return filter_seeds_by_prefix(seeds, SCENARIO_CATEGORY_PREFIXES)


def filter_seeds_for_mode(seeds: List[P.ScenarioSeed], mode: str) -> List[P.ScenarioSeed]:
    if mode == "all":
        return list(seeds)
    if mode == "avoid":
        return [s for s in seeds if s.contacts]
    return [s for s in seeds if not s.contacts]


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
    eval_metrics: Optional[Dict[str, Any]] = None,
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
    if eval_metrics:
        for key, val in eval_metrics.items():
            if val is not None:
                point[key] = val
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


def live_eval_extras(metrics: Dict[str, Any]) -> Dict[str, Any]:
    extras: Dict[str, Any] = {}
    for key in (
        "success_rate",
        "mean_speed_mps",
        "mean_goal_zone_speed_mps",
        "pct_goal_zone_at_min_speed",
    ):
        if metrics.get(key) is not None:
            extras[key] = metrics[key]
    bd = metrics.get("reward_breakdown_mean") or metrics.get("reward_breakdown")
    if bd:
        extras["reward_breakdown"] = bd
    return extras


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
    parser.add_argument(
        "--reward-config",
        type=str,
        default=None,
        help="JSON file with reward_weights overrides (merged into run-config)",
    )
    return parser.parse_args()


def load_run_config(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def apply_run_config(cfg: Dict[str, Any]) -> None:
    global DYNAMICS_JITTER, ROBUST_EVAL_ENABLED, NOMINAL_PLANT, GOAL_HOLD_SEC, MAX_EPISODE_STEPS
    global CURRENT_ENABLED, MONTAGE_ENABLED, MONTAGE_MAX_EPISODES, MONTAGE_STEP_COLS
    global CURRICULUM_PHASE, SCENARIO_CATEGORY_PREFIXES
    global CURRICULUM_EVAL_INTERVAL_SEC, CURRICULUM_EVAL_MAX_SCENARIOS, CURRICULUM_EARLY_STOP
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
    if "max_steps" in cfg:
        MAX_EPISODE_STEPS = max(1, int(cfg["max_steps"]))
    if "current_enabled" in cfg:
        CURRENT_ENABLED = bool(cfg["current_enabled"])
    if "montage_enabled" in cfg:
        MONTAGE_ENABLED = bool(cfg["montage_enabled"])
    if "montage_max_episodes" in cfg:
        MONTAGE_MAX_EPISODES = max(1, int(cfg["montage_max_episodes"]))
    if "montage_step_cols" in cfg:
        MONTAGE_STEP_COLS = max(2, int(cfg["montage_step_cols"]))
    if cfg.get("reward_weights"):
        applied = apply_reward_overrides(cfg["reward_weights"])
        if applied:
            print(f"[train] reward overrides: {applied}")
    if "curriculum_phase" in cfg:
        CURRICULUM_PHASE = int(cfg["curriculum_phase"])
    if "scenario_category_prefixes" in cfg:
        SCENARIO_CATEGORY_PREFIXES = list(cfg["scenario_category_prefixes"])
        _EVAL_SEEDS_CACHE.clear()
        _TRAIN_SEEDS_CACHE.clear()
        print(f"[train] scenario filter: {SCENARIO_CATEGORY_PREFIXES or 'all'}")
    if "gated_hold" in cfg:
        set_gated_hold_enabled(bool(cfg["gated_hold"]))
        print(f"[train] gated_hold={cfg['gated_hold']}")
    if "curriculum_eval_interval_sec" in cfg:
        CURRICULUM_EVAL_INTERVAL_SEC = float(cfg["curriculum_eval_interval_sec"])
    if "curriculum_eval_max_scenarios" in cfg:
        CURRICULUM_EVAL_MAX_SCENARIOS = int(cfg["curriculum_eval_max_scenarios"])
    if "curriculum_early_stop" in cfg:
        CURRICULUM_EARLY_STOP = bool(cfg["curriculum_early_stop"])


def apply_args(args: argparse.Namespace) -> Optional[str]:
    global MODE, TRAIN_BUDGET_SEC, N_ENVS, NOTES, DEVICE, DYNAMICS_JITTER, ROBUST_EVAL_ENABLED, NOMINAL_PLANT
    global GOAL_HOLD_SEC, MAX_EPISODE_STEPS, CURRENT_ENABLED, MONTAGE_ENABLED
    resume_id = args.resume
    run_cfg: Dict[str, Any] = {}
    if args.run_config:
        run_cfg = load_run_config(Path(args.run_config))
    if args.reward_config:
        reward_cfg = load_run_config(Path(args.reward_config))
        weights = reward_cfg.get("reward_weights", reward_cfg)
        run_cfg.setdefault("reward_weights", {}).update(weights)
    if run_cfg:
        apply_run_config(run_cfg)
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
        mode: str = P.DEFAULT_MODE,
        scenario: Optional[P.ScenarioSeed] = None,
        training_randomize: bool = True,
        train_seeds: Optional[List[P.ScenarioSeed]] = None,
        nominal_plant: Optional[P.PlantParams] = None,
        dynamics_jitter: bool = False,
        goal_hold_sec: int = P.DEFAULT_GOAL_HOLD_SEC,
        max_episode_steps: Optional[int] = None,
        current_enabled: bool = True,
        continuous: bool = False,
        contact_obs_noise_m: float = 0.0,
        contact_obs_noise_bearing_rad: float = 0.0,
        own_radius_m: float = P.OWN_RADIUS_M,
        include_reward_breakdown: bool = False,
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
        self.include_reward_breakdown = include_reward_breakdown
        self.episode_plant = self.nominal_plant
        self.water_current = P.WaterCurrent()
        self.goal_hold_steps = 0
        base_steps = max_episode_steps if max_episode_steps is not None else P.MAX_STEPS
        self.max_steps = max(1, int(base_steps)) + self.goal_hold_sec
        self.episode_cpa_unsafe_in_goal = False

        self.plant = self.nominal_plant.to_plant()
        self.own = P.VesselState()
        self.contacts: List[P.ContactState] = []
        self.goal_x = 0.0
        self.goal_y = 0.0
        self.leg_start_x = 0.0
        self.leg_start_y = 0.0
        self.origin_x = 0.0
        self.origin_y = 0.0
        self.step_count = 0
        self.initial_goal_range = 0.0
        self.prev_goal_range = 0.0
        self.prev_action = np.zeros(2, dtype=np.float32)
        self.rng = np.random.default_rng(0)
        self._obs = np.zeros(P.OBS_DIM, dtype=np.float32)
        self.mission: Optional[NavigationMission] = None
        self._base_max_episode_steps = base_steps

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

    def _apply_mission_transition(self, transition: MissionTransition) -> None:
        self.goal_x = transition.goal_x
        self.goal_y = transition.goal_y
        self.leg_start_x = transition.leg_start_x
        self.leg_start_y = transition.leg_start_y
        self.goal_hold_steps = transition.goal_hold_steps
        self.initial_goal_range = transition.initial_goal_range
        self.prev_goal_range = transition.prev_goal_range

    def _recompute_max_steps(self) -> None:
        extra = self.mission.extra_max_steps(self.goal_hold_sec) if self.mission else 0
        self.max_steps = max(1, int(self._base_max_episode_steps)) + self.goal_hold_sec + extra

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
            self.mission = NavigationMission.from_scenario(scenario, self.rng, dt_s=P.DT_S)
            gx, gy = self.mission.initial_goal()
            self.goal_x, self.goal_y = gx, gy
        else:
            self._sample_training_scenario()
            self.mission = NavigationMission.single_goal(
                self.goal_x, self.goal_y, self.rng, dt_s=P.DT_S
            )

        self._recompute_max_steps()
        self.step_count = 0
        self.goal_hold_steps = 0
        self.episode_cpa_unsafe_in_goal = False
        self.initial_goal_range = P.goal_range(self.own, self.goal_x, self.goal_y)
        self.prev_goal_range = self.initial_goal_range
        self.prev_action = np.zeros(2, dtype=np.float32)
        self.leg_start_x = self.own.x_m
        self.leg_start_y = self.own.y_m

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
        goal_changed = False
        if self.mission is not None:
            tr = self.mission.check_scheduled(
                self.step_count,
                self.own.x_m,
                self.own.y_m,
                curr_goal_range=P.goal_range(self.own, self.goal_x, self.goal_y),
                initial_goal_range=self.initial_goal_range,
                goal_range_fn=P.goal_range_xy,
            )
            if tr is not None:
                self._apply_mission_transition(tr)
                goal_changed = True

        curr_goal_range = P.goal_range(self.own, self.goal_x, self.goal_y)
        contact_metrics = contact_step_metrics(
            self.own, self.contacts, self.water_current, self.own_radius_m
        )
        in_goal_zone = curr_goal_range < P.GOAL_SUCCESS_RANGE_M

        reward_out = compute_step_reward(
            StepRewardInput(
                own=self.own,
                goal_x=self.goal_x,
                goal_y=self.goal_y,
                water_current=self.water_current,
                curr_goal_range=curr_goal_range,
                initial_goal_range=self.initial_goal_range,
                prev_goal_range=self.prev_goal_range,
                goal_hold_steps=self.goal_hold_steps,
                step_count=self.step_count,
                max_steps=self.max_steps,
                action=action,
                prev_action=self.prev_action,
                in_goal_zone=in_goal_zone,
                threat=contact_metrics.threat,
                cpa_penalty=contact_metrics.cpa_penalty,
                collision=contact_metrics.collision,
                cpa_unsafe=contact_metrics.cpa_unsafe,
                leg_start_x=self.leg_start_x,
                leg_start_y=self.leg_start_y,
            ),
            include_breakdown=self.include_reward_breakdown,
        )
        reward = reward_out.reward
        self.goal_hold_steps = reward_out.goal_hold_steps
        self.prev_action[:] = action
        self.prev_goal_range = curr_goal_range

        hold_complete = self.goal_hold_steps >= self.goal_hold_steps_required
        if not goal_changed and self.mission is not None:
            tr_hold = self.mission.check_hold_advance(
                self.own.x_m,
                self.own.y_m,
                in_goal_zone=in_goal_zone,
                goal_hold_steps=self.goal_hold_steps,
                goal_hold_steps_required=self.goal_hold_steps_required,
                goal_range_fn=P.goal_range_xy,
            )
            if tr_hold is not None:
                self._apply_mission_transition(tr_hold)
                goal_changed = True
                hold_complete = False

        if in_goal_zone and contact_metrics.cpa_unsafe:
            self.episode_cpa_unsafe_in_goal = True
        if self.continuous:
            terminated = False
            truncated = False
        else:
            final_leg = self.mission is None or self.mission.is_on_final_leg()
            terminated = contact_metrics.collision or (hold_complete and final_leg and not goal_changed)
            truncated = self.step_count >= self.max_steps
        success = (
            hold_complete
            and not contact_metrics.collision
            and not contact_metrics.cpa_unsafe
            and (self.mission is None or self.mission.is_on_final_leg())
            and not goal_changed
        )

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
        info: Dict[str, Any] = {
            "goal_range_m": curr_goal_range,
            "min_range_m": contact_metrics.min_range_m,
            "min_cpa_m": contact_metrics.min_cpa_m,
            "collision": contact_metrics.collision,
            "success": success,
            "cpa_unsafe": contact_metrics.cpa_unsafe,
            "goal_hold_steps": self.goal_hold_steps,
            "goal_hold_required": self.goal_hold_steps_required,
            "in_goal_zone": in_goal_zone,
        }
        if goal_changed:
            info["goal_changed"] = True
            info["goal_relocated"] = True
        if self.include_reward_breakdown:
            info["reward_breakdown"] = reward_out.breakdown
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
        speeds: List[float] = [float(self.own.speed_mps)]
        if collect_trace:
            steps.append(
                P.snapshot_step(0, self.own, self.goal_x, self.goal_y, self.contacts)
            )

        collision = False
        success = False
        final_goal_range_m = P.goal_range(self.own, self.goal_x, self.goal_y)
        min_goal_range_m = final_goal_range_m
        entered_goal_zone = final_goal_range_m < P.GOAL_SUCCESS_RANGE_M
        goal_zone_speeds: List[float] = []
        breakdown_sums: Dict[str, float] = {}
        breakdown_steps = 0

        for _t in range(1, max_steps + 1):
            action, _ = safe_model_predict(model, obs, deterministic=True)
            obs, _, terminated, truncated, info = self.step(action)
            if self.include_reward_breakdown and info.get("reward_breakdown"):
                for key, val in info["reward_breakdown"].items():
                    breakdown_sums[key] = breakdown_sums.get(key, 0.0) + float(val)
                breakdown_steps += 1
            final_goal_range_m = info["goal_range_m"]
            min_goal_range_m = min(min_goal_range_m, final_goal_range_m)
            if final_goal_range_m < P.GOAL_SUCCESS_RANGE_M:
                entered_goal_zone = True
            speed_mps = float(self.own.speed_mps)
            speeds.append(speed_mps)
            if final_goal_range_m < P.GOAL_SUCCESS_RANGE_M:
                goal_zone_speeds.append(speed_mps)
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
            "cpa_unsafe_in_goal": self.episode_cpa_unsafe_in_goal,
            "final_goal_range_m": final_goal_range_m,
            "min_goal_range_m": min_goal_range_m,
            "entered_goal_zone": entered_goal_zone,
            "scenario_name": scenario_ref.name if scenario_ref else "random",
            "scenario_category": scenario_ref.category if scenario_ref else "random",
            "scenario_description": scenario_ref.description if scenario_ref else "",
            "scenario_seed": scenario_ref.seed if scenario_ref else None,
            "plant": self.episode_plant.to_dict(),
            "current": self.water_current.to_dict(),
            "energy_score": energy_score_from_speeds(speeds),
            "mean_speed_mps": round(sum(speeds) / len(speeds), 3) if speeds else None,
            "mean_goal_zone_speed_mps": (
                round(sum(goal_zone_speeds) / len(goal_zone_speeds), 3) if goal_zone_speeds else None
            ),
            "pct_goal_zone_at_min_speed": (
                round(
                    sum(1 for s in goal_zone_speeds if s <= HOLD_AT_STOP_EPS_MPS) / len(goal_zone_speeds),
                    4,
                )
                if goal_zone_speeds
                else None
            ),
            "goal_zone_steps": len(goal_zone_speeds),
            "goal_zone_speeds": goal_zone_speeds,
        }
        if breakdown_steps:
            result["mean_reward_breakdown"] = {
                k: round(v / breakdown_steps, 4) for k, v in breakdown_sums.items()
            }
        if collect_trace:
            result["steps"] = steps
            result["energy_score"] = energy_score_from_trace(steps)
        return result


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
    """Periodic mini-eval on a random eval-set subset (async by default)."""

    def __init__(
        self,
        model_holder: Dict[str, Any],
        mode: str,
        run_id: str,
        interval_sec: float = LIVE_EVAL_INTERVAL_SEC,
        max_scenarios: int = LIVE_EVAL_SCENARIOS,
        run_dir: Optional[Path] = None,
    ) -> None:
        super().__init__()
        self.model_holder = model_holder
        self.mode = mode
        self.run_id = run_id
        self.run_dir = run_dir or (RUNS_DIR / run_id)
        self.interval_sec = interval_sec
        self.max_scenarios = max_scenarios
        self.start_time = 0.0
        self.last_eval_time = 0.0
        self.eval_tick = 0
        self._async = AsyncEvalRunner()

    def _on_training_start(self) -> None:
        self.start_time = time.time()
        self.last_eval_time = self.start_time

    def _publish_metrics(self, metrics: Dict[str, Any], elapsed: float) -> None:
        score = metrics[score_key_for_mode(self.mode)]
        append_live_metric(
            self.run_id,
            self.mode,
            self.num_timesteps,
            elapsed,
            score,
            metrics.get("avg_final_goal_range_m") or 0.0,
            successes=int(round(metrics.get("success_rate", 0) * metrics.get("eval_episodes", 0))),
            eval_episodes=metrics.get("eval_episodes", 0),
            scenario_names=metrics.get("scenario_names"),
            eval_metrics=live_eval_extras(metrics),
        )

    def _dispatch_eval(self) -> None:
        model = self.model_holder.get("model")
        if model is None:
            return
        self.eval_tick += 1
        sample_seed = self.num_timesteps + self.eval_tick * 10007
        if self._async.enabled:
            snap = self.run_dir / "_live_eval_snapshot"
            zip_path = snapshot_model_for_eval(model, snap)
            if not self._async.submit(
                run_eval_from_snapshot,
                str(zip_path),
                self.mode,
                self.max_scenarios,
                sample_seed,
                None,
                None,
                None,
                False,
                True,
                None,
            ):
                zip_path.unlink(missing_ok=True)
            return
        metrics = run_eval(
            model,
            self.mode,
            max_scenarios=self.max_scenarios,
            sample_seed=sample_seed,
            collect_traces=False,
        )
        self._publish_metrics(metrics, time.time() - self.start_time)

    def _on_step(self) -> bool:
        if is_cancel_requested():
            return False
        if self._async.enabled:
            try:
                metrics = self._async.poll()
                if metrics is not None:
                    self._publish_metrics(metrics, time.time() - self.start_time)
            except Exception as exc:
                print(f"[live-eval] failed: {exc}")
            if self._async.is_busy():
                return True
        now = time.time()
        if now - self.last_eval_time < self.interval_sec:
            return True
        self.last_eval_time = now
        try:
            self._dispatch_eval()
        except Exception as exc:
            print(f"[live-eval] skipped: {exc}")
        return True


class CurriculumCheckpointCallback(BaseCallback):
    """Periodic eval, save best_model, optional early stop when phase gate passes."""

    def __init__(
        self,
        model_holder: Dict[str, Any],
        run_dir: Path,
        mode: str,
        phase_id: int,
        run_id: str,
    ) -> None:
        super().__init__()
        self.model_holder = model_holder
        self.run_dir = run_dir
        self.mode = mode
        self.phase = get_phase(phase_id)
        self.run_id = run_id
        self.start_time = 0.0
        self.last_eval_time = 0.0
        self.tick = 0
        self.best_summary: Optional[Dict[str, Any]] = None
        self._async = AsyncEvalRunner()
        self._eval_was_capped = False

    def _on_training_start(self) -> None:
        self.start_time = time.time()
        self.last_eval_time = self.start_time

    def _max_scenarios_for_eval(self, *, full: bool) -> Tuple[Optional[int], bool]:
        n_seeds = len(eval_seeds_for_mode(self.mode))
        cap = CURRICULUM_EVAL_MAX_SCENARIOS
        use_cap = (not full) and cap > 0 and n_seeds > cap
        max_sc = cap if use_cap else None
        return max_sc, use_cap

    def _dispatch_eval(self, *, full: bool) -> None:
        model = self.model_holder.get("model")
        if model is None:
            return
        self.tick += 1
        max_sc, use_cap = self._max_scenarios_for_eval(full=full)
        self._eval_was_capped = use_cap
        sample_seed = self.num_timesteps + self.tick * 10007
        if self._async.enabled:
            snap = self.run_dir / "_curriculum_eval_snapshot"
            zip_path = snapshot_model_for_eval(model, snap)
            if not self._async.submit(
                run_eval_from_snapshot,
                str(zip_path),
                self.mode,
                max_sc,
                sample_seed,
                None,
                None,
                None,
                False,
                True,
                None,
            ):
                zip_path.unlink(missing_ok=True)
            return
        metrics = run_eval(
            model,
            self.mode,
            max_scenarios=max_sc,
            sample_seed=sample_seed,
            collect_traces=False,
        )
        self._handle_eval_metrics(metrics)

    def _run_eval_summary(self, *, full: bool) -> Dict[str, Any]:
        max_sc, use_cap = self._max_scenarios_for_eval(full=full)
        model = self.model_holder.get("model")
        metrics = run_eval(
            model,
            self.mode,
            max_scenarios=max_sc,
            sample_seed=self.num_timesteps + self.tick * 10007,
            collect_traces=False,
        )
        summary = metrics_to_summary(metrics)
        summary["eval_capped"] = use_cap
        return summary

    def _handle_eval_metrics(self, metrics: Dict[str, Any]) -> None:
        global CURRICULUM_EARLY_STOPPED
        elapsed = time.time() - self.start_time
        summary = metrics_to_summary(metrics)
        summary["eval_capped"] = self._eval_was_capped

        if self._eval_was_capped and is_summary_better(self.phase, summary, self.best_summary):
            if self._async.enabled:
                self._dispatch_eval(full=True)
            else:
                summary = self._run_eval_summary(full=True)
                self._apply_summary(summary, elapsed)
            return
        if self._eval_was_capped:
            return
        self._apply_summary(summary, elapsed)
        if CURRICULUM_EARLY_STOPPED:
            return

    def _apply_summary(self, summary: Dict[str, Any], elapsed: float) -> None:
        global CURRICULUM_EARLY_STOPPED
        if not is_summary_better(self.phase, summary, self.best_summary):
            return
        self._maybe_save(summary, elapsed)
        passed, reasons = check_exit(self.phase, summary)
        if passed and CURRICULUM_EARLY_STOP:
            CURRICULUM_EARLY_STOPPED = True
            print("[curriculum-eval] exit gate PASSED — early stop", flush=True)
            for line in reasons:
                print(f"  {line}", flush=True)

    def _maybe_save(self, summary: Dict[str, Any], elapsed: float) -> None:
        global CURRICULUM_EARLY_STOPPED
        model = self.model_holder.get("model")
        if model is None:
            return
        save_best_checkpoint(
            self.run_dir,
            model,
            summary,
            timesteps=self.num_timesteps,
            elapsed_sec=elapsed,
        )
        self.best_summary = dict(summary)
        sr = summary.get("success_rate")
        print(
            f"[curriculum-eval] new best success_rate={sr} "
            f"zone_entry={summary.get('zone_entry_rate')} timesteps={self.num_timesteps}",
            flush=True,
        )
        score = summary.get("score") or 0.0
        append_live_metric(
            self.run_id,
            self.mode,
            self.num_timesteps,
            elapsed,
            float(score),
            summary.get("avg_final_goal_range_m") or 0.0,
            successes=int(round(float(sr or 0) * int(summary.get("eval_episodes") or 0))),
            eval_episodes=int(summary.get("eval_episodes") or 0),
            eval_metrics=live_eval_extras(summary),
        )

    def _on_step(self) -> bool:
        global CURRICULUM_EARLY_STOPPED
        if is_cancel_requested():
            return False
        if self._async.enabled:
            try:
                metrics = self._async.poll()
                if metrics is not None:
                    self._handle_eval_metrics(metrics)
            except Exception as exc:
                print(f"[curriculum-eval] failed: {exc}", flush=True)
            if self._async.is_busy():
                return not CURRICULUM_EARLY_STOPPED
        now = time.time()
        if now - self.last_eval_time < CURRICULUM_EVAL_INTERVAL_SEC:
            return not CURRICULUM_EARLY_STOPPED
        self.last_eval_time = now
        try:
            if self._async.enabled:
                self._dispatch_eval(full=False)
            else:
                elapsed = now - self.start_time
                self.tick += 1
                summary = self._run_eval_summary(full=False)
                if summary.get("eval_capped") and is_summary_better(
                    self.phase, summary, self.best_summary
                ):
                    summary = self._run_eval_summary(full=True)
                elif summary.get("eval_capped"):
                    return not CURRICULUM_EARLY_STOPPED
                if not is_summary_better(self.phase, summary, self.best_summary):
                    return not CURRICULUM_EARLY_STOPPED
                self._maybe_save(summary, elapsed)
                passed, reasons = check_exit(self.phase, summary)
                if passed and CURRICULUM_EARLY_STOP:
                    CURRICULUM_EARLY_STOPPED = True
                    print("[curriculum-eval] exit gate PASSED — early stop", flush=True)
                    for line in reasons:
                        print(f"  {line}", flush=True)
        except Exception as exc:
            print(f"[curriculum-eval] skipped: {exc}", flush=True)
        if CURRICULUM_EARLY_STOPPED:
            return False
        return True


def train_seeds_for_mode(mode: str) -> List[P.ScenarioSeed]:
    key = _seed_cache_key(mode)
    if key in _TRAIN_SEEDS_CACHE:
        return _TRAIN_SEEDS_CACHE[key]
    seeds = filter_seeds_for_mode(P.load_train_seeds(), mode)
    seeds = apply_scenario_prefix_filter(seeds)
    if not seeds:
        raise RuntimeError(
            f"No train seeds for mode={mode} filter={SCENARIO_CATEGORY_PREFIXES}. Run prepare.py first."
        )
    _TRAIN_SEEDS_CACHE[key] = seeds
    return seeds


def make_env(
    mode: str,
    seed_offset: int = 0,
    train_seeds: Optional[List[P.ScenarioSeed]] = None,
    nominal_plant: Optional[P.PlantParams] = None,
    dynamics_jitter: bool = False,
    goal_hold_sec: int = P.DEFAULT_GOAL_HOLD_SEC,
    max_episode_steps: Optional[int] = None,
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
            max_episode_steps=max_episode_steps,
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
    key = _seed_cache_key(mode)
    if key in _EVAL_SEEDS_CACHE:
        return _EVAL_SEEDS_CACHE[key]
    seeds = filter_seeds_for_mode(P.load_eval_seeds(), mode)
    seeds = apply_scenario_prefix_filter(seeds)
    if not seeds:
        raise RuntimeError(
            f"No eval seeds for mode={mode} filter={SCENARIO_CATEGORY_PREFIXES}. Run prepare.py first."
        )
    _EVAL_SEEDS_CACHE[key] = seeds
    return seeds


def run_eval(
    model: PPO,
    mode: str,
    max_scenarios: Optional[int] = None,
    sample_seed: Optional[int] = None,
    eval_plant: Optional[P.PlantParams] = None,
    dynamics_jitter: Optional[bool] = None,
    current_enabled: Optional[bool] = None,
    collect_traces: bool = True,
    collect_breakdown: bool = True,
    workers: Optional[int] = None,
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
        plant_jitter = True
    if dynamics_jitter is not None:
        plant_jitter = dynamics_jitter

    episode_results = rollout_episodes(
        model,
        seeds,
        mode=mode,
        goal_hold_sec=GOAL_HOLD_SEC,
        max_episode_steps=MAX_EPISODE_STEPS,
        current_enabled=cur_enabled,
        plant_jitter=plant_jitter,
        nominal_plant=nominal_plant,
        collect_trace=collect_traces,
        collect_breakdown=collect_breakdown,
        workers=workers,
    )
    return aggregate_eval_metrics(
        episode_results,
        seeds,
        mode,
        eval_seed_list_count=len(eval_seeds_for_mode(mode)),
        train_scenario_count=len(train_seeds_for_mode(mode)),
        plant_jitter=plant_jitter,
        current_enabled=cur_enabled,
        nominal_plant=nominal_plant,
        collect_traces=collect_traces,
        colregs_enabled=colregs_enabled_for_mode(mode),
    )


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
            "rollout_steps_total": train_metrics.get("rollout_steps_total"),
            "steps_per_env": train_metrics.get("steps_per_env"),
            "vecenv_backend": train_metrics.get("vecenv_backend"),
            "device": train_metrics.get("device"),
            "dynamics_jitter": train_metrics.get("dynamics_jitter"),
            "robust_eval_enabled": train_metrics.get("robust_eval_enabled"),
            "nominal_plant": train_metrics.get("nominal_plant"),
            "goal_hold_sec": train_metrics.get("goal_hold_sec"),
            "max_steps": train_metrics.get("max_steps"),
            "current_enabled": train_metrics.get("current_enabled"),
            "montage_enabled": MONTAGE_ENABLED,
            "train_max_contacts": TRAIN_MAX_CONTACTS,
            "reward_weights": reward_weights_dict(),
            "curriculum_phase": CURRICULUM_PHASE,
            "gated_hold": gated_hold_enabled(),
            "scenario_category_prefixes": list(SCENARIO_CATEGORY_PREFIXES),
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
    rollout_total = rollout_steps_total(N_ENVS)
    n_steps = steps_per_env(N_ENVS)
    batch_size = ppo_batch_size(device, rollout_total, base=BATCH_SIZE)
    vec_backend = training_perf_defaults()["vecenv_backend"]
    gpu_info = torch_device_info()

    print(f"[train] mode={MODE} budget={TRAIN_BUDGET_SEC}s n_envs={N_ENVS} run={run_dir.name}")
    print(
        f"[train] vec={vec_backend} rollout={rollout_total} ({n_steps} steps/env) "
        f"dynamics_jitter={DYNAMICS_JITTER} robust_eval={ROBUST_EVAL_ENABLED} "
        f"hold={GOAL_HOLD_SEC}s max_steps={MAX_EPISODE_STEPS} current={CURRENT_ENABLED} live_eval={LIVE_EVAL_SCENARIOS}@{LIVE_EVAL_INTERVAL_SEC}s"
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
            max_episode_steps=MAX_EPISODE_STEPS,
            current_enabled=CURRENT_ENABLED,
            contact_obs_noise_m=CONTACT_OBS_NOISE_M,
            contact_obs_noise_bearing_rad=CONTACT_OBS_NOISE_BEARING_RAD,
        )
        for i in range(N_ENVS)
    ]
    env = make_vec_env(factories, N_ENVS)

    model_holder: Dict[str, Any] = {}
    if resume_run_id:
        parent_dir = RUNS_DIR / resume_run_id
        checkpoint = resolve_resume_checkpoint(parent_dir, prefer_best=True)
        model = PPO.load(str(checkpoint), env=env, device=device)
        print(f"[train] loaded checkpoint {checkpoint}")
    else:
        model = PPO(
            "MlpPolicy",
            env,
            learning_rate=LEARNING_RATE,
            n_steps=n_steps,
            batch_size=batch_size,
            gamma=GAMMA,
            max_grad_norm=0.5,
            device=device,
            policy_kwargs={"net_arch": dict(pi=NET_ARCH, vf=NET_ARCH)},
            verbose=1,
        )
    model_holder["model"] = model

    budget_cb = TimeBudgetCallback(TRAIN_BUDGET_SEC)
    if CURRICULUM_PHASE is not None:
        curriculum_cb = CurriculumCheckpointCallback(
            model_holder,
            run_dir,
            MODE,
            CURRICULUM_PHASE,
            run_dir.name,
        )
        callback = CallbackList([budget_cb, curriculum_cb])
    else:
        live_cb = LiveMetricsCallback(model_holder, MODE, run_dir.name, run_dir=run_dir)
        callback = CallbackList([budget_cb, live_cb])
    model.learn(total_timesteps=int(1e9), callback=callback, progress_bar=True)
    env.close()

    elapsed = time.time() - train_start
    early_stopped = CURRICULUM_EARLY_STOPPED
    cancelled = is_cancel_requested() or budget_cb.cancelled
    if early_stopped:
        print("[train] early stopped — curriculum exit gate passed")
    elif cancelled:
        print("[train] paused/cancelled by user")

    best_meta = load_best_metrics(run_dir)
    if best_meta:
        ckpt = resolve_resume_checkpoint(run_dir, prefer_best=True)
        if ckpt.with_suffix(".zip").exists() or ckpt.exists():
            model = PPO.load(str(ckpt), device=device)
            model_holder["model"] = model
            sr = best_meta.get("summary", {}).get("success_rate")
            print(f"[train] final eval using best checkpoint (success_rate={sr})")
        copy_best_to_final(run_dir)

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
            "curriculum_early_stopped": early_stopped,
            "best_checkpoint": best_meta,
            "device": device,
            "batch_size": batch_size,
            "rollout_steps_total": rollout_total,
            "steps_per_env": n_steps,
            "vecenv_backend": vec_backend,
            "dynamics_jitter": DYNAMICS_JITTER,
            "robust_eval_enabled": ROBUST_EVAL_ENABLED,
            "nominal_plant": NOMINAL_PLANT.to_dict(),
            "goal_hold_sec": GOAL_HOLD_SEC,
            "max_steps": MAX_EPISODE_STEPS,
            "current_enabled": CURRENT_ENABLED,
            "montage_enabled": MONTAGE_ENABLED,
        },
        model,
        resume_run_id=resume_run_id,
        parent_metrics=parent_metrics,
    )

    score_key = score_key_for_mode(MODE)
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
