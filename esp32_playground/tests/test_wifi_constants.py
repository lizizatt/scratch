"""WiFi constants match firmware source and docs."""

import re
import unittest
from pathlib import Path

from pg_protocol import (
    WIFI_AP_PASSWORD,
    WIFI_AP_SSID,
    WIFI_CMD_PORT,
    WIFI_DEFAULT_IP,
    WIFI_LINK_TIMEOUT_MS,
    WIFI_TLM_PORT,
)

ROOT = Path(__file__).resolve().parents[1]
PG_LINK_CPP = ROOT / "libraries" / "pg_link" / "src" / "pg_link.cpp"
WIFI_MD = ROOT / "docs" / "WIFI.md"
MOTOR_WIFI_PY = ROOT / "tools" / "motor_app_wifi.py"


class TestWifiConstants(unittest.TestCase):
    def test_pg_link_cpp_matches_protocol(self):
        text = PG_LINK_CPP.read_text(encoding="utf-8")
        self.assertIn(f'kApSsid[] = "{WIFI_AP_SSID}"', text)
        self.assertIn(f'kApPass[] = "{WIFI_AP_PASSWORD}"', text)
        self.assertIn(f"kCmdPort = {WIFI_CMD_PORT}", text)
        self.assertIn(f"kTlmPort = {WIFI_TLM_PORT}", text)
        self.assertIn(f"kLinkTimeoutMs = {WIFI_LINK_TIMEOUT_MS}", text)

    def test_wifi_md_documents_ports(self):
        text = WIFI_MD.read_text(encoding="utf-8")
        self.assertIn(WIFI_AP_SSID, text)
        self.assertIn(WIFI_AP_PASSWORD, text)
        self.assertIn(str(WIFI_CMD_PORT), text)
        self.assertIn(str(WIFI_TLM_PORT), text)
        self.assertIn(WIFI_DEFAULT_IP, text)

    def test_motor_app_wifi_imports_protocol_ports(self):
        text = MOTOR_WIFI_PY.read_text(encoding="utf-8")
        self.assertIn("from pg_protocol import", text)
        self.assertIn("CMD_PORT", text)
        self.assertIn("TLM_PORT", text)


if __name__ == "__main__":
    unittest.main()
