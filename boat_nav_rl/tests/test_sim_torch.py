"""GPU batched sim parity and smoke tests."""

import math
import sys
import unittest
from pathlib import Path

import numpy as np
import torch

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


def _relocate_seed():
    seeds = P.load_eval_seeds(P.EVAL_SEEDS_PATH)
    for s in seeds:
        if s.goal_relocate_x_m is not None:
            return s
    raise unittest.SkipTest("no goal-relocate seed")


def _multi_leg_seed():
    seeds = P.load_eval_seeds(P.EVAL_SEEDS_PATH)
    for s in seeds:
        if s.waypoint_events and len(s.waypoint_events) >= 2:
            return s
    raise unittest.SkipTest("no multi-leg seed")


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


class TestMissionParity(unittest.TestCase):
    """GPU mission machinery vs CPU NavigationMission on seeded scenarios."""

    @classmethod
    def setUpClass(cls):
        if not P.EVAL_SEEDS_PATH.exists():
            P.write_scenario_splits()

    def _run_paired(self, scenario, steps=120, goal_hold_sec=5):
        cpu = BoatNavEnv(
            mode="navigate",
            scenario=scenario,
            training_randomize=False,
            current_enabled=False,
            dynamics_jitter=False,
            goal_hold_sec=goal_hold_sec,
            max_episode_steps=600,
        )
        cpu.reset(seed=scenario.seed)
        cfg = BatchedBoatSimConfig(
            mode="navigate",
            n_envs=1,
            max_episode_steps=600,
            goal_hold_sec=goal_hold_sec,
            current_enabled=False,
            auto_reset=False,
        )
        gpu = BatchedBoatSim(cfg, device="cpu")
        gpu.sync_from_cpu_env(cpu)
        rng = np.random.default_rng(scenario.seed)
        saw_goal_change = False
        for _ in range(steps):
            action = rng.uniform(-1, 1, size=2).astype(np.float32)
            cpu_obs, cpu_r, term, trunc, info = cpu.step(action)
            gpu_obs, gpu_r, term_t, trunc_t = gpu.step(
                torch.as_tensor(action.reshape(1, 2), dtype=torch.float32)
            )
            saw_goal_change = saw_goal_change or bool(info.get("goal_changed"))
            np.testing.assert_allclose(
                cpu_obs, gpu_obs.cpu().numpy()[0], rtol=5e-3, atol=5e-3,
                err_msg="obs drift across mission boundary",
            )
            self.assertAlmostEqual(cpu_r, float(gpu_r[0]), places=2)
            self.assertEqual(bool(term), bool(term_t[0]))
            self.assertEqual(bool(trunc), bool(trunc_t[0]))
            if term or trunc:
                break
        return saw_goal_change

    def test_goal_relocate_parity(self):
        seed = _relocate_seed()
        saw_change = self._run_paired(seed, steps=200)
        self.assertTrue(saw_change, "relocate trigger never fired in parity window")

    def test_multi_leg_parity(self):
        seed = _multi_leg_seed()
        self._run_paired(seed, steps=200)


