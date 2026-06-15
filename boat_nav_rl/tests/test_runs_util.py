"""Tests for run listing helpers."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from runs_util import score_from_metrics, score_key_for_mode


class TestRunsUtil(unittest.TestCase):
    def test_score_key_for_mode(self):
        self.assertEqual(score_key_for_mode("avoid"), "avoid_score")
        self.assertEqual(score_key_for_mode("navigate"), "nav_score")

    def test_score_from_metrics(self):
        self.assertEqual(score_from_metrics({"mode": "avoid", "avoid_score": 0.7}), 0.7)
        self.assertEqual(score_from_metrics({"mode": "navigate", "nav_score": 0.9}), 0.9)


if __name__ == "__main__":
    unittest.main()
