# Wiring the MPU-6050 (GY-521)

## Why JST BAT+ reads 0 V (USB only, no battery)

The **MX1.25** connector is a **battery socket**, not a regulated power output. With USB plugged in and **no LiPo attached**, **BAT+ is ~0 V**. That is normal — the charger does not back-feed the battery pins.

**GND on the JST still works** (continuity with USB shell).

## Power options

### Option A — USB-only bench test (no battery)

Firmware drives **GPIO15 at 3.3 V** for the MPU (~4 mA, fine for a GPIO).

| GY-521 pin | Connect to |
|------------|------------|
| **VCC** | Ribbon **pin 7** (GPIO15) |
| **GND** | JST **GND** |
| **SCL** | Ribbon pin 9 (GPIO17) |
| **SDA** | Ribbon pin 10 (GPIO18) |
| **AD0** | GND (I2C address 0x68) |

### Option B — With a LiPo

Plug a **3.7 V** cell into the MX1.25 JST. Then **BAT+** is live (~3.7–4.2 V) and you can wire:

| GY-521 pin | Connect to |
|------------|------------|
| **VCC** | JST **BAT+** |
| **GND** | JST **GND** |
| **SCL / SDA** | GPIO17 / GPIO18 on ribbon pins 9–10 |

## 12-wire ribbon

Only **6 wires** are connected (cable pins 7–12):

| Cable pin | GPIO | Typical use |
|-----------|------|-------------|
| 7 | 15 | MPU **VCC** (USB-only power) |
| 8 | 16 | spare |
| 9 | 17 | MPU **SCL** |
| 10 | 18 | MPU **SDA** |
| 11 | 21 | spare |
| 12 | 33 | spare |

Pins **1–6** are not connected on the board.

## Verify

1. Measure **VCC–GND on the GY-521** → should be **~3.3 V** (GPIO15) or **~3.7–4.2 V** (LiPo).
2. Serial monitor @ 115200 — boot should show `MPU6050: OK @ 0x68`.
3. Press **`p`** for pin finder if you need to identify wires.
