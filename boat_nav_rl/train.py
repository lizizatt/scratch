"""
Boat navigation RL training CLI.

Edit CONFIG in train_config.py between experiments, then:

    python prepare.py   # once
    python train.py
    python serve.py     # visualization at http://localhost:8765
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback, CallbackList
from vecenv_util import (
    make_vec_env,
    ppo_batch_size,
    rollout_steps_total,
    steps_per_env,
    training_perf_defaults,
)

import prepare as P
from checkpoint_util import copy_best_to_final, load_best_metrics, resolve_resume_checkpoint
from device_util import configure_training_backend, resolve_device, torch_device_info
from callbacks import CurriculumCheckpointCallback, LiveMetricsCallback, TimeBudgetCallback
from env import BoatNavEnv, DEFAULT_TRAIN_MAX_CONTACTS
from env_factory import make_env
from eval_runner import run_eval, run_robust_eval
from run_outputs import create_run_dir, load_parent_metrics, write_run_outputs
from runs_util import score_key_for_mode
from scenario_seeds import eval_seeds_for_mode, filter_seeds_for_mode, train_seeds_for_mode
from train_config import (
    BATCH_SIZE,
    CONTACT_OBS_NOISE_BEARING_RAD,
    CONTACT_OBS_NOISE_M,
    CURRENT_ENABLED,
    CURRICULUM_EARLY_STOPPED,
    CURRICULUM_PHASE,
    DEVICE,
    DYNAMICS_JITTER,
    EVAL_EPISODES,
    GAMMA,
    GOAL_HOLD_SEC,
    LEARNING_RATE,
    LIVE_EVAL_INTERVAL_SEC,
    LIVE_EVAL_SCENARIOS,
    MAX_EPISODE_STEPS,
    MODE,
    MONTAGE_ENABLED,
    NET_ARCH,
    NOMINAL_PLANT,
    N_ENVS,
    NOTES,
    ROBUST_EVAL_ENABLED,
    TRAIN_BUDGET_SEC,
    TRAIN_MAX_CONTACTS,
    VIZ_PORT,
    apply_args,
    parse_args,
)
from train_job_state import LIVE_METRICS_PATH, RUNS_DIR, clear_cancel_flag, is_cancel_requested, update_job_status

# Re-exported for tests and scripts that import from train
from rewards import (  # noqa: E402, F401
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
        f"hold={GOAL_HOLD_SEC}s max_steps={MAX_EPISODE_STEPS} current={CURRENT_ENABLED} "
        f"live_eval={LIVE_EVAL_SCENARIOS}@{LIVE_EVAL_INTERVAL_SEC}s"
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

    import train_config as C

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
            "montage_enabled": C.MONTAGE_ENABLED,
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
