#!/usr/bin/env python3
"""Serve boat nav RL visualization and run API."""

import json
import mimetypes
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import List, Optional
from urllib.parse import parse_qs, urlparse

import prepare as P
import training_job as TJ
import exercise as EX


ROOT = Path(__file__).resolve().parent
RUNS_DIR = ROOT / "runs"
VIZ_DIR = ROOT / "viz"
EVAL_SEEDS_PATH = RUNS_DIR / "eval_seeds.json"
DEFAULT_PORT = 8765
API_VERSION = 1


def resolve_latest_run_id() -> Optional[str]:
    latest_link = RUNS_DIR / "latest"
    if latest_link.is_symlink() or latest_link.is_dir():
        return latest_link.name if latest_link.exists() else None
    latest_txt = RUNS_DIR / "latest.txt"
    if latest_txt.exists():
        return latest_txt.read_text(encoding="utf-8").strip()
    runs = sorted(
        [
            p
            for p in RUNS_DIR.iterdir()
            if p.is_dir()
            and p.name not in ("_training",)
            and (p / "metrics.json").exists()
        ],
        key=lambda p: p.name,
        reverse=True,
    )
    return runs[0].name if runs else None


def list_runs(limit: int = 40) -> List[dict]:
    runs = sorted(
        [
            p
            for p in RUNS_DIR.iterdir()
            if p.is_dir()
            and p.name not in ("_training",)
            and (p / "metrics.json").exists()
        ],
        key=lambda p: p.name,
        reverse=True,
    )[:limit]
    out = []
    for run_dir in runs:
        metrics_path = run_dir / "metrics.json"
        try:
            metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            metrics = {}
        mode = metrics.get("mode", "?")
        score = metrics.get("nav_score") if mode == "navigate" else metrics.get("avoid_score")
        out.append(
            {
                "id": run_dir.name,
                "mode": mode,
                "score": score,
                "notes": metrics.get("notes", ""),
                "success_rate": metrics.get("success_rate"),
                "collision_rate": metrics.get("collision_rate"),
            }
        )
    return out


