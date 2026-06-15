"""Tests for run analysis and reward override helpers."""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P
from rewards import W_HOLD_SPEED, apply_reward_overrides, reward_weights_dict
from run_analysis import episode_diagnostics


class TestRewardOverrides(unittest.TestCase):
    def test_apply_reward_overrides(self):
        original = W_HOLD_SPEED
        try:
            applied = apply_reward_overrides({"hold_speed": 9.99})
            self.assertEqual(applied["hold_speed"], 9.99)
            self.assertEqual(reward_weights_dict()["hold_speed"], 9.99)
        finally:
            apply_reward_overrides({"hold_speed": original})

    def test_legacy_hold_station_alias(self):
        original = W_HOLD_SPEED
        try:
            applied = apply_reward_overrides({"hold_station": 7.5})
            self.assertEqual(applied["hold_speed"], 7.5)
        finally:
            apply_reward_overrides({"hold_speed": original})

    def test_deprecated_energy_ignored(self):
        applied = apply_reward_overrides({"energy": 0.99})
        self.assertEqual(applied, {})

    def test_unknown_keys_ignored(self):
        applied = apply_reward_overrides({"not_a_weight": 1.0})
        self.assertEqual(applied, {})


class TestRunAnalysis(unittest.TestCase):
    def test_episode_diagnostics_goal_zone_speed(self):
        episode = {
            "steps": [
                {
                    "own": {"x": 0.0, "y": 0.0, "speed": P.V_MAX_MPS},
                    "goal": {"x": 0.0, "y": 100.0},
                },
                {
                    "own": {"x": 0.0, "y": 48.0, "speed": P.V_MIN_MPS},
                    "goal": {"x": 0.0, "y": 50.0},
                },
            ]
        }
        diag = episode_diagnostics(episode)
        self.assertAlmostEqual(diag["mean_goal_zone_speed_mps"], P.V_MIN_MPS, places=3)
        self.assertEqual(diag["goal_zone_steps"], 1)


if __name__ == "__main__":
    unittest.main()
