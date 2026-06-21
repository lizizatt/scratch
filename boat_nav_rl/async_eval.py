"""Background eval runner — training callbacks poll results without blocking rollouts."""

from __future__ import annotations

import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable, Optional

EVAL_ASYNC = os.environ.get("EVAL_ASYNC", "1").strip().lower() not in ("0", "false", "no")


class AsyncEvalRunner:
    """Runs one eval job at a time on a background thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._future: Optional[Future] = None
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="boat-eval")

    @property
    def enabled(self) -> bool:
        return EVAL_ASYNC

    def is_busy(self) -> bool:
        with self._lock:
            return self._future is not None and not self._future.done()

    def submit(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> bool:
        """Start fn(*args) if idle. Returns False if a job is already running."""
        with self._lock:
            if self._future is not None and not self._future.done():
                return False
            self._future = self._pool.submit(fn, *args, **kwargs)
            return True

    def poll(self) -> Optional[Any]:
        """Return completed job result, or None if still running / no job."""
        with self._lock:
            if self._future is None or not self._future.done():
                return None
            future = self._future
            self._future = None
        try:
            return future.result()
        except Exception:
            raise

    def drain(self, timeout: float = 600.0) -> Optional[Any]:
        """Block until the in-flight job finishes (or timeout). Returns its result."""
        import time

        deadline = time.time() + timeout
        while time.time() < deadline:
            if not self.is_busy():
                return self.poll()
            try:
                result = self.poll()
                if result is not None:
                    return result
            except Exception:
                raise
            time.sleep(0.05)
        return None

    def shutdown(self, *, wait: bool = False) -> None:
        try:
            self._pool.shutdown(wait=wait, cancel_futures=True)
        except TypeError:
            self._pool.shutdown(wait=wait)
