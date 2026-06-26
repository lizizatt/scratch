"""Motor command strings documented in firmware C++ source."""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOTOR_CPP = ROOT / "projects" / "ins_display" / "motor_drv8833.cpp"

# Commands the firmware explicitly handles (from motor_handle_line / handle_line)
FIRMWARE_COMMANDS = frozenset(
    {
        "PING",
        "STATUS",
        "ARM",
        "DISARM",
        "STOP",
        "WAKE",
        "TEST,ON",
        "TEST,FULL",
        "TEST,OFF",
        "TEST,A",
        "TEST,B",
        "DIAG,ON",
        "DIAG,OFF",
    }
)

PREFIX_COMMANDS = (
    "A,",
    "B,",
    "M,",
    "RAMP,",
    "INV,B,",
    "TEST,",  # TEST,A,REV etc.
)


class TestMotorCommandsDoc(unittest.TestCase):
    def test_firmware_source_contains_core_commands(self):
        text = MOTOR_CPP.read_text(encoding="utf-8")
        for cmd in ("PING", "ARM", "STOP", "WAKE", "STATUS"):
            self.assertIn(f'"{cmd}"', text, f"missing handler for {cmd}")

    def test_pong_reply(self):
        text = MOTOR_CPP.read_text(encoding="utf-8")
        self.assertIn("PONG,DRV8833", text)

    def test_err_disarmed_present(self):
        text = MOTOR_CPP.read_text(encoding="utf-8")
        self.assertIn("ERR,DISARMED", text)

    def test_prefix_handlers(self):
        text = MOTOR_CPP.read_text(encoding="utf-8")
        for prefix in PREFIX_COMMANDS:
            self.assertIn(f'startsWith("{prefix}")', text, prefix)


if __name__ == "__main__":
    unittest.main()
