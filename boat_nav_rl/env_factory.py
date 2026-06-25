"""Vectorized environment factory for PPO training."""

from __future__ import annotations

from typing import List, Optional

import prepare as P
import train_config as C
from env import BoatNavEnv
from scenario_seeds import train_seeds_for_mode


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
    plant = nominal_plant or C.NOMINAL_PLANT

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
            train_max_contacts=C.TRAIN_MAX_CONTACTS,
        )
        env.reset(seed=seed_offset)
        return env

    return _init
