"""SB3 VecEnv wrapper around GPU-batched BatchedBoatSim."""

from __future__ import annotations

from typing import Any, List, Optional

import numpy as np
import torch
from stable_baselines3.common.vec_env.base_vec_env import VecEnv, VecEnvIndices, VecEnvStepReturn

from sim_torch import BatchedBoatSim, BatchedBoatSimConfig


def make_gpu_vec_env(
    *,
    n_envs: int,
    mode: str,
    device: Optional[str] = None,
    goal_hold_sec: int = 0,
    max_episode_steps: Optional[int] = None,
    current_enabled: bool = False,
    seed: Optional[int] = None,
) -> "BatchedBoatVecEnv":
    cfg = BatchedBoatSimConfig(
        mode=mode,
        n_envs=n_envs,
        max_episode_steps=max_episode_steps or 600,
        goal_hold_sec=goal_hold_sec,
        current_enabled=current_enabled,
    )
    return BatchedBoatVecEnv(cfg, device=device, seed=seed)


class BatchedBoatVecEnv(VecEnv):
    """Vectorized env stepping all instances on GPU in one kernel."""

    def __init__(
        self,
        cfg: BatchedBoatSimConfig,
        device: Optional[str] = None,
        seed: Optional[int] = None,
    ) -> None:
        self.sim = BatchedBoatSim(cfg, device=device)
        self._seed = seed
        super().__init__(cfg.n_envs, self.sim.observation_space, self.sim.action_space)
        self.reset()

    def reset(self) -> np.ndarray:
        obs = self.sim.reset(seed=self._seed)
        return obs.cpu().numpy()

    def step_async(self, actions: np.ndarray) -> None:
        self._actions = np.asarray(actions, dtype=np.float32)

    def step_wait(self) -> VecEnvStepReturn:
        act = torch.as_tensor(self._actions, device=self.sim.device, dtype=torch.float32)
        obs, rewards, terminated, truncated = self.sim.step(act)
        dones = (terminated | truncated).cpu().numpy()
        infos: List[dict] = [{} for _ in range(self.num_envs)]
        return obs.cpu().numpy(), rewards.cpu().numpy(), dones, infos

    def close(self) -> None:
        return None

    def get_attr(self, attr_name: str, indices: VecEnvIndices = None) -> List[Any]:
        if attr_name == "render_mode":
            target = self._get_indices(indices)
            return [None] * len(target)
        raise NotImplementedError(f"BatchedBoatVecEnv does not support get_attr({attr_name!r})")

    def _get_indices(self, indices: VecEnvIndices) -> List[int]:
        if indices is None:
            return list(range(self.num_envs))
        if isinstance(indices, int):
            return [indices]
        return list(indices)

    def set_attr(self, attr_name: str, value: Any, indices: VecEnvIndices = None) -> None:
        raise NotImplementedError("BatchedBoatVecEnv does not support set_attr")

    def env_method(
        self,
        method_name: str,
        *method_args,
        indices: VecEnvIndices = None,
        **method_kwargs,
    ) -> List[Any]:
        raise NotImplementedError("BatchedBoatVecEnv does not support env_method")

    def env_is_wrapped(self, wrapper_class, indices: VecEnvIndices = None) -> List[bool]:
        return [False] * self.num_envs

    def seed(self, seed: Optional[int] = None) -> List[Optional[int]]:
        self._seed = seed
        return [seed] * self.num_envs
