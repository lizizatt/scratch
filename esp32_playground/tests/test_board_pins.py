"""Board pin map consistency across headers and docs."""

import unittest
from pathlib import Path

from pg_protocol import RIBBON_GPIO_BY_CABLE_PIN, parse_pin_defines, parse_pin_finder_table

ROOT = Path(__file__).resolve().parents[1]
BOARD_PINS = ROOT / "libraries" / "pg_board" / "src" / "board_pins.h"
PIN_FINDER = ROOT / "projects" / "ins_display" / "pin_finder.h"


class TestBoardPins(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pins = parse_pin_defines(BOARD_PINS.read_text(encoding="utf-8"))
        cls.ribbon = parse_pin_finder_table(PIN_FINDER.read_text(encoding="utf-8"))

    def test_motor_pins_on_ribbon(self):
        motor = {
            self.pins["PIN_MOTOR_A1"],
            self.pins["PIN_MOTOR_A2"],
            self.pins["PIN_MOTOR_B1"],
            self.pins["PIN_MOTOR_B2"],
        }
        ribbon_gpios = set(RIBBON_GPIO_BY_CABLE_PIN.values())
        self.assertTrue(motor.issubset(ribbon_gpios), f"motor {motor} vs ribbon {ribbon_gpios}")

    def test_mpu_pins_on_ribbon(self):
        mpu = {self.pins["PIN_MPU_SDA"], self.pins["PIN_MPU_SCL"]}
        ribbon_gpios = set(RIBBON_GPIO_BY_CABLE_PIN.values())
        self.assertEqual(mpu, {17, 18})
        self.assertTrue(mpu.issubset(ribbon_gpios))

    def test_pin_finder_matches_protocol_table(self):
        self.assertEqual(self.ribbon, RIBBON_GPIO_BY_CABLE_PIN)

    def test_no_duplicate_gpio_on_ribbon(self):
        self.assertEqual(len(set(self.ribbon.values())), len(self.ribbon))

    def test_lcd_pins_not_on_ribbon(self):
        lcd = {
            self.pins[f"PIN_LCD_{name}"]
            for name in ("MOSI", "MISO", "SCLK", "CS", "DC", "RST", "BL")
        }
        ribbon_gpios = set(self.ribbon.values())
        self.assertFalse(lcd & ribbon_gpios, "LCD pins must not share SH1.0 ribbon GPIOs")

    def test_drv_sleep_not_motor_pin(self):
        sleep = self.pins.get("PIN_DRV_SLEEP")
        if sleep is not None:
            motor = {
                self.pins["PIN_MOTOR_A1"],
                self.pins["PIN_MOTOR_A2"],
                self.pins["PIN_MOTOR_B1"],
                self.pins["PIN_MOTOR_B2"],
            }
            self.assertNotIn(sleep, motor)


if __name__ == "__main__":
    unittest.main()
