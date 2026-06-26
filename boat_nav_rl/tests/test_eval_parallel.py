"""Parallel / async eval helpers."""

import sys
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P
from eval_parallel import (
    MISSION_SCORE_VERSION,
    aggregate_eval_metrics,
    alloc_eval_snapshot_stem,
    approach_factor,
    checkpoint_stem,
    checkpoint_zip_path,
    colregs_enabled_for_mode,
    episode_mission_score,
    hold_multiplier,
    rollout_episodes_sequential,
)
from async_eval import AsyncEvalRunner


class TestCheckpointPaths(unittest.TestCase):
    def test_stem_strips_zip_suffix(self):
        self.assertEqual(
            checkpoint_stem(Path("runs/_eval_snapshot.zip")),
            Path("runs/_eval_snapshot"),
        )

    def test_zip_path_from_stem(self):
        self.assertEqual(
            checkpoint_zip_path(Path("runs/_eval_snapshot")),
            Path("runs/_eval_snapshot.zip"),
        )

    def test_alloc_eval_snapshot_stem_unique(self):
        a = alloc_eval_snapshot_stem(Path("runs/_test_snapshots"))
        b = alloc_eval_snapshot_stem(Path("runs/_test_snapshots"))
        self.assertNotEqual(a, b)
        self.assertFalse(str(a).endswith(".zip"))


class TestColregsGating(unittest.TestCase):
    def test_navigate_skips_colregs(self):
        self.assertFalse(colregs_enabled_for_mode("navigate"))

    def test_avoid_enables_colregs(self):
        self.assertTrue(colregs_enabled_for_mode("avoid"))


class TestEpisodeMissionScore(unittest.TestCase):
    def _ep(self, **kwargs):
        base = {
            "success": False,
            "collision": False,
            "cpa_unsafe_in_goal": False,
            "cpa_unsafe_at_end": False,
            "initial_goal_range_m": 400.0,
            "goal_hold_required": 30,
            "goal_zone_speeds": [],
        }
        base.update(kwargs)
        return base

    def test_mission_score_version_constant(self):
        self.assertEqual(MISSION_SCORE_VERSION, 3)

    def test_timeout_near_goal_without_zone_entry_gets_approach_credit(self):
        ep = self._ep(
            min_goal_range_m=55.0,
            final_goal_range_m=55.0,
            entered_goal_zone=False,
            goal_hold_steps=0,
        )
        self.assertGreater(approach_factor(ep), 0.8)
        self.assertGreater(episode_mission_score(ep, "navigate"), 0.75)

    def test_flyby_scores_lower_than_steady_approach(self):
        flyby = self._ep(
            min_goal_range_m=10.0,
            final_goal_range_m=200.0,
            entered_goal_zone=True,
            goal_hold_steps=0,
        )
        steady = self._ep(
            min_goal_range_m=55.0,
            final_goal_range_m=55.0,
            entered_goal_zone=False,
            goal_hold_steps=0,
        )
        self.assertLess(episode_mission_score(flyby, "navigate"), episode_mission_score(steady, "navigate"))

    def test_zone_buzz_without_hold_scores_zero(self):
        ep = self._ep(
            min_goal_range_m=15.0,
            final_goal_range_m=20.0,
            entered_goal_zone=True,
            goal_hold_steps=0,
        )
        self.assertEqual(hold_multiplier(ep), 0.0)
        self.assertLess(episode_mission_score(ep, "avoid"), 0.01)

    def test_partial_hold_credit(self):
        ep = self._ep(
            min_goal_range_m=5.0,
            final_goal_range_m=8.0,
            entered_goal_zone=True,
            goal_hold_steps=20,
            goal_zone_speeds=[0.05, 0.04],
        )
        score = episode_mission_score(ep, "avoid")
        self.assertGreater(score, 0.35)
        self.assertLess(score, 0.95)

    def test_full_success_near_one(self):
        ep = self._ep(
            success=True,
            min_goal_range_m=5.0,
            final_goal_range_m=5.0,
            entered_goal_zone=True,
            goal_hold_steps=30,
            goal_zone_speeds=[0.05] * 30,
        )
        self.assertGreater(episode_mission_score(ep, "avoid"), 0.85)

    def test_fast_cruise_not_crushed_vs_slow_when_not_in_zone(self):
        ep = self._ep(
            success=True,
            min_goal_range_m=3.0,
            final_goal_range_m=3.0,
            entered_goal_zone=True,
            goal_hold_steps=30,
            goal_zone_speeds=[0.05] * 30,
        )
        slow = episode_mission_score(ep, "navigate")
        self.assertGreater(slow, 0.85)

    def test_collision_scores_below_clean_approach(self):
        ep = self._ep(
            collision=True,
            min_goal_range_m=10.0,
            final_goal_range_m=12.0,
            entered_goal_zone=True,
            goal_hold_steps=5,
        )
        clean = dict(ep, collision=False)
        self.assertLess(episode_mission_score(ep, "avoid"), episode_mission_score(clean, "avoid"))

    def test_far_from_goal_near_zero(self):
        ep = self._ep(min_goal_range_m=400.0, final_goal_range_m=400.0, entered_goal_zone=False)
        self.assertLess(episode_mission_score(ep, "avoid"), 0.05)

    def test_cpa_unsafe_at_end_not_latched_mid_episode(self):
        ep = self._ep(
            cpa_unsafe_in_goal=True,
            cpa_unsafe_at_end=False,
            min_goal_range_m=5.0,
            final_goal_range_m=5.0,
            entered_goal_zone=True,
            goal_hold_steps=30,
            success=True,
        )
        self.assertGreater(episode_mission_score(ep, "avoid"), 0.8)

    def test_direct_path_scores_above_wide_arc(self):
        direct = self._ep(
            success=True,
            min_goal_range_m=5.0,
            final_goal_range_m=5.0,
            entered_goal_zone=True,
            goal_hold_steps=30,
            mean_cross_track_m=12.0,
            max_cross_track_m=28.0,
            goal_zone_speeds=[0.05] * 30,
        )
        wide_arc = self._ep(
            success=True,
            min_goal_range_m=4.0,
            final_goal_range_m=4.0,
            entered_goal_zone=True,
            goal_hold_steps=30,
            mean_cross_track_m=75.0,
            max_cross_track_m=110.0,
            goal_zone_speeds=[0.05] * 30,
        )
        self.assertGreater(
            episode_mission_score(direct, "navigate"),
            episode_mission_score(wide_arc, "navigate"),
        )


