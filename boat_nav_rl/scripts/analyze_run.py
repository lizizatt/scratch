#!/usr/bin/env python3
"""Print stopping / energy diagnostics for a training run."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from run_analysis import summarize_run
from runs_util import latest_run_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze eval traces for a run")
    parser.add_argument("run_id", nargs="?", default=None, help="Run id (default: latest)")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON only")
    args = parser.parse_args()

    run_id = args.run_id or latest_run_id(ROOT / "runs")
    if not run_id:
        print("No runs found.", file=sys.stderr)
        sys.exit(1)

    summary = summarize_run(ROOT / "runs" / run_id)
    if args.json:
        print(json.dumps(summary, indent=2))
        return

    print(f"Run {summary['run_id']} ({summary['mode']}) — {summary.get('notes') or ''}")
    print(f"  {summary['score_key']}: {summary.get('score')}")
    print(f"  success: {summary.get('success_rate')}  collision: {summary.get('collision_rate')}")
    print(f"  mean_energy_score: {summary.get('mean_energy_score')}")
    print(f"  mean_speed_mps: {summary.get('mean_speed_mps')}")
    print(f"  mean_goal_zone_speed_mps: {summary.get('mean_goal_zone_speed_mps')}  (target ~{1.0})")
    print(f"  pct_goal_zone_at_min_speed: {summary.get('pct_goal_zone_at_min_speed')}")
    print(f"  success episodes mean zone speed: {summary.get('mean_success_goal_zone_speed_mps')}")
    print(f"  episodes reaching goal zone: {summary.get('episodes_with_goal_zone_steps')}")


if __name__ == "__main__":
    main()
