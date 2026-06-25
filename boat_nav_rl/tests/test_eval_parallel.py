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
    aggregate_eval_metrics,
    alloc_eval_snapshot_stem,
    checkpoint_stem,
    checkpoint_zip_path,
    colregs_enabled_for_mode,
    episode_mission_score,
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
    def test_partial_credit_zone_buzz_not_zero(self):
        ep = {
            "success": False,
            "collision": False,
            "cpa_unsafe_in_goal": False,
            "final_goal_range_m": 20.0,
            "min_goal_range_m": 15.0,
            "entered_goal_zone": True,
            "goal_hold_steps": 0,
            "goal_hold_required": 30,
            "energy_score": 0.7,
            "mean_goal_zone_speed_mps": 7.5,
        }
        score = episode_mission_score(ep, "avoid")
        self.assertGreater(score, 0.05)
        self.assertLess(score, 0.5)

    def test_full_success_near_one(self):
        ep = {
            "success": True,
            "collision": False,
            "cpa_unsafe_in_goal": False,
            "final_goal_range_m": 5.0,
            "min_goal_range_m": 5.0,
            "entered_goal_zone": True,
            "goal_hold_steps": 30,
            "goal_hold_required": 30,
            "energy_score": 0.9,
        }
        self.assertGreater(episode_mission_score(ep, "avoid"), 0.8)

    def test_collision_soft_penalty_not_zero_if_close(self):
        ep = {
            "success": False,
            "collision": True,
            "cpa_unsafe_in_goal": False,
            "final_goal_range_m": 10.0,
            "min_goal_range_m": 10.0,
            "entered_goal_zone": True,
            "goal_hold_steps": 5,
            "goal_hold_required": 30,
            "energy_score": 0.8,
        }
        clean = dict(ep, collision=False)
        self.assertGreater(episode_mission_score(ep, "avoid"), 0.0)
        self.assertLess(
            episode_mission_score(ep, "avoid"),
            episode_mission_score(clean, "avoid"),
        )

    def test_far_from_goal_near_zero(self):
        ep = {
            "success": False,
            "collision": False,
            "final_goal_range_m": 400.0,
            "min_goal_range_m": 400.0,
            "entered_goal_zone": False,
            "energy_score": 0.9,
        }
        self.assertLess(episode_mission_score(ep, "avoid"), 0.01)


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
                "final_goal_range_m": 20.0,
                "min_goal_range_m": 15.0,
                "entered_goal_zone": True,
                "goal_hold_steps": 0,
                "goal_hold_required": 30,
                "energy_score": 0.7,
                "goal_zone_speeds": [7.0],
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
