#!/usr/bin/env python3
"""Short train + analyze loop for agent-driven reward tuning."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from run_analysis import summarize_run
from runs_util import latest_run_id


def _build_run_config(reward_config: Path | None, extra: dict) -> Path | None:
    cfg: dict = dict(extra)
    if reward_config and reward_config.exists():
        loaded = json.loads(reward_config.read_text(encoding="utf-8"))
        weights = loaded.get("reward_weights", loaded)
        cfg.setdefault("reward_weights", {}).update(weights)
    if not cfg:
        return None
    tmp = Path(tempfile.gettempdir()) / f"boat_nav_agent_run_{reward_config.stem if reward_config else 'cfg'}.json"
    tmp.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return tmp


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train briefly, then emit stopping/energy diagnostics (for agent iteration)"
    )
    parser.add_argument("--mode", choices=("navigate", "avoid", "all"), default="avoid")
    parser.add_argument("--budget", type=int, default=120, help="Training seconds (default 120)")
    parser.add_argument("--n-envs", type=int, default=None)
    parser.add_argument("--resume", type=str, default=None)
    parser.add_argument("--notes", type=str, default="agent iterate")
    parser.add_argument("--reward-config", type=Path, default=None, help="JSON reward_weights overrides")
    parser.add_argument("--eval-only", type=str, default=None, help="Skip training; analyze this run_id")
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--json", action="store_true", help="Print summary JSON only")
    args = parser.parse_args()

    if args.eval_only:
        summary = summarize_run(ROOT / "runs" / args.eval_only)
        if args.json:
            print(json.dumps(summary, indent=2))
        else:
            print(json.dumps(summary, indent=2))
        return

    cmd = [
        sys.executable,
        str(ROOT / "train.py"),
        "--mode",
        args.mode,
        "--budget",
        str(args.budget),
        "--notes",
        args.notes,
        "--device",
        args.device,
    ]
    if args.n_envs is not None:
        cmd.extend(["--n-envs", str(args.n_envs)])
    if args.resume:
        cmd.extend(["--resume", args.resume])

    run_cfg_path = _build_run_config(args.reward_config, {})
    if run_cfg_path:
        cmd.extend(["--run-config", str(run_cfg_path)])

    print("[agent_train]", " ".join(cmd), flush=True)
    proc = subprocess.run(cmd, cwd=str(ROOT))
    if proc.returncode != 0:
        sys.exit(proc.returncode)

    run_id = latest_run_id(ROOT / "runs")
    if not run_id:
        print("Training finished but no run found.", file=sys.stderr)
        sys.exit(2)

    summary = summarize_run(ROOT / "runs" / run_id)
    summary["train_exit_code"] = proc.returncode
    summary["reward_config"] = str(args.reward_config) if args.reward_config else None

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
