"""Tests for pg_protocol encode/decode and constants."""

import unittest

from pg_protocol import (
    BENCH_SCRIPT_STEPS,
    HOLD_TEST_COMMANDS,
    MAX_LINE_LEN,
    WIFI_CMD_PORT,
    WIFI_LINK_TIMEOUT_MS,
    WIFI_TLM_PORT,
    encode_command,
    is_hold_test_command,
    parse_status,
    parse_tlm,
    validate_command_length,
)


class TestPgProtocol(unittest.TestCase):
    def test_encode_command_adds_newline(self):
        self.assertEqual(encode_command("PING"), b"PING\n")
        self.assertEqual(encode_command("  STOP  "), b"STOP\n")

    def test_hold_test_commands(self):
        for cmd in ("TEST,ON", "test,a", "DIAG,ON"):
            self.assertTrue(is_hold_test_command(cmd))
        self.assertFalse(is_hold_test_command("PING"))
        self.assertFalse(is_hold_test_command("TEST,OFF"))

    def test_hold_sets_match_firmware(self):
        self.assertEqual(
            {c.upper() for c in HOLD_TEST_COMMANDS},
            {"TEST,ON", "TEST,FULL", "TEST,A", "TEST,B", "DIAG,ON"},
        )

    def test_max_line_length(self):
        ok = "A" * MAX_LINE_LEN
        self.assertIsNone(validate_command_length(ok))
        self.assertEqual(
            validate_command_length("A" * (MAX_LINE_LEN + 1)),
            "ERR,LINE_TOO_LONG",
        )

    def test_parse_tlm(self):
        pkt = parse_tlm("TLM,1.25,-2.50,90.00")
        self.assertIsNotNone(pkt)
        assert pkt is not None
        self.assertAlmostEqual(pkt.pitch_deg, 1.25)
        self.assertAlmostEqual(pkt.roll_deg, -2.50)
        self.assertAlmostEqual(pkt.yaw_deg, 90.0)

    def test_parse_tlm_rejects_garbage(self):
        self.assertIsNone(parse_tlm("Q8658 A +1 +2 +3"))
        self.assertIsNone(parse_tlm("TLM,1,2"))

    def test_parse_status(self):
        st = parse_status("OK,ARM,1,TEST,0,INV_B,1,A,70,B,0")
        self.assertEqual(st, {"armed": 1, "test": 0, "inv_b": 1, "a": 70, "b": 0})

    def test_wifi_ports_match_docs(self):
        self.assertEqual(WIFI_CMD_PORT, 4242)
        self.assertEqual(WIFI_TLM_PORT, 4243)
        self.assertEqual(WIFI_LINK_TIMEOUT_MS, 500)

    def test_bench_script_shape(self):
        kinds = set()
        for step in BENCH_SCRIPT_STEPS:
            if isinstance(step, str):
                kinds.add("cmd")
            elif step[0] == "sleep":
                kinds.add("sleep")
            elif step[0] == "test_on":
                kinds.add("test_on")
        self.assertEqual(kinds, {"cmd", "sleep", "test_on"})


if __name__ == "__main__":
    unittest.main()
