"""Core sim, scenarios, and metrics tests (no server required)."""

import json
import math
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P
import scenarios as SC
import training_job as TJ


class TestObservationLayout(unittest.TestCase):
    def test_obs_dim_is_77(self):
        self.assertEqual(P.OBS_DIM, 77)

    def test_pack_observation_shape(self):
        own = P.VesselState(heading_rad=0.5, speed_mps=4.0)
        obs = P.pack_observation(own, 100.0, 500.0, True, [], 0.0, 0.0)
        self.assertEqual(obs.shape, (77,))
        self.assertEqual(obs[6], 0.0)  # no current
        self.assertEqual(obs[-1], 1.0)  # has_goal

    def test_pack_observation_reuses_buffer(self):
        own = P.VesselState(heading_rad=0.0, speed_mps=3.0)
        buf = np.zeros(P.OBS_DIM, dtype=np.float32)
        out = P.pack_observation(own, 0.0, 100.0, True, [], 0.0, 0.0, out=buf)
        self.assertIs(out, buf)
        self.assertAlmostEqual(out[1], 3.0 / P.SPEED_SCALE_MPS, places=4)

    def test_pack_observation_includes_current(self):
        own = P.VesselState(heading_rad=0.0, speed_mps=4.0)
        cur = P.WaterCurrent(vx_mps=0.25, vy_mps=0.0)
        obs = P.pack_observation(own, 0.0, 100.0, True, [], 0.0, 0.0, current=cur)
        self.assertAlmostEqual(obs[6], 0.5, places=4)  # 0.25 / CURRENT_MAX
        self.assertAlmostEqual(obs[7], 1.0, places=4)
        self.assertAlmostEqual(obs[8], 0.0, places=4)

    def test_sample_water_current_bounded(self):
        rng = np.random.default_rng(0)
        for _ in range(20):
            cur = P.sample_water_current(rng)
            self.assertLessEqual(cur.speed_mps, P.CURRENT_MAX_MPS + 1e-6)
            self.assertGreaterEqual(cur.speed_mps, 0.0)


class TestScenarioLibrary(unittest.TestCase):
    def test_generate_nonempty(self):
        seeds = SC.generate_all_scenarios()
        self.assertGreater(len(seeds), 50)

    def test_navigate_and_traffic_categories(self):
        seeds = SC.generate_all_scenarios()
        cats = {s.category for s in seeds}
        self.assertTrue(any(c.startswith("clear/") for c in cats))
        self.assertTrue(any(c.startswith("traffic/") for c in cats))
        self.assertTrue(any(c == "clear/hold_then_go" for c in cats))
        self.assertTrue(any(c == "clear/exercise_sampler" for c in cats))
        self.assertTrue(any(c == "clear/multi_leg" for c in cats))
        self.assertTrue(all(s.mode == "navigate" for s in seeds))

    def test_goal_relocate_scenarios(self):
        seeds = SC.generate_goal_relocate_scenarios()
        self.assertGreaterEqual(len(seeds), 40)
        sample = seeds[0]
        self.assertEqual(sample.category, "clear/hold_then_go")
        self.assertEqual(sample.own_x_m, sample.goal_x_m)
        self.assertEqual(sample.own_y_m, sample.goal_y_m)
        self.assertIsNotNone(sample.goal_relocate_x_m)
        self.assertIsNotNone(sample.goal_relocate_delay_sec_min)

    def test_write_and_load_roundtrip(self):
        path = ROOT / "runs" / "_test_eval_seeds.json"
        P.build_eval_seeds()
        seeds = P.load_eval_seeds(P.EVAL_SEEDS_PATH)
        self.assertTrue(all(hasattr(s, "category") for s in seeds))


class TestTransferFunction(unittest.TestCase):
    def test_moves_toward_command(self):
        plant = P.TransferFunctionPlant()
        state = P.VesselState(heading_rad=0.0, speed_mps=3.0)
        plant.apply_command(state, math.radians(45), 5.0)
        for _ in range(50):
            plant.step(state, P.DT_S)
        self.assertGreater(state.heading_rad, 0.1)
        self.assertGreater(state.speed_mps, 3.1)

    def test_literal_stop_command(self):
        heading, speed = P.action_to_command(np.array([0.0, -1.0], dtype=np.float32))
        self.assertAlmostEqual(speed, P.V_MIN_MPS)
        self.assertEqual(P.V_MIN_MPS, 0.0)
        plant = P.TransferFunctionPlant()
        state = P.VesselState(speed_mps=4.0)
        plant.apply_command(state, heading, speed)
        for _ in range(120):
            plant.step(state, P.DT_S)
        self.assertLess(state.speed_mps, 0.05)


