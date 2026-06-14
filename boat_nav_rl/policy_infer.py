"""Thread-safe policy inference (training and live eval must not overlap)."""

from __future__ import annotations

import threading
from typing import Any, Tuple

import numpy as np

_inference_lock = threading.RLock()


def inference_lock() -> threading.RLock:
    return _inference_lock


def safe_model_predict(
    model: Any,
    obs: np.ndarray,
    *,
    deterministic: bool = True,
) -> Tuple[np.ndarray, Any]:
    """Serialize all predict calls so they never overlap PPO weight updates."""
    with _inference_lock:
        import torch

        with torch.no_grad():
            return model.predict(obs, deterministic=deterministic)
