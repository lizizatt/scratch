"""Tests for extracted reward logic and incremental frame scoring."""

import math
import sys
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P
from colregs.frame_series import frame_score_series, frame_score_series_naive
from rewards import (
    APPROACH_SLOW_RANGE_M,
    CPA_WARNING_MULT,
    REWARD_CLIP,
    THREAT_PROGRESS_THRESH,
    W_COLLISION,
    W_CPA,
    W_CPA_SOFT,
    W_GOAL_ARRIVAL,
    W_GOAL_ARRIVAL_EARLY,
    W_GOAL_PROGRESS,
    W_GOAL_THREAT_STAY,
    W_HOLD_BASE,
    W_HOLD_CENTER,
    W_HOLD_SPEED,
    W_SMOOTH,
    StepRewardInput,
    aggregate_episode_breakdowns,
    compute_step_reward,
    contact_step_metrics,
    contact_threat_and_cpa_penalty,
    cross_track_step_penalty,
    energy_score_from_speeds,
    energy_score_from_trace,
    hold_overspeed_penalty,
    is_hold_stationary,
    reward_weights_dict,
)


def _input(**overrides) -> StepRewardInput:
    defaults = {
        "own": P.VesselState(x_m=0.0, y_m=0.0, heading_rad=0.0, speed_mps=4.0),
        "goal_x": 0.0,
        "goal_y": 500.0,
        "water_current": P.WaterCurrent(),
        "curr_goal_range": 500.0,
        "initial_goal_range": 500.0,
        "prev_goal_range": 505.0,
        "leg_start_x": 0.0,
        "leg_start_y": 0.0,
        "goal_hold_steps": 0,
        "step_count": 1,
        "max_steps": 330,
        "action": np.array([0.0, 0.0], dtype=np.float32),
        "prev_action": np.zeros(2, dtype=np.float32),
        "in_goal_zone": False,
        "threat": 0.0,
        "cpa_penalty": 0.0,
        "collision": False,
        "cpa_unsafe": False,
    }
    defaults.update(overrides)
    return StepRewardInput(**defaults)


def _assert_breakdown_sums(testcase, out):
    testcase.assertAlmostEqual(sum(out.breakdown.values()), out.reward, places=4)


class TestRewardWeights(unittest.TestCase):
    def test_reward_weights_dict_covers_all_weights(self):
        weights = reward_weights_dict()
        for key in (
            "goal_progress",
            "goal_arrival",
            "goal_arrival_early",
            "hold_base",
            "hold_speed",
            "hold_center",
            "approach_slow",
            "cpa",
            "cpa_soft",
            "goal_threat_stay",
            "collision",
            "cross_track",
        ):
            self.assertIn(key, weights)

    def test_cross_track_default_nonzero(self):
        from rewards import RewardConfig

        cfg = RewardConfig()
        self.assertGreater(cfg.w_cross_track, 0.0)
        self.assertEqual(cfg.w_cross_track, 0.65)
        self.assertEqual(cfg.cross_track_scale_m, 60.0)