def load_scenario_catalog() -> List[dict]:
    if not EVAL_SEEDS_PATH.exists():
        return []
    eval_raw = json.loads(EVAL_SEEDS_PATH.read_text(encoding="utf-8"))
    train_raw: List[dict] = []
    if (ROOT / "runs" / "train_seeds.json").exists():
        train_raw = json.loads((ROOT / "runs" / "train_seeds.json").read_text(encoding="utf-8"))
    out: List[dict] = []
    for item in train_raw:
        row = dict(item)
        row["split"] = "train"
        out.append(row)
    for item in eval_raw:
        row = dict(item)
        row["split"] = "eval"
        out.append(row)
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        if os.environ.get("BOAT_NAV_QUIET"):
            return
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def _send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404, "Not found")
            return
        ctype, _ = mimetypes.guess_type(str(path))
        ctype = ctype or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def send_error(self, code: int, message: Optional[str] = None, explain: Optional[str] = None) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self._send_json(
                {"error": message or "Not found", "path": path, "api_version": API_VERSION},
                status=code,
            )
            return
        super().send_error(code, message, explain)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/train":
            try:
                body = self._read_json_body()
            except json.JSONDecodeError:
                self._send_json({"ok": False, "error": "invalid JSON"}, status=400)
                return
            result = TJ.start_training(
                mode=body.get("mode", "navigate"),
                budget_sec=int(body.get("budget_sec", 600)),
                resume_run_id=body.get("resume_run_id") or None,
                notes=str(body.get("notes", "")),
                n_envs=int(body.get("n_envs", 8)),
                device=str(body.get("device", "auto")),
                dynamics_jitter=bool(body.get("dynamics_jitter", False)),
                robust_eval_enabled=bool(body.get("robust_eval_enabled", False)),
                plant=body.get("plant") or None,
                goal_hold_sec=int(body.get("goal_hold_sec", 30)),
                current_enabled=bool(body.get("current_enabled", True)),
                montage_enabled=bool(body.get("montage_enabled", False)),
            )
            status = 200 if result.get("ok") else 409
            self._send_json(result, status=status)
            return

        if path == "/api/train/cancel":
            result = TJ.cancel_training()
            status = 200 if result.get("ok") else 409
            self._send_json(result, status=status)
            return

        if path == "/api/exercise/init":
            try:
                body = self._read_json_body()
            except json.JSONDecodeError:
                self._send_json({"ok": False, "error": "invalid JSON"}, status=400)
                return
            try:
                run_id = EX.resolve_exercise_run_id(body.get("run_id"))
                session = EX.init_session(
                    run_id,
                    goal_hold_sec=body.get("goal_hold_sec"),
                    current_enabled=body.get("current_enabled"),
                )
                self._send_json({"ok": True, **session.to_dict()})
            except FileNotFoundError as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=404)
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=500)
            return

        if path == "/api/exercise/goal":
            try:
                body = self._read_json_body()
            except json.JSONDecodeError:
                self._send_json({"ok": False, "error": "invalid JSON"}, status=400)
                return
            session = EX.get_session()
            if session is None:
                self._send_json({"ok": False, "error": "exercise not initialized"}, status=409)
                return
            session.set_goal(float(body.get("x_m", 0)), float(body.get("y_m", 0)))
            self._send_json({"ok": True, **session.to_dict()})
            return

        if path == "/api/exercise/intruder":
            try:
                body = self._read_json_body()
            except json.JSONDecodeError:
                self._send_json({"ok": False, "error": "invalid JSON"}, status=400)
                return
            session = EX.get_session()
            if session is None:
                self._send_json({"ok": False, "error": "exercise not initialized"}, status=409)
                return
            session.add_intruder(
                float(body.get("x_m", 0)),
                float(body.get("y_m", 0)),
                float(body.get("cog_deg", 0)),
                float(body.get("sog_mps", 0)),
                str(body.get("vessel_class", P.DEFAULT_VESSEL_CLASS)),
            )
            self._send_json({"ok": True, **session.to_dict()})
            return

        if path == "/api/exercise/intruders/clear":
            session = EX.get_session()
            if session is None:
                self._send_json({"ok": False, "error": "exercise not initialized"}, status=409)
                return
            session.clear_intruders()
            self._send_json({"ok": True, **session.to_dict()})
            return

        if path == "/api/exercise/step":
            try:
                body = self._read_json_body()
            except json.JSONDecodeError:
                self._send_json({"ok": False, "error": "invalid JSON"}, status=400)
                return
            session = EX.get_session()
            if session is None:
                self._send_json({"ok": False, "error": "exercise not initialized"}, status=409)
                return
            session.step(int(body.get("steps", 1)))
            self._send_json({"ok": True, **session.to_dict()})
            return

        if path == "/api/exercise/reset":
            session = EX.get_session()
            if session is None:
                self._send_json({"ok": False, "error": "exercise not initialized"}, status=409)
                return
            session.reset_vessels()
            self._send_json({"ok": True, **session.to_dict()})
            return

        self.send_error(404, "Not found")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/api/health":
            self._send_json(
                {
                    "ok": True,
                    "api_version": API_VERSION,
                    "gpu": TJ.torch_device_info(),
                    "endpoints": [
                        "/api/health",
                        "/api/plant/config",
                        "/api/history",
                        "/api/train/status",
                        "/api/train (POST)",
                        "/api/train/cancel (POST)",
                        "/api/runs",
                        "/api/scenarios",
                        "/api/exercise/state",
                        "/api/exercise/init (POST)",
                        "/api/exercise/goal (POST)",
                        "/api/exercise/intruder (POST)",
                        "/api/exercise/intruders/clear (POST)",
                        "/api/exercise/step (POST)",
                        "/api/exercise/reset (POST)",
                    ],
                }
            )
            return

        if path == "/api/exercise/state":
            session = EX.get_session()
            if session is None:
                self._send_json({"ok": False, "error": "exercise not initialized"}, status=409)
                return
            self._send_json({"ok": True, **session.to_dict()})
            return

        if path == "/api/plant/config":
            self._send_json(P.default_plant_config())
            return

        if path == "/api/history":
            self._send_json(TJ.training_history())
            return

        if path == "/api/train/status":
            payload = TJ.read_status()
            payload["log_tail"] = TJ.read_log_tail()
            self._send_json(payload)
            return

        if path == "/api/scenarios":
            scenarios = load_scenario_catalog()
            by_mode: dict = {}
            by_category: dict = {}
            by_split: dict = {"train": 0, "eval": 0}
            for s in scenarios:
                mode = s.get("mode", "?")
                cat = s.get("category", "uncategorized")
                by_mode[mode] = by_mode.get(mode, 0) + 1
                key = f"{mode}/{cat}"
                by_category[key] = by_category.get(key, 0) + 1
                split = s.get("split", "eval")
                by_split[split] = by_split.get(split, 0) + 1
            self._send_json(
                {
                    "count": len(scenarios),
                    "scenarios": scenarios,
                    "by_mode": by_mode,
                    "by_category": by_category,
                    "by_split": by_split,
                }
            )
            return

        if path == "/api/runs":
            self._send_json({"runs": list_runs(), "latest": resolve_latest_run_id()})
            return

        if path == "/api/latest":
            run_id = resolve_latest_run_id()
            if not run_id:
                self._send_json({"error": "no runs yet"}, status=404)
                return
            metrics_path = RUNS_DIR / run_id / "metrics.json"
            traces_path = RUNS_DIR / run_id / "eval_traces.json"
            payload = {
                "run_id": run_id,
                "metrics": json.loads(metrics_path.read_text(encoding="utf-8")),
                "traces": json.loads(traces_path.read_text(encoding="utf-8")),
            }
            self._send_json(payload)
            return

        if path.startswith("/api/runs/"):
            parts = path.strip("/").split("/")
            if len(parts) == 3 and parts[0] == "api" and parts[1] == "runs":
                run_id = parts[2]
                run_dir = RUNS_DIR / run_id
                metrics_path = run_dir / "metrics.json"
                traces_path = run_dir / "eval_traces.json"
                if not metrics_path.exists():
                    self._send_json({"error": "run not found"}, status=404)
                    return
                payload = {
                    "run_id": run_id,
                    "metrics": json.loads(metrics_path.read_text(encoding="utf-8")),
                    "traces": json.loads(traces_path.read_text(encoding="utf-8")),
                }
                self._send_json(payload)
                return
            if len(parts) == 4 and parts[0] == "api" and parts[1] == "runs" and parts[3] in (
                "step_montage.png",
                "trajectory_montage.png",
            ):
                run_id = parts[2]
                fname = "eval_step_montage.png" if parts[3] == "step_montage.png" else "eval_trajectory_montage.png"
                self._send_file(RUNS_DIR / run_id / fname)
                return

        # Static viz files
        if path in ("/", "/index.html"):
            self._send_file(VIZ_DIR / "index.html")
            return

        if path in ("/scenarios.html", "/overview.html"):
            self._send_file(VIZ_DIR / "scenarios.html")
            return

        if path == "/train.html":
            self._send_file(VIZ_DIR / "train.html")
            return

        if path == "/exercise.html":
            self._send_file(VIZ_DIR / "exercise.html")
            return

        rel = path.lstrip("/")
        candidate = (VIZ_DIR / rel).resolve()
        if str(candidate).startswith(str(VIZ_DIR.resolve())) and candidate.exists():
            self._send_file(candidate)
            return

        self.send_error(404, "Not found")


def main() -> None:
    port = int(os.environ.get("BOAT_NAV_PORT", DEFAULT_PORT))
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"[viz] Train:     http://127.0.0.1:{port}/train.html")
    print(f"[viz] Exercise:  http://127.0.0.1:{port}/exercise.html")
    print(f"[viz] Replay:    http://127.0.0.1:{port}/")
    print(f"[viz] Overview:  http://127.0.0.1:{port}/scenarios.html")
    print(f"[viz] Runs directory: {RUNS_DIR}")
    print("[viz] Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[viz] Stopped")


if __name__ == "__main__":
    main()