class TestBoatNavEnv(unittest.TestCase):
    def test_reset_step_navigate(self):
        from train import BoatNavEnv

        env = BoatNavEnv(mode="navigate", training_randomize=True)
        obs, _ = env.reset(seed=42)
        self.assertEqual(obs.shape, (P.OBS_DIM,))
        action = env.action_space.sample()
        obs2, reward, term, trunc, info = env.step(action)
        self.assertEqual(obs2.shape, (P.OBS_DIM,))
        self.assertIn("goal_range_m", info)

    def test_scenario_eval_reset(self):
        from train import BoatNavEnv

        seeds = [s for s in P.load_eval_seeds() if not s.contacts]
        self.assertTrue(seeds)
        env = BoatNavEnv(mode="navigate", scenario=seeds[0], training_randomize=False)
        obs, _ = env.reset()
        self.assertEqual(obs.shape, (P.OBS_DIM,))

    def test_goal_relocates_after_delay(self):
        from train import BoatNavEnv

        scenario = SC.generate_goal_relocate_scenarios()[0]
        env = BoatNavEnv(scenario=scenario, training_randomize=False, goal_hold_sec=60, current_enabled=False)
        env.reset(seed=42)
        self.assertLess(P.goal_range(env.own, env.goal_x, env.goal_y), P.GOAL_SUCCESS_RANGE_M)

        relocated = False
        for _ in range(80):
            _, _, term, trunc, info = env.step(np.array([0.0, -1.0], dtype=np.float32))
            if info.get("goal_relocated"):
                relocated = True
                break
            if term or trunc:
                break

        self.assertTrue(relocated)
        self.assertGreater(P.goal_range(env.own, env.goal_x, env.goal_y), P.GOAL_SUCCESS_RANGE_M / 2)
        self.assertEqual(env.goal_hold_steps, 0)

    def test_multi_leg_advances_without_terminating(self):
        from train import BoatNavEnv

        scenario = next(s for s in SC.generate_multi_leg_scenarios() if s.name.startswith("multi_leg_2x"))
        env = BoatNavEnv(
            scenario=scenario,
            training_randomize=False,
            goal_hold_sec=5,
            current_enabled=False,
        )
        env.reset(seed=99)
        env.own.x_m = env.goal_x
        env.own.y_m = env.goal_y
        env.own.speed_mps = P.V_MIN_MPS
        env.goal_hold_steps = 5
        _, _, term, _, info = env.step(np.array([0.0, -1.0], dtype=np.float32))
        self.assertFalse(term)
        self.assertTrue(info.get("goal_changed"))
        self.assertGreater(P.goal_range(env.own, env.goal_x, env.goal_y), P.GOAL_SUCCESS_RANGE_M / 2)

    def test_goal_hold_requires_staying_in_zone(self):
        from train import BoatNavEnv

        env = BoatNavEnv(
            mode="navigate",
            training_randomize=False,
            goal_hold_sec=3,
            current_enabled=False,
        )
        env.reset(seed=1)
        env.own.x_m = env.goal_x
        env.own.y_m = env.goal_y
        env.own.speed_mps = P.V_MIN_MPS
        env.prev_goal_range = 0.0
        env.goal_hold_steps = 0

        for _ in range(2):
            env.own.speed_mps = P.V_MIN_MPS
            _, _, term, _, info = env.step(np.array([0.0, -1.0], dtype=np.float32))
            self.assertFalse(term)
            self.assertFalse(info["success"])
            self.assertTrue(info["in_goal_zone"])

        env.own.speed_mps = P.V_MIN_MPS
        _, _, term, _, info = env.step(np.array([0.0, -1.0], dtype=np.float32))
        self.assertTrue(term)
        self.assertTrue(info["success"])

    def test_max_episode_steps_override(self):
        from train import BoatNavEnv

        env = BoatNavEnv(
            mode="navigate",
            training_randomize=False,
            goal_hold_sec=5,
            max_episode_steps=40,
            current_enabled=False,
        )
        self.assertEqual(env.max_steps, 45)
        env.reset(seed=1)
        for _ in range(44):
            _, _, term, trunc, _ = env.step(env.action_space.sample())
            self.assertFalse(term)
            self.assertFalse(trunc)
        _, _, term, trunc, _ = env.step(env.action_space.sample())
        self.assertFalse(term)
        self.assertTrue(trunc)

    def test_reward_breakdown_optional(self):
        from train import BoatNavEnv

        env = BoatNavEnv(mode="navigate", training_randomize=False, include_reward_breakdown=False)
        env.reset(seed=1)
        _, _, _, _, info = env.step(env.action_space.sample())
        self.assertNotIn("reward_breakdown", info)

        env2 = BoatNavEnv(mode="navigate", training_randomize=False, include_reward_breakdown=True)
        env2.reset(seed=1)
        _, _, _, _, info2 = env2.step(env2.action_space.sample())
        self.assertIn("reward_breakdown", info2)

    def test_hold_zone_favors_lower_speed(self):
        from rewards import W_HOLD_SPEED
        from train import BoatNavEnv

        env = BoatNavEnv(
            mode="navigate",
            training_randomize=False,
            goal_hold_sec=5,
            current_enabled=False,
        )
        env.reset(seed=2)
        env.own.x_m = env.goal_x
        env.own.y_m = env.goal_y
        env.own.speed_mps = P.V_MIN_MPS
        env.prev_goal_range = 0.0
        env.goal_hold_steps = 1
        _, reward_slow, _, _, _ = env.step(np.array([0.0, -1.0], dtype=np.float32))

        env.own.x_m = env.goal_x
        env.own.y_m = env.goal_y
        env.own.speed_mps = P.V_MAX_MPS
        env.prev_goal_range = 0.0
        env.goal_hold_steps = 1
        _, reward_fast, _, _, _ = env.step(np.array([0.0, 1.0], dtype=np.float32))

        self.assertGreater(reward_slow, reward_fast)
        self.assertGreater(W_HOLD_SPEED, 0.0)

    def test_cross_track_penalizes_lateral_offset(self):
        from rewards import apply_reward_overrides
        from train import BoatNavEnv

        apply_reward_overrides({"cross_track": 1.0, "cross_track_scale_m": 100.0})
        env = BoatNavEnv(
            mode="navigate",
            training_randomize=False,
            goal_hold_sec=5,
            current_enabled=False,
        )
        env.reset(seed=4)
        env.goal_x = 0.0
        env.goal_y = 500.0
        env.leg_start_x = 0.0
        env.leg_start_y = 0.0
        env.own.x_m = 0.0
        env.own.y_m = 100.0
        env.prev_goal_range = 400.0
        env.own.speed_mps = 4.0
        _, reward_on_track, _, _, _ = env.step(np.array([0.0, 0.0], dtype=np.float32))

        env.own.x_m = 100.0
        env.own.y_m = 100.0
        env.prev_goal_range = P.goal_range(env.own, env.goal_x, env.goal_y) + 5.0
        _, reward_offset, _, _, _ = env.step(np.array([0.0, 0.0], dtype=np.float32))

        self.assertGreater(reward_on_track, reward_offset)
        apply_reward_overrides({"cross_track": 0.0})

    def test_approach_zone_favors_slowing_down(self):
        from train import APPROACH_SLOW_RANGE_M, BoatNavEnv

        env = BoatNavEnv(
            mode="navigate",
            training_randomize=False,
            goal_hold_sec=5,
            current_enabled=False,
        )
        env.reset(seed=3)
        env.own.x_m = env.goal_x
        env.own.y_m = env.goal_y + APPROACH_SLOW_RANGE_M * 0.4
        env.prev_goal_range = APPROACH_SLOW_RANGE_M * 0.4
        env.goal_hold_steps = 0
        env.own.speed_mps = P.V_MIN_MPS
        _, reward_slow, _, _, _ = env.step(np.array([0.0, -1.0], dtype=np.float32))

        env.own.x_m = env.goal_x
        env.own.y_m = env.goal_y + APPROACH_SLOW_RANGE_M * 0.4
        env.prev_goal_range = APPROACH_SLOW_RANGE_M * 0.4
        env.goal_hold_steps = 0
        env.own.speed_mps = P.V_MAX_MPS
        _, reward_fast, _, _, _ = env.step(np.array([0.0, 1.0], dtype=np.float32))

        self.assertGreater(reward_slow, reward_fast)

    def test_cpa_penalty_weights_quadrupled(self):
        from train import W_CPA, W_CPA_SOFT

        self.assertEqual(W_CPA, 40.0)
        self.assertEqual(W_CPA_SOFT, 12.0)

    def test_threat_at_goal_rewards_leaving_waypoint(self):
        from train import BoatNavEnv, THREAT_PROGRESS_THRESH, contact_threat_and_cpa_penalty

        env = BoatNavEnv(
            mode="avoid",
            training_randomize=False,
            goal_hold_sec=30,
            current_enabled=False,
        )
        env.reset(seed=0)
        env.own.x_m = env.goal_x
        env.own.y_m = env.goal_y
        env.own.speed_mps = 2.0
        env.prev_goal_range = 0.0
        env.goal_hold_steps = 5

        # Intruder east of waypoint, closing west through the hold zone
        env.contacts = [
            P.ContactState(
                x_m=env.goal_x + 120.0,
                y_m=env.goal_y,
                cog_rad=-math.pi / 2,
                sog_mps=6.0,
                speed_mps=6.0,
                radius_m=P.VESSEL_CLASSES["workboat"],
                vessel_class="workboat",
            )
        ]
        _, threat = contact_threat_and_cpa_penalty(
            env.own, env.contacts, env.water_current, env.own_radius_m
        )
        self.assertGreaterEqual(threat, THREAT_PROGRESS_THRESH)

        env.prev_goal_range = 5.0
        stay_range = 8.0
        env.own.x_m = env.goal_x + stay_range
        env.own.y_m = env.goal_y
        _, reward_stay, _, _, _ = env.step(np.array([0.0, -0.5], dtype=np.float32))

        env.prev_goal_range = 5.0
        env.own.x_m = env.goal_x + 25.0
        env.own.y_m = env.goal_y
        env.goal_hold_steps = 5
        _, reward_leave, _, _, _ = env.step(np.array([0.0, 0.5], dtype=np.float32))

        self.assertGreater(reward_leave, reward_stay)

    def test_training_current_in_obs(self):
        from train import BoatNavEnv

        env = BoatNavEnv(
            mode="navigate",
            training_randomize=True,
            current_enabled=True,
        )
        obs, _ = env.reset(seed=0)
        expected = env.water_current.speed_mps / P.CURRENT_MAX_MPS
        self.assertAlmostEqual(obs[6], expected, places=4)
        self.assertLessEqual(env.water_current.speed_mps, P.CURRENT_MAX_MPS)

    def test_eval_samples_current_without_training_randomize(self):
        from train import BoatNavEnv

        seeds = [s for s in P.load_eval_seeds() if not s.contacts]
        self.assertTrue(seeds)
        env = BoatNavEnv(
            mode="navigate",
            scenario=seeds[0],
            training_randomize=False,
            dynamics_jitter=False,
            current_enabled=True,
        )
        env.reset(seed=10)
        c0 = env.water_current.speed_mps
        env.reset(seed=11)
        c1 = env.water_current.speed_mps
        self.assertNotEqual(c0, c1)

    def test_eval_samples_plant_when_jitter_on(self):
        from train import BoatNavEnv

        seeds = [s for s in P.load_eval_seeds() if not s.contacts]
        env = BoatNavEnv(
            mode="navigate",
            scenario=seeds[0],
            training_randomize=False,
            dynamics_jitter=True,
            current_enabled=False,
        )
        env.reset(seed=20)
        p0 = env.episode_plant.to_dict()
        env.reset(seed=21)
        p1 = env.episode_plant.to_dict()
        self.assertNotEqual(p0, p1)
        env.reset(seed=20)
        self.assertEqual(env.episode_plant.to_dict(), p0)


