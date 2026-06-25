"""Best-checkpoint path resolution and metrics comparison."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from checkpoint_util import BEST_MODEL_DIRNAME, resolve_resume_checkpoint, save_periodic_snapshot, snapshots_dir
from curriculum import get_phase, is_summary_better, metrics_to_summary


class TestResolveResume(unittest.TestCase):
    def test_prefers_best_over_final(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            (run_dir / f"{BEST_MODEL_DIRNAME}.zip").write_bytes(b"best")
            (run_dir / "model.zip").write_bytes(b"final")
            path = resolve_resume_checkpoint(run_dir, prefer_best=True)
            self.assertEqual(path.name, f"{BEST_MODEL_DIRNAME}.zip")

    def test_falls_back_to_final(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            (run_dir / "model.zip").write_bytes(b"final")
            path = resolve_resume_checkpoint(run_dir, prefer_best=True)
            self.assertEqual(path.name, "model.zip")


class TestSummaryComparison(unittest.TestCase):
    def test_metrics_to_summary_zone_rate(self):
        s = metrics_to_summary(
            {
                "success_rate": 0.8,
                "eval_episodes": 10,
                "episodes_with_goal_zone_steps": 7,
                "mode": "navigate",
                "nav_score": 0.72,
            }
        )
        self.assertAlmostEqual(s["zone_entry_rate"], 0.7)
        self.assertEqual(s["score"], 0.72)

    def test_is_summary_better_success_rate(self):
        phase = get_phase(0)
        best = {"success_rate": 0.6, "mean_speed_mps": 5.0, "eval_episodes": 10}
        better = {"success_rate": 0.79, "mean_speed_mps": 5.0, "eval_episodes": 10}
        worse = {"success_rate": 0.58, "mean_speed_mps": 5.0, "eval_episodes": 10}
        self.assertTrue(is_summary_better(phase, better, best))
        self.assertFalse(is_summary_better(phase, worse, best))


class TestPeriodicSnapshot(unittest.TestCase):
    def test_save_periodic_snapshot_writes_zip_and_meta(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)

            class _FakeModel:
                def save(self, stem: str) -> None:
                    Path(f"{stem}.zip").write_bytes(b"ckpt")

            zip_path = save_periodic_snapshot(
                run_dir,
                _FakeModel(),
                elapsed_sec=1830.0,
                timesteps=42_000,
                index=1,
            )
            self.assertTrue(zip_path.exists())
            self.assertEqual(zip_path.parent, snapshots_dir(run_dir))
            meta_files = list(snapshots_dir(run_dir).glob("*.meta.json"))
            self.assertEqual(len(meta_files), 1)
            meta = json.loads(meta_files[0].read_text(encoding="utf-8"))
            self.assertEqual(meta["timesteps"], 42_000)
            self.assertEqual(meta["index"], 1)
            self.assertEqual(meta["elapsed_min"], 30)


if __name__ == "__main__":
    unittest.main()
