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
