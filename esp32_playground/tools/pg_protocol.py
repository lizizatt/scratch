"""Motor command protocol shared by firmware docs and Python tools."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

# WiFi link — must match libraries/pg_link/src/pg_link.cpp and docs/WIFI.md
WIFI_AP_SSID = "ESP32-Playground"
WIFI_AP_PASSWORD = "heli9053"
WIFI_DEFAULT_IP = "192.168.4.1"
WIFI_CMD_PORT = 4242
WIFI_TLM_PORT = 4243
WIFI_LINK_TIMEOUT_MS = 500
MAX_LINE_LEN = 56

HOLD_TEST_COMMANDS = frozenset(
    {"TEST,ON", "TEST,FULL", "TEST,A", "TEST,B", "DIAG,ON"}
)

BENCH_SCRIPT_STEPS: tuple[str | tuple[str, float] | tuple[str], ...] = (
    "PING",
    "STATUS",
    ("test_on",),
    "ARM",
    "A,70",
    ("sleep", 2.0),
    "STOP",
    "ARM",
    "B,70",
    ("sleep", 2.0),
    "STOP",
    "ARM",
    "RAMP,M,30,70,80",
    ("sleep", 0.5),
    "STOP",
)

# Ribbon cable pin → GPIO (pin_finder.h kShPins)
RIBBON_GPIO_BY_CABLE_PIN: dict[int, int] = {
    7: 15,
    8: 16,
    9: 17,
    10: 18,
    11: 21,
    12: 33,
}

# Motor pin roles in board_pins.h
MOTOR_PIN_ROLES: dict[str, str] = {
    "PIN_MOTOR_A1": "16",
    "PIN_MOTOR_A2": "21",
    "PIN_MOTOR_B1": "33",
    "PIN_MOTOR_B2": "15",
}


def encode_command(cmd: str) -> bytes:
    """Newline-terminated UTF-8 line for serial or UDP."""
    return (cmd.strip() + "\n").encode("utf-8")


def is_hold_test_command(cmd: str) -> bool:
    return cmd.strip().upper() in HOLD_TEST_COMMANDS


def validate_command_length(cmd: str) -> Optional[str]:
    """Return error token if too long (firmware sends ERR,LINE_TOO_LONG)."""
    if len(cmd.strip()) > MAX_LINE_LEN:
        return "ERR,LINE_TOO_LONG"
    return None


@dataclass(frozen=True)
class TlmPacket:
    pitch_deg: float
    roll_deg: float
    yaw_deg: float


_TLM_RE = re.compile(r"^TLM,([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)$")


def parse_tlm(line: str) -> Optional[TlmPacket]:
    m = _TLM_RE.match(line.strip())
    if not m:
        return None
    return TlmPacket(float(m.group(1)), float(m.group(2)), float(m.group(3)))


_STATUS_RE = re.compile(
    r"^OK,ARM,(?P<armed>[01]),TEST,(?P<test>[01]),INV_B,(?P<inv>[01]),"
    r"A,(?P<a>\d+),B,(?P<b>\d+)$"
)


def parse_status(line: str) -> Optional[dict[str, int]]:
    m = _STATUS_RE.match(line.strip())
    if not m:
        return None
    return {
        "armed": int(m.group("armed")),
        "test": int(m.group("test")),
        "inv_b": int(m.group("inv")),
        "a": int(m.group("a")),
        "b": int(m.group("b")),
    }


def parse_pin_defines(header_text: str) -> dict[str, int]:
    pins: dict[str, int] = {}
    for m in re.finditer(r"#define\s+(PIN_\w+)\s+(\d+)", header_text):
        pins[m.group(1)] = int(m.group(2))
    return pins


def parse_pin_finder_table(header_text: str) -> dict[int, int]:
    """Parse kShPins {gpio, cable_pin, ...} rows from pin_finder.h."""
    mapping: dict[int, int] = {}
    for m in re.finditer(r"\{\s*(\d+)\s*,\s*(\d+)\s*,", header_text):
        gpio, cable = int(m.group(1)), int(m.group(2))
        mapping[cable] = gpio
    return mapping