class TestAggregateEvalMetrics(unittest.TestCase):
    def test_navigate_no_colregs_in_metrics(self):
        seeds = [
            P.ScenarioSeed(
                name="t",
                mode="navigate",
                seed=1,
                own_heading_deg=0,
                own_speed_mps=3,
                own_x_m=0,
                own_y_m=0,
                goal_x_m=0,
                goal_y_m=100,
            )
        ]
        episodes = [
            {
                "success": True,
                "collision": False,
                "cpa_unsafe_in_goal": False,
                "final_goal_range_m": 10.0,
                "entered_goal_zone": True,
                "energy_score": 0.9,
                "mean_speed_mps": 3.0,
                "goal_zone_speeds": [0.0],
                "steps": [{"own": {"x": 0, "y": 90, "speed": 0}, "goal": {"x": 0, "y": 100}}],
            }
        ]
        with mock.patch("colregs.evaluate.evaluate_episode") as mock_eval:
            result = aggregate_eval_metrics(
                episodes,
                seeds,
                "navigate",
                eval_seed_list_count=1,
                train_scenario_count=1,
                plant_jitter=False,
                current_enabled=False,
                nominal_plant=P.plant_from_dict(P.PLANT_NOMINAL),
                collect_traces=True,
            )
            mock_eval.assert_not_called()
        metrics, traces = result.metrics, result.traces
        self.assertEqual(metrics["eval_episodes"], 1)
        self.assertEqual(len(traces), 1)
        self.assertIn("mission_score", traces[0])
        self.assertEqual(traces[0].get("mission_score_version"), MISSION_SCORE_VERSION)
        self.assertNotIn("colregs_mean_safety", metrics)

    def test_avoid_runs_colregs_when_traces(self):
        seeds = [
            P.ScenarioSeed(
                name="t",
                mode="avoid",
                seed=1,
                own_heading_deg=0,
                own_speed_mps=3,
                own_x_m=0,
                own_y_m=0,
                goal_x_m=0,
                goal_y_m=100,
                contacts=[{"x_m": 50, "y_m": 0, "cog_deg": 180, "sog_mps": 3, "speed_mps": 3, "radius_m": 15}],
            )
        ]
        episodes = [
            {
                "success": True,
                "collision": False,
                "cpa_unsafe_in_goal": False,
                "final_goal_range_m": 10.0,
                "min_goal_range_m": 10.0,
                "entered_goal_zone": True,
                "goal_hold_steps": 30,
                "goal_hold_required": 30,
                "energy_score": 0.9,
                "mean_speed_mps": 3.0,
                "goal_zone_speeds": [0.0],
                "steps": [{"own": {"x": 0, "y": 90, "speed": 0}, "goal": {"x": 0, "y": 100}}],
            }
        ]
        with mock.patch("colregs.evaluate.evaluate_episode", return_value={"mean_safety_S": 80.0}) as mock_eval:
            with mock.patch("colregs.evaluate.rollup_episodes", return_value={"colregs_mean_safety": 80.0}):
                aggregate_eval_metrics(
                    episodes,
                    seeds,
                    "avoid",
                    eval_seed_list_count=1,
                    train_scenario_count=1,
                    plant_jitter=False,
                    current_enabled=False,
                    nominal_plant=P.plant_from_dict(P.PLANT_NOMINAL),
                    collect_traces=True,
                )
                mock_eval.assert_called_once()

    def test_partial_credit_avoid_score_when_no_binary_success(self):
        seeds = [
            P.ScenarioSeed(
                name="t",
                mode="avoid",
                seed=1,
                own_heading_deg=0,
                own_speed_mps=3,
                own_x_m=0,
                own_y_m=0,
                goal_x_m=0,
                goal_y_m=100,
            )
        ]
        episodes = [
            {
                "success": False,
                "collision": False,
                "cpa_unsafe_in_goal": False,
                "final_goal_range_m": 55.0,
                "min_goal_range_m": 55.0,
                "initial_goal_range_m": 400.0,
                "entered_goal_zone": False,
                "goal_hold_steps": 0,
                "goal_hold_required": 30,
                "goal_zone_speeds": [],
            }
        ]
        metrics = aggregate_eval_metrics(
            episodes,
            seeds,
            "avoid",
            eval_seed_list_count=1,
            train_scenario_count=1,
            plant_jitter=False,
            current_enabled=False,
            nominal_plant=P.plant_from_dict(P.PLANT_NOMINAL),
            collect_traces=False,
        ).metrics
        self.assertEqual(metrics["success_rate"], 0.0)
        self.assertGreater(metrics["avoid_score"], 0.0)
        self.assertEqual(metrics["avoid_score"], metrics["mean_mission_score"])
        self.assertEqual(metrics["avoid_score_strict"], 0.0)


class TestAsyncEvalRunner(unittest.TestCase):
    def test_submit_and_poll(self):
        runner = AsyncEvalRunner()
        started = threading.Event()
        gate = threading.Event()

        def job():
            started.set()
            gate.wait(timeout=5.0)
            return {"ok": True}

        self.assertTrue(runner.enabled)
        self.assertTrue(runner.submit(job))
        started.wait(timeout=5.0)
        self.assertTrue(runner.is_busy())
        gate.set()
        deadline = time.time() + 5.0
        result = None
        while time.time() < deadline:
            result = runner.poll()
            if result is not None:
                break
            time.sleep(0.01)
        self.assertIsNotNone(result)
        self.assertEqual(result["ok"], True)
        runner.shutdown()

    def test_drain_waits_for_job(self):
        runner = AsyncEvalRunner()
        gate = threading.Event()

        def job():
            gate.wait(timeout=5.0)
            return 42

        self.assertTrue(runner.submit(job))
        gate.set()
        self.assertEqual(runner.drain(timeout=5.0), 42)
        runner.shutdown()


if __name__ == "__main__":
    unittest.main()
