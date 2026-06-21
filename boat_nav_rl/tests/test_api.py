"""HTTP API integration tests — starts serve.py handler on ephemeral port."""

import json
import socket
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from serve import API_VERSION, Handler, VIZ_DIR  # noqa: E402


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get_json(base: str, path: str, expect_ok: bool = True) -> dict:
    req = urllib.request.Request(base + path)
    with urllib.request.urlopen(req, timeout=5) as resp:
        body = resp.read().decode("utf-8")
        ctype = resp.headers.get("Content-Type", "")
        self_check = "application/json" in ctype, f"Non-JSON response for {path}: {ctype}\n{body[:200]}"
        assert self_check[0], self_check[1]
        data = json.loads(body)
        if expect_ok and resp.status >= 400:
            raise AssertionError(f"{path} -> {resp.status}: {data}")
        return data


def post_json(base: str, path: str, payload: dict) -> tuple:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        base + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        body = resp.read().decode("utf-8")
        return resp.status, json.loads(body)


class TestHttpApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = free_port()
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.server = ThreadingHTTPServer(("127.0.0.1", cls.port), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_health(self):
        data = get_json(self.base, "/api/health")
        self.assertTrue(data["ok"])
        self.assertEqual(data["api_version"], API_VERSION)
        self.assertIn("gpu", data)
        self.assertIn("cuda_available", data["gpu"])

    def test_history_is_json(self):
        data = get_json(self.base, "/api/history")
        self.assertIn("runs", data)

    def test_train_status_is_json(self):
        data = get_json(self.base, "/api/train/status")
        self.assertIn("state", data)
        self.assertIn("log_tail", data)
        self.assertIn("live_metrics", data)

    def test_train_cancel_when_idle(self):
        try:
            post_json(self.base, "/api/train/cancel", {})
            self.fail("Expected 409")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 409)
            body = json.loads(e.read().decode("utf-8"))
            self.assertFalse(body.get("ok"))

    def test_runs_is_json(self):
        data = get_json(self.base, "/api/runs")
        self.assertIn("runs", data)

    def test_scenarios_is_json(self):
        data = get_json(self.base, "/api/scenarios")
        self.assertIn("count", data)
        self.assertIn("by_split", data)

    def test_plant_config_is_json(self):
        data = get_json(self.base, "/api/plant/config")
        self.assertIn("nominal", data)
        self.assertIn("goal_hold_sec_default", data)
        self.assertIn("default_mode", data)
        self.assertIn("sim_constants", data)
        self.assertIn("vessel_classes", data["sim_constants"])
        self.assertIn("reward_weights", data)
        self.assertIn("goal_progress", data["reward_weights"])
        self.assertIn("cpa", data["reward_weights"])
        self.assertIn("gated_hold_default", data)

    def test_train_rejects_invalid_budget(self):
        req = urllib.request.Request(
            self.base + "/api/train",
            data=json.dumps({"budget_sec": "not-a-number"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                self.fail(f"Expected 400, got {resp.status}")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)
            body = json.loads(e.read().decode("utf-8"))
            self.assertIn("error", body)

    def test_exercise_step_rejects_invalid_steps(self):
        runs = get_json(self.base, "/api/runs")["runs"]
        if not runs:
            self.skipTest("no trained runs with checkpoints")
        post_json(self.base, "/api/exercise/init", {"run_id": runs[0]["id"]})
        req = urllib.request.Request(
            self.base + "/api/exercise/step",
            data=json.dumps({"steps": "many"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                self.fail(f"Expected 400, got {resp.status}")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)
            body = json.loads(e.read().decode("utf-8"))
            self.assertIn("error", body)

    def test_unknown_api_returns_json_not_html(self):
        try:
            get_json(self.base, "/api/does-not-exist", expect_ok=False)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8")
            self.assertNotIn("<!DOCTYPE", body)
            data = json.loads(body)
            self.assertIn("error", data)
        else:
            self.fail("Expected 404")

    def test_train_html_served(self):
        req = urllib.request.Request(self.base + "/train.html")
        with urllib.request.urlopen(req, timeout=5) as resp:
            html = resp.read().decode("utf-8")
        self.assertIn("Boat Nav RL", html)
        self.assertIn("api.js", html)

    def test_viz_static_assets_exist(self):
        for name in ("api.js", "chart.js", "draw.js", "train.js", "scenarios.js", "replay.js", "exercise.js"):
            path = VIZ_DIR / name
            self.assertTrue(path.exists(), f"missing viz/{name}")

    def test_exercise_html_served(self):
        req = urllib.request.Request(self.base + "/exercise.html")
        with urllib.request.urlopen(req, timeout=5) as resp:
            html = resp.read().decode("utf-8")
        self.assertIn("Exercise", html)
        self.assertIn("exercise.js", html)

    def test_exercise_state_before_init(self):
        import exercise as EX

        with EX._session_lock:
            EX._session = None
        try:
            get_json(self.base, "/api/exercise/state", expect_ok=False)
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 409)
        else:
            self.fail("Expected 409")

    def test_exercise_add_intruder(self):
        runs = get_json(self.base, "/api/runs")["runs"]
        if not runs:
            self.skipTest("no trained runs with checkpoints")
        run_id = runs[0]["id"]
        _, init = post_json(self.base, "/api/exercise/init", {"run_id": run_id})
        self.assertTrue(init.get("ok"))
        self.assertEqual(init.get("contacts"), [])
        _, placed = post_json(
            self.base,
            "/api/exercise/intruder",
            {"x_m": 100, "y_m": 200, "cog_deg": 45, "sog_mps": 3.5, "vessel_class": "freighter"},
        )
        self.assertTrue(placed.get("ok"))
        self.assertEqual(len(placed.get("contacts", [])), 1)
        c = placed["contacts"][0]
        self.assertAlmostEqual(c["x"], 100.0, places=1)
        self.assertAlmostEqual(c["sog_mps"], 3.5, places=1)
        self.assertEqual(c["vessel_class"], "freighter")
        colregs = placed.get("colregs") or {}
        self.assertIn("vessels", colregs)
        self.assertEqual(len(colregs["vessels"]), 3)
        self.assertIsNotNone(colregs.get("mean_safety_S"))
        _, cleared = post_json(self.base, "/api/exercise/intruders/clear", {})
        self.assertTrue(cleared.get("ok"))
        self.assertEqual(cleared.get("contacts"), [])

    def test_colregs_frames_api(self):
        import prepare as P

        steps = []
        for t in range(5):
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
        _, data = post_json(
            self.base,
            "/api/colregs/frames",
            {"steps": steps, "scenario_category": "traffic/base_t_crossing_stbd"},
        )
        self.assertTrue(data.get("ok"))
        self.assertGreaterEqual(len(data.get("frames") or []), 1)
        frame0 = data["frames"][0]
        self.assertIn("mean_safety_S", frame0)
        self.assertIn("live", frame0)


if __name__ == "__main__":
    unittest.main()
