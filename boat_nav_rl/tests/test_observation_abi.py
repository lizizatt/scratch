"""Golden-vector tests for observation ABI (Python pack_observation vs header layout)."""

import math
import unittest

import numpy as np

import prepare as P


class TestObservationAbi(unittest.TestCase):
    def test_schema_version_matches_header(self):
        self.assertEqual(P.OBS_SCHEMA_VERSION, 4)
        self.assertEqual(P.OBS_DIM, 85)

    def test_flat_layout_offsets_match_header(self):
        self.assertEqual(P.OBS_MASK_OFFSET, 73)
        self.assertEqual(P.OBS_GOAL_OFFSET, 81)
        self.assertEqual(P.OBS_HAS_GOAL_OFFSET, 84)
        self.assertEqual(P.OBS_DIM, P.OBS_HAS_GOAL_OFFSET + 1)

    def test_golden_vector_no_contacts(self):
        own = P.VesselState(
            x_m=100.0,
            y_m=-50.0,
            heading_rad=math.radians(30.0),
            speed_mps=4.0,
            yaw_rate_rps=0.05,
        )
        current = P.WaterCurrent(vx_mps=0.2, vy_mps=0.1)
        obs = P.pack_observation(
            own,
            goal_x=100.0,
            goal_y=450.0,
            has_goal=True,
            contacts=[],
            origin_x=100.0,
            origin_y=-50.0,
            current=current,
        )
        self.assertEqual(obs.shape, (P.OBS_DIM,))
        self.assertAlmostEqual(obs[0], math.radians(30.0) / math.pi, places=5)
        self.assertAlmostEqual(obs[1], 4.0 / P.SPEED_SCALE_MPS, places=5)
        self.assertAlmostEqual(obs[2], 0.05 / P.YAW_RATE_SCALE_RPS, places=5)
        self.assertAlmostEqual(obs[3], 0.0, places=5)
        self.assertAlmostEqual(obs[4], 0.0, places=5)
        self.assertAlmostEqual(obs[5], 0.0, places=5)
        self.assertAlmostEqual(obs[6], current.speed_mps / P.CURRENT_MAX_MPS, places=5)
        self.assertAlmostEqual(obs[7], math.sin(current.direction_rad), places=5)
        self.assertAlmostEqual(obs[8], math.cos(current.direction_rad), places=5)
        self.assertEqual(obs[P.OBS_MASK_OFFSET : P.OBS_GOAL_OFFSET].sum(), 0.0)
        g_brg, g_rng = P.bearing_range(own.x_m, own.y_m, 100.0, 450.0)
        self.assertAlmostEqual(obs[P.OBS_GOAL_OFFSET], math.sin(g_brg), places=5)
        self.assertAlmostEqual(obs[P.OBS_GOAL_OFFSET + 1], math.cos(g_brg), places=5)
        self.assertAlmostEqual(
            obs[P.OBS_GOAL_OFFSET + 2], min(g_rng / P.RANGE_SCALE_M, 1.0), places=5
        )
        self.assertAlmostEqual(obs[P.OBS_HAS_GOAL_OFFSET], 1.0, places=5)

    def test_golden_vector_one_contact_relative_motion(self):
        own = P.VesselState(x_m=0.0, y_m=0.0, heading_rad=0.0, speed_mps=3.0)
        contact = P.ContactState(
            x_m=0.0,
            y_m=200.0,
            cog_rad=math.pi,
            sog_mps=2.0,
            speed_mps=2.0,
            radius_m=P.VESSEL_CLASSES["freighter"],
            vessel_class="freighter",
        )
        obs = P.pack_observation(own, 500.0, 0.0, True, [contact], 0.0, 0.0)
        base = P.OBS_OWN_DIM + P.OBS_CURRENT_DIM
        self.assertAlmostEqual(obs[P.OBS_MASK_OFFSET], 1.0, places=5)
        rel_cog_sin, rel_cog_cos, rel_fwd, rel_stbd = P.contact_relative_motion(
            own, contact
        )
        self.assertAlmostEqual(obs[base + 3], rel_cog_sin, places=5)
        self.assertAlmostEqual(obs[base + 4], rel_cog_cos, places=5)
        self.assertAlmostEqual(obs[base + 5], rel_fwd / P.REL_VEL_SCALE_MPS, places=5)
        self.assertAlmostEqual(obs[base + 6], rel_stbd / P.REL_VEL_SCALE_MPS, places=5)
        self.assertAlmostEqual(
            obs[base + 7],
            contact.radius_m / P.RADIUS_SCALE_M,
            places=5,
        )
        self.assertAlmostEqual(rel_fwd, -5.0, places=5)
        self.assertAlmostEqual(rel_stbd, 0.0, places=5)

    def test_relative_cog_rotates_with_own_heading(self):
        contact = P.ContactState(
            x_m=100.0,
            y_m=0.0,
            cog_rad=math.radians(90.0),
            sog_mps=4.0,
            speed_mps=4.0,
        )
        own_a = P.VesselState(heading_rad=0.0, speed_mps=3.0)
        own_b = P.VesselState(heading_rad=math.radians(90.0), speed_mps=3.0)
        _, cos_a, _, _ = P.contact_relative_motion(own_a, contact)
        _, cos_b, _, _ = P.contact_relative_motion(own_b, contact)
        self.assertAlmostEqual(cos_a, math.cos(math.radians(90.0)), places=5)
        self.assertAlmostEqual(cos_b, 1.0, places=5)

    def test_golden_vector_digest(self):
        """Regression fingerprint — update only when OBS layout changes intentionally."""
        own = P.VesselState(x_m=0.0, y_m=0.0, heading_rad=0.0, speed_mps=2.0)
        obs = P.pack_observation(own, 100.0, 0.0, True, [], 0.0, 0.0)
        digest = float(np.round(obs, 4).sum())
        self.assertAlmostEqual(digest, 3.3, places=3)


if __name__ == "__main__":
    unittest.main()