class TestContactStepMetrics(unittest.TestCase):
    def test_empty_contacts(self):
        own = P.VesselState(speed_mps=4.0)
        metrics = contact_step_metrics(own, [], P.WaterCurrent(), P.OWN_RADIUS_M)
        self.assertEqual(metrics.cpa_penalty, 0.0)
        self.assertEqual(metrics.threat, 0.0)
        self.assertFalse(metrics.collision)
        self.assertFalse(metrics.cpa_unsafe)
        self.assertIsNone(metrics.min_cpa_m)

    def test_records_range_and_cpa(self):
        own = P.VesselState(x_m=0.0, y_m=0.0, heading_rad=0.0, speed_mps=4.0)
        contact = P.ContactState(
            x_m=300.0,
            y_m=0.0,
            cog_rad=math.pi,
            sog_mps=4.0,
            speed_mps=4.0,
            radius_m=15.0,
            vessel_class="workboat",
        )
        metrics = contact_step_metrics(own, [contact], P.WaterCurrent(), P.OWN_RADIUS_M)
        self.assertLess(metrics.min_range_m, 301.0)
        self.assertIsNotNone(metrics.min_cpa_m)

    def test_hard_cpa_penalty_when_unsafe(self):
        own = P.VesselState(x_m=0.0, y_m=0.0, heading_rad=0.0, speed_mps=5.0)
        contact = P.ContactState(
            x_m=0.0,
            y_m=80.0,
            cog_rad=math.pi,
            sog_mps=5.0,
            speed_mps=5.0,
            radius_m=15.0,
            vessel_class="workboat",
        )
        metrics = contact_step_metrics(own, [contact], P.WaterCurrent(), P.OWN_RADIUS_M)
        self.assertGreater(metrics.cpa_penalty, 0.0)
        self.assertGreater(metrics.threat, 0.0)
        self.assertTrue(metrics.cpa_unsafe)
        self.assertGreaterEqual(metrics.cpa_penalty, W_CPA * 0.5)

    def test_soft_cpa_warning_band(self):
        own = P.VesselState(x_m=0.0, y_m=0.0, heading_rad=0.0, speed_mps=4.0)
        safe = P.cpa_safe_distance(15.0, P.OWN_RADIUS_M)
        contact = P.ContactState(
            x_m=70.0,
            y_m=150.0,
            cog_rad=math.pi,
            sog_mps=4.0,
            speed_mps=4.0,
            radius_m=15.0,
            vessel_class="workboat",
        )
        metrics = contact_step_metrics(own, [contact], P.WaterCurrent(), P.OWN_RADIUS_M)
        self.assertGreater(metrics.cpa_penalty, 0.0)
        self.assertLess(metrics.cpa_penalty, W_CPA)
        self.assertGreater(metrics.min_cpa_m, safe)
        self.assertLess(metrics.min_cpa_m, safe * CPA_WARNING_MULT)
        self.assertFalse(metrics.cpa_unsafe)

    def test_contact_threat_wrapper_matches_metrics(self):
        own = P.VesselState(x_m=0.0, y_m=0.0, heading_rad=0.0, speed_mps=4.0)
        contact = P.ContactState(
            x_m=300.0,
            y_m=0.0,
            cog_rad=math.pi,
            sog_mps=4.0,
            speed_mps=4.0,
            radius_m=15.0,
            vessel_class="workboat",
        )
        metrics = contact_step_metrics(own, [contact], P.WaterCurrent(), P.OWN_RADIUS_M)
        penalty, threat = contact_threat_and_cpa_penalty(
            own, [contact], P.WaterCurrent(), P.OWN_RADIUS_M
        )
        self.assertEqual(penalty, metrics.cpa_penalty)
        self.assertEqual(threat, metrics.threat)


