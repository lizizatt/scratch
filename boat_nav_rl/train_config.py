"""Training configuration globals and CLI / run-config application."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import prepare as P
from curriculum import filter_seeds_by_prefix
from rewards import apply_reward_overrides, set_gated_hold_enabled
from vecenv_util import recommended_n_envs

# =============================================================================
# CONFIG — edit this section between experiments
# =============================================================================
MODE = P.DEFAULT_MODE  # "navigate" (clear) | "avoid" (traffic) | "all"

TRAIN_BUDGET_SEC = int(os.environ.get("TRAIN_BUDGET_SEC", "600"))
N_ENVS = int(os.environ.get("N_ENVS", str(recommended_n_envs())))
DEVICE = os.environ.get("TRAIN_DEVICE", "auto")
EVAL_EPISODES = int(os.environ.get("EVAL_EPISODES", "0"))  # 0 = full eval set at end
LIVE_EVAL_SCENARIOS = int(os.environ.get("LIVE_EVAL_SCENARIOS", "6"))
LIVE_EVAL_INTERVAL_SEC = float(os.environ.get("LIVE_EVAL_INTERVAL_SEC", "45.0"))
ROBUST_EVAL_SAMPLES = int(os.environ.get("ROBUST_EVAL_SAMPLES", "5"))
ROBUST_EVAL_SCENARIOS = int(os.environ.get("ROBUST_EVAL_SCENARIOS", "12"))

DYNAMICS_JITTER = os.environ.get("DYNAMICS_JITTER", "0") == "1"
ROBUST_EVAL_ENABLED = os.environ.get("ROBUST_EVAL_ENABLED", "0") == "1"
GOAL_HOLD_SEC = int(os.environ.get("GOAL_HOLD_SEC", str(P.DEFAULT_GOAL_HOLD_SEC)))
MAX_EPISODE_STEPS = int(os.environ.get("MAX_STEPS", str(P.MAX_STEPS)))
CURRENT_ENABLED = os.environ.get("CURRENT_ENABLED", "1") == "1"
MONTAGE_ENABLED = os.environ.get("MONTAGE_ENABLED", "0") == "1"
MONTAGE_MAX_EPISODES = int(os.environ.get("MONTAGE_MAX_EPISODES", "48"))
MONTAGE_STEP_COLS = int(os.environ.get("MONTAGE_STEP_COLS", "12"))
NOMINAL_PLANT = P.plant_from_dict(P.PLANT_NOMINAL)

NET_ARCH: List[int] = [256, 256]
LEARNING_RATE = 3e-4
BATCH_SIZE = 256
GAMMA = 0.99

CONTACT_OBS_NOISE_M = float(os.environ.get("CONTACT_OBS_NOISE_M", str(P.CONTACT_OBS_NOISE_M)))
CONTACT_OBS_NOISE_BEARING_RAD = float(
    os.environ.get("CONTACT_OBS_NOISE_BEARING_RAD", str(P.CONTACT_OBS_NOISE_BEARING_RAD))
)
TRAIN_MAX_CONTACTS = int(os.environ.get("TRAIN_MAX_CONTACTS", "4"))

NOTES = "baseline"
VIZ_PORT = 8765

SCENARIO_CATEGORY_PREFIXES: List[str] = []
CURRICULUM_PHASE: Optional[int] = None
CURRICULUM_EVAL_INTERVAL_SEC = 120.0
CURRICULUM_EVAL_MAX_SCENARIOS = 0
CURRICULUM_EARLY_STOP = False
CURRICULUM_EARLY_STOPPED = False
# =============================================================================


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Boat nav RL training")
    parser.add_argument("--mode", choices=("navigate", "avoid", "all"), default=None)
    parser.add_argument("--budget", type=int, default=None, help="Training budget seconds")
    parser.add_argument("--n-envs", type=int, default=None)
    parser.add_argument("--resume", type=str, default=None, help="Run id to continue from")
    parser.add_argument("--notes", type=str, default=None)
    parser.add_argument(
        "--device",
        choices=("auto", "cuda", "cpu"),
        default=None,
        help="PyTorch device for policy training (env sim stays on CPU)",
    )
    parser.add_argument(
        "--dynamics-jitter",
        action="store_true",
        default=None,
        help="Randomize plant params each training episode (agile↔freighter)",
    )
    parser.add_argument("--no-dynamics-jitter", action="store_true", default=None)
    parser.add_argument(
        "--robust-eval",
        action="store_true",
        default=None,
        help="Run extra perturbed-plant eval pass after training",
    )
    parser.add_argument("--run-config", type=str, default=None, help="JSON run config from UI")
    parser.add_argument(
        "--reward-config",
        type=str,
        default=None,
        help="JSON file with reward_weights overrides (merged into run-config)",
    )
    return parser.parse_args()


def load_run_config(path: Path) -> Dict[str, Any]:
    import json

    return json.loads(path.read_text(encoding="utf-8"))


def apply_run_config(cfg: Dict[str, Any]) -> None:
    global DYNAMICS_JITTER, ROBUST_EVAL_ENABLED, NOMINAL_PLANT, GOAL_HOLD_SEC, MAX_EPISODE_STEPS
    global CURRENT_ENABLED, MONTAGE_ENABLED, MONTAGE_MAX_EPISODES, MONTAGE_STEP_COLS
    global CURRICULUM_PHASE, SCENARIO_CATEGORY_PREFIXES
    global CURRICULUM_EVAL_INTERVAL_SEC, CURRICULUM_EVAL_MAX_SCENARIOS, CURRICULUM_EARLY_STOP
    if "dynamics_jitter" in cfg:
        DYNAMICS_JITTER = bool(cfg["dynamics_jitter"])
    elif cfg.get("phase") in ("jitter", "robust"):
        DYNAMICS_JITTER = True
    if "robust_eval_enabled" in cfg:
        ROBUST_EVAL_ENABLED = bool(cfg["robust_eval_enabled"])
    elif cfg.get("phase") == "robust":
        ROBUST_EVAL_ENABLED = True
    if cfg.get("plant"):
        NOMINAL_PLANT = P.plant_from_dict(cfg["plant"])
    if "goal_hold_sec" in cfg:
        GOAL_HOLD_SEC = max(0, int(cfg["goal_hold_sec"]))
    if "max_steps" in cfg:
        MAX_EPISODE_STEPS = max(1, int(cfg["max_steps"]))
    if "current_enabled" in cfg:
        CURRENT_ENABLED = bool(cfg["current_enabled"])
    if "montage_enabled" in cfg:
        MONTAGE_ENABLED = bool(cfg["montage_enabled"])
    if "montage_max_episodes" in cfg:
        MONTAGE_MAX_EPISODES = max(1, int(cfg["montage_max_episodes"]))
    if "montage_step_cols" in cfg:
        MONTAGE_STEP_COLS = max(2, int(cfg["montage_step_cols"]))
    if cfg.get("reward_weights"):
        applied = apply_reward_overrides(cfg["reward_weights"])
        if applied:
            print(f"[train] reward overrides: {applied}")
    if "curriculum_phase" in cfg:
        CURRICULUM_PHASE = int(cfg["curriculum_phase"])
    if "scenario_category_prefixes" in cfg:
        SCENARIO_CATEGORY_PREFIXES = list(cfg["scenario_category_prefixes"])
        from scenario_seeds import clear_seed_caches

        clear_seed_caches()
        print(f"[train] scenario filter: {SCENARIO_CATEGORY_PREFIXES or 'all'}")
    if "gated_hold" in cfg:
        set_gated_hold_enabled(bool(cfg["gated_hold"]))
        print(f"[train] gated_hold={cfg['gated_hold']}")
    if "curriculum_eval_interval_sec" in cfg:
        CURRICULUM_EVAL_INTERVAL_SEC = float(cfg["curriculum_eval_interval_sec"])
    if "curriculum_eval_max_scenarios" in cfg:
        CURRICULUM_EVAL_MAX_SCENARIOS = int(cfg["curriculum_eval_max_scenarios"])
    if "curriculum_early_stop" in cfg:
        CURRICULUM_EARLY_STOP = bool(cfg["curriculum_early_stop"])


def apply_args(args: argparse.Namespace) -> Optional[str]:
    global MODE, TRAIN_BUDGET_SEC, N_ENVS, NOTES, DEVICE, DYNAMICS_JITTER, ROBUST_EVAL_ENABLED, NOMINAL_PLANT
    global GOAL_HOLD_SEC, MAX_EPISODE_STEPS, CURRENT_ENABLED, MONTAGE_ENABLED
    resume_id = args.resume
    run_cfg: Dict[str, Any] = {}
    if args.run_config:
        run_cfg = load_run_config(Path(args.run_config))
    if args.reward_config:
        reward_cfg = load_run_config(Path(args.reward_config))
        weights = reward_cfg.get("reward_weights", reward_cfg)
        run_cfg.setdefault("reward_weights", {}).update(weights)
    if run_cfg:
        apply_run_config(run_cfg)
    if args.mode is not None:
        MODE = args.mode
    if args.budget is not None:
        TRAIN_BUDGET_SEC = args.budget
    if args.n_envs is not None:
        N_ENVS = args.n_envs
    if args.notes is not None:
        NOTES = args.notes
    if args.device is not None:
        DEVICE = args.device
    if args.no_dynamics_jitter:
        DYNAMICS_JITTER = False
    elif args.dynamics_jitter:
        DYNAMICS_JITTER = True
    if getattr(args, "robust_eval", None):
        ROBUST_EVAL_ENABLED = True
    return resume_id
