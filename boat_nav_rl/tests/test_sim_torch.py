"""GPU batched sim parity and smoke tests."""

import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P
from env import BoatNavEnv
from sim_torch import BatchedBoatSim, BatchedBoatSimConfig


def _clear_navigate_seed():
    seeds = P.load_eval_seeds(P.EVAL_SEEDS_PATH)
    for s in seeds:
        if s.mode == "navigate" and not s.contacts and s.category.startswith("clear/"):
            if not s.waypoint_events and s.goal_relocate_x_m is None:
                return s
    return seeds[0]


def _traffic_seed():
    seeds = P.load_eval_seeds(P.EVAL_SEEDS_PATH)
    for s in seeds:
        if s.contacts and s.mode == "navigate":
            return s
    raise unittest.SkipTest("no traffic seed")


class TestSimTorchParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not P.EVAL_SEEDS_PATH.exists():
            P.write_scenario_splits()

    def _make_pair(self, scenario, mode="navigate"):
        cpu = BoatNavEnv(
            mode=mode,
            scenario=scenario,
            training_randomize=False,
            current_enabled=False,
            dynamics_jitter=False,
            goal_hold_sec=0,
            max_episode_steps=600,
        )
        obs, _ = cpu.reset(seed=scenario.seed)
        cfg = BatchedBoatSimConfig(
            mode=mode,
            n_envs=1,
            max_episode_steps=600,
            goal_hold_sec=0,
            current_enabled=False,
            auto_reset=False,
        )
        gpu = BatchedBoatSim(cfg, device="cpu")
        gpu.sync_from_cpu_env(cpu)
        gpu_obs = gpu._pack_obs().cpu().numpy()[0]
        np.testing.assert_allclose(obs, gpu_obs, rtol=1e-4, atol=1e-4)
        return cpu, gpu

    def test_reset_obs_parity_navigate(self):
        seed = _clear_navigate_seed()
        self._make_pair(seed)

    def test_step_obs_reward_parity_navigate(self):
        seed = _clear_navigate_seed()
        cpu, gpu = self._make_pair(seed)
        rng = np.random.default_rng(42)
        for _ in range(30):
            action = rng.uniform(-1, 1, size=2).astype(np.float32)
            cpu_obs, cpu_r, term, trunc, _ = cpu.step(action)
            gpu_obs, gpu_r, term_t, trunc_t = gpu.step(
                __import__("torch").as_tensor(action.reshape(1, 2), dtype=__import__("torch").float32)
            )
            self.assertFalse(bool(term) or bool(trunc), "episode ended early in parity test")
            np.testing.assert_allclose(
                cpu_obs, gpu_obs.cpu().numpy()[0], rtol=2e-3, atol=2e-3,
                err_msg="obs drift",
            )
            self.assertAlmostEqual(cpu_r, float(gpu_r[0]), places=3, msg="reward drift")

    def test_step_parity_with_contacts(self):
        seed = _traffic_seed()
        cpu, gpu = self._make_pair(seed, mode="navigate")
        rng = np.random.default_rng(7)
        for _ in range(20):
            action = rng.uniform(-1, 1, size=2).astype(np.float32)
            cpu_obs, cpu_r, term, trunc, _ = cpu.step(action)
            import torch

            gpu_obs, gpu_r, _, _ = gpu.step(torch.as_tensor(action.reshape(1, 2)))
            if term or trunc:
                break
            np.testing.assert_allclose(cpu_obs, gpu_obs.cpu().numpy()[0], rtol=5e-3, atol=5e-3)
            self.assertAlmostEqual(cpu_r, float(gpu_r[0]), places=2)


class TestBatchedVecEnv(unittest.TestCase):
    def test_sb3_vecenv_smoke(self):
        from batched_boat_vecenv import make_gpu_vec_env

        env = make_gpu_vec_env(n_envs=8, mode="navigate", device="cpu", goal_hold_sec=0)
        obs = env.reset()
        self.assertEqual(obs.shape, (8, P.OBS_DIM))
        import numpy as np

        actions = np.zeros((8, 2), dtype=np.float32)
        env.step_async(actions)
        obs2, rews, dones, infos = env.step_wait()
        self.assertEqual(obs2.shape, (8, P.OBS_DIM))
        self.assertEqual(rews.shape, (8,))
        self.assertEqual(dones.shape, (8,))
        self.assertEqual(len(infos), 8)
        env.close()


class TestVecenvBackend(unittest.TestCase):
    def test_gpu_backend_resolves(self):
        from vecenv_util import resolve_vecenv_backend

        self.assertEqual(resolve_vecenv_backend(32, "gpu"), "gpu")
        self.assertEqual(resolve_vecenv_backend(1, "subproc"), "dummy")


if __name__ == "__main__":
    unittest.main()
