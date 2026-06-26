"""Repo layout, libraries, and build entrypoint."""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_LIBS = ("pg_board", "pg_display", "pg_imu", "pg_attitude", "pg_link")
REQUIRED_PROJECTS = ("ins_display",)


class TestProjectLayout(unittest.TestCase):
    def test_build_ps1_exists(self):
        self.assertTrue((ROOT / "build.ps1").is_file())

    def test_agents_and_readme(self):
        self.assertTrue((ROOT / "AGENTS.md").is_file())
        self.assertTrue((ROOT / "README.md").is_file())

    def _read_properties(self, path: Path) -> dict[str, str]:
        data: dict[str, str] = {}
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                data[k.strip()] = v.strip()
        return data

    def test_libraries_have_properties(self):
        for name in REQUIRED_LIBS:
            props = ROOT / "libraries" / name / "library.properties"
            self.assertTrue(props.is_file(), f"missing {props}")
            data = self._read_properties(props)
            self.assertEqual(data.get("name"), name)
            self.assertEqual(data.get("architectures"), "esp32")
            src = ROOT / "libraries" / name / "src"
            self.assertTrue(src.is_dir(), f"missing src for {name}")

    def test_projects_have_ino(self):
        for proj in REQUIRED_PROJECTS:
            ino = ROOT / "projects" / proj / f"{proj}.ino"
            self.assertTrue(ino.is_file(), f"missing {ino}")

    def test_tools_present(self):
        self.assertTrue((ROOT / "tools" / "motor_app.py").is_file())
        self.assertTrue((ROOT / "tools" / "motor_app_wifi.py").is_file())
        self.assertTrue((ROOT / "tools" / "pg_protocol.py").is_file())
        self.assertTrue((ROOT / "tools" / "pg_attitude.py").is_file())
        self.assertTrue((ROOT / "tools" / "tune_attitude.py").is_file())

    def test_docs_present(self):
        for doc in ("WIRING.md", "MOTORS_WIRING.md", "WIFI.md", "memory.md"):
            self.assertTrue((ROOT / "docs" / doc).is_file(), doc)


if __name__ == "__main__":
    unittest.main()
