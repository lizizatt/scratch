"""Tests for vectorized env sizing helpers."""

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vecenv_util import (
    max_n_envs,
    ppo_batch_size,
    recommended_n_envs,
    resolve_vecenv_backend,
    rollout_steps_total,
    steps_per_env,
    training_perf_defaults,
)


class TestVecenvUtil(unittest.TestCase):
    def test_recommended_n_envs_scales_with_cores(self):
        with mock.patch("vecenv_util.cpu_count", return_value=8):
            self.assertEqual(recommended_n_envs(), 32)
        with mock.patch("vecenv_util.cpu_count", return_value=16):
            self.assertEqual(recommended_n_envs(), 64)

    def test_rollout_steps_scales_with_env_count(self):
        self.assertGreaterEqual(rollout_steps_total(32), 4096)
        self.assertEqual(steps_per_env(32), rollout_steps_total(32) // 32)

    def test_ppo_batch_size_larger_on_cuda(self):
        cpu_batch = ppo_batch_size("cpu", 4096)
        gpu_batch = ppo_batch_size("cuda", 4096)
        self.assertEqual(cpu_batch, 256)
        self.assertGreaterEqual(gpu_batch, 512)

    def test_resolve_vecenv_backend(self):
        self.assertEqual(resolve_vecenv_backend(1), "dummy")
        self.assertEqual(resolve_vecenv_backend(8), "subproc")
        self.assertEqual(resolve_vecenv_backend(8, "dummy"), "dummy")

    def test_training_perf_defaults_keys(self):
        perf = training_perf_defaults()
        self.assertIn("recommended_n_envs", perf)
        self.assertIn("rollout_steps_total", perf)
        self.assertLessEqual(perf["recommended_n_envs"], max_n_envs())


if __name__ == "__main__":
    unittest.main()
