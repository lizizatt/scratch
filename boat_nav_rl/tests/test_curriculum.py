"""Curriculum phase filters and exit gates."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P
from curriculum import check_exit, filter_seeds_by_prefix, get_phase, is_summary_better, list_ui_training_presets, metrics_to_summary
from rewards import set_gated_hold_enabled, is_hold_stationary


class TestCurriculumFilter(unittest.TestCase):
    def test_filter_traffic_prefix(self):
        seeds = P.load_eval_seeds()
        out = filter_seeds_by_prefix(seeds, ["traffic/crossing_stbd"])
        self.assertTrue(out)
        self.assertTrue(all(s.category.startswith("traffic/crossing_stbd") for s in out))

    def test_empty_prefix_returns_all(self):
        seeds = P.load_eval_seeds()[:5]
        self.assertEqual(len(filter_seeds_by_prefix(seeds, [])), 5)


class TestCurriculumExit(unittest.TestCase):
    def test_phase0_pass(self):
        phase = get_phase(0)
        ok, _ = check_exit(
            phase,
            {
                "success_rate": 0.8,
                "mean_speed_mps": 5.0,
                "mean_goal_zone_speed_mps": 0.2,
                "pct_goal_zone_at_min_speed": 0.55,
                "eval_episodes": 23,
            },
        )
        self.assertTrue(ok)

    def test_gated_hold_disabled(self):
        set_gated_hold_enabled(False)
        try:
            self.assertTrue(is_hold_stationary(8.0))
        finally:
            set_gated_hold_enabled(True)

    def test_is_summary_better_passes_gate(self):
        phase = get_phase(0)
        failing = {"success_rate": 0.5, "mean_speed_mps": 5.0, "eval_episodes": 10}
        passing = {"success_rate": 0.8, "mean_speed_mps": 5.0, "eval_episodes": 10}
        self.assertTrue(is_summary_better(phase, passing, failing))


class TestUiTrainingPresets(unittest.TestCase):
    def test_list_ui_training_presets(self):
        presets = list_ui_training_presets()
        self.assertGreaterEqual(len(presets), 3)
        quick = next(p for p in presets if p["id"] == "quick_start")
        self.assertEqual(quick["mode"], "navigate")
        self.assertEqual(quick["goal_hold_sec"], P.DEFAULT_GOAL_HOLD_SEC_UI)
        self.assertEqual(quick.get("snapshot_interval_min"), 30)
        phase1 = next(p for p in presets if p["id"] == "phase1")
        self.assertEqual(phase1["mode"], "avoid")
        self.assertFalse(phase1["gated_hold"])
        self.assertIsInstance(phase1["scenario_category_prefixes"], list)


if __name__ == "__main__":
    unittest.main()
