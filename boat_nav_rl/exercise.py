"""Interactive exercise sandbox — three policy-controlled vessels, click-to-set goal."""

from __future__ import annotations

import json
import math
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from stable_baselines3 import PPO

import prepare as P
from colregs.live import live_status_for_step
from colregs.evaluate import evaluate_steps
from device_util import resolve_device
from mission import NavigationMission
from policy_infer import safe_model_predict

ROOT = Path(__file__).resolve().parent
RUNS_DIR = ROOT / "runs"

WORLD_BOUNDS = dict(P.WORLD_BOUNDS)

# Three start positions (m) — same model, different spawn points
DEFAULT_STARTS: List[Tuple[float, float]] = [
    (-500.0, -250.0),
    (-500.0, 0.0),
    (-500.0, 250.0),
]

DEFAULT_GOAL = (400.0, 0.0)

# Full protocol eval is expensive; live pose scoring runs every frame.
COLREGS_FULL_EVAL_INTERVAL = max(
    1, int(os.environ.get("EXERCISE_COLREGS_FULL_EVAL_INTERVAL", "8"))
)
EXERCISE_MAX_STEP_BATCH = 20

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
        from env import BoatNavEnv

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
        self.mode = str(metrics.get("mode", P.DEFAULT_MODE))
        self.model = load_policy(run_id)
        self.goal_x, self.goal_y = DEFAULT_GOAL
        self.bounds = dict(WORLD_BOUNDS)
        self.mission = NavigationMission.single_goal(
            self.goal_x, self.goal_y, np.random.default_rng(42), dt_s=P.DT_S
        )
        self.contacts: List[P.ContactState] = []
        self.traces: List[List[Dict[str, Any]]] = [[], [], []]
        self.vessels: List[BoatNavEnv] = []
        self._colregs_frame = 0
        self._colregs_rollup_cache: List[Optional[Dict[str, Any]]] = [None, None, None]

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
        self._record_trace_snapshot()

    def _invalidate_colregs_cache(self) -> None:
        self._colregs_rollup_cache = [None, None, None]

    def _record_trace_snapshot(self) -> None:
        for i, env in enumerate(self.vessels):
            self.traces[i].append(
                P.snapshot_step(
                    env.step_count,
                    env.own,
                    self.goal_x,
                    self.goal_y,
                    self.contacts,
                )
            )
            if len(self.traces[i]) > 800:
                self.traces[i] = self.traces[i][-800:]

    def _colregs_payload(self) -> Dict[str, Any]:
        if not self.contacts:
            return {
                "vessels": [],
                "mean_safety_S": None,
                "mean_protocol_R": None,
                "live": {"live_contacts": [], "mean_live_safety_S": None},
            }

        self._colregs_frame += 1
        run_full = (
            self._colregs_frame % COLREGS_FULL_EVAL_INTERVAL == 0
            or any(cache is None for cache in self._colregs_rollup_cache)
        )

        vessel_scores: List[Dict[str, Any]] = []
        safety_vals: List[float] = []
        protocol_vals: List[float] = []
        live_payload: Optional[Dict[str, Any]] = None

        for i, trace in enumerate(self.traces):
            if not trace:
                continue
            live = live_status_for_step(trace[-1])
            if run_full or self._colregs_rollup_cache[i] is None:
                rollup = evaluate_steps(trace, scenario_category="exercise/live")
                self._colregs_rollup_cache[i] = rollup
            else:
                rollup = self._colregs_rollup_cache[i]
            if i == 0:
                live_payload = live
            label = chr(ord("A") + i)
            vessel_scores.append(
                {
                    "vessel": label,
                    "mean_safety_S": rollup.get("mean_safety_S")
                    if rollup.get("mean_safety_S") is not None
                    else live.get("mean_live_safety_S"),
                    "mean_protocol_R": rollup.get("mean_protocol_R")
                    if rollup.get("mean_protocol_R") is not None
                    else live.get("mean_live_protocol_R"),
                    "min_safety_S": rollup.get("min_safety_S")
                    if rollup.get("min_safety_S") is not None
                    else live.get("mean_live_safety_S"),
                    "by_rule": rollup.get("by_rule") or {},
                    "encounters": rollup.get("encounters") or [],
                    "live": live,
                }
            )
            mean_s = rollup.get("mean_safety_S")
            if mean_s is None:
                mean_s = live.get("mean_live_safety_S")
            if mean_s is not None:
                safety_vals.append(float(mean_s))
            mean_r = rollup.get("mean_protocol_R")
            if mean_r is None:
                mean_r = live.get("mean_live_protocol_R")
            if mean_r is not None:
                protocol_vals.append(float(mean_r))

        return {
            "vessels": vessel_scores,
            "mean_safety_S": round(sum(safety_vals) / len(safety_vals), 1) if safety_vals else None,
            "mean_protocol_R": round(sum(protocol_vals) / len(protocol_vals), 1)
            if protocol_vals
            else None,
            "live": live_payload or {"live_contacts": [], "mean_live_safety_S": None},
        }

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
        self._invalidate_colregs_cache()
        self._record_trace_snapshot()
        return contact

    def clear_intruders(self) -> None:
        self.contacts.clear()
        self._sync_contacts_to_envs()
        self._invalidate_colregs_cache()
        self._record_trace_snapshot()

    def set_goal(self, x_m: float, y_m: float) -> None:
        x_m, y_m = self._clip_xy(x_m, y_m)
        if not self.vessels:
            self.goal_x, self.goal_y = x_m, y_m
            return
        ref = self.vessels[0]
        tr = self.mission.set_goal(
            ref.own.x_m,
            ref.own.y_m,
            x_m,
            y_m,
            self.goal_x,
            self.goal_y,
            P.goal_range_xy,
        )
        if tr is None:
            return
        self.goal_x = tr.goal_x
        self.goal_y = tr.goal_y
        for env in self.vessels:
            gr = P.goal_range(env.own, x_m, y_m)
            env.goal_x = x_m
            env.goal_y = y_m
            env.leg_start_x = env.own.x_m
            env.leg_start_y = env.own.y_m
            env.goal_hold_steps = 0
            env.initial_goal_range = gr
            env.prev_goal_range = gr
        self._sync_contacts_to_envs()
        self._invalidate_colregs_cache()
        self._record_trace_snapshot()

    def step(self, n_steps: int = 1) -> None:
        n_steps = max(1, min(int(n_steps), EXERCISE_MAX_STEP_BATCH))
        for _ in range(n_steps):
            for c in self.contacts:
                c.step(P.DT_S)
            for env in self.vessels:
                env.contacts = self.contacts
                action, _ = safe_model_predict(self.model, env._last_obs, deterministic=True)
                obs, _, _, _, _ = env.step(action, advance_contacts=False)
                env._last_obs = obs
            self._record_trace_snapshot()

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
        self.traces = [[], [], []]
        self._invalidate_colregs_cache()
        self._sync_contacts_to_envs()
        self._record_trace_snapshot()

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
            "colregs": self._colregs_payload(),
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