class TestTrainingHistory(unittest.TestCase):
    def test_history_skips_training_dir(self):
        data = TJ.training_history()
        for run in data["runs"]:
            self.assertNotEqual(run["run_id"], "_training")

    def test_metrics_files_parse(self):
        runs_dir = ROOT / "runs"
        if not runs_dir.exists():
            self.skipTest("no runs yet")
        for run_dir in runs_dir.iterdir():
            if not run_dir.is_dir() or run_dir.name.startswith("_"):
                continue
            metrics_path = run_dir / "metrics.json"
            if metrics_path.exists():
                payload = json.loads(metrics_path.read_text(encoding="utf-8"))
                self.assertIn("mode", payload)


class TestPlantDynamics(unittest.TestCase):
    def test_sample_plant_in_envelope(self):
        rng = np.random.default_rng(0)
        for _ in range(30):
            p = P.sample_plant_params(rng)
            self.assertGreaterEqual(p.tau_heading_s, P.PLANT_AGILE["tau_heading_s"])
            self.assertLessEqual(p.tau_heading_s, P.PLANT_FREIGHTER["tau_heading_s"])
            self.assertGreaterEqual(p.max_yaw_rate_deg_s, P.PLANT_FREIGHTER["max_yaw_rate_deg_s"])
            self.assertLessEqual(p.max_yaw_rate_deg_s, P.PLANT_AGILE["max_yaw_rate_deg_s"])

    def test_plant_lti_within_episode(self):
        from train import BoatNavEnv

        env = BoatNavEnv(mode="navigate", training_randomize=True, dynamics_jitter=True)
        env.reset(seed=99)
        p0 = env.episode_plant.to_dict()
        env.step(env.action_space.sample())
        self.assertEqual(env.episode_plant.to_dict(), p0)
        env.reset(seed=100)
        p1 = env.episode_plant.to_dict()
        self.assertNotEqual(p0, p1)


