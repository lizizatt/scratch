"""Python tool behavior with mocks (no hardware)."""

import socket
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import motor_app_wifi  # noqa: E402
from pg_protocol import WIFI_CMD_PORT, encode_command  # noqa: E402


class TestMotorAppWifi(unittest.TestCase):
    def test_send_cmd_uses_protocol_encoding(self):
        sock = mock.Mock(spec=socket.socket)
        with mock.patch.object(motor_app_wifi, "drain"), mock.patch.object(
            motor_app_wifi.time, "sleep"
        ), mock.patch("builtins.print"):
            motor_app_wifi.send_cmd(sock, "192.168.4.1", "PING", wait=0)
        sock.sendto.assert_called_once_with(
            encode_command("PING"), ("192.168.4.1", WIFI_CMD_PORT)
        )

    def test_send_test_hold_sends_command_then_release(self):
        sock = mock.Mock(spec=socket.socket)
        with mock.patch.object(motor_app_wifi, "drain"), mock.patch(
            "builtins.input", return_value=""
        ), mock.patch("builtins.print"):
            motor_app_wifi.send_test_hold(sock, "192.168.4.1", "TEST,A")
        calls = sock.sendto.call_args_list
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][0][0], encode_command("TEST,A"))
        self.assertEqual(calls[1][0][0], encode_command(""))


if __name__ == "__main__":
    unittest.main()
