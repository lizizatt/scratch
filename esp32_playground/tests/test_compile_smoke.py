"""Firmware compile smoke test (requires arduino-cli on this machine)."""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD_PS1 = ROOT / "build.ps1"
ARDUINO_CLI = Path(r"C:\Program Files\Arduino CLI\arduino-cli.exe")
COMPILE_TIMEOUT_S = 240


@unittest.skipUnless(BUILD_PS1.is_file(), "build.ps1 missing")
class TestCompileSmoke(unittest.TestCase):
    @unittest.skipUnless(ARDUINO_CLI.is_file(), "arduino-cli not installed")
    def test_ins_display_compiles(self) -> None:
        proc = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(BUILD_PS1),
                "-Action",
                "compile",
            ],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=COMPILE_TIMEOUT_S,
        )
        combined = (proc.stdout or "") + (proc.stderr or "")
        self.assertEqual(
            proc.returncode,
            0,
            f"compile failed (exit {proc.returncode}):\n{combined[-4000:]}",
        )
        self.assertIn("Sketch uses", combined)

    @unittest.skipUnless(ARDUINO_CLI.is_file(), "arduino-cli not installed")
    def test_ins_display_compiles_no_wifi(self) -> None:
        proc = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(BUILD_PS1),
                "-Action",
                "compile",
                "-NoWifi",
            ],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=COMPILE_TIMEOUT_S,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr or proc.stdout)


if __name__ == "__main__":
    unittest.main()
