#!/usr/bin/env python3
"""Run one curriculum phase (or chain phases), check exit gates, update state."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from checkpoint_util import load_best_metrics
from curriculum import (
    PHASES,
    build_run_config,
    check_exit,
    get_phase,
    load_state,
    record_run,
    resume_for_phase,
    save_state,
)
from run_analysis import summarize_run
from runs_util import latest_run_id

STATUS_PATH = ROOT / "runs" / "_training" / "status.json"


def run_id_from_training_status() -> str | None:
    if not STATUS_PATH.exists():
        return None
    try:
        data = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    run_id = data.get("run_id")
    return str(run_id) if run_id else None


def run_phase(phase_id: int, budget: int | None, resume: str | None, device: str) -> int:
    phase = get_phase(phase_id)
    state = load_state()
    parent = resume if resume is not None else resume_for_phase(state, phase_id)

    run_cfg = build_run_config(phase)
    tmp = Path(tempfile.gettempdir()) / f"boat_nav_curriculum_p{phase_id}.json"
    tmp.write_text(json.dumps(run_cfg, indent=2), encoding="utf-8")

    budget_sec = budget if budget is not None else phase.budget_sec
    notes = phase.notes_suffix

    cmd = [
        sys.executable,
        str(ROOT / "train.py"),
        "--mode",
        phase.mode,
        "--budget",
        str(budget_sec),
        "--notes",
        notes,
        "--device",
        device,
        "--run-config",
        str(tmp),
    ]
    if parent:
        cmd.extend(["--resume", parent])

    print(f"\n=== Curriculum phase {phase_id}: {phase.name} ===", flush=True)
    print(f"    mode={phase.mode} budget={budget_sec}s resume={parent or 'fresh'}", flush=True)
    print(f"    gated_hold={phase.gated_hold} scenarios={phase.scenario_prefixes or 'all'}", flush=True)
    print("[curriculum_run]", " ".join(cmd), flush=True)

    proc = subprocess.run(cmd, cwd=str(ROOT))
    if proc.returncode != 0:
        return proc.returncode

    run_id = run_id_from_training_status() or latest_run_id(ROOT / "runs")
    if not run_id:
        print("No run produced.", file=sys.stderr)
        return 2

    run_dir = ROOT / "runs" / run_id
    best_meta = load_best_metrics(run_dir)
    summary = summarize_run(run_dir)
    if summary.get("eval_episodes"):
        summary["zone_entry_rate"] = (
            summary.get("episodes_with_goal_zone_steps", 0) / summary["eval_episodes"]
        )

    passed, reasons = check_exit(phase, summary)
    used_best = False
    if best_meta and best_meta.get("summary"):
        best_summary = dict(best_meta["summary"])
        if best_summary.get("zone_entry_rate") is None and best_summary.get("eval_episodes"):
            best_summary["zone_entry_rate"] = (
                best_summary.get("episodes_with_goal_zone_steps", 0)
                / best_summary["eval_episodes"]
            )
        passed_best, reasons_best = check_exit(phase, best_summary)
        if passed_best:
            passed = True
            reasons = reasons_best
            summary = {**summary, **best_summary, "used_best_checkpoint": True}
            used_best = True

    record_run(state, phase, run_id, summary, passed)

    print(
        json.dumps(
            {
                "run_id": run_id,
                "phase": phase_id,
                "passed": passed,
                "used_best_checkpoint": used_best,
                "summary": summary,
            },
            indent=2,
        )
    )
    print("Exit gate:")
    for line in reasons:
        print(f"  {line}")

    if passed:
        print(f"Promoted checkpoint for phase {phase_id}: {run_id}")
    else:
        print(f"Phase {phase_id} did not pass — fix weights or extend budget, then re-run.")
    return 0 if passed else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Run staged curriculum training")
    parser.add_argument("--phase", type=int, default=None, help="Phase id 0-4")
    parser.add_argument("--continue", dest="chain", action="store_true", help="Run phases until one fails")
    parser.add_argument("--status", action="store_true", help="Print curriculum state and exit")
    parser.add_argument("--reset", action="store_true", help="Reset curriculum state to phase 0")
    parser.add_argument("--budget", type=int, default=None, help="Override phase budget (seconds)")
    parser.add_argument("--resume", type=str, default=None, help="Override resume run id")
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    args = parser.parse_args()

    if args.reset:
        from curriculum import default_state

        save_state(default_state())
        print("Curriculum state reset.")
        return

    state = load_state()
    if args.status:
        print(json.dumps(state, indent=2))
        return

    start = args.phase if args.phase is not None else int(state.get("current_phase", 0))
    end = PHASES[-1].phase_id if args.chain else start

    exit_code = 0
    for pid in range(start, end + 1):
        code = run_phase(pid, args.budget, args.resume if pid == start else None, args.device)
        if code != 0:
            exit_code = code
            break
        args.resume = None  # only honor explicit resume on first phase

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
