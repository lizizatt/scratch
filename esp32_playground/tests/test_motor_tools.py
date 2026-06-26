"""Python tool behavior with mocks (no hardware)."""

import socket
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import motor_app  # noqa: E402
import motor_app_wifi  # noqa: E402
from pg_protocol import WIFI_CMD_PORT, encode_command  # noqa: E402


class TestMotorAppSerial(unittest.TestCase):
    def test_send_writes_encoded_line(self):
        ser = mock.Mock()
        ser.in_waiting = 0
        with mock.patch.object(motor_app, "drain"), mock.patch.object(
            motor_app.time, "sleep"
        ), mock.patch("builtins.print"):
            motor_app.send(ser, "STOP", wait=0)
        ser.write.assert_called_once_with(encode_command("STOP"))
        ser.flush.assert_called_once()

    def test_send_test_on_writes_hold_and_release(self):
        ser = mock.Mock()
        ser.in_waiting = 0
        with mock.patch.object(motor_app, "drain"), mock.patch(
            "builtins.input", return_value=""
        ), mock.patch("builtins.print"):
            motor_app.send_test_on(ser)
        writes = [c.args[0] for c in ser.write.call_args_list]
        self.assertEqual(writes[0], encode_command("TEST,ON"))
        self.assertEqual(writes[1], encode_command(""))


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