class TestScenarioSplit(unittest.TestCase):
    def test_train_eval_disjoint(self):
        from scenarios import generate_all_scenarios, split_train_eval

        train, eval_seeds = split_train_eval(generate_all_scenarios())
        train_names = {s.name for s in train}
        eval_names = {s.name for s in eval_seeds}
        self.assertFalse(train_names & eval_names)
        self.assertGreater(len(train), 50)
        self.assertGreater(len(eval_seeds), 20)

    def test_prepare_writes_both_splits(self):
        P.write_scenario_splits()
        train = P.load_train_seeds()
        eval_seeds = P.load_eval_seeds()
        self.assertGreater(len(train), 0)
        self.assertGreater(len(eval_seeds), 0)
        overlap = {s.name for s in train} & {s.name for s in eval_seeds}
        self.assertEqual(len(overlap), 0)


class TestRenderMontage(unittest.TestCase):
    def test_step_montage_writes_png(self):
        try:
            import render_montage as RM
        except ImportError:
            self.skipTest("render_montage not available")

        if RM.Image is None:
            self.skipTest("Pillow not installed")

        episode = {
            "scenario_name": "test",
            "success": True,
            "collision": False,
            "steps": [
                {
                    "t": t,
                    "own": {"x": float(t), "y": 0.0, "heading": 0.0, "speed": 3.0},
                    "goal": {"x": 100.0, "y": 0.0},
                    "contacts": [],
                }
                for t in range(5)
            ],
        }
        out = ROOT / "runs" / "_test_montage.png"
        meta = RM.render_step_montage([episode], out, max_episodes=1, step_cols=3, cell_w=64, cell_h=48)
        self.assertTrue(out.exists())
        self.assertGreater(meta["width_px"], 0)
        out.unlink(missing_ok=True)


class TestDeviceUtil(unittest.TestCase):
    def test_resolve_cpu(self):
        from device_util import resolve_device

        self.assertEqual(resolve_device("cpu"), "cpu")

    def test_torch_device_info_shape(self):
        from device_util import torch_device_info

        info = torch_device_info()
        self.assertIn("cuda_available", info)
        self.assertIn("torch_version", info)

    def test_configure_training_backend_cpu(self):
        from device_util import configure_training_backend

        configure_training_backend("cpu")


if __name__ == "__main__":
    unittest.main()
