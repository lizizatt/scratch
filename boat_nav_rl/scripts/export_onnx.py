#!/usr/bin/env python3
"""Export a trained PPO checkpoint to ONNX plus a metadata sidecar."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from stable_baselines3 import PPO

import prepare as P

ROOT = Path(__file__).resolve().parent.parent
RUNS_DIR = ROOT / "runs"


class _OnnxPolicy(torch.nn.Module):
    def __init__(self, policy: torch.nn.Module) -> None:
        super().__init__()
        self.policy = policy

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        return self.policy(obs)[0]


def export_onnx(run_id: str, output_path: Path) -> Path:
    ckpt = RUNS_DIR / run_id / "model"
    if not (ckpt.with_suffix(".zip").exists() or ckpt.exists()):
        raise FileNotFoundError(f"No checkpoint for run {run_id}")

    model = PPO.load(str(ckpt), device="cpu")
    onnxable = _OnnxPolicy(model.policy)
    onnxable.eval()
    dummy = torch.zeros(1, P.OBS_DIM, dtype=torch.float32)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        onnxable,
        dummy,
        str(output_path),
        input_names=["obs"],
        output_names=["action"],
        dynamic_axes={"obs": {0: "batch"}, "action": {0: "batch"}},
        opset_version=17,
    )

    meta_path = output_path.with_suffix(".metadata.json")
    meta = {
        "obs_schema_version": P.OBS_SCHEMA_VERSION,
        "obs_dim": P.OBS_DIM,
        "action_dim": 2,
        "action_space": "box[-1,1] -> heading/speed via prepare.action_to_command",
        "v_min_mps": P.V_MIN_MPS,
        "v_max_mps": P.V_MAX_MPS,
        "run_id": run_id,
    }
    metrics_path = RUNS_DIR / run_id / "metrics.json"
    if metrics_path.exists():
        meta["training_mode"] = json.loads(metrics_path.read_text(encoding="utf-8")).get("mode")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Export boat_nav_rl PPO checkpoint to ONNX")
    parser.add_argument("run_id", help="Run id under runs/")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output .onnx path (default: runs/<run_id>/policy.onnx)",
    )
    args = parser.parse_args()
    out = args.output or (RUNS_DIR / args.run_id / "policy.onnx")
    path = export_onnx(args.run_id, out)
    print(f"[onnx] wrote {path}")
    print(f"[onnx] metadata {path.with_suffix('.metadata.json')}")


if __name__ == "__main__":
    main()
