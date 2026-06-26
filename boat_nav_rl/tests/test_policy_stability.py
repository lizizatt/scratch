"""Policy inference and training stability tests."""

import sys
import threading
import time
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import prepare as P
import policy_infer as PI


class TestObservationSanitization(unittest.TestCase):
    def test_sanitize_observation_replaces_non_finite(self):
        obs = np.array([np.nan, np.inf, -np.inf, 2.5, -99.0], dtype=np.float32)
        out = P.sanitize_observation(obs.copy())
        self.assertTrue(np.all(np.isfinite(out)))
        self.assertLessEqual(np.max(out), 10.0)
        self.assertGreaterEqual(np.min(out), -10.0)

    def test_pack_observation_is_finite(self):
        own = P.VesselState(heading_rad=0.5, speed_mps=4.0)
        obs = P.pack_observation(own, 100.0, 500.0, True, [], 0.0, 0.0)
        self.assertTrue(np.all(np.isfinite(obs)))


class TestRewardStability(unittest.TestCase):
    def test_goal_reached_reward_is_clipped(self):
        from train import BoatNavEnv, REWARD_CLIP

        env = BoatNavEnv(
            mode="navigate",
            training_randomize=False,
            goal_hold_sec=30,
            current_enabled=False,
        )
        env.reset(seed=1)
        env.own.x_m = env.goal_x
        env.own.y_m = env.goal_y
        env.own.speed_mps = P.V_MIN_MPS
        env.prev_goal_range = 0.0
        env.goal_hold_steps = 0
        env.step_count = 1
        _, reward, _, _, _ = env.step(np.array([0.0, -1.0], dtype=np.float32))
        self.assertTrue(np.isfinite(reward))
        self.assertLessEqual(reward, REWARD_CLIP)
        self.assertGreaterEqual(reward, -REWARD_CLIP)


class TestSafeModelPredict(unittest.TestCase):
    def test_predict_runs_under_inference_lock(self):
        calls = []

        class FakeModel:
            def predict(self, obs, deterministic=True):
                calls.append(obs.shape)
                return np.array([0.1, -0.2], dtype=np.float32), None

        action, _ = PI.safe_model_predict(FakeModel(), np.zeros(P.OBS_DIM, dtype=np.float32))
        self.assertEqual(action.shape, (2,))
        self.assertEqual(calls, [(P.OBS_DIM,)])

    def test_concurrent_predict_calls_are_serialized(self):
        active = 0
        max_active = 0
        guard = threading.Lock()

        class SlowModel:
            def predict(self, obs, deterministic=True):
                nonlocal active, max_active
                with guard:
                    active += 1
                    max_active = max(max_active, active)
                time.sleep(0.03)
                with guard:
                    active -= 1
                return np.zeros(2, dtype=np.float32), None

        model = SlowModel()
        threads = [
            threading.Thread(
                target=lambda: PI.safe_model_predict(model, np.zeros(P.OBS_DIM, dtype=np.float32))
            )
            for _ in range(4)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)
        self.assertEqual(max_active, 1)


class TestLiveEvalAsync(unittest.TestCase):
    def test_live_metrics_callback_uses_async_runner(self):
        from train import LiveMetricsCallback

        cb = LiveMetricsCallback({}, "navigate", "test_run")
        self.assertIsNotNone(cb._async)
        self.assertTrue(cb._async.enabled)


if __name__ == "__main__":
    unittest.main()
