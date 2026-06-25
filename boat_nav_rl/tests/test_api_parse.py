"""Tests for API request parsing helpers."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api_parse import (
    ApiParseError,
    parse_device,
    parse_float,
    parse_int,
    parse_mode,
    parse_optional_int,
    parse_run_id,
)


class TestApiParse(unittest.TestCase):
    def test_parse_int_rejects_invalid(self):
        with self.assertRaises(ApiParseError):
            parse_int("abc", 1, name="steps")

    def test_parse_int_enforces_minimum(self):
        with self.assertRaises(ApiParseError):
            parse_int(0, 1, name="steps", minimum=1)

    def test_parse_mode_rejects_unknown(self):
        with self.assertRaises(ApiParseError):
            parse_mode("hover", "avoid")

    def test_parse_mode_accepts_valid(self):
        self.assertEqual(parse_mode(None, "avoid"), "avoid")
        self.assertEqual(parse_mode("navigate", "avoid"), "navigate")

    def test_parse_float_rejects_invalid(self):
        with self.assertRaises(ApiParseError):
            parse_float("nan?", 0, name="x_m")

    def test_parse_device_rejects_unknown(self):
        with self.assertRaises(ApiParseError):
            parse_device("tpu")

    def test_parse_run_id_rejects_traversal(self):
        with self.assertRaises(ApiParseError):
            parse_run_id("../secret")

    def test_parse_optional_int_none(self):
        self.assertIsNone(parse_optional_int(None, name="curriculum_phase"))


if __name__ == "__main__":
    unittest.main()