class TestComputeStepReward(unittest.TestCase):
    def test_en_route_breakdown_components(self):
        out = compute_step_reward(_input())
        _assert_breakdown_sums(self, out)
        self.assertIn("progress", out.breakdown)
        self.assertIn("cross_track", out.breakdown)
        self.assertIn("smooth", out.breakdown)
        self.assertNotIn("time", out.breakdown)
        self.assertNotIn("energy", out.breakdown)

    def test_approach_zone_adds_slow_bonus(self):
        base = compute_step_reward(
            _input(
                curr_goal_range=APPROACH_SLOW_RANGE_M * 0.5,
                prev_goal_range=APPROACH_SLOW_RANGE_M * 0.5 + 1.0,
                own=P.VesselState(speed_mps=P.V_MIN_MPS),
            )
        )
        fast = compute_step_reward(
            _input(
                curr_goal_range=500.0,
                prev_goal_range=505.0,
                own=P.VesselState(speed_mps=P.V_MAX_MPS),
            )
        )
        _assert_breakdown_sums(self, base)
        self.assertIn("approach_slow", base.breakdown)
        self.assertGreater(base.breakdown["approach_slow"], 0.0)
        self.assertNotIn("approach_slow", fast.breakdown)

    def test_progress_rewards_approach(self):
        out = compute_step_reward(
            _input(curr_goal_range=400.0, prev_goal_range=410.0)
        )
        self.assertGreater(out.breakdown["progress"], 0.0)
        _assert_breakdown_sums(self, out)

    def test_progress_penalizes_retreat_when_not_threatened(self):
        out = compute_step_reward(
            _input(curr_goal_range=410.0, prev_goal_range=400.0)
        )
        self.assertLess(out.breakdown["progress"], 0.0)

    def test_goal_zone_first_entry_bonuses(self):
        out = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=10.0,
                prev_goal_range=12.0,
                goal_hold_steps=0,
                step_count=10,
                own=P.VesselState(speed_mps=P.V_MIN_MPS),
            )
        )
        _assert_breakdown_sums(self, out)
        self.assertGreaterEqual(out.breakdown["goal_arrival"], W_GOAL_ARRIVAL)
        self.assertIn("hold_speed", out.breakdown)
        self.assertEqual(out.goal_hold_steps, 1)

    def test_hold_speed_prefers_slow_speed(self):
        slow = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=5.0,
                prev_goal_range=5.0,
                goal_hold_steps=1,
                own=P.VesselState(speed_mps=P.V_MIN_MPS),
            )
        )
        fast = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=5.0,
                prev_goal_range=5.0,
                goal_hold_steps=1,
                own=P.VesselState(speed_mps=P.V_MAX_MPS),
            )
        )
        self.assertGreater(slow.breakdown["hold_speed"], fast.breakdown.get("hold_speed", 0.0))
        self.assertIn("hold_overspeed", fast.breakdown)

    def test_hold_center_penalizes_offset_from_waypoint(self):
        out = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=40.0,
                prev_goal_range=40.0,
                goal_hold_steps=2,
                own=P.VesselState(speed_mps=P.V_MIN_MPS),
            )
        )
        self.assertLess(out.breakdown["hold_center"], 0.0)

    def test_threat_at_goal_rewards_escape_over_stay(self):
        threat = max(THREAT_PROGRESS_THRESH, 0.5)
        stay = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=20.0,
                prev_goal_range=10.0,
                goal_hold_steps=3,
                threat=threat,
            )
        )
        leave = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=30.0,
                prev_goal_range=10.0,
                goal_hold_steps=3,
                threat=threat,
            )
        )
        _assert_breakdown_sums(self, stay)
        _assert_breakdown_sums(self, leave)
        self.assertIn("goal_threat_stay", stay.breakdown)
        self.assertGreater(leave.reward, stay.reward)

    def test_cpa_unsafe_blocks_hold_rewards_and_counter(self):
        calm = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=5.0,
                prev_goal_range=5.0,
                goal_hold_steps=1,
                cpa_unsafe=False,
                own=P.VesselState(speed_mps=P.V_MIN_MPS),
            )
        )
        unsafe = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=5.0,
                prev_goal_range=5.0,
                goal_hold_steps=1,
                cpa_unsafe=True,
                own=P.VesselState(speed_mps=P.V_MIN_MPS),
            )
        )
        self.assertIn("hold_speed", calm.breakdown)
        self.assertNotIn("hold_speed", unsafe.breakdown)
        self.assertEqual(calm.goal_hold_steps, 2)
        self.assertEqual(unsafe.goal_hold_steps, 1)
        self.assertIn("goal_threat_stay", unsafe.breakdown)

    def test_cpa_unsafe_blocks_first_reach_bonus(self):
        out = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=5.0,
                prev_goal_range=8.0,
                goal_hold_steps=0,
                cpa_unsafe=True,
                own=P.VesselState(speed_mps=P.V_MIN_MPS),
            )
        )
        self.assertNotIn("goal_arrival", out.breakdown)
        self.assertEqual(out.goal_hold_steps, 0)

    def test_hold_counter_requires_stationary_speed(self):
        slow = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=5.0,
                prev_goal_range=5.0,
                goal_hold_steps=1,
                own=P.VesselState(speed_mps=P.V_MIN_MPS),
            )
        )
        fast = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=5.0,
                prev_goal_range=5.0,
                goal_hold_steps=1,
                own=P.VesselState(speed_mps=P.V_MAX_MPS),
            )
        )
        self.assertEqual(slow.goal_hold_steps, 2)
        self.assertEqual(fast.goal_hold_steps, 1)
        self.assertIn("hold_overspeed", fast.breakdown)
        self.assertLess(fast.breakdown["hold_overspeed"], 0.0)
        self.assertNotIn("hold_speed", fast.breakdown)

    def test_first_reach_requires_stationary(self):
        moving = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=5.0,
                prev_goal_range=10.0,
                goal_hold_steps=0,
                own=P.VesselState(speed_mps=P.V_MAX_MPS),
            )
        )
        stopped = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=5.0,
                prev_goal_range=10.0,
                goal_hold_steps=0,
                own=P.VesselState(speed_mps=P.V_MIN_MPS),
            )
        )
        self.assertNotIn("goal_arrival", moving.breakdown)
        self.assertIn("goal_arrival", stopped.breakdown)
        self.assertEqual(moving.goal_hold_steps, 0)
        self.assertEqual(stopped.goal_hold_steps, 1)

    def test_goal_hold_steps_reset_outside_zone(self):
        out = compute_step_reward(_input(goal_hold_steps=5))
        self.assertEqual(out.goal_hold_steps, 0)

    def test_smooth_penalizes_action_jumps(self):
        calm = compute_step_reward(_input())
        jump = compute_step_reward(
            _input(action=np.array([1.0, 1.0], dtype=np.float32))
        )
        self.assertEqual(calm.breakdown["smooth"], 0.0)
        self.assertLess(jump.breakdown["smooth"], 0.0)
        self.assertAlmostEqual(jump.breakdown["smooth"], -W_SMOOTH * math.sqrt(2), places=4)

    def test_cpa_and_collision_penalties(self):
        out = compute_step_reward(_input(cpa_penalty=12.5, collision=True))
        _assert_breakdown_sums(self, out)
        self.assertEqual(out.breakdown["cpa"], -12.5)
        self.assertEqual(out.breakdown["collision"], -W_COLLISION)

    def test_reward_is_clipped(self):
        out = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=0.0,
                prev_goal_range=0.0,
                goal_hold_steps=0,
                cpa_penalty=500.0,
                collision=True,
            )
        )
        self.assertLessEqual(out.reward, REWARD_CLIP)
        self.assertGreaterEqual(out.reward, -REWARD_CLIP)

    def test_non_finite_reward_becomes_zero(self):
        inp = _input()
        with mock.patch("rewards.W_GOAL_PROGRESS", float("nan")):
            out = compute_step_reward(inp)
        self.assertEqual(out.reward, 0.0)

    def test_cross_track_not_applied_in_goal_zone(self):
        out = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=10.0,
                prev_goal_range=10.0,
                goal_hold_steps=1,
            )
        )
        self.assertNotIn("cross_track", out.breakdown)

    def test_cross_track_geometry(self):
        self.assertAlmostEqual(P.cross_track_m(0.0, 0.0, 0.0, 500.0, 0.0, 250.0), 0.0, places=4)
        self.assertAlmostEqual(P.cross_track_m(0.0, 0.0, 0.0, 500.0, 100.0, 250.0), 100.0, places=4)

    def test_cross_track_penalty_worse_off_track(self):
        with mock.patch("rewards.W_CROSS_TRACK", 1.0), mock.patch(
            "rewards.CROSS_TRACK_SCALE_M", 100.0
        ):
            on_track = compute_step_reward(
                _input(own=P.VesselState(x_m=0.0, y_m=250.0, speed_mps=4.0))
            )
            off_track = compute_step_reward(
                _input(own=P.VesselState(x_m=100.0, y_m=250.0, speed_mps=4.0))
            )
        self.assertIn("cross_track", on_track.breakdown)
        self.assertLess(off_track.breakdown["cross_track"], on_track.breakdown["cross_track"])

    def test_cross_track_not_applied_in_goal_zone(self):
        with mock.patch("rewards.W_CROSS_TRACK", 1.0):
            out = compute_step_reward(
                _input(in_goal_zone=True, curr_goal_range=10.0, prev_goal_range=10.0)
            )
        self.assertNotIn("cross_track", out.breakdown)

    def test_no_time_penalty_in_goal_zone(self):
        out = compute_step_reward(
            _input(
                in_goal_zone=True,
                curr_goal_range=10.0,
                prev_goal_range=10.0,
                goal_hold_steps=1,
            )
        )
        self.assertNotIn("time", out.breakdown)


