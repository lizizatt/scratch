"""Strict parsing for JSON API request bodies."""

from __future__ import annotations

from typing import Any, Optional


class ApiParseError(ValueError):
    """Invalid or out-of-range API field."""


def parse_int(
    value: Any,
    default: int,
    *,
    name: str,
    minimum: Optional[int] = None,
    maximum: Optional[int] = None,
) -> int:
    try:
        parsed = int(value if value is not None else default)
    except (TypeError, ValueError) as exc:
        raise ApiParseError(f"invalid {name}") from exc
    if minimum is not None and parsed < minimum:
        raise ApiParseError(f"{name} must be >= {minimum}")
    if maximum is not None and parsed > maximum:
        raise ApiParseError(f"{name} must be <= {maximum}")
    return parsed


def parse_mode(value: Any, default: str) -> str:
    mode = str(value if value is not None else default)
    if mode not in ("navigate", "avoid", "all"):
        raise ApiParseError("mode must be navigate, avoid, or all")
    return mode


def parse_float(
    value: Any,
    default: float,
    *,
    name: str,
    minimum: Optional[float] = None,
    maximum: Optional[float] = None,
) -> float:
    try:
        parsed = float(value if value is not None else default)
    except (TypeError, ValueError) as exc:
        raise ApiParseError(f"invalid {name}") from exc
    if minimum is not None and parsed < minimum:
        raise ApiParseError(f"{name} must be >= {minimum}")
    if maximum is not None and parsed > maximum:
        raise ApiParseError(f"{name} must be <= {maximum}")
    return parsed


def parse_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "1", "yes", "on"):
            return True
        if lowered in ("false", "0", "no", "off"):
            return False
    raise ApiParseError("invalid boolean")


def parse_device(value: Any, default: str = "auto") -> str:
    device = str(value if value is not None else default).strip().lower()
    if device not in ("auto", "cuda", "cpu"):
        raise ApiParseError("device must be auto, cuda, or cpu")
    return device


def parse_run_id(value: Any, *, required: bool = True) -> Optional[str]:
    from runs_util import InvalidRunIdError, validate_run_id

    if value is None or value == "":
        if required:
            raise ApiParseError("run id required")
        return None
    try:
        return validate_run_id(str(value))
    except InvalidRunIdError as exc:
        raise ApiParseError(str(exc)) from exc


def parse_optional_int(
    value: Any,
    *,
    name: str,
    minimum: Optional[int] = None,
    maximum: Optional[int] = None,
) -> Optional[int]:
    if value is None:
        return None
    return parse_int(value, 0, name=name, minimum=minimum, maximum=maximum)
