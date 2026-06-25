"""
Boat navigation RL training — edit the CONFIG section, then run:

    python prepare.py   # once
    python train.py
    python serve.py     # visualization at http://localhost:8765
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import CallbackList
from vecenv_util import (
    make_vec_env,
    ppo_batch_size,
    recommended_n_envs,
    rollout_steps_total,
    steps_per_env,
    training_perf_defaults,
)

import prepare as P
from checkpoint_util import (
    copy_best_to_final,
    load_best_metrics,
    resolve_resume_checkpoint,
)
from eval_parallel import (
    aggregate_eval_metrics,
    colregs_enabled_for_mode,
    rollout_episodes,
)
from curriculum import filter_seeds_by_prefix
from device_util import configure_training_backend, resolve_device, torch_device_info

from env import BoatNavEnv, DEFAULT_TRAIN_MAX_CONTACTS
from callbacks import CurriculumCheckpointCallback, LiveMetricsCallback, TimeBudgetCallback
from train_job_state import (
    CANCEL_FLAG_PATH,
    JOB_DIR,
    LIVE_METRICS_PATH,
    RUNS_DIR,
    STATUS_PATH,
    append_live_metric,
    clear_cancel_flag,
    is_cancel_requested,
    live_eval_extras,
    update_job_status,
)
from rewards import (
    REWARD_CLIP,
    StepRewardInput,
    W_CPA,
    W_CPA_SOFT,
    W_GOAL_ARRIVAL,
    W_GOAL_ARRIVAL_EARLY,
    W_GOAL_PROGRESS,
    W_GOAL_THREAT_STAY,
    W_HOLD_BASE,
    W_HOLD_CENTER,
    W_HOLD_SPEED,
    W_APPROACH_SLOW,
    APPROACH_SLOW_RANGE_M,
    CPA_WARNING_MULT,
    THREAT_PROGRESS_THRESH,
    W_COLLISION,
    W_SMOOTH,
    apply_reward_overrides,
    compute_step_reward,
    contact_step_metrics,
    contact_threat_and_cpa_penalty,
    energy_score_from_speeds,
    energy_score_from_trace,
    HOLD_AT_STOP_EPS_MPS,
    reward_weights_dict,
    set_gated_hold_enabled,
    gated_hold_enabled,
)
from runs_util import score_key_for_mode

ROOT = Path(__file__).resolve().parent

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

# Contact sensing noise (training only — eval uses zero)
CONTACT_OBS_NOISE_M = float(os.environ.get("CONTACT_OBS_NOISE_M", str(P.CONTACT_OBS_NOISE_M)))
CONTACT_OBS_NOISE_BEARING_RAD = float(
    os.environ.get("CONTACT_OBS_NOISE_BEARING_RAD", str(P.CONTACT_OBS_NOISE_BEARING_RAD))
)
TRAIN_MAX_CONTACTS = int(os.environ.get("TRAIN_MAX_CONTACTS", "4"))

NOTES = "baseline"

VIZ_PORT = 8765

_EVAL_SEEDS_CACHE: Dict[tuple, List[P.ScenarioSeed]] = {}
_TRAIN_SEEDS_CACHE: Dict[tuple, List[P.ScenarioSeed]] = {}
CURRICULUM_PHASE: Optional[int] = None
SCENARIO_CATEGORY_PREFIXES: List[str] = []
CURRICULUM_EVAL_INTERVAL_SEC = 120.0
CURRICULUM_EVAL_MAX_SCENARIOS = 0
CURRICULUM_EARLY_STOP = False
CURRICULUM_EARLY_STOPPED = False
# =============================================================================

# Re-exported for tests and scripts that import from train
from rewards import (  # noqa: E402
    APPROACH_SLOW_RANGE_M,
    REWARD_CLIP,
    THREAT_PROGRESS_THRESH,
    W_APPROACH_SLOW,
    W_CPA,
    W_CPA_SOFT,
    W_COLLISION,
    W_GOAL_ARRIVAL,
    W_GOAL_ARRIVAL_EARLY,
    W_GOAL_PROGRESS,
    W_GOAL_THREAT_STAY,
    W_HOLD_BASE,
    W_HOLD_CENTER,
    W_HOLD_SPEED,
    W_SMOOTH,
    contact_threat_and_cpa_penalty,
)


def _seed_cache_key(mode: str) -> tuple:
    return (mode, tuple(SCENARIO_CATEGORY_PREFIXES))


def apply_scenario_prefix_filter(seeds: List[P.ScenarioSeed]) -> List[P.ScenarioSeed]:
    return filter_seeds_by_prefix(seeds, SCENARIO_CATEGORY_PREFIXES)


def filter_seeds_for_mode(seeds: List[P.ScenarioSeed], mode: str) -> List[P.ScenarioSeed]:
    if mode == "all":
        return list(seeds)
    if mode == "avoid":
        return [s for s in seeds if s.contacts]
    return [s for s in seeds if not s.contacts]


def load_parent_metrics(resume_run_id: str) -> Dict[str, Any]:
    path = RUNS_DIR / resume_run_id / "metrics.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))







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
        _EVAL_SEEDS_CACHE.clear()
        _TRAIN_SEEDS_CACHE.clear()
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



def train_seeds_for_mode(mode: str) -> List[P.ScenarioSeed]:
    key = _seed_cache_key(mode)
    if key in _TRAIN_SEEDS_CACHE:
        return _TRAIN_SEEDS_CACHE[key]
    seeds = filter_seeds_for_mode(P.load_train_seeds(), mode)
    seeds = apply_scenario_prefix_filter(seeds)
    if not seeds:
        raise RuntimeError(
            f"No train seeds for mode={mode} filter={SCENARIO_CATEGORY_PREFIXES}. Run prepare.py first."
        )
    _TRAIN_SEEDS_CACHE[key] = seeds
    return seeds


def make_env(
    mode: str,
    seed_offset: int = 0,
    train_seeds: Optional[List[P.ScenarioSeed]] = None,
    nominal_plant: Optional[P.PlantParams] = None,
    dynamics_jitter: bool = False,
    goal_hold_sec: int = P.DEFAULT_GOAL_HOLD_SEC,
    max_episode_steps: Optional[int] = None,
    current_enabled: bool = True,
    contact_obs_noise_m: float = 0.0,
    contact_obs_noise_bearing_rad: float = 0.0,
):
    seeds = train_seeds if train_seeds is not None else train_seeds_for_mode(mode)
    plant = nominal_plant or NOMINAL_PLANT

    def _init():
        env = BoatNavEnv(
            mode=mode,
            training_randomize=True,
            train_seeds=seeds,
            nominal_plant=plant,
            dynamics_jitter=dynamics_jitter,
            goal_hold_sec=goal_hold_sec,
            max_episode_steps=max_episode_steps,
            current_enabled=current_enabled,
            contact_obs_noise_m=contact_obs_noise_m,
            contact_obs_noise_bearing_rad=contact_obs_noise_bearing_rad,
            train_max_contacts=TRAIN_MAX_CONTACTS,
        )
        env.reset(seed=seed_offset)
        return env

    return _init


def create_run_dir() -> Path:
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    latest = RUNS_DIR / "latest"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    try:
        latest.symlink_to(run_dir.name, target_is_directory=True)
    except OSError:
        (RUNS_DIR / "latest.txt").write_text(run_dir.name, encoding="utf-8")
    return run_dir


def eval_seeds_for_mode(mode: str) -> List[P.ScenarioSeed]:
    key = _seed_cache_key(mode)
    if key in _EVAL_SEEDS_CACHE:
        return _EVAL_SEEDS_CACHE[key]
    seeds = filter_seeds_for_mode(P.load_eval_seeds(), mode)
    seeds = apply_scenario_prefix_filter(seeds)
    if not seeds:
        raise RuntimeError(
            f"No eval seeds for mode={mode} filter={SCENARIO_CATEGORY_PREFIXES}. Run prepare.py first."
        )
    _EVAL_SEEDS_CACHE[key] = seeds
    return seeds


def run_eval(
    model: PPO,
    mode: str,
    max_scenarios: Optional[int] = None,
    sample_seed: Optional[int] = None,
    eval_plant: Optional[P.PlantParams] = None,
    dynamics_jitter: Optional[bool] = None,
    current_enabled: Optional[bool] = None,
    collect_traces: bool = True,
    collect_breakdown: bool = True,
    workers: Optional[int] = None,
) -> Any:
    seeds = eval_seeds_for_mode(mode)
    if max_scenarios is not None and max_scenarios < len(seeds):
        rng = np.random.default_rng(sample_seed if sample_seed is not None else 0)
        picks = rng.choice(len(seeds), size=max_scenarios, replace=False)
        seeds = [seeds[i] for i in sorted(int(x) for x in picks)]
    cur_enabled = CURRENT_ENABLED if current_enabled is None else current_enabled
    if eval_plant is not None:
        plant_jitter = False
        nominal_plant = eval_plant
    else:
        nominal_plant = NOMINAL_PLANT
        plant_jitter = True
    if dynamics_jitter is not None:
        plant_jitter = dynamics_jitter

    episode_results = rollout_episodes(
        model,
        seeds,
        mode=mode,
        goal_hold_sec=GOAL_HOLD_SEC,
        max_episode_steps=MAX_EPISODE_STEPS,
        current_enabled=cur_enabled,
        plant_jitter=plant_jitter,
        nominal_plant=nominal_plant,
        collect_trace=collect_traces,
        collect_breakdown=collect_breakdown,
        workers=workers,
    )
    return aggregate_eval_metrics(
        episode_results,
        seeds,
        mode,
        eval_seed_list_count=len(eval_seeds_for_mode(mode)),
        train_scenario_count=len(train_seeds_for_mode(mode)),
        plant_jitter=plant_jitter,
        current_enabled=cur_enabled,
        nominal_plant=nominal_plant,
        collect_traces=collect_traces,
        colregs_enabled=colregs_enabled_for_mode(mode),
    )


def run_robust_eval(model: PPO, mode: str) -> Dict[str, Any]:
    """Sample random plants (agile↔freighter) and score on eval scenario subsets."""
    score_key = score_key_for_mode(mode)
    scores: List[float] = []
    plant_records: List[Dict[str, float]] = []
    for i in range(ROBUST_EVAL_SAMPLES):
        rng = np.random.default_rng(9001 + i)
        plant = P.sample_plant_params(rng)
        metrics = run_eval(
            model,
            mode,
            max_scenarios=ROBUST_EVAL_SCENARIOS,
            sample_seed=8000 + i,
            eval_plant=plant,
            collect_traces=False,
        ).metrics
        scores.append(float(metrics[score_key]))
        plant_records.append(plant.to_dict())
    arr = np.array(scores, dtype=np.float64)
    return {
        "robust_eval_score": round(float(arr.mean()), 4),
        "robust_eval_worst": round(float(arr.min()), 4),
        "robust_eval_samples": ROBUST_EVAL_SAMPLES,
        "robust_eval_scenarios_per_sample": ROBUST_EVAL_SCENARIOS,
        "robust_eval_plants": plant_records,
    }


def write_run_outputs(
    run_dir: Path,
    metrics: Dict[str, Any],
    traces: List[Dict[str, Any]],
    train_metrics: Dict[str, Any],
    model: PPO,
    resume_run_id: Optional[str] = None,
    parent_metrics: Optional[Dict[str, Any]] = None,
) -> None:
    parent_metrics = parent_metrics or {}
    train_session = int(parent_metrics.get("train_session", 1)) + 1 if resume_run_id else 1
    prev_cumulative = float(parent_metrics.get("cumulative_train_sec", 0) or 0)
    elapsed = float(train_metrics.get("train_elapsed_sec", 0) or 0)

    payload = {
        **metrics,
        **train_metrics,
        "notes": NOTES,
        "parent_run_id": resume_run_id,
        "train_session": train_session,
        "cumulative_train_sec": round(prev_cumulative + elapsed, 1),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "mode": MODE,
            "net_arch": NET_ARCH,
            "learning_rate": LEARNING_RATE,
            "n_envs": N_ENVS,
            "rollout_steps_total": train_metrics.get("rollout_steps_total"),
            "steps_per_env": train_metrics.get("steps_per_env"),
            "vecenv_backend": train_metrics.get("vecenv_backend"),
            "device": train_metrics.get("device"),
            "dynamics_jitter": train_metrics.get("dynamics_jitter"),
            "robust_eval_enabled": train_metrics.get("robust_eval_enabled"),
            "nominal_plant": train_metrics.get("nominal_plant"),
            "goal_hold_sec": train_metrics.get("goal_hold_sec"),
            "max_steps": train_metrics.get("max_steps"),
            "current_enabled": train_metrics.get("current_enabled"),
            "montage_enabled": MONTAGE_ENABLED,
            "train_max_contacts": TRAIN_MAX_CONTACTS,
            "reward_weights": reward_weights_dict(),
            "curriculum_phase": CURRICULUM_PHASE,
            "gated_hold": gated_hold_enabled(),
            "scenario_category_prefixes": list(SCENARIO_CATEGORY_PREFIXES),
        },
        "viz_url": f"http://localhost:{VIZ_PORT}/scenarios.html?run={run_dir.name}",
    }
    (run_dir / "metrics.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (run_dir / "eval_traces.json").write_text(
        json.dumps({"episodes": traces}, separators=(",", ":")), encoding="utf-8"
    )
    model.save(str(run_dir / "model"))

    if MONTAGE_ENABLED and traces:
        try:
            import render_montage as RM

            montage_meta = RM.write_eval_montages(
                run_dir,
                traces,
                max_episodes=MONTAGE_MAX_EPISODES,
                step_cols=MONTAGE_STEP_COLS,
            )
            payload["montage"] = montage_meta
            (run_dir / "metrics.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
            print(
                f"[montage] wrote step + trajectory PNGs in {montage_meta['montage_sec']}s "
                f"({montage_meta['step_montage']['episodes_shown']}/"
                f"{montage_meta['step_montage']['episodes_total']} episodes)"
            )
        except Exception as exc:
            print(f"[montage] skipped: {exc}")


def main() -> None:
    args = parse_args()
    resume_run_id = apply_args(args)

    if not P.EVAL_SEEDS_PATH.exists() or not P.TRAIN_SEEDS_PATH.exists():
        P.write_scenario_splits()

    parent_metrics = load_parent_metrics(resume_run_id) if resume_run_id else {}
    clear_cancel_flag()
    LIVE_METRICS_PATH.unlink(missing_ok=True)
    run_dir = create_run_dir()
    train_start = time.time()

    device = resolve_device(DEVICE)
    configure_training_backend(device)
    rollout_total = rollout_steps_total(N_ENVS)
    n_steps = steps_per_env(N_ENVS)
    batch_size = ppo_batch_size(device, rollout_total, base=BATCH_SIZE)
    vec_backend = training_perf_defaults()["vecenv_backend"]
    gpu_info = torch_device_info()

    print(f"[train] mode={MODE} budget={TRAIN_BUDGET_SEC}s n_envs={N_ENVS} run={run_dir.name}")
    print(
        f"[train] vec={vec_backend} rollout={rollout_total} ({n_steps} steps/env) "
        f"dynamics_jitter={DYNAMICS_JITTER} robust_eval={ROBUST_EVAL_ENABLED} "
        f"hold={GOAL_HOLD_SEC}s max_steps={MAX_EPISODE_STEPS} current={CURRENT_ENABLED} live_eval={LIVE_EVAL_SCENARIOS}@{LIVE_EVAL_INTERVAL_SEC}s"
    )
    print(f"[train] device={device} batch_size={batch_size}", end="")
    if device == "cuda" and gpu_info.get("cuda_device"):
        print(f" ({gpu_info['cuda_device']})", end="")
    print()
    if resume_run_id:
        print(f"[train] resuming from runs/{resume_run_id}")

    update_job_status(
        run_id=run_dir.name,
        mode=MODE,
        resume_run_id=resume_run_id,
        dynamics_jitter=DYNAMICS_JITTER,
        robust_eval_enabled=ROBUST_EVAL_ENABLED,
        nominal_plant=NOMINAL_PLANT.to_dict(),
        goal_hold_sec=GOAL_HOLD_SEC,
        current_enabled=CURRENT_ENABLED,
        montage_enabled=MONTAGE_ENABLED,
    )

    train_seeds = train_seeds_for_mode(MODE)
    factories = [
        make_env(
            MODE,
            i,
            train_seeds=train_seeds,
            nominal_plant=NOMINAL_PLANT,
            dynamics_jitter=DYNAMICS_JITTER,
            goal_hold_sec=GOAL_HOLD_SEC,
            max_episode_steps=MAX_EPISODE_STEPS,
            current_enabled=CURRENT_ENABLED,
            contact_obs_noise_m=CONTACT_OBS_NOISE_M,
            contact_obs_noise_bearing_rad=CONTACT_OBS_NOISE_BEARING_RAD,
        )
        for i in range(N_ENVS)
    ]
    env = make_vec_env(factories, N_ENVS)

    model_holder: Dict[str, Any] = {}
    if resume_run_id:
        parent_dir = RUNS_DIR / resume_run_id
        checkpoint = resolve_resume_checkpoint(parent_dir, prefer_best=True)
        model = PPO.load(str(checkpoint), env=env, device=device)
        print(f"[train] loaded checkpoint {checkpoint}")
    else:
        model = PPO(
            "MlpPolicy",
            env,
            learning_rate=LEARNING_RATE,
            n_steps=n_steps,
            batch_size=batch_size,
            gamma=GAMMA,
            max_grad_norm=0.5,
            device=device,
            policy_kwargs={"net_arch": dict(pi=NET_ARCH, vf=NET_ARCH)},
            verbose=1,
        )
    model_holder["model"] = model

    budget_cb = TimeBudgetCallback(TRAIN_BUDGET_SEC)
    async_eval_cb: Optional[BaseCallback] = None
    if CURRICULUM_PHASE is not None:
        async_eval_cb = CurriculumCheckpointCallback(
            model_holder,
            run_dir,
            MODE,
            CURRICULUM_PHASE,
            run_dir.name,
        )
        callback = CallbackList([budget_cb, async_eval_cb])
    else:
        async_eval_cb = LiveMetricsCallback(model_holder, MODE, run_dir.name, run_dir=run_dir)
        callback = CallbackList([budget_cb, async_eval_cb])
    model.learn(total_timesteps=int(1e9), callback=callback, progress_bar=True)
    env.close()

    if async_eval_cb is not None and hasattr(async_eval_cb, "drain_background_eval"):
        async_eval_cb.drain_background_eval()

    elapsed = time.time() - train_start
    early_stopped = CURRICULUM_EARLY_STOPPED
    cancelled = is_cancel_requested() or budget_cb.cancelled
    if early_stopped:
        print("[train] early stopped — curriculum exit gate passed")
    elif cancelled:
        print("[train] paused/cancelled by user")

    best_meta = load_best_metrics(run_dir)
    if best_meta:
        ckpt = resolve_resume_checkpoint(run_dir, prefer_best=True)
        if ckpt.with_suffix(".zip").exists() or ckpt.exists():
            model = PPO.load(str(ckpt), device=device)
            model_holder["model"] = model
            sr = best_meta.get("summary", {}).get("success_rate")
            print(f"[train] final eval using best checkpoint (success_rate={sr})")
        copy_best_to_final(run_dir)

    eval_limit = EVAL_EPISODES if EVAL_EPISODES > 0 else None
    eval_metrics: Dict[str, Any] = {}
    traces: List[Dict[str, Any]] = []
    try:
        eval_result = run_eval(model, MODE, max_scenarios=eval_limit, collect_traces=True)
        eval_metrics, traces = eval_result.metrics, eval_result.traces
        if ROBUST_EVAL_ENABLED:
            eval_metrics.update(run_robust_eval(model, MODE))
            print(
                f"[train] robust_eval score={eval_metrics.get('robust_eval_score')} "
                f"worst={eval_metrics.get('robust_eval_worst')}"
            )
    except Exception as exc:
        print(f"[train] final eval failed ({exc}); saving checkpoint without full eval")

    write_run_outputs(
        run_dir,
        eval_metrics,
        traces,
        {
            "train_budget_sec": TRAIN_BUDGET_SEC,
            "train_elapsed_sec": round(elapsed, 1),
            "cancelled": cancelled,
            "curriculum_early_stopped": early_stopped,
            "best_checkpoint": best_meta,
            "device": device,
            "batch_size": batch_size,
            "rollout_steps_total": rollout_total,
            "steps_per_env": n_steps,
            "vecenv_backend": vec_backend,
            "dynamics_jitter": DYNAMICS_JITTER,
            "robust_eval_enabled": ROBUST_EVAL_ENABLED,
            "nominal_plant": NOMINAL_PLANT.to_dict(),
            "goal_hold_sec": GOAL_HOLD_SEC,
            "max_steps": MAX_EPISODE_STEPS,
            "current_enabled": CURRENT_ENABLED,
            "montage_enabled": MONTAGE_ENABLED,
        },
        model,
        resume_run_id=resume_run_id,
        parent_metrics=parent_metrics,
    )

    score_key = score_key_for_mode(MODE)
    score = eval_metrics.get(score_key)
    avg_rng = eval_metrics.get("avg_final_goal_range_m")
    clear_cancel_flag()
    update_job_status(
        running=False,
        state="cancelled" if cancelled else "completed",
        run_id=run_dir.name,
        score=score,
        avg_final_goal_range_m=avg_rng,
    )
    if score is not None:
        print(
            f"[experiment] {score_key}={score:.3f}  avg_goal_range={avg_rng}m  "
            f"elapsed={elapsed:.0f}s  run=runs/{run_dir.name}"
        )
    else:
        print(
            f"[experiment] checkpoint saved (eval skipped)  "
            f"elapsed={elapsed:.0f}s  run=runs/{run_dir.name}"
        )
    print(f"[viz] Train:     http://localhost:{VIZ_PORT}/train.html")
    print(f"[viz] Overview:  http://localhost:{VIZ_PORT}/scenarios.html?run={run_dir.name}")
    print(f"[viz] Replay:    http://localhost:{VIZ_PORT}/?run={run_dir.name}")


if __name__ == "__main__":
    main()
