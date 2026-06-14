"""Traffic, CPA geometry, and vessel size tests."""

import math
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P


class TestVesselSizes(unittest.TestCase):
    def test_contact_from_polar_includes_radius(self):
        c = P.contact_from_polar(0, 0, 45, 500, 270, 4.0, vessel_class="freighter")
        self.assertEqual(c["vessel_class"], "freighter")
        self.assertEqual(c["radius_m"], P.VESSEL_CLASSES["freighter"])

    def test_size_aware_collision(self):
        own = P.VesselState(x_m=0.0, y_m=0.0)
        contact = P.ContactState(
            x_m=30.0,
            y_m=0.0,
            cog_rad=0.0,
            sog_mps=0.0,
            speed_mps=0.0,
            radius_m=8.0,
            vessel_class="dinghy",
        )
        self.assertFalse(P.check_collision(own, [contact], own_radius_m=15.0))
        contact.x_m = 22.0
        self.assertTrue(P.check_collision(own, [contact], own_radius_m=15.0))

    def test_obs_contact_radius_slot(self):
        own = P.VesselState()
        contact = P.ContactState(
            x_m=100.0,
            y_m=500.0,
            cog_rad=0.0,
            sog_mps=3.0,
            speed_mps=3.0,
            radius_m=35.0,
            vessel_class="freighter",
        )
        obs = P.pack_observation(own, 0.0, 900.0, True, [contact], 0.0, 0.0)
        self.assertAlmostEqual(obs[9 + 6], 35.0 / P.RADIUS_SCALE_M, places=4)


class TestCpaGeometry(unittest.TestCase):
    def test_head_on_cpa_at_meeting_point(self):
        cpa_m, tcpa = P.compute_cpa_tcpa(
            0.0,
            0.0,
            0.0,
            4.0,
            0.0,
            600.0,
            0.0,
            -5.0,
        )
        self.assertAlmostEqual(cpa_m, 0.0, delta=1.0)
        self.assertGreater(tcpa, 0.0)

    def test_parallel_tracks_use_current_range(self):
        cpa_m, tcpa = P.compute_cpa_tcpa(
            0.0,
            0.0,
            0.0,
            4.0,
            200.0,
            0.0,
            0.0,
            4.0,
        )
        self.assertAlmostEqual(cpa_m, 200.0, delta=1.0)
        self.assertEqual(tcpa, float("inf"))

    def test_stationary_obstruction_cpa(self):
        cpa_m, tcpa = P.compute_cpa_tcpa(
            0.0,
            0.0,
            0.0,
            4.0,
            0.0,
            200.0,
            0.0,
            0.0,
        )
        self.assertAlmostEqual(cpa_m, 0.0, delta=1.0)
        self.assertAlmostEqual(tcpa, 50.0, delta=1.0)

    def test_cpa_safe_distance_scales_with_size(self):
        small = P.cpa_safe_distance(P.VESSEL_CLASSES["dinghy"])
        large = P.cpa_safe_distance(P.VESSEL_CLASSES["freighter"])
        self.assertGreater(large, small)


class TestContactObsNoise(unittest.TestCase):
    def test_noise_changes_sensed_range_not_true_state(self):
        own = P.VesselState()
        contact = P.ContactState(
            x_m=0.0,
            y_m=500.0,
            cog_rad=0.0,
            sog_mps=0.0,
            speed_mps=0.0,
            radius_m=15.0,
        )
        clean = P.pack_observation(own, 0.0, 900.0, True, [contact], 0.0, 0.0)
        rng = np.random.default_rng(123)
        noisy = P.pack_observation(
            own,
            0.0,
            900.0,
            True,
            [contact],
            0.0,
            0.0,
            contact_noise_m=50.0,
            contact_noise_bearing_rad=0.2,
            rng=rng,
        )
        self.assertNotAlmostEqual(clean[11], noisy[11], places=3)
        self.assertAlmostEqual(contact.y_m, 500.0, places=4)


class TestScenarioTemplates(unittest.TestCase):
    def test_all_scenarios_unified_mode(self):
        from scenarios import generate_all_scenarios

        seeds = generate_all_scenarios()
        self.assertGreater(len(seeds), 100)
        self.assertTrue(all(s.mode == "navigate" for s in seeds))

    def test_traffic_and_clear_categories(self):
        from scenarios import generate_all_scenarios

        cats = {s.category for s in generate_all_scenarios()}
        self.assertTrue(any(c.startswith("clear/") for c in cats))
        self.assertTrue(any(c.startswith("traffic/") for c in cats))
        self.assertIn("traffic/stationary", cats)


class TestRunEvalReturn(unittest.TestCase):
    def test_run_robust_eval_accepts_metrics_only_from_run_eval(self):
        from unittest import mock

        from train import run_robust_eval

        fake_metrics = {"avoid_score": 0.42, "nav_score": 0.5}
        with mock.patch("train.run_eval", return_value=fake_metrics):
            result = run_robust_eval(mock.Mock(), "avoid")
        self.assertAlmostEqual(result["robust_eval_score"], 0.42, places=4)
        self.assertEqual(result["robust_eval_samples"], 5)


class TestTrainContactCount(unittest.TestCase):
    def test_training_randomizes_one_to_max_contacts(self):
        from train import BoatNavEnv, TRAIN_MAX_CONTACTS

        seeds = [s for s in P.load_train_seeds() if s.contacts][:30]
        self.assertTrue(seeds)
        env = BoatNavEnv(mode="avoid", train_seeds=seeds, training_randomize=True)
        counts = set()
        for seed in range(120):
            obs, _ = env.reset(seed=seed)
            n = len(env.contacts)
            counts.add(n)
            mask_sum = int(obs[65:73].sum())
            self.assertEqual(mask_sum, n)
            self.assertGreaterEqual(n, 1)
            self.assertLessEqual(n, TRAIN_MAX_CONTACTS)
        self.assertGreater(max(counts), 1)

    def test_eval_scenario_keeps_fixed_contact_count(self):
        from train import BoatNavEnv

        seeds = [s for s in P.load_eval_seeds() if len(s.contacts) == 1][:5]
        self.assertTrue(seeds)
        env = BoatNavEnv(
            mode="avoid",
            scenario=seeds[0],
            training_randomize=False,
        )
        for seed in (1, 2, 3):
            env.reset(seed=seed)
            self.assertEqual(len(env.contacts), 1)


if __name__ == "__main__":
    unittest.main()
