"""Interactive exercise sandbox — three policy-controlled vessels, click-to-set goal."""

from __future__ import annotations

import json
import math
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from stable_baselines3 import PPO

import prepare as P
from device_util import resolve_device
from policy_infer import safe_model_predict

ROOT = Path(__file__).resolve().parent
RUNS_DIR = ROOT / "runs"

WORLD_BOUNDS = {"min_x": -1200.0, "max_x": 1200.0, "min_y": -900.0, "max_y": 900.0}

# Three start positions (m) — same model, different spawn points
DEFAULT_STARTS: List[Tuple[float, float]] = [
    (-500.0, -250.0),
    (-500.0, 0.0),
    (-500.0, 250.0),
]

DEFAULT_GOAL = (400.0, 0.0)

_model_cache: Dict[str, PPO] = {}
_model_lock = threading.Lock()
_session_lock = threading.Lock()
_session: Optional["ExerciseSession"] = None


def _load_run_metrics(run_id: str) -> Dict[str, Any]:
    path = RUNS_DIR / run_id / "metrics.json"
    if not path.exists():
        raise FileNotFoundError(f"Run not found: {run_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_policy(run_id: str) -> PPO:
    with _model_lock:
        if run_id in _model_cache:
            return _model_cache[run_id]
        ckpt = RUNS_DIR / run_id / "model"
        if not (ckpt.with_suffix(".zip").exists() or ckpt.exists()):
            raise FileNotFoundError(f"No model checkpoint for run {run_id}")
        device = resolve_device("cpu")
        model = PPO.load(str(ckpt), device=device)
        _model_cache[run_id] = model
        return model


class ExerciseSession:
    def __init__(
        self,
        run_id: str,
        *,
        goal_hold_sec: Optional[int] = None,
        current_enabled: Optional[bool] = None,
    ) -> None:
        from train import BoatNavEnv

        metrics = _load_run_metrics(run_id)
        cfg = metrics.get("config") or {}
        plant = P.plant_from_dict(cfg.get("nominal_plant") or P.PLANT_NOMINAL)
        hold = goal_hold_sec if goal_hold_sec is not None else int(
            cfg.get("goal_hold_sec", P.DEFAULT_GOAL_HOLD_SEC)
        )
        cur = True if current_enabled is None else bool(current_enabled)
        if "current_enabled" in cfg and current_enabled is None:
            cur = bool(cfg["current_enabled"])

        self.run_id = run_id
        self.mode = str(metrics.get("mode", "navigate"))
        self.model = load_policy(run_id)
        self.goal_x, self.goal_y = DEFAULT_GOAL
        self.bounds = dict(WORLD_BOUNDS)
        self.contacts: List[P.ContactState] = []
        self.vessels: List[BoatNavEnv] = []

        for i, (sx, sy) in enumerate(DEFAULT_STARTS):
            env = BoatNavEnv(
                mode=self.mode,
                training_randomize=False,
                nominal_plant=plant,
                dynamics_jitter=True,
                goal_hold_sec=hold,
                current_enabled=cur,
                continuous=True,
            )
            env.reset(seed=7000 + i)
            env.own.x_m = sx
            env.own.y_m = sy
            env.own.speed_mps = 3.5
            env.own.cmd_heading_rad = env.own.heading_rad
            env.own.cmd_speed_mps = 3.5
            env.origin_x = sx
            env.origin_y = sy
            env.goal_x = self.goal_x
            env.goal_y = self.goal_y
            env.initial_goal_range = P.goal_range(env.own, self.goal_x, self.goal_y)
            env.prev_goal_range = env.initial_goal_range
            env.goal_hold_steps = 0
            env.step_count = 0
            env._last_obs = env._obs
            P.pack_observation(
                env.own,
                env.goal_x,
                env.goal_y,
                has_goal=True,
                contacts=[],
                origin_x=env.origin_x,
                origin_y=env.origin_y,
                current=env.water_current,
                out=env._obs,
            )
            self.vessels.append(env)
        self._sync_contacts_to_envs()

    def _clip_xy(self, x_m: float, y_m: float) -> Tuple[float, float]:
        return (
            float(np.clip(x_m, self.bounds["min_x"], self.bounds["max_x"])),
            float(np.clip(y_m, self.bounds["min_y"], self.bounds["max_y"])),
        )

    def _sync_contacts_to_envs(self) -> None:
        for env in self.vessels:
            env.contacts = self.contacts
            P.pack_observation(
                env.own,
                env.goal_x,
                env.goal_y,
                has_goal=True,
                contacts=self.contacts,
                origin_x=env.origin_x,
                origin_y=env.origin_y,
                current=env.water_current,
                out=env._obs,
            )
            env._last_obs = env._obs

    def add_intruder(
        self,
        x_m: float,
        y_m: float,
        cog_deg: float,
        sog_mps: float,
        vessel_class: str = P.DEFAULT_VESSEL_CLASS,
    ) -> P.ContactState:
        x_m, y_m = self._clip_xy(x_m, y_m)
        vessel_class = vessel_class if vessel_class in P.VESSEL_CLASSES else P.DEFAULT_VESSEL_CLASS
        sog_mps = float(np.clip(sog_mps, 0.0, P.V_MAX_MPS))
        contact = P.ContactState(
            x_m=x_m,
            y_m=y_m,
            cog_rad=math.radians(cog_deg),
            sog_mps=sog_mps,
            speed_mps=sog_mps,
            radius_m=P.radius_for_class(vessel_class),
            vessel_class=vessel_class,
        )
        self.contacts.append(contact)
        self._sync_contacts_to_envs()
        return contact

    def clear_intruders(self) -> None:
        self.contacts.clear()
        self._sync_contacts_to_envs()

    def set_goal(self, x_m: float, y_m: float) -> None:
        x_m, y_m = self._clip_xy(x_m, y_m)
        self.goal_x = x_m
        self.goal_y = y_m
        for env in self.vessels:
            env.goal_x = x_m
            env.goal_y = y_m
            env.goal_hold_steps = 0
            env.prev_goal_range = P.goal_range(env.own, x_m, y_m)
        self._sync_contacts_to_envs()

    def step(self, n_steps: int = 1) -> None:
        n_steps = max(1, min(int(n_steps), 20))
        for _ in range(n_steps):
            for c in self.contacts:
                c.step(P.DT_S)
            for env in self.vessels:
                env.contacts = self.contacts
                action, _ = safe_model_predict(self.model, env._last_obs, deterministic=True)
                obs, _, _, _, _ = env.step(action, advance_contacts=False)
                env._last_obs = obs

    def reset_vessels(self) -> None:
        for i, env in enumerate(self.vessels):
            sx, sy = DEFAULT_STARTS[i]
            env.reset(seed=8000 + i)
            env.own.x_m = sx
            env.own.y_m = sy
            env.own.speed_mps = 3.5
            env.own.cmd_heading_rad = env.own.heading_rad
            env.own.cmd_speed_mps = 3.5
            env.origin_x = sx
            env.origin_y = sy
            env.goal_x = self.goal_x
            env.goal_y = self.goal_y
            env.initial_goal_range = P.goal_range(env.own, self.goal_x, self.goal_y)
            env.prev_goal_range = env.initial_goal_range
            env.goal_hold_steps = 0
            env.step_count = 0
        self._sync_contacts_to_envs()

    def _contact_payload(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for c in self.contacts:
            out.append(
                {
                    "x": round(c.x_m, 2),
                    "y": round(c.y_m, 2),
                    "cog_deg": round(math.degrees(c.cog_rad), 1),
                    "sog_mps": round(c.sog_mps, 2),
                    "radius_m": round(c.radius_m, 1),
                    "vessel_class": c.vessel_class,
                }
            )
        return out

    def to_dict(self) -> Dict[str, Any]:
        vessel_payload = []
        for i, env in enumerate(self.vessels):
            rng = P.goal_range(env.own, self.goal_x, self.goal_y)
            vessel_payload.append(
                {
                    "id": i,
                    "x": round(env.own.x_m, 2),
                    "y": round(env.own.y_m, 2),
                    "heading": round(env.own.heading_rad, 4),
                    "speed": round(env.own.speed_mps, 2),
                    "cmd_heading": round(env.own.cmd_heading_rad, 4),
                    "cmd_speed": round(env.own.cmd_speed_mps, 2),
                    "goal_range_m": round(rng, 2),
                    "in_goal_zone": rng < P.GOAL_SUCCESS_RANGE_M,
                    "goal_hold_steps": env.goal_hold_steps,
                    "goal_hold_required": env.goal_hold_steps_required,
                    "current": env.water_current.to_dict(),
                    "plant": env.episode_plant.to_dict(),
                }
            )
        return {
            "run_id": self.run_id,
            "mode": self.mode,
            "goal": {"x": round(self.goal_x, 2), "y": round(self.goal_y, 2)},
            "bounds": self.bounds,
            "goal_success_range_m": P.GOAL_SUCCESS_RANGE_M,
            "contacts": self._contact_payload(),
            "vessels": vessel_payload,
        }


def get_session() -> Optional[ExerciseSession]:
    with _session_lock:
        return _session


def init_session(
    run_id: str,
    *,
    goal_hold_sec: Optional[int] = None,
    current_enabled: Optional[bool] = None,
) -> ExerciseSession:
    global _session
    session = ExerciseSession(
        run_id,
        goal_hold_sec=goal_hold_sec,
        current_enabled=current_enabled,
    )
    with _session_lock:
        _session = session
    return session


def resolve_exercise_run_id(run_id: Optional[str]) -> str:
    if run_id:
        _load_run_metrics(run_id)
        return run_id
    runs = sorted(
        [
            p
            for p in RUNS_DIR.iterdir()
            if p.is_dir()
            and p.name not in ("_training",)
            and (p / "model.zip").exists()
        ],
        key=lambda p: p.name,
        reverse=True,
    )
    if not runs:
        raise FileNotFoundError("No trained runs with checkpoints found")
    return runs[0].name
