"""Tests for API request parsing helpers."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api_parse import ApiParseError, parse_int, parse_mode


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


if __name__ == "__main__":
    unittest.main()
