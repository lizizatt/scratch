"""GPU-batched boat navigation simulation (Torch).

Vectorized plant, contacts, missions, observation packing, and rewards for
navigate / avoid training without SubprocVecEnv. Feature-parity target is the
CPU BoatNavEnv training path (see tests/test_sim_torch.py).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, List, Optional, Tuple

import numpy as np
import torch
from gymnasium import spaces

import dynamics as D
import prepare as P
from mission import scenario_waypoint_events
from rewards import PROGRESS_DISTANCE_SCALE_M, RewardConfig, get_reward_config

PI = math.pi
K_MAX = P.N_MAX_CONTACTS
TRAIN_K_MAX = 4  # default cap on randomized training contacts
E_MAX = 8  # max mission legs per episode (start event + pending)

# Mission trigger kinds (m_kind values). 0 = start/none.
KIND_NONE = 0
KIND_DELAY_SEC = 1
KIND_PROGRESS_FRAC = 2
KIND_HOLD_COMPLETE = 3
_MISSION_KIND = {
    "start": KIND_NONE,
    "delay_sec": KIND_DELAY_SEC,
    "progress_frac": KIND_PROGRESS_FRAC,
    "hold_complete": KIND_HOLD_COMPLETE,
}

_VESSEL_RADII = tuple(P.VESSEL_CLASSES.values())


def _device_or_cpu(device: Optional[str]) -> torch.device:
    if device is None or device == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(device)


def wrap_angle_torch(rad: torch.Tensor) -> torch.Tensor:
    return torch.atan2(torch.sin(rad), torch.cos(rad))


class ScenarioBank:
    """Tensorized ScenarioSeed list resident on the sim device."""

    def __init__(self, seeds: List[P.ScenarioSeed], device: torch.device) -> None:
        if not seeds:
            raise ValueError("ScenarioBank requires at least one seed")
        self.size = len(seeds)
        s_count = self.size

        def f(vals) -> torch.Tensor:
            return torch.tensor(vals, device=device, dtype=torch.float32)

        self.own_x = f([s.own_x_m for s in seeds])
        self.own_y = f([s.own_y_m for s in seeds])
        self.own_heading = f([math.radians(s.own_heading_deg) for s in seeds])
        self.own_speed = f([s.own_speed_mps for s in seeds])

        c_x = np.zeros((s_count, K_MAX), dtype=np.float32)
        c_y = np.zeros((s_count, K_MAX), dtype=np.float32)
        c_cog = np.zeros((s_count, K_MAX), dtype=np.float32)
        c_sog = np.zeros((s_count, K_MAX), dtype=np.float32)
        c_radius = np.full((s_count, K_MAX), P.OWN_RADIUS_M, dtype=np.float32)
        c_active = np.zeros((s_count, K_MAX), dtype=bool)
        for i, seed in enumerate(seeds):
            for j, c in enumerate(P.scenario_to_contacts(seed)[:K_MAX]):
                c_x[i, j] = c.x_m
                c_y[i, j] = c.y_m
                c_cog[i, j] = c.cog_rad
                c_sog[i, j] = c.sog_mps
                c_radius[i, j] = c.radius_m
                c_active[i, j] = True
        self.c_x = torch.from_numpy(c_x).to(device)
        self.c_y = torch.from_numpy(c_y).to(device)
        self.c_cog = torch.from_numpy(c_cog).to(device)
        self.c_sog = torch.from_numpy(c_sog).to(device)
        self.c_radius = torch.from_numpy(c_radius).to(device)
        self.c_active = torch.from_numpy(c_active).to(device)

        # Mission events; event 0 is the initial goal.
        ev_x = np.zeros((s_count, E_MAX), dtype=np.float32)
        ev_y = np.zeros((s_count, E_MAX), dtype=np.float32)
        ev_kind = np.zeros((s_count, E_MAX), dtype=np.int64)
        ev_lo = np.zeros((s_count, E_MAX), dtype=np.float32)
        ev_hi = np.zeros((s_count, E_MAX), dtype=np.float32)
        ev_count = np.ones(s_count, dtype=np.int64)
        for i, seed in enumerate(seeds):
            events = scenario_waypoint_events(seed)[:E_MAX]
            ev_count[i] = len(events)
            for j, ev in enumerate(events):
                ev_x[i, j] = ev.goal_x_m
                ev_y[i, j] = ev.goal_y_m
                kind = _MISSION_KIND.get(ev.trigger, KIND_NONE) if j > 0 else KIND_NONE
                ev_kind[i, j] = kind
                if kind == KIND_DELAY_SEC:
                    lo = ev.delay_sec_min if ev.delay_sec_min is not None else 5.0
                    hi = ev.delay_sec_max if ev.delay_sec_max is not None else lo
                elif kind == KIND_PROGRESS_FRAC:
                    lo = ev.progress_frac_min if ev.progress_frac_min is not None else 0.4
                    hi = ev.progress_frac_max if ev.progress_frac_max is not None else 0.7
                else:
                    lo = hi = 0.0
                if hi < lo:
                    lo, hi = hi, lo
                ev_lo[i, j] = lo
                ev_hi[i, j] = hi
        self.ev_x = torch.from_numpy(ev_x).to(device)
        self.ev_y = torch.from_numpy(ev_y).to(device)
        self.ev_kind = torch.from_numpy(ev_kind).to(device)
        self.ev_lo = torch.from_numpy(ev_lo).to(device)
        self.ev_hi = torch.from_numpy(ev_hi).to(device)
        self.ev_count = torch.from_numpy(ev_count).to(device)
        # Stretch goals only allowed on single-leg scenarios (matches CPU env).
        self.allows_stretch = self.ev_count == 1


@dataclass
class BatchedBoatSimConfig:
    mode: str = "navigate"
    n_envs: int = 256
    max_episode_steps: int = P.MAX_STEPS
    goal_hold_sec: int = P.DEFAULT_GOAL_HOLD_SEC
    current_enabled: bool = False
    own_radius_m: float = P.OWN_RADIUS_M
    contact_obs_noise_m: float = 0.0
    contact_obs_noise_bearing_rad: float = 0.0
    reward_config: Optional[RewardConfig] = None
    auto_reset: bool = True
    train_seeds: Optional[List[P.ScenarioSeed]] = None
    dynamics_jitter: bool = False
    nominal_plant: Optional[P.PlantParams] = None
    train_max_contacts: int = TRAIN_K_MAX


class BatchedBoatSim:
    """Vectorized env core — all state lives on `self.device`."""

    def __init__(self, cfg: BatchedBoatSimConfig, device: Optional[str] = None) -> None:
        self.cfg = cfg
        self.device = _device_or_cpu(device)
        self.mode = cfg.mode if cfg.mode != "all" else "avoid"
        self.n = int(cfg.n_envs)
        self.reward_cfg = cfg.reward_config or get_reward_config()
        self.goal_hold_sec = max(0, int(cfg.goal_hold_sec))
        self.goal_hold_required = max(1, self.goal_hold_sec) if self.goal_hold_sec > 0 else 1
        self.base_max_steps = max(1, int(cfg.max_episode_steps))
        nominal = cfg.nominal_plant or P.plant_from_dict(P.PLANT_NOMINAL)
        self._nominal_tau_h = float(nominal.tau_heading_s)
        self._nominal_tau_s = float(nominal.tau_speed_s)
        self._nominal_max_yaw = float(nominal.max_yaw_rate_rps)
        self.train_k_max = max(1, min(int(cfg.train_max_contacts), K_MAX))
        self._train_bank: Optional[ScenarioBank] = (
            ScenarioBank(cfg.train_seeds, self.device) if cfg.train_seeds else None
        )

        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(P.OBS_DIM,), dtype=np.float32
        )
        self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(2,), dtype=np.float32)

        self._init_tensors()

    def _z(self, *shape: int) -> torch.Tensor:
        return torch.zeros(*shape, device=self.device, dtype=torch.float32)

    def _init_tensors(self) -> None:
        n = self.n
        self.x = self._z(n)
        self.y = self._z(n)
        self.heading = self._z(n)
        self.speed = self._z(n)
        self.sway = self._z(n)
        self.yaw_rate = self._z(n)
        self.cmd_heading = self._z(n)
        self.cmd_speed = self._z(n)
        self.origin_x = self._z(n)
        self.origin_y = self._z(n)
        self.goal_x = self._z(n)
        self.goal_y = self._z(n)
        self.leg_start_x = self._z(n)
        self.leg_start_y = self._z(n)
        self.prev_goal_range = self._z(n)
        self.initial_goal_range = self._z(n)
        self.goal_hold_steps = self._z(n)
        self.step_count = self._z(n)
        self.prev_action = self._z(n, 2)
        self.tau_h = torch.full((n,), self._nominal_tau_h, device=self.device)
        self.tau_s = torch.full((n,), self._nominal_tau_s, device=self.device)
        self.max_yaw = torch.full((n,), self._nominal_max_yaw, device=self.device)
        self.cur_speed = self._z(n)
        self.cur_sin = self._z(n)
        self.cur_cos = torch.ones(n, device=self.device)
        self.c_x = self._z(n, K_MAX)
        self.c_y = self._z(n, K_MAX)
        self.c_cog = self._z(n, K_MAX)
        self.c_sog = self._z(n, K_MAX)
        self.c_radius = torch.full((n, K_MAX), P.OWN_RADIUS_M, device=self.device)
        self.c_active = torch.zeros(n, K_MAX, device=self.device, dtype=torch.bool)
        # Mission state: slot 0 = initial goal; m_leg indexes the active leg.
        self.m_goal_x = self._z(n, E_MAX)
        self.m_goal_y = self._z(n, E_MAX)
        self.m_kind = torch.zeros(n, E_MAX, device=self.device, dtype=torch.int64)
        self.m_param = self._z(n, E_MAX)
        self.m_count = torch.ones(n, device=self.device, dtype=torch.int64)
        self.m_leg = torch.zeros(n, device=self.device, dtype=torch.int64)
        self.max_steps_t = torch.full(
            (n,), float(self.base_max_steps + self.goal_hold_sec), device=self.device
        )
        self.ep_return = self._z(n)
        self.ep_length = self._z(n)
        self.last_success = torch.zeros(n, device=self.device, dtype=torch.bool)
        self.last_collision = torch.zeros(n, device=self.device, dtype=torch.bool)
        self.last_terminal_obs: Optional[torch.Tensor] = None
        self.last_ep_return = self.ep_return
        self.last_ep_length = self.ep_length
        self._obs = self._z(n, P.OBS_DIM)
        self._rng = torch.Generator(device=self.device)

    # ------------------------------------------------------------------
    # Random sampling helpers
    # ------------------------------------------------------------------

    def _rand(self, shape: Tuple[int, ...], lo, hi) -> torch.Tensor:
        u = torch.rand(shape, device=self.device, generator=self._rng)
        if isinstance(lo, torch.Tensor) or isinstance(hi, torch.Tensor):
            return u * (hi - lo) + lo
        return u * (hi - lo) + lo

    def _randint(self, shape: Tuple[int, ...], lo: int, hi: int) -> torch.Tensor:
        return torch.randint(lo, hi, shape, device=self.device, generator=self._rng)

    def _world_max_goal_dist(self, ox: torch.Tensor, oy: torch.Tensor) -> torch.Tensor:
        margin = P.TRAIN_GOAL_WORLD_MARGIN_M
        best = None
        for cx, cy in (
            (P.WORLD_BOUNDS["min_x"] + margin, P.WORLD_BOUNDS["min_y"] + margin),
            (P.WORLD_BOUNDS["min_x"] + margin, P.WORLD_BOUNDS["max_y"] - margin),
            (P.WORLD_BOUNDS["max_x"] - margin, P.WORLD_BOUNDS["min_y"] + margin),
            (P.WORLD_BOUNDS["max_x"] - margin, P.WORLD_BOUNDS["max_y"] - margin),
        ):
            d = torch.hypot(cx - ox, cy - oy)
            best = d if best is None else torch.maximum(best, d)
        return best

    def _clip_world(self, x: torch.Tensor, y: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        margin = P.TRAIN_GOAL_WORLD_MARGIN_M
        return (
            x.clamp(P.WORLD_BOUNDS["min_x"] + margin, P.WORLD_BOUNDS["max_x"] - margin),
            y.clamp(P.WORLD_BOUNDS["min_y"] + margin, P.WORLD_BOUNDS["max_y"] - margin),
        )

    def _sample_goal_xy(
        self, ox: torch.Tensor, oy: torch.Tensor, stretch: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """Batched port of prepare.sample_training_goal_xy (rejection sampling)."""
        m = ox.shape[0]
        reachable = P.estimate_reachable_goal_range_m(
            self.base_max_steps, goal_hold_sec=self.goal_hold_sec
        )
        world_max = self._world_max_goal_dist(ox, oy)
        arrival_horizon = torch.clamp(world_max, max=reachable)
        near_hi = torch.clamp(
            arrival_horizon * 0.95, max=P.TRAIN_GOAL_DIST_NEAR_MAX_M
        ).clamp(min=P.TRAIN_GOAL_DIST_MIN_M + 1.0)
        far_world = world_max > reachable * P.STRETCH_GOAL_REACH_MULT_MIN
        stretch_lo = torch.where(
            far_world,
            torch.clamp(
                torch.full_like(world_max, reachable * P.STRETCH_GOAL_REACH_MULT_MIN),
                min=P.TRAIN_GOAL_DIST_NEAR_MAX_M,
            ),
            torch.clamp(world_max * 0.82, min=P.TRAIN_GOAL_DIST_NEAR_MAX_M),
        )
        stretch_hi = torch.where(
            far_world,
            torch.clamp(world_max, max=reachable * P.STRETCH_GOAL_REACH_MULT_MAX),
            world_max,
        )

        def sample_dist() -> torch.Tensor:
            near = self._rand((m,), P.TRAIN_GOAL_DIST_MIN_M, near_hi)
            far = torch.where(
                stretch_lo >= stretch_hi,
                stretch_hi,
                self._rand((m,), stretch_lo, stretch_hi),
            )
            return torch.where(stretch, far, near)

        gx = ox.clone()
        gy = oy.clone()
        accepted = torch.zeros(m, dtype=torch.bool, device=self.device)
        for _ in range(12):
            ang = self._rand((m,), -PI, PI)
            dist = sample_dist()
            cx, cy = self._clip_world(ox + dist * torch.sin(ang), oy + dist * torch.cos(ang))
            actual = torch.hypot(cx - ox, cy - oy)
            ok = actual >= P.TRAIN_GOAL_DIST_MIN_M
            ok = ok & (~stretch | (actual >= stretch_lo * 0.95))
            newly = ok & ~accepted
            gx = torch.where(newly, cx, gx)
            gy = torch.where(newly, cy, gy)
            accepted = accepted | ok
        if not bool(accepted.all()):
            ang = self._rand((m,), -PI, PI)
            dist = sample_dist()
            cx, cy = self._clip_world(ox + dist * torch.sin(ang), oy + dist * torch.cos(ang))
            gx = torch.where(accepted, gx, cx)
            gy = torch.where(accepted, gy, cy)
        return gx, gy

    def _spawn_random_contacts(
        self, ox: torch.Tensor, oy: torch.Tensor
    ) -> Tuple[torch.Tensor, ...]:
        """Random contact fields [m, K_MAX] matching BoatNavEnv._spawn_random_contact."""
        m = ox.shape[0]
        brg = self._rand((m, K_MAX), -PI / 2.0, PI / 2.0)
        rng_m = self._rand((m, K_MAX), 350.0, 900.0)
        cx = ox.unsqueeze(1) + rng_m * torch.sin(brg)
        cy = oy.unsqueeze(1) + rng_m * torch.cos(brg)
        cog = self._rand((m, K_MAX), 0.0, 2.0 * PI)
        sog = self._rand((m, K_MAX), 0.0, 5.5)
        cls = self._randint((m, K_MAX), 0, len(_VESSEL_RADII))
        radii = torch.tensor(_VESSEL_RADII, device=self.device, dtype=torch.float32)
        radius = radii[cls]
        return cx, cy, cog, sog, radius

    def _randomize_contact_count(
        self,
        ox: torch.Tensor,
        oy: torch.Tensor,
        c_x: torch.Tensor,
        c_y: torch.Tensor,
        c_cog: torch.Tensor,
        c_sog: torch.Tensor,
        c_radius: torch.Tensor,
        active: torch.Tensor,
    ) -> Tuple[torch.Tensor, ...]:
        """Uniform{1..train_k_max} contacts: subsample seed contacts, spawn extras."""
        m = ox.shape[0]
        target = self._randint((m,), 1, self.train_k_max + 1)
        counts = active.sum(dim=1)
        keep_n = torch.minimum(counts, target)
        # Shuffle active seed contacts to the front in random order.
        keys = torch.rand((m, K_MAX), device=self.device, generator=self._rng)
        keys = torch.where(active, keys, torch.full_like(keys, 2.0))
        order = torch.argsort(keys, dim=1)
        c_x = torch.gather(c_x, 1, order)
        c_y = torch.gather(c_y, 1, order)
        c_cog = torch.gather(c_cog, 1, order)
        c_sog = torch.gather(c_sog, 1, order)
        c_radius = torch.gather(c_radius, 1, order)
        slots = torch.arange(K_MAX, device=self.device).unsqueeze(0)
        keep_seed = slots < keep_n.unsqueeze(1)
        rx, ry, rcog, rsog, rrad = self._spawn_random_contacts(ox, oy)
        c_x = torch.where(keep_seed, c_x, rx)
        c_y = torch.where(keep_seed, c_y, ry)
        c_cog = torch.where(keep_seed, c_cog, rcog)
        c_sog = torch.where(keep_seed, c_sog, rsog)
        c_radius = torch.where(keep_seed, c_radius, rrad)
        active = slots < target.unsqueeze(1)
        return c_x, c_y, c_cog, c_sog, c_radius, active

    # ------------------------------------------------------------------
    # Reset paths
    # ------------------------------------------------------------------

    def _set_single_goal_mission(self, idx: torch.Tensor) -> None:
        self.m_count[idx] = 1
        self.m_leg[idx] = 0
        self.m_kind[idx] = KIND_NONE
        self.m_param[idx] = 0.0
        self.m_goal_x[idx] = 0.0
        self.m_goal_y[idx] = 0.0
        self.m_goal_x[idx, 0] = self.goal_x[idx]
        self.m_goal_y[idx, 0] = self.goal_y[idx]

    def _reset_random(self, idx: torch.Tensor) -> None:
        m = idx.numel()
        self.heading[idx] = self._rand((m,), -PI, PI)
        self.speed[idx] = self._rand((m,), 2.5, 5.5)
        self.x[idx] = 0.0
        self.y[idx] = 0.0
        self.origin_x[idx] = 0.0
        self.origin_y[idx] = 0.0
        self.c_active[idx] = False
        if self.mode in ("avoid", "all"):
            cx, cy, cog, sog, radius = self._spawn_random_contacts(self.x[idx], self.y[idx])
            target = self._randint((m,), 1, self.train_k_max + 1)
            slots = torch.arange(K_MAX, device=self.device).unsqueeze(0)
            self.c_x[idx] = cx
            self.c_y[idx] = cy
            self.c_cog[idx] = cog
            self.c_sog[idx] = sog
            self.c_radius[idx] = radius
            self.c_active[idx] = slots < target.unsqueeze(1)
        stretch = (
            torch.rand((m,), device=self.device, generator=self._rng) < P.STRETCH_GOAL_PROB
        )
        gx, gy = self._sample_goal_xy(self.x[idx], self.y[idx], stretch)
        self.goal_x[idx] = gx
        self.goal_y[idx] = gy
        self._set_single_goal_mission(idx)

    def _reset_from_bank(self, idx: torch.Tensor) -> None:
        bank = self._train_bank
        assert bank is not None
        m = idx.numel()
        s = self._randint((m,), 0, bank.size)
        self.heading[idx] = bank.own_heading[s]
        self.speed[idx] = bank.own_speed[s]
        self.x[idx] = bank.own_x[s]
        self.y[idx] = bank.own_y[s]
        self.origin_x[idx] = bank.own_x[s]
        self.origin_y[idx] = bank.own_y[s]
        gx = bank.ev_x[s, 0]
        gy = bank.ev_y[s, 0]

        c_x = bank.c_x[s]
        c_y = bank.c_y[s]
        c_cog = bank.c_cog[s]
        c_sog = bank.c_sog[s]
        c_radius = bank.c_radius[s]
        active = bank.c_active[s]
        if self.mode in ("avoid", "all"):
            c_x, c_y, c_cog, c_sog, c_radius, active = self._randomize_contact_count(
                self.x[idx], self.y[idx], c_x, c_y, c_cog, c_sog, c_radius, active
            )
        self.c_x[idx] = c_x
        self.c_y[idx] = c_y
        self.c_cog[idx] = c_cog
        self.c_sog[idx] = c_sog
        self.c_radius[idx] = c_radius
        self.c_active[idx] = active

        # ~20% stretch goals on scenarios that allow it (single-leg, no relocate).
        do_stretch = bank.allows_stretch[s] & (
            torch.rand((m,), device=self.device, generator=self._rng) < P.STRETCH_GOAL_PROB
        )
        if bool(do_stretch.any()):
            force = torch.ones(m, dtype=torch.bool, device=self.device)
            sgx, sgy = self._sample_goal_xy(self.x[idx], self.y[idx], force)
            gx = torch.where(do_stretch, sgx, gx)
            gy = torch.where(do_stretch, sgy, gy)
        self.goal_x[idx] = gx
        self.goal_y[idx] = gy
        # Training uses single-goal missions (parity with BoatNavEnv training path).
        self._set_single_goal_mission(idx)

    def _assign_plant(self, idx: torch.Tensor) -> None:
        m = idx.numel()
        if self.cfg.dynamics_jitter:
            self.tau_h[idx] = self._rand(
                (m,), P.PLANT_AGILE["tau_heading_s"], P.PLANT_FREIGHTER["tau_heading_s"]
            )
            self.tau_s[idx] = self._rand(
                (m,), P.PLANT_AGILE["tau_speed_s"], P.PLANT_FREIGHTER["tau_speed_s"]
            )
            self.max_yaw[idx] = self._rand(
                (m,),
                math.radians(P.PLANT_FREIGHTER["max_yaw_rate_deg_s"]),
                math.radians(P.PLANT_AGILE["max_yaw_rate_deg_s"]),
            )
        else:
            self.tau_h[idx] = self._nominal_tau_h
            self.tau_s[idx] = self._nominal_tau_s
            self.max_yaw[idx] = self._nominal_max_yaw

    def _assign_current(self, idx: torch.Tensor) -> None:
        m = idx.numel()
        if self.cfg.current_enabled:
            cs = self._rand((m,), 0.0, P.CURRENT_MAX_MPS)
            cd = self._rand((m,), -PI, PI)
            self.cur_speed[idx] = cs
            self.cur_sin[idx] = torch.sin(cd)
            self.cur_cos[idx] = torch.cos(cd)
        else:
            self.cur_speed[idx] = 0.0
            self.cur_sin[idx] = 0.0
            self.cur_cos[idx] = 1.0

    def _finalize_reset(self, idx: torch.Tensor) -> None:
        self.yaw_rate[idx] = 0.0
        self.sway[idx] = 0.0
        self.cmd_heading[idx] = self.heading[idx]
        self.cmd_speed[idx] = self.speed[idx]
        self.leg_start_x[idx] = self.x[idx]
        self.leg_start_y[idx] = self.y[idx]
        gr = torch.hypot(self.goal_x[idx] - self.x[idx], self.goal_y[idx] - self.y[idx])
        self.initial_goal_range[idx] = gr
        self.prev_goal_range[idx] = gr
        self.goal_hold_steps[idx] = 0.0
        self.step_count[idx] = 0.0
        self.prev_action[idx] = 0.0
        self.ep_return[idx] = 0.0
        self.ep_length[idx] = 0.0
        extra_legs = (self.m_count[idx] - 1).clamp(min=0).to(torch.float32)
        self.max_steps_t[idx] = (
            float(self.base_max_steps + self.goal_hold_sec)
            + extra_legs * float(self.goal_hold_sec + 120)
        )

    def _reset_indices(self, idx: torch.Tensor) -> None:
        if idx.numel() == 0:
            return
        self._assign_plant(idx)
        self._assign_current(idx)
        if self._train_bank is not None:
            self._reset_from_bank(idx)
        else:
            self._reset_random(idx)
        self._finalize_reset(idx)

    def reset(self, *, seed: Optional[int] = None) -> torch.Tensor:
        if seed is not None:
            self._rng.manual_seed(int(seed))
        idx = torch.arange(self.n, device=self.device)
        self._reset_indices(idx)
        return self._pack_obs()

    def reset_to_scenarios(
        self, scenarios: List[P.ScenarioSeed], *, seed: Optional[int] = None
    ) -> torch.Tensor:
        """Exact scenario replay (no randomization) with full waypoint missions."""
        if len(scenarios) != self.n:
            raise ValueError(f"expected {self.n} scenarios, got {len(scenarios)}")
        if seed is not None:
            self._rng.manual_seed(int(seed))
        bank = ScenarioBank(scenarios, self.device)
        idx = torch.arange(self.n, device=self.device)
        self._assign_plant(idx)
        self._assign_current(idx)
        self.heading[:] = bank.own_heading
        self.speed[:] = bank.own_speed
        self.x[:] = bank.own_x
        self.y[:] = bank.own_y
        self.origin_x[:] = bank.own_x
        self.origin_y[:] = bank.own_y
        self.c_x[:] = bank.c_x
        self.c_y[:] = bank.c_y
        self.c_cog[:] = bank.c_cog
        self.c_sog[:] = bank.c_sog
        self.c_radius[:] = bank.c_radius
        self.c_active[:] = bank.c_active
        self.goal_x[:] = bank.ev_x[:, 0]
        self.goal_y[:] = bank.ev_y[:, 0]
        self.m_goal_x[:] = bank.ev_x
        self.m_goal_y[:] = bank.ev_y
        self.m_kind[:] = bank.ev_kind
        self.m_count[:] = bank.ev_count
        self.m_leg[:] = 0
        # Sample per-episode trigger params like NavigationMission._build_pending.
        u = torch.rand((self.n, E_MAX), device=self.device, generator=self._rng)
        param = bank.ev_lo + u * (bank.ev_hi - bank.ev_lo)
        delay_steps = torch.clamp(torch.round(param / P.DT_S), min=1.0)
        self.m_param[:] = torch.where(bank.ev_kind == KIND_DELAY_SEC, delay_steps, param)
        self._finalize_reset(idx)
        return self._pack_obs()

    # ------------------------------------------------------------------
    # Step
    # ------------------------------------------------------------------

    def _goal_range(self) -> torch.Tensor:
        return torch.hypot(self.goal_x - self.x, self.goal_y - self.y)

    def _own_ground_velocity(self) -> Tuple[torch.Tensor, torch.Tensor]:
        """Ground velocity incl. sway and current (matches prepare.own_velocity)."""
        sh = torch.sin(self.heading)
        ch = torch.cos(self.heading)
        vx = self.speed * sh + self.sway * ch + self.cur_speed * self.cur_sin
        vy = self.speed * ch - self.sway * sh + self.cur_speed * self.cur_cos
        return vx, vy

    def _apply_action(self, actions: torch.Tensor) -> None:
        a = actions.to(self.device, dtype=torch.float32)
        self.cmd_heading = wrap_angle_torch(a[:, 0] * PI)
        self.cmd_speed = P.V_MIN_MPS + (a[:, 1] + 1.0) * 0.5 * (P.V_MAX_MPS - P.V_MIN_MPS)

    def _step_plant(self) -> None:
        dt = P.DT_S
        cur_vx = self.cur_speed * self.cur_sin
        cur_vy = self.cur_speed * self.cur_cos
        if P.PLANT_MODEL == "3dof":
            coeffs = D.coeffs_from_plant(self.tau_h, self.tau_s, self.max_yaw)
            x, y, heading, u, v, r = D.step_dynamics(
                coeffs,
                self.x,
                self.y,
                self.heading,
                self.speed,
                self.sway,
                self.yaw_rate,
                self.cmd_heading,
                self.cmd_speed,
                dt=dt,
            )
            self.x = x + cur_vx * dt
            self.y = y + cur_vy * dt
            self.heading = heading
            self.speed = u
            self.sway = v
            self.yaw_rate = r
            return
        err = wrap_angle_torch(self.cmd_heading - self.heading)
        yaw_rate = err / self.tau_h.clamp(min=1e-3)
        yaw_rate = torch.clamp(yaw_rate, -self.max_yaw, self.max_yaw)
        self.yaw_rate = yaw_rate
        self.heading = wrap_angle_torch(self.heading + yaw_rate * dt)
        speed_err = self.cmd_speed - self.speed
        self.speed = torch.clamp(
            self.speed + speed_err / self.tau_s.clamp(min=1e-3) * dt,
            P.V_MIN_MPS,
            P.V_MAX_MPS,
        )
        self.sway = torch.zeros_like(self.sway)
        vx = self.speed * torch.sin(self.heading)
        vy = self.speed * torch.cos(self.heading)
        self.x = self.x + (vx + cur_vx) * dt
        self.y = self.y + (vy + cur_vy) * dt

    def _step_contacts(self) -> None:
        dt = P.DT_S
        active = self.c_active
        self.c_x = torch.where(
            active, self.c_x + self.c_sog * torch.sin(self.c_cog) * dt, self.c_x
        )
        self.c_y = torch.where(
            active, self.c_y + self.c_sog * torch.cos(self.c_cog) * dt, self.c_y
        )

    # ------------------------------------------------------------------
    # Missions
    # ------------------------------------------------------------------

    def _apply_mission_transition(self, mask: torch.Tensor, next_i: torch.Tensor) -> None:
        gx = self.m_goal_x.gather(1, next_i.unsqueeze(1)).squeeze(1)
        gy = self.m_goal_y.gather(1, next_i.unsqueeze(1)).squeeze(1)
        self.goal_x = torch.where(mask, gx, self.goal_x)
        self.goal_y = torch.where(mask, gy, self.goal_y)
        self.leg_start_x = torch.where(mask, self.x, self.leg_start_x)
        self.leg_start_y = torch.where(mask, self.y, self.leg_start_y)
        gr = torch.hypot(self.goal_x - self.x, self.goal_y - self.y)
        self.initial_goal_range = torch.where(mask, gr, self.initial_goal_range)
        self.prev_goal_range = torch.where(mask, gr, self.prev_goal_range)
        self.goal_hold_steps = torch.where(
            mask, torch.zeros_like(self.goal_hold_steps), self.goal_hold_steps
        )
        self.m_leg = torch.where(mask, self.m_leg + 1, self.m_leg)

    def _mission_scheduled(self, curr_goal_range: torch.Tensor) -> torch.Tensor:
        has_pending = (self.m_leg + 1) < self.m_count
        if not bool(has_pending.any()):
            return torch.zeros(self.n, dtype=torch.bool, device=self.device)
        next_i = torch.clamp(self.m_leg + 1, max=E_MAX - 1)
        kind = self.m_kind.gather(1, next_i.unsqueeze(1)).squeeze(1)
        param = self.m_param.gather(1, next_i.unsqueeze(1)).squeeze(1)
        fire_delay = has_pending & (kind == KIND_DELAY_SEC) & (self.step_count >= param)
        init = self.initial_goal_range
        progress = 1.0 - curr_goal_range / init.clamp(min=1e-9)
        fire_prog = (
            has_pending & (kind == KIND_PROGRESS_FRAC) & (init > 1.0) & (progress >= param)
        )
        fired = fire_delay | fire_prog
        if bool(fired.any()):
            self._apply_mission_transition(fired, next_i)
        return fired

    def _mission_hold_advance(
        self, in_goal: torch.Tensor, hold_complete: torch.Tensor, already: torch.Tensor
    ) -> torch.Tensor:
        has_pending = (self.m_leg + 1) < self.m_count
        if not bool(has_pending.any()):
            return torch.zeros(self.n, dtype=torch.bool, device=self.device)
        next_i = torch.clamp(self.m_leg + 1, max=E_MAX - 1)
        kind = self.m_kind.gather(1, next_i.unsqueeze(1)).squeeze(1)
        fired = (
            ~already
            & has_pending
            & (kind == KIND_HOLD_COMPLETE)
            & in_goal
            & hold_complete
        )
        if bool(fired.any()):
            self._apply_mission_transition(fired, next_i)
        return fired

    # ------------------------------------------------------------------
    # Contact metrics and rewards
    # ------------------------------------------------------------------

    def _contact_metrics(self) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Returns cpa_penalty, threat, collision, cpa_unsafe per env."""
        cfg = self.reward_cfg
        active = self.c_active
        if not bool(active.any()):
            z = torch.zeros(self.n, device=self.device)
            return z, z, torch.zeros(self.n, device=self.device, dtype=torch.bool), z

        own_vx, own_vy = self._own_ground_velocity()
        c_vx = self.c_sog * torch.sin(self.c_cog)
        c_vy = self.c_sog * torch.cos(self.c_cog)

        rx = self.c_x - self.x.unsqueeze(1)
        ry = self.c_y - self.y.unsqueeze(1)
        vx = c_vx - own_vx.unsqueeze(1)
        vy = c_vy - own_vy.unsqueeze(1)
        v2 = (vx * vx + vy * vy).clamp(min=1e-8)
        tcpa = -(rx * vx + ry * vy) / v2
        cpa_x = rx + vx * tcpa
        cpa_y = ry + vy * tcpa
        cpa_m = torch.hypot(cpa_x, cpa_y)

        safe = self.cfg.own_radius_m + self.c_radius + P.CPA_MARGIN_M
        dist = torch.hypot(rx, ry)
        collision = active & (dist < (self.cfg.own_radius_m + self.c_radius))

        in_horizon = active & (tcpa >= 0.0) & (tcpa <= P.CPA_HORIZON_S)
        hard = in_horizon & (cpa_m < safe)
        warn = in_horizon & ~hard & (cpa_m < safe * cfg.cpa_warning_mult)

        frac_hard = torch.where(hard, (safe - cpa_m) / safe.clamp(min=1e-6), torch.zeros_like(cpa_m))
        span = safe * (cfg.cpa_warning_mult - 1.0)
        frac_warn = torch.where(
            warn,
            (safe * cfg.cpa_warning_mult - cpa_m) / span.clamp(min=1e-6),
            torch.zeros_like(cpa_m),
        )
        cpa_penalty = (cfg.w_cpa * frac_hard + cfg.w_cpa_soft * frac_warn) * active.float()
        cpa_penalty = cpa_penalty.sum(dim=1)
        threat_hard = torch.where(hard, frac_hard.clamp(0, 1), torch.zeros_like(frac_hard))
        threat_warn = torch.where(warn, (0.5 * frac_warn).clamp(0, 1), torch.zeros_like(frac_warn))
        threat = torch.maximum(
            threat_hard.max(dim=1).values,
            threat_warn.max(dim=1).values,
        )
        cpa_unsafe = hard.any(dim=1)
        collision_any = collision.any(dim=1)
        return cpa_penalty, threat, collision_any, cpa_unsafe.float()

    def _compute_rewards(
        self,
        actions: torch.Tensor,
        curr_goal_range: torch.Tensor,
        in_goal: torch.Tensor,
        cpa_penalty: torch.Tensor,
        threat: torch.Tensor,
        collision: torch.Tensor,
        cpa_unsafe: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        cfg = self.reward_cfg
        n = self.n
        reward = torch.zeros(n, device=self.device)
        ghs = self.goal_hold_steps.clone()
        unsafe = cpa_unsafe.bool()
        hold_allowed = ~unsafe

        progress_scale = 1.0 + torch.minimum(
            curr_goal_range / self.initial_goal_range.clamp(min=1.0),
            torch.ones_like(curr_goal_range),
        )
        retreat = (curr_goal_range - self.prev_goal_range).clamp(min=0.0)
        approach = (self.prev_goal_range - curr_goal_range).clamp(min=0.0)
        threat_thresh = threat >= cfg.threat_progress_thresh
        threatened = in_goal & (unsafe | threat_thresh)

        threat_mult = 1.0 + torch.maximum(threat.clamp(min=0.0), cpa_unsafe)
        prog_scale = max(PROGRESS_DISTANCE_SCALE_M, 1e-6)
        prog = torch.where(
            threatened,
            cfg.w_goal_progress * retreat * progress_scale * threat_mult / prog_scale,
            cfg.w_goal_progress * (approach - retreat) * progress_scale / prog_scale,
        )
        reward = reward + prog

        if cfg.w_en_route_speed > 0.0:
            speed_norm = self.speed / max(P.V_MAX_MPS, 1e-6)
            en_route = torch.where(
                in_goal,
                torch.zeros_like(speed_norm),
                cfg.w_en_route_speed * speed_norm,
            )
            reward = reward + en_route

        if cfg.w_cross_track > 0.0:
            leg_dx = self.goal_x - self.leg_start_x
            leg_dy = self.goal_y - self.leg_start_y
            leg_len2 = leg_dx * leg_dx + leg_dy * leg_dy
            rel_x = self.x - self.leg_start_x
            rel_y = self.y - self.leg_start_y
            ct_line = (rel_x * leg_dy - rel_y * leg_dx).abs() / torch.sqrt(
                leg_len2.clamp(min=1e-6)
            )
            # Degenerate leg (goal == leg start): distance from the start point.
            ct = torch.where(leg_len2 < 1e-6, torch.hypot(rel_x, rel_y), ct_line)
            norm = ct / max(cfg.cross_track_scale_m, 1e-6)
            cross = torch.where(
                in_goal,
                torch.zeros_like(norm),
                -cfg.w_cross_track * norm * norm,
            )
            reward = reward + cross

        speed_norm = (self.speed - P.V_MIN_MPS) / max(P.V_MAX_MPS - P.V_MIN_MPS, 1e-6)
        slow_bonus = (1.0 - speed_norm).clamp(min=0.0) ** 2
        stationary = torch.ones(n, dtype=torch.bool, device=self.device)
        if cfg.gated_hold:
            stationary = self.speed <= cfg.hold_stationary_speed_mps

        holding = in_goal & hold_allowed & stationary
        first_hold = holding & (ghs == 0)
        arrival = torch.where(
            first_hold,
            cfg.w_goal_arrival
            + cfg.w_goal_arrival_early
            * (1.0 - self.step_count / self.max_steps_t.clamp(min=1.0)).clamp(min=0.0),
            torch.zeros(n, device=self.device),
        )
        hold_speed = torch.where(
            holding,
            cfg.w_hold_base + cfg.w_hold_speed * slow_bonus,
            torch.zeros(n, device=self.device),
        )
        hold_center = torch.where(
            holding,
            -cfg.w_hold_center * (curr_goal_range / P.GOAL_SUCCESS_RANGE_M),
            torch.zeros(n, device=self.device),
        )
        overspeed = torch.where(
            in_goal & cfg.gated_hold & hold_allowed & ~stationary,
            -cfg.w_hold_overspeed
            * (self.speed - cfg.hold_stationary_speed_mps).clamp(min=0.0)
            / max(P.V_MAX_MPS, 1e-6),
            torch.zeros(n, device=self.device),
        )
        stay_threat = torch.where(
            in_goal & (unsafe | threat_thresh),
            -cfg.w_goal_threat_stay * torch.maximum(threat, cpa_unsafe),
            torch.zeros(n, device=self.device),
        )
        reward = reward + arrival + hold_speed + hold_center + overspeed + stay_threat

        ghs = torch.where(
            holding,
            ghs + 1.0,
            torch.where(in_goal, ghs, torch.zeros_like(ghs)),
        )

        approach_prox = (1.0 - curr_goal_range / cfg.approach_slow_range_m).clamp(min=0.0)
        approach_r = torch.where(
            ~in_goal & (curr_goal_range < cfg.approach_slow_range_m),
            cfg.w_approach_slow * approach_prox * slow_bonus,
            torch.zeros(n, device=self.device),
        )
        reward = reward + approach_r

        smooth = -cfg.w_smooth * torch.linalg.vector_norm(actions - self.prev_action, dim=1)
        reward = reward + smooth - cpa_penalty
        reward = torch.where(collision, reward - cfg.w_collision, reward)
        reward = torch.clamp(reward, -cfg.reward_clip, cfg.reward_clip)
        reward = torch.where(torch.isfinite(reward), reward, torch.zeros_like(reward))
        self.goal_hold_steps = ghs
        return reward, ghs

    # ------------------------------------------------------------------
    # Observation packing
    # ------------------------------------------------------------------

    def _pack_obs(self) -> torch.Tensor:
        n = self.n
        obs = self._obs
        obs.zero_()
        obs[:, 0] = self.heading / PI
        obs[:, 1] = self.speed / P.SPEED_SCALE_MPS
        obs[:, 2] = self.yaw_rate / P.YAW_RATE_SCALE_RPS
        obs[:, 3] = (self.x - self.origin_x) / P.POS_SCALE_M
        obs[:, 4] = (self.y - self.origin_y) / P.POS_SCALE_M
        obs[:, 5] = self.sway / P.SPEED_SCALE_MPS
        obs[:, 6] = self.cur_speed / max(P.CURRENT_MAX_MPS, 1e-6)
        obs[:, 7] = self.cur_sin
        obs[:, 8] = self.cur_cos

        active = self.c_active
        if bool(active.any()):
            dx = self.c_x - self.x.unsqueeze(1)
            dy = self.c_y - self.y.unsqueeze(1)
            dist = torch.hypot(dx, dy)
            brg = torch.atan2(dx, dy)
            noise_m = float(self.cfg.contact_obs_noise_m)
            noise_b = float(self.cfg.contact_obs_noise_bearing_rad)
            if noise_m > 0.0 or noise_b > 0.0:
                if noise_b > 0.0:
                    brg = wrap_angle_torch(
                        brg
                        + noise_b
                        * torch.randn((n, K_MAX), device=self.device, generator=self._rng)
                    )
                if noise_m > 0.0:
                    dist = (
                        dist
                        + noise_m
                        * torch.randn((n, K_MAX), device=self.device, generator=self._rng)
                    ).clamp(min=0.0)
            # Sort contacts nearest-first by sensed range.
            sort_key = torch.where(active, dist, torch.full_like(dist, 1e9))
            order = torch.argsort(sort_key, dim=1)
            d = torch.gather(dist, 1, order)
            b = torch.gather(brg, 1, order)
            cog = torch.gather(self.c_cog, 1, order)
            sog = torch.gather(self.c_sog, 1, order)
            rad = torch.gather(self.c_radius, 1, order)
            on = torch.gather(active, 1, order)

            own_vx, own_vy = self._own_ground_velocity()
            cvx = sog * torch.sin(cog)
            cvy = sog * torch.cos(cog)
            rvx = cvx - own_vx.unsqueeze(1)
            rvy = cvy - own_vy.unsqueeze(1)
            sh = torch.sin(self.heading).unsqueeze(1)
            ch = torch.cos(self.heading).unsqueeze(1)
            rel_fwd = rvx * sh + rvy * ch
            rel_stbd = rvx * ch - rvy * sh
            rel_cog = wrap_angle_torch(cog - self.heading.unsqueeze(1))

            feats = torch.stack(
                (
                    torch.sin(b),
                    torch.cos(b),
                    (d / P.RANGE_SCALE_M).clamp(max=1.0),
                    torch.sin(rel_cog),
                    torch.cos(rel_cog),
                    rel_fwd / P.REL_VEL_SCALE_MPS,
                    rel_stbd / P.REL_VEL_SCALE_MPS,
                    rad / P.RADIUS_SCALE_M,
                ),
                dim=2,
            )
            feats = feats * on.unsqueeze(2).to(feats.dtype)
            base = P.OBS_OWN_DIM + P.OBS_CURRENT_DIM
            obs[:, base : base + K_MAX * P.OBS_CONTACT_DIM] = feats.reshape(
                n, K_MAX * P.OBS_CONTACT_DIM
            )
            obs[:, P.OBS_MASK_OFFSET : P.OBS_MASK_OFFSET + K_MAX] = on.to(obs.dtype)

        gdx = self.goal_x - self.x
        gdy = self.goal_y - self.y
        gdist = torch.hypot(gdx, gdy)
        gbrg = torch.atan2(gdx, gdy)
        gb = P.OBS_GOAL_OFFSET
        obs[:, gb + 0] = torch.sin(gbrg)
        obs[:, gb + 1] = torch.cos(gbrg)
        obs[:, gb + 2] = (gdist / P.RANGE_SCALE_M).clamp(max=1.0)
        obs[:, P.OBS_HAS_GOAL_OFFSET] = 1.0
        torch.nan_to_num_(obs, nan=0.0, posinf=1.0, neginf=-1.0)
        obs.clamp_(-10.0, 10.0)
        return obs

    # ------------------------------------------------------------------
    # Step
    # ------------------------------------------------------------------

    def step(
        self, actions: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Returns obs, reward, terminated, truncated (SB3 autoreset semantics)."""
        actions = actions.to(self.device, dtype=torch.float32)
        self._apply_action(actions)
        self._step_plant()
        self._step_contacts()
        self.step_count = self.step_count + 1.0

        curr_goal_range = self._goal_range()
        fired_sched = self._mission_scheduled(curr_goal_range)
        if bool(fired_sched.any()):
            curr_goal_range = self._goal_range()
        in_goal = curr_goal_range < P.GOAL_SUCCESS_RANGE_M
        cpa_penalty, threat, collision, cpa_unsafe = self._contact_metrics()

        reward, ghs = self._compute_rewards(
            actions, curr_goal_range, in_goal, cpa_penalty, threat, collision, cpa_unsafe
        )
        self.prev_goal_range = curr_goal_range
        self.prev_action = actions.clone()

        hold_complete = ghs >= float(self.goal_hold_required)
        fired_hold = self._mission_hold_advance(in_goal, hold_complete, fired_sched)
        goal_changed = fired_sched | fired_hold
        hold_complete = hold_complete & ~fired_hold
        final_leg = (self.m_leg + 1) >= self.m_count

        terminated = collision | (hold_complete & final_leg & ~goal_changed)
        truncated = self.step_count >= self.max_steps_t
        done = terminated | truncated
        self.last_success = (
            hold_complete & ~collision & ~cpa_unsafe.bool() & final_leg & ~goal_changed
        )
        self.last_collision = collision

        obs = self._pack_obs()
        self.ep_return = self.ep_return + reward
        self.ep_length = self.ep_length + 1.0
        self.last_terminal_obs = None
        self.last_ep_return = self.ep_return
        self.last_ep_length = self.ep_length

        if self.cfg.auto_reset and bool(done.any()):
            idx = torch.nonzero(done, as_tuple=False).squeeze(1)
            self.last_terminal_obs = obs[idx].clone()
            self.last_ep_return = self.ep_return.clone()
            self.last_ep_length = self.ep_length.clone()
            self._reset_indices(idx)
            obs = self._pack_obs()

        return obs, reward, terminated, truncated

    # ------------------------------------------------------------------
    # Test / parity helpers
    # ------------------------------------------------------------------

    def sync_from_cpu_env(self, env: Any, indices: Optional[torch.Tensor] = None) -> None:
        """Copy state from a CPU BoatNavEnv into batch rows (for parity tests)."""
        if indices is None:
            indices = torch.arange(self.n, device=self.device)
        for i in indices.tolist():
            self.x[i] = env.own.x_m
            self.y[i] = env.own.y_m
            self.heading[i] = env.own.heading_rad
            self.speed[i] = env.own.speed_mps
            self.sway[i] = getattr(env.own, "sway_mps", 0.0)
            self.yaw_rate[i] = env.own.yaw_rate_rps
            self.cmd_heading[i] = env.own.cmd_heading_rad
            self.cmd_speed[i] = env.own.cmd_speed_mps
            self.origin_x[i] = env.origin_x
            self.origin_y[i] = env.origin_y
            self.goal_x[i] = env.goal_x
            self.goal_y[i] = env.goal_y
            self.leg_start_x[i] = env.leg_start_x
            self.leg_start_y[i] = env.leg_start_y
            self.prev_goal_range[i] = env.prev_goal_range
            self.initial_goal_range[i] = env.initial_goal_range
            self.goal_hold_steps[i] = float(env.goal_hold_steps)
            self.step_count[i] = float(env.step_count)
            self.prev_action[i] = torch.as_tensor(env.prev_action, device=self.device)
            self.tau_h[i] = env.plant.tau_heading_s
            self.tau_s[i] = env.plant.tau_speed_s
            self.max_yaw[i] = env.plant.max_yaw_rate_rps
            self.max_steps_t[i] = float(env.max_steps)
            self.ep_return[i] = 0.0
            self.ep_length[i] = 0.0
            cur = env.water_current
            dr = cur.direction_rad
            self.cur_speed[i] = cur.speed_mps
            self.cur_sin[i] = math.sin(dr)
            self.cur_cos[i] = math.cos(dr)
            self.c_active[i] = False
            for slot, c in enumerate(env.contacts[:K_MAX]):
                self.c_x[i, slot] = c.x_m
                self.c_y[i, slot] = c.y_m
                self.c_cog[i, slot] = c.cog_rad
                self.c_sog[i, slot] = c.sog_mps
                self.c_radius[i, slot] = c.radius_m
                self.c_active[i, slot] = True
            # Mission pending state (already-sampled trigger params).
            self.m_goal_x[i] = 0.0
            self.m_goal_y[i] = 0.0
            self.m_kind[i] = KIND_NONE
            self.m_param[i] = 0.0
            self.m_goal_x[i, 0] = env.goal_x
            self.m_goal_y[i, 0] = env.goal_y
            self.m_leg[i] = 0
            count = 1
            mission = getattr(env, "mission", None)
            if mission is not None:
                for j, trig in enumerate(mission.pending[: E_MAX - 1]):
                    slot = j + 1
                    self.m_goal_x[i, slot] = trig.goal_x
                    self.m_goal_y[i, slot] = trig.goal_y
                    kind = _MISSION_KIND.get(trig.kind, KIND_NONE)
                    self.m_kind[i, slot] = kind
                    if kind == KIND_DELAY_SEC and trig.fire_at_step is not None:
                        self.m_param[i, slot] = float(trig.fire_at_step)
                    elif kind == KIND_PROGRESS_FRAC and trig.progress_threshold is not None:
                        self.m_param[i, slot] = float(trig.progress_threshold)
                    count += 1
            self.m_count[i] = count

    def step_numpy(
        self, actions: np.ndarray
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Convenience for tests — returns numpy arrays."""
        act = torch.as_tensor(actions, device=self.device, dtype=torch.float32)
        obs, rew, term, trunc = self.step(act)
        done = (term | trunc).cpu().numpy()
        return (
            obs.cpu().numpy(),
            rew.cpu().numpy(),
            done,
            np.zeros(self.n, dtype=bool),
        )