class TestEnergyScore(unittest.TestCase):
    def test_aggregate_episode_breakdowns(self):
        episodes = [
            {"mean_reward_breakdown": {"progress": 1.0, "energy": -0.1}},
            {"mean_reward_breakdown": {"progress": 0.5, "energy": -0.2}},
        ]
        agg = aggregate_episode_breakdowns(episodes)
        self.assertAlmostEqual(agg["progress"], 0.75)
        self.assertAlmostEqual(agg["energy"], -0.15)

    def test_energy_score_min_at_vmin(self):
        self.assertAlmostEqual(energy_score_from_speeds([P.V_MIN_MPS]), 1.0)

    def test_energy_score_decreases_with_speed(self):
        slow = energy_score_from_speeds([P.V_MIN_MPS, P.V_MIN_MPS + 0.5])
        fast = energy_score_from_speeds([P.V_MAX_MPS, P.V_MAX_MPS])
        self.assertGreater(slow, fast)

    def test_energy_score_from_trace(self):
        steps = [
            {"own": {"speed": P.V_MIN_MPS}},
            {"own": {"speed": P.V_MAX_MPS}},
        ]
        self.assertAlmostEqual(energy_score_from_trace(steps), 0.5, places=4)

    def test_is_hold_stationary_at_zero(self):
        self.assertTrue(is_hold_stationary(0.0))
        self.assertTrue(is_hold_stationary(0.1))
        self.assertFalse(is_hold_stationary(0.5))


