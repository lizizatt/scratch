"""Golden-vector tests for observation ABI (Python pack_observation vs header layout)."""

import math
import unittest

import numpy as np

import prepare as P


class TestObservationAbi(unittest.TestCase):
    def test_schema_version_matches_header(self):
        self.assertEqual(P.OBS_SCHEMA_VERSION, 3)
        self.assertEqual(P.OBS_DIM, 77)

    def test_flat_layout_offsets_match_header(self):
        self.assertEqual(P.OBS_MASK_OFFSET, 65)
        self.assertEqual(P.OBS_GOAL_OFFSET, 73)
        self.assertEqual(P.OBS_HAS_GOAL_OFFSET, 76)
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

    def test_golden_vector_one_contact_radius_slot(self):
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
        self.assertAlmostEqual(
            obs[base + 6],
            contact.radius_m / P.RADIUS_SCALE_M,
            places=5,
            msg="contact slot 6 must be normalized radius (schema v3)",
        )
        self.assertAlmostEqual(obs[base + 5], 2.0 / P.SPEED_SCALE_MPS, places=5)

    def test_golden_vector_digest(self):
        """Regression fingerprint — update only when OBS layout changes intentionally."""
        own = P.VesselState(x_m=0.0, y_m=0.0, heading_rad=0.0, speed_mps=2.0)
        obs = P.pack_observation(own, 100.0, 0.0, True, [], 0.0, 0.0)
        digest = float(np.round(obs, 4).sum())
        self.assertAlmostEqual(digest, 3.3, places=3)
