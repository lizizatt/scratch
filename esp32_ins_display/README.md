# ESP32 INS display starter

Minimal firmware for the **Waveshare ESP32-S3-Touch-LCD-1.28** round display. No Arduino IDE — just PowerShell + `arduino-cli`.

**Current mode:** dual-IMU **debug display** (onboard QMI8658 + external MPU-6050). See [WIRING.md](WIRING.md) for hookup.

## What it does

- **Q8658** column: onboard QMI8658 accel (g) + gyro (°/s)
- **M6050** column: external MPU-6050 on SH1.0 GPIO17/18
- Shows **OFF** if MPU not wired yet
- Serial at **115200** on COM16 — I2C scan on boot + 2 Hz data log

## Files to tinker with

| File | Purpose |
|------|---------|
| `ins_display/ins_display.ino` | Main loop, timing |
| `ins_display/imu.cpp` | QMI8658 I2C driver |
| `ins_display/attitude.cpp` | Complementary filter (pitch/roll/yaw) |
| `ins_display/horizon.cpp` | Drawing sky, ground, numbers |
| `ins_display/display.cpp` | GC9A01 SPI display via `esp_lcd` |
| `ins_display/board_pins.h` | GPIO map (matches Waveshare board variant) |

## Commands

```powershell
cd c:\Users\liz\scratch\esp32_ins_display

# compile + upload (default port COM16)
.\build.ps1

# compile only
.\build.ps1 -Action compile

# upload only
.\build.ps1 -Action upload -Port COM16

# serial monitor
.\build.ps1 -Action monitor -Port COM16
```

If upload fails: hold **BOOT**, tap **RESET**, release **BOOT**, run `.\build.ps1` again.

## Board / toolchain

- FQBN: `esp32:esp32:waveshare_esp32s3_touch_lcd_128:PSRAM=enabled`
- Requires `arduino-cli core install esp32:esp32` (already done if you followed earlier steps)
- Port: CH343 USB-UART, typically **COM16**

## Reference repo

Display pinout came from the Espressif board variant. The [Waveshare DualEye repo](https://github.com/waveshareteam/ESP32-S3-DualEye-Touch-LCD-1.28) uses different GPIOs (two screens) — don't copy its `Display_GC9A01.h` pins blindly.

## Next ideas

- Tap screen to zero yaw (CST816S touch on same I2C bus)
- Smoother filter (Madgwick)
- Boat/heli-themed reticle graphics
- Log CSV over serial for analysis in Python
