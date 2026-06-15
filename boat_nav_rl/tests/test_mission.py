"""NavigationMission controller tests."""

import math
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P
import scenarios as SC
from mission import NavigationMission, scenario_waypoint_events


class TestNavigationMission(unittest.TestCase):
    def test_legacy_relocate_events(self):
        seed = SC.generate_goal_relocate_scenarios()[0]
        events = scenario_waypoint_events(seed)
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0].trigger, "start")
        self.assertEqual(events[1].trigger, "delay_sec")

    def test_delay_fires_and_resets_hold(self):
        seed = SC.generate_goal_relocate_scenarios()[0]
        mission = NavigationMission.from_scenario(seed, np.random.default_rng(0), dt_s=P.DT_S)
        self.assertFalse(mission.is_on_final_leg())

        tr = None
        for step in range(1, 50):
            tr = mission.check_scheduled(
                step,
                0.0,
                0.0,
                curr_goal_range=10.0,
                initial_goal_range=10.0,
                goal_range_fn=P.goal_range_xy,
            )
            if tr is not None:
                break
        self.assertIsNotNone(tr)
        assert tr is not None
        self.assertGreater(math.hypot(tr.goal_x, tr.goal_y), 100.0)
        self.assertTrue(mission.is_on_final_leg())

    def test_set_goal_ignores_duplicate(self):
        mission = NavigationMission.single_goal(100.0, 200.0, np.random.default_rng(0))
        tr = mission.set_goal(0.0, 0.0, 100.0, 200.0, 100.0, 200.0, P.goal_range_xy)
        self.assertIsNone(tr)
        tr2 = mission.set_goal(0.0, 0.0, 400.0, 0.0, 100.0, 200.0, P.goal_range_xy)
        self.assertIsNotNone(tr2)
        assert tr2 is not None
        self.assertAlmostEqual(tr2.leg_start_x, 0.0)
        self.assertAlmostEqual(tr2.goal_x, 400.0)

    def test_multi_leg_hold_advance(self):
        seeds = SC.generate_multi_leg_scenarios()
        two_leg = next(s for s in seeds if s.name.startswith("multi_leg_2x"))
        mission = NavigationMission.from_scenario(two_leg, np.random.default_rng(1), dt_s=P.DT_S)
        self.assertEqual(len(mission.pending), 1)
        tr = mission.check_hold_advance(
            0.0,
            0.0,
            in_goal_zone=True,
            goal_hold_steps=30,
            goal_hold_steps_required=30,
            goal_range_fn=P.goal_range_xy,
        )
        self.assertIsNotNone(tr)
        self.assertTrue(mission.is_on_final_leg())


if __name__ == "__main__":
    unittest.main()
