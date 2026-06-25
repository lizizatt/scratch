"""P0 solidification tests — run id safety, config round-trip, API guards."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import train_config as C
from runs_util import InvalidRunIdError, safe_run_dir, validate_run_id


class TestRunIdValidation(unittest.TestCase):
    def test_validate_run_id_accepts_timestamp(self):
        self.assertEqual(validate_run_id("20260625_021230"), "20260625_021230")

    def test_validate_run_id_rejects_traversal(self):
        for bad in ("../etc/passwd", "..", "foo/bar", "foo\\bar", ""):
            with self.subTest(bad=bad):
                with self.assertRaises(InvalidRunIdError):
                    validate_run_id(bad)

    def test_safe_run_dir_stays_under_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = safe_run_dir("good_run", root)
            self.assertEqual(run_dir, root / "good_run")
            with self.assertRaises(InvalidRunIdError):
                safe_run_dir("../../outside", root)


class TestApplyRunConfig(unittest.TestCase):
    def setUp(self):
        self._saved = (
            C.TRAIN_BUDGET_SEC,
            C.SNAPSHOT_INTERVAL_SEC,
            C.GOAL_HOLD_SEC,
        )

    def tearDown(self):
        C.TRAIN_BUDGET_SEC, C.SNAPSHOT_INTERVAL_SEC, C.GOAL_HOLD_SEC = self._saved

    def test_apply_run_config_budget_and_snapshot_interval(self):
        C.apply_run_config(
            {
                "budget_sec": 7200,
                "snapshot_interval_min": 30,
                "goal_hold_sec": 15,
            }
        )
        self.assertEqual(C.TRAIN_BUDGET_SEC, 7200)
        self.assertEqual(C.SNAPSHOT_INTERVAL_SEC, 1800)
        self.assertEqual(C.GOAL_HOLD_SEC, 15)


class TestRewardConfigOverrides(unittest.TestCase):
    def test_reward_config_from_overrides_does_not_mutate_globals(self):
        from rewards import get_reward_config, reward_config_from_overrides

        before = get_reward_config().w_cpa
        cfg = reward_config_from_overrides({"cpa": before + 7.0})
        after = get_reward_config().w_cpa
        self.assertEqual(after, before)
        self.assertEqual(cfg.w_cpa, before + 7.0)


class TestTrainingHistoryResilience(unittest.TestCase):
    def test_training_history_skips_corrupt_metrics(self):
        import training_job as TJ

        with tempfile.TemporaryDirectory() as tmp:
            runs = Path(tmp)
            good = runs / "20260101_000001"
            good.mkdir()
            (good / "metrics.json").write_text(
                json.dumps({"mode": "navigate", "nav_score": 0.5}),
                encoding="utf-8",
            )
            bad = runs / "20260101_000002"
            bad.mkdir()
            (bad / "metrics.json").write_text("{not json", encoding="utf-8")

            with mock.patch.object(TJ, "RUNS_DIR", runs):
                data = TJ.training_history()
            self.assertEqual(data["count"], 1)
            self.assertEqual(data["runs"][0]["run_id"], "20260101_000001")


if __name__ == "__main__":
    unittest.main()
