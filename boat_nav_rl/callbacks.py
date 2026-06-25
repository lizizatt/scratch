"""PPO training callbacks for live eval and curriculum checkpoints."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from stable_baselines3.common.callbacks import BaseCallback

from async_eval import AsyncEvalRunner
from checkpoint_util import save_best_checkpoint, save_periodic_snapshot
from curriculum import check_exit, get_phase, is_summary_better, metrics_to_summary
from eval_parallel import EvalResult, checkpoint_zip_path, run_eval_from_snapshot, snapshot_model_for_eval
from eval_runner import run_eval
from runs_util import score_key_for_mode
from scenario_seeds import eval_seeds_for_mode
from train_config import (
    CURRICULUM_EARLY_STOP,
    CURRICULUM_EVAL_INTERVAL_SEC,
    CURRICULUM_EVAL_MAX_SCENARIOS,
    LIVE_EVAL_INTERVAL_SEC,
    LIVE_EVAL_SCENARIOS,
)
import train_config as C
from train_job_state import (
    RUNS_DIR,
    append_live_metric,
    is_cancel_requested,
    live_eval_extras,
)


def _eval_metrics(result: Any) -> Dict[str, Any]:
    if isinstance(result, EvalResult):
        return result.metrics
    return result


class TimeBudgetCallback(BaseCallback):
    def __init__(self, budget_sec: float, verbose: int = 0):
        super().__init__(verbose)
        self.budget_sec = budget_sec
        self.start_time = 0.0
        self.cancelled = False

    def _on_training_start(self) -> None:
        self.start_time = time.time()

    def _on_step(self) -> bool:
        if is_cancel_requested():
            self.cancelled = True
            return False
        return (time.time() - self.start_time) < self.budget_sec


class PeriodicSnapshotCallback(BaseCallback):
    """Save PPO checkpoints on a fixed wall-clock interval (for long runs)."""

    def __init__(
        self,
        model_holder: Dict[str, Any],
        run_dir: Path,
        interval_sec: float,
    ) -> None:
        super().__init__()
        self.model_holder = model_holder
        self.run_dir = run_dir
        self.interval_sec = max(60.0, float(interval_sec))
        self.start_time = 0.0
        self.next_snapshot_time = 0.0
        self.snapshot_index = 0

    def _on_training_start(self) -> None:
        self.start_time = time.time()
        self.next_snapshot_time = self.start_time + self.interval_sec

    def _save_snapshot(self, now: float) -> None:
        model = self.model_holder.get("model")
        if model is None:
            return
        elapsed = now - self.start_time
        self.snapshot_index += 1
        path = save_periodic_snapshot(
            self.run_dir,
            model,
            elapsed_sec=elapsed,
            timesteps=self.num_timesteps,
            index=self.snapshot_index,
        )
        print(
            f"[snapshot] saved {path.name} "
            f"@ {elapsed / 60.0:.1f} min ({self.num_timesteps} steps)",
            flush=True,
        )

    def _on_step(self) -> bool:
        now = time.time()
        if now < self.next_snapshot_time:
            return True
        try:
            self._save_snapshot(now)
        except Exception as exc:
            print(f"[snapshot] skipped: {exc}", flush=True)
        self.next_snapshot_time += self.interval_sec
        return True


class LiveMetricsCallback(BaseCallback):
    """Periodic mini-eval on a random eval-set subset (async by default)."""

    def __init__(
        self,
        model_holder: Dict[str, Any],
        mode: str,
        run_id: str,
        interval_sec: Optional[float] = None,
        max_scenarios: Optional[int] = None,
        run_dir: Optional[Path] = None,
    ) -> None:
        super().__init__()
        self.model_holder = model_holder
        self.mode = mode
        self.run_id = run_id
        self.run_dir = run_dir or (RUNS_DIR / run_id)
        self.interval_sec = LIVE_EVAL_INTERVAL_SEC if interval_sec is None else interval_sec
        self.max_scenarios = LIVE_EVAL_SCENARIOS if max_scenarios is None else max_scenarios
        self.start_time = 0.0
        self.last_eval_time = 0.0
        self.eval_tick = 0
        self._async = AsyncEvalRunner()

    def _on_training_start(self) -> None:
        self.start_time = time.time()
        self.last_eval_time = self.start_time

    def _publish_metrics(self, metrics: Dict[str, Any], elapsed: float) -> None:
        score = metrics[score_key_for_mode(self.mode)]
        append_live_metric(
            self.run_id,
            self.mode,
            self.num_timesteps,
            elapsed,
            score,
            metrics.get("avg_final_goal_range_m") or 0.0,
            successes=int(round(metrics.get("success_rate", 0) * metrics.get("eval_episodes", 0))),
            eval_episodes=metrics.get("eval_episodes", 0),
            scenario_names=metrics.get("scenario_names"),
            eval_metrics=live_eval_extras(metrics),
        )

    def _dispatch_eval(self) -> None:
        model = self.model_holder.get("model")
        if model is None:
            return
        self.eval_tick += 1
        sample_seed = self.num_timesteps + self.eval_tick * 10007
        if self._async.enabled:
            snap = self.run_dir / "_live_eval_snapshot"
            stem = snapshot_model_for_eval(model, snap)
            if not self._async.submit(
                run_eval_from_snapshot,
                str(stem),
                self.mode,
                self.max_scenarios,
                sample_seed,
                None,
                None,
                None,
                False,
                True,
                None,
            ):
                checkpoint_zip_path(stem).unlink(missing_ok=True)
            return
        metrics = run_eval(
            model,
            self.mode,
            max_scenarios=self.max_scenarios,
            sample_seed=sample_seed,
            collect_traces=False,
        ).metrics
        self._publish_metrics(metrics, time.time() - self.start_time)

    def _on_step(self) -> bool:
        if is_cancel_requested():
            return False
        if self._async.enabled:
            try:
                result = self._async.poll()
                if result is not None:
                    self._publish_metrics(_eval_metrics(result), time.time() - self.start_time)
            except Exception as exc:
                print(f"[live-eval] failed: {exc}")
            if self._async.is_busy():
                return True
        now = time.time()
        if now - self.last_eval_time < self.interval_sec:
            return True
        self.last_eval_time = now
        try:
            self._dispatch_eval()
        except Exception as exc:
            print(f"[live-eval] skipped: {exc}")
        return True

    def drain_background_eval(self, timeout: float = 900.0) -> None:
        if not self._async.enabled or not self._async.is_busy():
            try:
                self._async.poll()
            except Exception as exc:
                print(f"[live-eval] background eval failed: {exc}")
            return
        print("[live-eval] waiting for background eval to finish…")
        try:
            result = self._async.drain(timeout=timeout)
            if result is not None:
                self._publish_metrics(_eval_metrics(result), time.time() - self.start_time)
        except Exception as exc:
            print(f"[live-eval] background eval failed: {exc}")


class CurriculumCheckpointCallback(BaseCallback):
    """Periodic eval, save best_model, optional early stop when phase gate passes."""

    def __init__(
        self,
        model_holder: Dict[str, Any],
        run_dir: Path,
        mode: str,
        phase_id: int,
        run_id: str,
    ) -> None:
        super().__init__()
        self.model_holder = model_holder
        self.run_dir = run_dir
        self.mode = mode
        self.phase = get_phase(phase_id)
        self.run_id = run_id
        self.start_time = 0.0
        self.last_eval_time = 0.0
        self.tick = 0
        self.best_summary: Optional[Dict[str, Any]] = None
        self._async = AsyncEvalRunner()
        self._eval_was_capped = False

    def _on_training_start(self) -> None:
        self.start_time = time.time()
        self.last_eval_time = self.start_time

    def _max_scenarios_for_eval(self, *, full: bool) -> Tuple[Optional[int], bool]:
        n_seeds = len(eval_seeds_for_mode(self.mode))
        cap = CURRICULUM_EVAL_MAX_SCENARIOS
        use_cap = (not full) and cap > 0 and n_seeds > cap
        max_sc = cap if use_cap else None
        return max_sc, use_cap

    def _dispatch_eval(self, *, full: bool) -> None:
        model = self.model_holder.get("model")
        if model is None:
            return
        self.tick += 1
        max_sc, use_cap = self._max_scenarios_for_eval(full=full)
        self._eval_was_capped = use_cap
        sample_seed = self.num_timesteps + self.tick * 10007
        if self._async.enabled:
            snap = self.run_dir / "_curriculum_eval_snapshot"
            stem = snapshot_model_for_eval(model, snap)
            if not self._async.submit(
                run_eval_from_snapshot,
                str(stem),
                self.mode,
                max_sc,
                sample_seed,
                None,
                None,
                None,
                False,
                True,
                None,
            ):
                checkpoint_zip_path(stem).unlink(missing_ok=True)
            return
        metrics = run_eval(
            model,
            self.mode,
            max_scenarios=max_sc,
            sample_seed=sample_seed,
            collect_traces=False,
        ).metrics
        self._handle_eval_metrics(metrics)

    def _run_eval_summary(self, *, full: bool) -> Dict[str, Any]:
        max_sc, use_cap = self._max_scenarios_for_eval(full=full)
        model = self.model_holder.get("model")
        metrics = run_eval(
            model,
            self.mode,
            max_scenarios=max_sc,
            sample_seed=self.num_timesteps + self.tick * 10007,
            collect_traces=False,
        ).metrics
        summary = metrics_to_summary(metrics)
        summary["eval_capped"] = use_cap
        return summary

    def _handle_eval_metrics(self, metrics: Dict[str, Any]) -> None:
        elapsed = time.time() - self.start_time
        summary = metrics_to_summary(metrics)
        summary["eval_capped"] = self._eval_was_capped

        if self._eval_was_capped and is_summary_better(self.phase, summary, self.best_summary):
            if self._async.enabled:
                self._dispatch_eval(full=True)
            else:
                summary = self._run_eval_summary(full=True)
                self._apply_summary(summary, elapsed)
            return
        if self._eval_was_capped:
            return
        self._apply_summary(summary, elapsed)
        if C.CURRICULUM_EARLY_STOPPED:
            return

    def _apply_summary(self, summary: Dict[str, Any], elapsed: float) -> None:
        if not is_summary_better(self.phase, summary, self.best_summary):
            return
        self._maybe_save(summary, elapsed)
        passed, reasons = check_exit(self.phase, summary)
        if passed and CURRICULUM_EARLY_STOP:
            C.CURRICULUM_EARLY_STOPPED = True
            print("[curriculum-eval] exit gate PASSED — early stop", flush=True)
            for line in reasons:
                print(f"  {line}", flush=True)

    def _maybe_save(self, summary: Dict[str, Any], elapsed: float) -> None:
        model = self.model_holder.get("model")
        if model is None:
            return
        save_best_checkpoint(
            self.run_dir,
            model,
            summary,
            timesteps=self.num_timesteps,
            elapsed_sec=elapsed,
        )
        self.best_summary = dict(summary)
        sr = summary.get("success_rate")
        print(
            f"[curriculum-eval] new best success_rate={sr} "
            f"zone_entry={summary.get('zone_entry_rate')} timesteps={self.num_timesteps}",
            flush=True,
        )
        score = summary.get("score") or 0.0
        append_live_metric(
            self.run_id,
            self.mode,
            self.num_timesteps,
            elapsed,
            float(score),
            summary.get("avg_final_goal_range_m") or 0.0,
            successes=int(round(float(sr or 0) * int(summary.get("eval_episodes") or 0))),
            eval_episodes=int(summary.get("eval_episodes") or 0),
            eval_metrics=live_eval_extras(summary),
        )

    def _on_step(self) -> bool:
        if is_cancel_requested():
            return False
        if self._async.enabled:
            try:
                result = self._async.poll()
                if result is not None:
                    self._handle_eval_metrics(_eval_metrics(result))
            except Exception as exc:
                print(f"[curriculum-eval] failed: {exc}", flush=True)
            if self._async.is_busy():
                return not C.CURRICULUM_EARLY_STOPPED
        now = time.time()
        if now - self.last_eval_time < CURRICULUM_EVAL_INTERVAL_SEC:
            return not C.CURRICULUM_EARLY_STOPPED
        self.last_eval_time = now
        try:
            if self._async.enabled:
                self._dispatch_eval(full=False)
            else:
                elapsed = now - self.start_time
                self.tick += 1
                summary = self._run_eval_summary(full=False)
                if summary.get("eval_capped") and is_summary_better(
                    self.phase, summary, self.best_summary
                ):
                    summary = self._run_eval_summary(full=True)
                elif summary.get("eval_capped"):
                    return not C.CURRICULUM_EARLY_STOPPED
                if not is_summary_better(self.phase, summary, self.best_summary):
                    return not C.CURRICULUM_EARLY_STOPPED
                self._maybe_save(summary, elapsed)
                passed, reasons = check_exit(self.phase, summary)
                if passed and CURRICULUM_EARLY_STOP:
                    C.CURRICULUM_EARLY_STOPPED = True
                    print("[curriculum-eval] exit gate PASSED — early stop", flush=True)
                    for line in reasons:
                        print(f"  {line}", flush=True)
        except Exception as exc:
            print(f"[curriculum-eval] skipped: {exc}", flush=True)
        if C.CURRICULUM_EARLY_STOPPED:
            return False
        return True

    def drain_background_eval(self, timeout: float = 900.0) -> None:
        if not self._async.enabled or not self._async.is_busy():
            try:
                self._async.poll()
            except Exception as exc:
                print(f"[curriculum-eval] background eval failed: {exc}", flush=True)
            return
        print("[curriculum-eval] waiting for background eval to finish…", flush=True)
        try:
            result = self._async.drain(timeout=timeout)
            if result is not None:
                self._handle_eval_metrics(_eval_metrics(result))
        except Exception as exc:
            print(f"[curriculum-eval] background eval failed: {exc}", flush=True)
