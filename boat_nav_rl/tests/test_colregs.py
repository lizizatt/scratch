"""COLREGS geometry, safety, and trace evaluation tests."""

import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P
from colregs.config import ColregsConfig, SafetyCombineMode, load_config
from colregs.entry import assign_rule_from_category, assign_rule_from_pose
from colregs.geometry import Pose, pose_at, pose_from_track_at_cpa
from colregs.evaluate import evaluate_trace
from colregs.safety import analyze_safety, safety_range_score


class TestColregsGeometry(unittest.TestCase):
    def test_pose_conventions_fig2(self):
        # Own at origin heading north; contact east on parallel northbound track
        p_parallel = pose_at(0, 0, 0.0, 100, 0, 0.0)
        self.assertAlmostEqual(p_parallel.beta_deg, 90.0, delta=0.5)
        self.assertAlmostEqual(abs(p_parallel.alpha_deg), 90.0, delta=0.5)

        # Contact ahead on same track
        p_ahead = pose_at(0, 0, 0.0, 0, 200, 0.0)
        self.assertAlmostEqual(p_ahead.beta_deg, 0.0, delta=0.5)

    def test_pose_from_track_finds_cpa_step(self):
        steps = []
        for t in range(5):
            steps.append(
                {
                    "t": t,
                    "own": {"x": 0.0, "y": float(t * 10), "heading": 0.0, "speed": 4.0},
                    "contacts": [
                        {
                            "x": 50.0,
                            "y": float(t * 10),
                            "cog": -math.pi / 2,
                            "sog": 4.0,
                            "radius_m": 15.0,
                            "vessel_class": "workboat",
                        }
                    ],
                }
            )
        pose, r_cpa, tcpa, idx = pose_from_track_at_cpa(steps, 0)
        self.assertIsNotNone(pose)
        self.assertLess(r_cpa, 60.0)
        self.assertGreaterEqual(idx, 0)


class TestColregsSafety(unittest.TestCase):
    def setUp(self) -> None:
        self.cfg = load_config()

    def test_range_score_anchors(self):
        r_col = self.cfg.R_col_m(15.0, 15.0)
        self.assertAlmostEqual(
            safety_range_score(self.cfg.R_pref_m, self.cfg, contact_radius_m=15.0, own_radius_m=15.0),
            100.0,
        )
        self.assertAlmostEqual(
            safety_range_score(r_col, self.cfg, contact_radius_m=15.0, own_radius_m=15.0),
            self.cfg.S_Rcol,
        )

    def test_bow_aspect_lower_pose_score_than_beam(self):
        cfg = ColregsConfig(safety_combine_mode=SafetyCombineMode.POSE_ONLY)
        bow = analyze_safety(200.0, Pose(alpha_deg=0.0, beta_deg=0.0), cfg, contact_radius_m=15.0, own_radius_m=15.0)
        beam = analyze_safety(200.0, Pose(alpha_deg=90.0, beta_deg=90.0), cfg, contact_radius_m=15.0, own_radius_m=15.0)
        self.assertLess(bow, beam)

    def test_multiplicative_mode(self):
        cfg = ColregsConfig(safety_combine_mode=SafetyCombineMode.MULTIPLICATIVE)
        s = analyze_safety(
            self.cfg.R_pref_m,
            Pose(alpha_deg=90.0, beta_deg=90.0),
            cfg,
            contact_radius_m=15.0,
            own_radius_m=15.0,
        )
        self.assertAlmostEqual(s, 100.0, delta=0.1)


class TestColregsEntry(unittest.TestCase):
    def test_category_maps_head_on(self):
        rule = assign_rule_from_category("traffic/base_t_head_on")
        self.assertIsNotNone(rule)
        assert rule is not None
        self.assertEqual(rule.rule_id, "R14")

    def test_pose_entry_crossing_give_way(self):
        cfg = load_config()
        rule = assign_rule_from_pose(Pose(alpha_deg=5.0, beta_deg=45.0), cfg)
        self.assertEqual(rule.rule_id, "R15/16")


class TestColregsEvaluateTrace(unittest.TestCase):
    def test_evaluate_trace_on_synthetic_episode(self):
        contact = P.ContactState(
            x_m=400.0,
            y_m=0.0,
            cog_rad=0.0,
            sog_mps=0.0,
            speed_mps=0.0,
            radius_m=15.0,
            vessel_class="workboat",
        )
        steps = []
        for t in range(10):
            own = P.VesselState(x_m=0.0, y_m=float(t * 20), heading_rad=0.0, speed_mps=4.0)
            steps.append(P.snapshot_step(t, own, 0.0, 1000.0, [contact]))
        encounters = evaluate_trace(steps, scenario_category="traffic/base_t_crossing_stbd")
        self.assertEqual(len(encounters), 1)
        self.assertFalse(encounters[0].collision)
        self.assertGreater(encounters[0].safety_S, 0.0)
        self.assertEqual(encounters[0].rule.rule_id, "R15/16")


if __name__ == "__main__":
    unittest.main()
