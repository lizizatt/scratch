"""PyTorch device selection for training."""

from __future__ import annotations

from typing import Any, Dict


def torch_device_info() -> Dict[str, Any]:
    try:
        import torch
    except ImportError:
        return {"cuda_available": False, "error": "torch not installed"}

    info: Dict[str, Any] = {
        "torch_version": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
    }
    if torch.cuda.is_available():
        info["cuda_device"] = torch.cuda.get_device_name(0)
        info["cuda_device_count"] = torch.cuda.device_count()
    else:
        info["cuda_device"] = None
        if "+cpu" in torch.__version__:
            info["install_hint"] = (
                "pip install torch --index-url https://download.pytorch.org/whl/cu124"
            )
    return info


def configure_training_backend(device: str) -> None:
    """Enable safe PyTorch throughput settings for long training runs."""
    if device != "cuda":
        return
    import torch

    torch.backends.cudnn.benchmark = True
    if hasattr(torch.backends, "cuda") and hasattr(torch.backends.cuda, "matmul"):
        torch.backends.cuda.matmul.allow_tf32 = True
    if hasattr(torch.backends, "cudnn"):
        torch.backends.cudnn.allow_tf32 = True
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("high")


def resolve_device(choice: str = "auto") -> str:
    import torch

    normalized = (choice or "auto").strip().lower()
    if normalized == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if normalized == "cuda":
        if not torch.cuda.is_available():
            hint = torch_device_info().get("install_hint", "")
            msg = "CUDA requested but not available."
            if hint:
                msg += f" Install GPU PyTorch: {hint}"
            raise RuntimeError(msg)
        return "cuda"
    if normalized == "cpu":
        return "cpu"
    raise ValueError(f"Unknown device {choice!r} — use auto, cuda, or cpu")