class TestFrameSeries(unittest.TestCase):
    def _sample_steps(self, n: int = 12):
        steps = []
        for t in range(n):
            steps.append(
                P.snapshot_step(
                    t,
                    P.VesselState(x_m=0.0, y_m=float(t * 10), heading_rad=0.0, speed_mps=4.0),
                    0.0,
                    500.0,
                    [
                        P.ContactState(
                            x_m=300.0,
                            y_m=float(t * 10),
                            cog_rad=0.0,
                            sog_mps=0.0,
                            speed_mps=0.0,
                            radius_m=15.0,
                            vessel_class="workboat",
                        )
                    ],
                )
            )
        return steps

    def test_incremental_matches_naive(self):
        steps = self._sample_steps(15)
        fast = frame_score_series(steps, scenario_category="traffic/base_t_crossing_stbd", stride=3)
        slow = frame_score_series_naive(
            steps, scenario_category="traffic/base_t_crossing_stbd", stride=3
        )
        self.assertEqual(len(fast), len(slow))
        for f, s in zip(fast, slow):
            self.assertEqual(f["frame"], s["frame"])
            self.assertEqual(f["mean_safety_S"], s["mean_safety_S"])
            self.assertEqual(f["mean_protocol_R"], s["mean_protocol_R"])
            self.assertEqual(f["min_safety_S"], s["min_safety_S"])


if __name__ == "__main__":
    unittest.main()
