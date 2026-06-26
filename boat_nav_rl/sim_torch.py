"""GPU-batched boat navigation simulation (Torch).

Prototype: vectorized plant, contacts, observation packing, and rewards for
navigate / avoid training without SubprocVecEnv.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import numpy as np
import torch
from gymnasium import spaces

import prepare as P
from rewards import RewardConfig, get_reward_config

PI = math.pi
K_MAX = P.N_MAX_CONTACTS
TRAIN_K_MAX = 4


def _device_or_cpu(device: Optional[str]) -> torch.device:
    if device is None or device == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(device)


def wrap_angle_torch(rad: torch.Tensor) -> torch.Tensor:
    return torch.atan2(torch.sin(rad), torch.cos(rad))


@dataclass
class BatchedBoatSimConfig:
    mode: str = "navigate"
    n_envs: int = 256
    max_episode_steps: int = P.MAX_STEPS
    goal_hold_sec: int = P.DEFAULT_GOAL_HOLD_SEC
    current_enabled: bool = False
    own_radius_m: float = P.OWN_RADIUS_M
    contact_obs_noise_m: float = 0.0
    reward_config: Optional[RewardConfig] = None
    auto_reset: bool = True


class BatchedBoatSim:
    """Vectorized env core — all state lives on `self.device`."""

    def __init__(self, cfg: BatchedBoatSimConfig, device: Optional[str] = None) -> None:
        self.cfg = cfg
        self.device = _device_or_cpu(device)
        self.mode = cfg.mode if cfg.mode != "all" else "avoid"
        self.n = int(cfg.n_envs)
        self.reward_cfg = cfg.reward_config or get_reward_config()
        self.goal_hold_required = max(1, int(cfg.goal_hold_sec)) if cfg.goal_hold_sec > 0 else 1
        self.max_steps = max(1, int(cfg.max_episode_steps)) + max(0, int(cfg.goal_hold_sec))

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
        self.goal_hold_steps = torch.zeros(n, device=self.device, dtype=torch.float32)
        self.step_count = torch.zeros(n, device=self.device, dtype=torch.float32)
        self.prev_action = self._z(n, 2)
        self.tau_h = torch.full((n,), P.TAU_HEADING_S, device=self.device)
        self.tau_s = torch.full((n,), P.TAU_SPEED_S, device=self.device)
        self.max_yaw = torch.full((n,), P.MAX_YAW_RATE_RPS, device=self.device)
        self.cur_speed = self._z(n)
        self.cur_sin = self._z(n)
        self.cur_cos = torch.ones(n, device=self.device)
        self.c_x = self._z(n, K_MAX)
        self.c_y = self._z(n, K_MAX)
        self.c_cog = self._z(n, K_MAX)
        self.c_sog = self._z(n, K_MAX)
        self.c_radius = self._z(n, K_MAX)
        self.c_active = torch.zeros(n, K_MAX, device=self.device, dtype=torch.bool)
        self._obs = self._z(n, P.OBS_DIM)
        self._rng = torch.Generator(device=self.device)

    def _rand(self, shape: Tuple[int, ...], lo: float, hi: float) -> torch.Tensor:
        return torch.rand(shape, device=self.device, generator=self._rng) * (hi - lo) + lo

    def _sample_training_goal_distances(self, m: int) -> torch.Tensor:
        reachable = P.estimate_reachable_goal_range_m(
            self.cfg.max_episode_steps,
            goal_hold_sec=self.cfg.goal_hold_sec,
        )
        world_max = P.max_goal_distance_from_xy(0.0, 0.0)
        arrival_horizon = min(reachable, world_max)
        near_hi = min(P.TRAIN_GOAL_DIST_NEAR_MAX_M, arrival_horizon * 0.95)
        near_hi = max(near_hi, P.TRAIN_GOAL_DIST_MIN_M + 1.0)
        if world_max > reachable * P.STRETCH_GOAL_REACH_MULT_MIN:
            stretch_lo = max(
                P.TRAIN_GOAL_DIST_NEAR_MAX_M, reachable * P.STRETCH_GOAL_REACH_MULT_MIN
            )
            stretch_hi = min(reachable * P.STRETCH_GOAL_REACH_MULT_MAX, world_max)
        else:
            stretch_lo = max(P.TRAIN_GOAL_DIST_NEAR_MAX_M, world_max * 0.82)
            stretch_hi = world_max
        if stretch_lo >= stretch_hi:
            stretch_dist = torch.full((m,), stretch_hi, device=self.device)
        else:
            stretch_dist = self._rand((m,), stretch_lo, stretch_hi)
        near_dist = self._rand((m,), P.TRAIN_GOAL_DIST_MIN_M, near_hi)
        stretch = (
            torch.rand((m,), device=self.device, generator=self._rng) < P.STRETCH_GOAL_PROB
        )
        return torch.where(stretch, stretch_dist, near_dist)

    def _reset_indices(self, idx: torch.Tensor) -> None:
        if idx.numel() == 0:
            return
        m = idx.numel()
        self.heading[idx] = self._rand((m,), -PI, PI)
        self.speed[idx] = self._rand((m,), 2.5, 5.5)
        self.yaw_rate[idx] = 0.0
        self.cmd_heading[idx] = self.heading[idx]
        self.cmd_speed[idx] = self.speed[idx]
        self.x[idx] = 0.0
        self.y[idx] = 0.0
        self.origin_x[idx] = 0.0
        self.origin_y[idx] = 0.0
        ang = self._rand((m,), -PI, PI)
        dist = self._sample_training_goal_distances(m)
        self.goal_x[idx] = self.x[idx] + dist * torch.sin(ang)
        self.goal_y[idx] = self.y[idx] + dist * torch.cos(ang)
        self.leg_start_x[idx] = self.x[idx]
        self.leg_start_y[idx] = self.y[idx]
        gr = torch.hypot(self.goal_x[idx] - self.x[idx], self.goal_y[idx] - self.y[idx])
        self.initial_goal_range[idx] = gr
        self.prev_goal_range[idx] = gr
        self.goal_hold_steps[idx] = 0.0
        self.step_count[idx] = 0.0
        self.prev_action[idx] = 0.0
        self.c_active[idx] = False

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

        if self.mode in ("avoid", "all"):
            self.c_active[idx] = False
            n_contacts = torch.randint(
                1, TRAIN_K_MAX + 1, (m,), device=self.device, generator=self._rng
            )
            slots = torch.arange(TRAIN_K_MAX, device=self.device).unsqueeze(0)
            on = slots < n_contacts.unsqueeze(1)
            for slot in range(TRAIN_K_MAX):
                mask = on[:, slot]
                if not mask.any():
                    continue
                env_i = idx[mask]
                self.c_x[env_i, slot] = self._rand((env_i.numel(),), -400.0, 400.0)
                self.c_y[env_i, slot] = self._rand((env_i.numel(),), -400.0, 400.0)
                self.c_cog[env_i, slot] = self._rand((env_i.numel(),), 0.0, 2 * PI)
                self.c_sog[env_i, slot] = self._rand((env_i.numel(),), 0.0, 5.5)
                self.c_radius[env_i, slot] = P.OWN_RADIUS_M
                self.c_active[env_i, slot] = True

    def reset(self, *, seed: Optional[int] = None) -> torch.Tensor:
        if seed is not None:
            self._rng.manual_seed(int(seed))
        idx = torch.arange(self.n, device=self.device)
        self._reset_indices(idx)
        return self._pack_obs()

    def _goal_range(self) -> torch.Tensor:
        return torch.hypot(self.goal_x - self.x, self.goal_y - self.y)

    def _apply_action(self, actions: torch.Tensor) -> None:
        a = actions.to(self.device, dtype=torch.float32)
        self.cmd_heading = wrap_angle_torch(a[:, 0] * PI)
        self.cmd_speed = P.V_MIN_MPS + (a[:, 1] + 1.0) * 0.5 * (P.V_MAX_MPS - P.V_MIN_MPS)

    def _step_plant(self) -> None:
        dt = P.DT_S
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
        vx = self.speed * torch.sin(self.heading)
        vy = self.speed * torch.cos(self.heading)
        cur_vx = self.cur_speed * self.cur_sin
        cur_vy = self.cur_speed * self.cur_cos
        self.x = self.x + (vx + cur_vx) * dt
        self.y = self.y + (vy + cur_vy) * dt

    def _step_contacts(self) -> None:
        dt = P.DT_S
        active = self.c_active
        self.c_x = torch.where(
            active,
            self.c_x + self.c_sog * torch.sin(self.c_cog) * dt,
            self.c_x,
        )
        self.c_y = torch.where(
            active,
            self.c_y + self.c_sog * torch.cos(self.c_cog) * dt,
            self.c_y,
        )

    def _contact_metrics(self) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Returns cpa_penalty, threat, collision, cpa_unsafe per env."""
        cfg = self.reward_cfg
        active = self.c_active
        if not active.any():
            z = torch.zeros(self.n, device=self.device)
            return z, z, torch.zeros(self.n, device=self.device, dtype=torch.bool), z

        own_vx = self.speed * torch.sin(self.heading) + self.cur_speed * self.cur_sin
        own_vy = self.speed * torch.cos(self.heading) + self.cur_speed * self.cur_cos
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

        progress_scale = 1.0 + torch.minimum(
            curr_goal_range / self.initial_goal_range.clamp(min=1.0), torch.ones_like(curr_goal_range)
        )
        retreat = (curr_goal_range - self.prev_goal_range).clamp(min=0.0)
        approach = (self.prev_goal_range - curr_goal_range).clamp(min=0.0)
        threat_thresh = threat >= cfg.threat_progress_thresh
        threatened = in_goal & (cpa_unsafe.bool() | threat_thresh)

        prog = torch.where(
            threatened,
            cfg.w_goal_progress * retreat * progress_scale * (1.0 + threat.clamp(min=0)) / 100.0,
            cfg.w_goal_progress * (approach - retreat) * progress_scale / 100.0,
        )
        reward = reward + prog

        if cfg.w_cross_track > 0.0:
            leg_dx = self.goal_x - self.leg_start_x
            leg_dy = self.goal_y - self.leg_start_y
            leg_len2 = (leg_dx * leg_dx + leg_dy * leg_dy).clamp(min=1e-6)
            rel_x = self.x - self.leg_start_x
            rel_y = self.y - self.leg_start_y
            ct = (rel_x * leg_dy - rel_y * leg_dx).abs() / torch.sqrt(leg_len2)
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

        first_hold = in_goal & stationary & (ghs == 0)
        arrival = torch.where(
            first_hold,
            torch.full((n,), cfg.w_goal_arrival, device=self.device),
            torch.zeros(n, device=self.device),
        )
        early = torch.where(
            first_hold & (self.max_steps > 0),
            cfg.w_goal_arrival_early
            * (1.0 - self.step_count / float(self.max_steps)).clamp(min=0.0),
            torch.zeros(n, device=self.device),
        )
        hold_speed = torch.where(
            in_goal & stationary,
            cfg.w_hold_base + cfg.w_hold_speed * slow_bonus,
            torch.zeros(n, device=self.device),
        )
        hold_center = torch.where(
            in_goal & stationary,
            -cfg.w_hold_center * (curr_goal_range / P.GOAL_SUCCESS_RANGE_M),
            torch.zeros(n, device=self.device),
        )
        overspeed = torch.where(
            in_goal & cfg.gated_hold & ~stationary & ~cpa_unsafe.bool(),
            -cfg.w_hold_overspeed
            * (self.speed - cfg.hold_stationary_speed_mps).clamp(min=0.0)
            / max(P.V_MAX_MPS, 1e-6),
            torch.zeros(n, device=self.device),
        )
        stay_threat = torch.where(
            in_goal & (cpa_unsafe.bool() | threat_thresh),
            -cfg.w_goal_threat_stay * torch.maximum(threat, cpa_unsafe),
            torch.zeros(n, device=self.device),
        )
        reward = reward + arrival + early + hold_speed + hold_center + overspeed + stay_threat

        ghs = torch.where(
            in_goal & stationary & ~cpa_unsafe.bool(),
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

    def _pack_obs(self) -> torch.Tensor:
        obs = self._obs
        obs.zero_()
        n = self.n
        obs[:, 0] = self.heading / PI
        obs[:, 1] = self.speed / P.SPEED_SCALE_MPS
        obs[:, 2] = self.yaw_rate / P.YAW_RATE_SCALE_RPS
        obs[:, 3] = (self.x - self.origin_x) / P.POS_SCALE_M
        obs[:, 4] = (self.y - self.origin_y) / P.POS_SCALE_M
        obs[:, 6] = self.cur_speed / max(P.CURRENT_MAX_MPS, 1e-6)
        obs[:, 7] = self.cur_sin
        obs[:, 8] = self.cur_cos

        active = self.c_active
        if active.any():
            dx = self.c_x - self.x.unsqueeze(1)
            dy = self.c_y - self.y.unsqueeze(1)
            dist = torch.hypot(dx, dy)
            brg = torch.atan2(dx, dy)
            # argsort contacts by range per env
            dist_masked = torch.where(active, dist, torch.full_like(dist, 1e9))
            order = torch.argsort(dist_masked, dim=1)
            own_vx_n = self.speed * torch.sin(self.heading) + self.cur_speed * self.cur_sin
            own_vy_n = self.speed * torch.cos(self.heading) + self.cur_speed * self.cur_cos
            base = 9
            contact_dim = P.OBS_CONTACT_DIM
            batch_idx = torch.arange(n, device=self.device)
            for slot in range(K_MAX):
                idx = order[:, slot]
                d = dist[batch_idx, idx]
                b = brg[batch_idx, idx]
                cog = self.c_cog[batch_idx, idx]
                sog = self.c_sog[batch_idx, idx]
                rad = self.c_radius[batch_idx, idx]
                is_on = active[batch_idx, idx]
                h = self.heading
                cvx = sog * torch.sin(cog)
                cvy = sog * torch.cos(cog)
                rvx = cvx - own_vx_n
                rvy = cvy - own_vy_n
                sh = torch.sin(h)
                ch = torch.cos(h)
                rel_fwd = rvx * sh + rvy * ch
                rel_stbd = rvx * ch - rvy * sh
                rel_cog = torch.atan2(torch.sin(cog - h), torch.cos(cog - h))
                off = base + slot * contact_dim
                obs[:, off + 0] = torch.where(is_on, torch.sin(b), torch.zeros_like(b))
                obs[:, off + 1] = torch.where(is_on, torch.cos(b), torch.zeros_like(b))
                obs[:, off + 2] = torch.where(is_on, (d / P.RANGE_SCALE_M).clamp(max=1.0), torch.zeros_like(d))
                obs[:, off + 3] = torch.where(is_on, torch.sin(rel_cog), torch.zeros_like(rel_cog))
                obs[:, off + 4] = torch.where(is_on, torch.cos(rel_cog), torch.zeros_like(rel_cog))
                obs[:, off + 5] = torch.where(
                    is_on, rel_fwd / P.REL_VEL_SCALE_MPS, torch.zeros_like(rel_fwd)
                )
                obs[:, off + 6] = torch.where(
                    is_on, rel_stbd / P.REL_VEL_SCALE_MPS, torch.zeros_like(rel_stbd)
                )
                obs[:, off + 7] = torch.where(is_on, rad / P.RADIUS_SCALE_M, torch.zeros_like(rad))
                mask_i = base + K_MAX * contact_dim + slot
                obs[:, mask_i] = is_on.float()

        gdx = self.goal_x - self.x
        gdy = self.goal_y - self.y
        gdist = torch.hypot(gdx, gdy)
        gbrg = torch.atan2(gdx, gdy)
        gb = P.OBS_GOAL_OFFSET
        obs[:, gb + 0] = torch.sin(gbrg)
        obs[:, gb + 1] = torch.cos(gbrg)
        obs[:, gb + 2] = (gdist / P.RANGE_SCALE_M).clamp(max=1.0)
        obs[:, gb + 3] = 1.0
        obs[:, P.OBS_HAS_GOAL_OFFSET] = 1.0
        return obs

    def step(
        self, actions: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Returns obs, reward, done, truncated."""
        actions = actions.to(self.device, dtype=torch.float32)
        self._apply_action(actions)
        self._step_plant()
        self._step_contacts()
        self.step_count = self.step_count + 1.0

        curr_goal_range = self._goal_range()
        in_goal = curr_goal_range < P.GOAL_SUCCESS_RANGE_M
        cpa_penalty, threat, collision, cpa_unsafe = self._contact_metrics()

        reward, _ghs = self._compute_rewards(
            actions, curr_goal_range, in_goal, cpa_penalty, threat, collision, cpa_unsafe
        )

        hold_complete = self.goal_hold_steps >= float(self.goal_hold_required)
        terminated = collision | (hold_complete & in_goal)
        truncated = self.step_count >= float(self.max_steps)
        done = terminated | truncated

        obs = self._pack_obs()
        self.prev_goal_range = curr_goal_range
        self.prev_action = actions.clone()

        if self.cfg.auto_reset and done.any():
            self._reset_indices(torch.nonzero(done, as_tuple=False).squeeze(1))

        return obs, reward, terminated, truncated

    def sync_from_cpu_env(self, env: Any, indices: Optional[torch.Tensor] = None) -> None:
        """Copy state from a CPU BoatNavEnv into batch rows (for parity tests)."""
        if indices is None:
            indices = torch.arange(self.n, device=self.device)
        for j, i in enumerate(indices.tolist()):
            self.x[i] = env.own.x_m
            self.y[i] = env.own.y_m
            self.heading[i] = env.own.heading_rad
            self.speed[i] = env.own.speed_mps
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
