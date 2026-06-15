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
    checkpoint_stem,
    checkpoint_zip_path,
    colregs_enabled_for_mode,
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


class TestColregsGating(unittest.TestCase):
    def test_navigate_skips_colregs(self):
        self.assertFalse(colregs_enabled_for_mode("navigate"))

    def test_avoid_enables_colregs(self):
        self.assertTrue(colregs_enabled_for_mode("avoid"))


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
            metrics, traces = aggregate_eval_metrics(
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
                "success": False,
                "collision": False,
                "cpa_unsafe_in_goal": False,
                "final_goal_range_m": 50.0,
                "entered_goal_zone": False,
                "energy_score": 0.8,
                "mean_speed_mps": 4.0,
                "goal_zone_speeds": [],
                "steps": [{"own": {"x": 0, "y": 0, "speed": 4}, "goal": {"x": 0, "y": 100}}],
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


if __name__ == "__main__":
    unittest.main()