class TestTrainingFeatures(unittest.TestCase):
    """Batched training features: seeds, jitter, noise, contact diversity."""

    @classmethod
    def setUpClass(cls):
        if not P.TRAIN_SEEDS_PATH.exists():
            P.write_scenario_splits()
        cls.train_seeds = P.load_train_seeds()

    def _make(self, **kwargs):
        defaults = dict(
            mode="avoid",
            n_envs=64,
            max_episode_steps=300,
            goal_hold_sec=0,
            current_enabled=False,
        )
        defaults.update(kwargs)
        cfg = BatchedBoatSimConfig(**defaults)
        return BatchedBoatSim(cfg, device="cpu")

    def test_seed_bank_spawns_match_scenarios(self):
        avoid_seeds = [s for s in self.train_seeds if s.contacts][:50]
        sim = self._make(train_seeds=avoid_seeds)
        sim.reset(seed=123)
        own_xy = {(round(s.own_x_m, 3), round(s.own_y_m, 3)) for s in avoid_seeds}
        for i in range(sim.n):
            key = (round(float(sim.x[i]), 3), round(float(sim.y[i]), 3))
            self.assertIn(key, own_xy, f"env {i} spawned off-bank at {key}")

    def test_contact_count_in_train_range(self):
        avoid_seeds = [s for s in self.train_seeds if s.contacts][:50]
        sim = self._make(train_seeds=avoid_seeds, train_max_contacts=4)
        sim.reset(seed=7)
        counts = sim.c_active.sum(dim=1)
        self.assertTrue(bool((counts >= 1).all()))
        self.assertTrue(bool((counts <= 4).all()))

    def test_dynamics_jitter_varies_plant(self):
        sim = self._make(mode="navigate", dynamics_jitter=True)
        sim.reset(seed=3)
        self.assertGreater(float(sim.tau_h.std()), 0.1)
        lo, hi = P.PLANT_AGILE["tau_heading_s"], P.PLANT_FREIGHTER["tau_heading_s"]
        self.assertTrue(bool((sim.tau_h >= lo).all() and (sim.tau_h <= hi).all()))
        yaw_lo = math.radians(P.PLANT_FREIGHTER["max_yaw_rate_deg_s"])
        yaw_hi = math.radians(P.PLANT_AGILE["max_yaw_rate_deg_s"])
        self.assertTrue(bool((sim.max_yaw >= yaw_lo - 1e-6).all()))
        self.assertTrue(bool((sim.max_yaw <= yaw_hi + 1e-6).all()))

    def test_no_jitter_uses_nominal_plant(self):
        sim = self._make(mode="navigate")
        sim.reset(seed=3)
        self.assertAlmostEqual(float(sim.tau_h[0]), P.TAU_HEADING_S, places=5)
        self.assertAlmostEqual(float(sim.tau_s[0]), P.TAU_SPEED_S, places=5)

    def test_contact_obs_noise_perturbs_range(self):
        sim_clean = self._make()
        sim_noisy = self._make(contact_obs_noise_m=20.0)
        obs_c = sim_clean.reset(seed=11).cpu().numpy()
        obs_n = sim_noisy.reset(seed=11).cpu().numpy()
        base = P.OBS_OWN_DIM + P.OBS_CURRENT_DIM
        rng_cols = [base + k * P.OBS_CONTACT_DIM + 2 for k in range(P.N_MAX_CONTACTS)]
        mask = obs_c[:, P.OBS_MASK_OFFSET : P.OBS_MASK_OFFSET + P.N_MAX_CONTACTS] > 0
        diff = np.abs(obs_c[:, rng_cols] - obs_n[:, rng_cols])[mask]
        self.assertGreater(float(diff.max()), 1e-4)

    def test_vessel_class_diversity_random_contacts(self):
        sim = self._make()
        sim.reset(seed=5)
        radii = sim.c_radius[sim.c_active].cpu().numpy()
        self.assertGreater(len(np.unique(np.round(radii, 2))), 1)

    def test_stretch_goals_present_with_bank(self):
        nav_seeds = [
            s
            for s in self.train_seeds
            if not s.contacts and not s.waypoint_events and s.goal_relocate_x_m is None
        ][:30]
        if not nav_seeds:
            raise unittest.SkipTest("no plain navigate train seeds")
        sim = self._make(mode="navigate", train_seeds=nav_seeds, n_envs=256)
        sim.reset(seed=9)
        seed_goals = {(round(s.goal_x_m, 3), round(s.goal_y_m, 3)) for s in nav_seeds}
        off_bank = 0
        for i in range(sim.n):
            key = (round(float(sim.goal_x[i]), 3), round(float(sim.goal_y[i]), 3))
            if key not in seed_goals:
                off_bank += 1
        frac = off_bank / sim.n
        self.assertGreater(frac, 0.05, "stretch goal resampling never triggered")
        self.assertLess(frac, 0.5, "too many goals resampled (expected ~20%)")

    def test_autoreset_returns_fresh_obs(self):
        sim = self._make(mode="navigate", n_envs=4, max_episode_steps=3)
        sim.reset(seed=1)
        actions = torch.zeros(4, 2)
        for _ in range(3):
            obs, _, term, trunc = sim.step(actions)
        done = (term | trunc).cpu().numpy()
        self.assertTrue(done.all(), "expected truncation at max steps")
        self.assertIsNotNone(sim.last_terminal_obs)
        # After reset, step_count restarts and obs reflects new episode start.
        self.assertTrue(bool((sim.step_count == 0).all()))
        term_obs = sim.last_terminal_obs.cpu().numpy()
        fresh = obs.cpu().numpy()
        self.assertFalse(np.allclose(term_obs, fresh), "obs not repacked after reset")


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

    def test_done_infos_have_sb3_keys(self):
        from batched_boat_vecenv import make_gpu_vec_env

        env = make_gpu_vec_env(
            n_envs=4, mode="navigate", device="cpu", goal_hold_sec=0, max_episode_steps=3
        )
        env.reset()
        import numpy as np

        actions = np.zeros((4, 2), dtype=np.float32)
        infos = None
        for _ in range(4):
            env.step_async(actions)
            _, _, dones, infos = env.step_wait()
            if dones.any():
                break
        self.assertTrue(dones.all())
        for info in infos:
            self.assertIn("terminal_observation", info)
            self.assertIn("TimeLimit.truncated", info)
            self.assertIn("episode", info)
            self.assertEqual(info["episode"]["l"], 3)
            self.assertTrue(info["TimeLimit.truncated"])
        env.close()


class TestVecenvBackend(unittest.TestCase):
    def test_gpu_backend_resolves(self):
        from vecenv_util import resolve_vecenv_backend

        self.assertEqual(resolve_vecenv_backend(32, "gpu"), "gpu")
        self.assertEqual(resolve_vecenv_backend(1, "subproc"), "dummy")


if __name__ == "__main__":
    unittest.main()
