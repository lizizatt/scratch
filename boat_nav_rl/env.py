"""Gymnasium environment for boat navigation RL."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

import gymnasium as gym
import numpy as np
from gymnasium import spaces
from stable_baselines3 import PPO

import prepare as P
from mission import MissionTransition, NavigationMission
from policy_infer import safe_model_predict
from rewards import (
    HOLD_AT_STOP_EPS_MPS,
    StepRewardInput,
    compute_step_reward,
    contact_step_metrics,
    energy_score_from_speeds,
    energy_score_from_trace,
)

DEFAULT_TRAIN_MAX_CONTACTS = 4
_VESSEL_CLASS_CHOICES = tuple(P.VESSEL_CLASSES.keys())


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
        train_max_contacts: int = DEFAULT_TRAIN_MAX_CONTACTS,
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
        self.train_max_contacts = max(1, int(train_max_contacts))
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
        return max(1, min(self.train_max_contacts, P.N_MAX_CONTACTS))

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
        max_goal_hold_steps = 0
        goal_hold_required = self.goal_hold_steps_required
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
            max_goal_hold_steps = max(max_goal_hold_steps, int(info.get("goal_hold_steps") or 0))
            if info.get("goal_hold_required") is not None:
                goal_hold_required = int(info["goal_hold_required"])
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
            "goal_hold_steps": max_goal_hold_steps,
            "goal_hold_required": goal_hold_required,
        }
        if breakdown_steps:
            result["mean_reward_breakdown"] = {
                k: round(v / breakdown_steps, 4) for k, v in breakdown_sums.items()
            }
        if collect_trace:
            result["steps"] = steps
            result["energy_score"] = energy_score_from_trace(steps)
        return result

