#!/usr/bin/env python3
"""Re-evaluate a saved checkpoint (no training)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from device_util import resolve_device, configure_training_backend
from run_analysis import summarize_run
from stable_baselines3 import PPO

import prepare as P
from eval_runner import run_eval


def main() -> None:
    parser = argparse.ArgumentParser(description="Re-run eval on a checkpoint")
    parser.add_argument("run_id", help="Run with model.zip")
    parser.add_argument("--mode", choices=("navigate", "avoid", "all"), default=None)
    parser.add_argument("--max-scenarios", type=int, default=0, help="0 = full eval set")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--write", action="store_true", help="Overwrite eval_traces.json + metrics eval fields")
    args = parser.parse_args()

    run_dir = ROOT / "runs" / args.run_id
    metrics_path = run_dir / "metrics.json"
    if not metrics_path.exists():
        print(f"Run not found: {args.run_id}", file=sys.stderr)
        sys.exit(1)

    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    mode = args.mode or metrics.get("mode", P.DEFAULT_MODE)
    ckpt = run_dir / "model"
    device = resolve_device(args.device)
    configure_training_backend(device)
    model = PPO.load(str(ckpt), device=device)

    limit = args.max_scenarios if args.max_scenarios > 0 else None
    eval_result = run_eval(model, mode, max_scenarios=limit, collect_traces=True)
    eval_metrics, traces = eval_result.metrics, eval_result.traces

    if args.write:
        (run_dir / "eval_traces.json").write_text(
            json.dumps({"episodes": traces}, separators=(",", ":")),
            encoding="utf-8",
        )
        merged = {**metrics, **eval_metrics}
        (run_dir / "metrics.json").write_text(json.dumps(merged, indent=2), encoding="utf-8")

    summary = summarize_run(run_dir)
    summary["eval_rerun"] = eval_metrics
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
