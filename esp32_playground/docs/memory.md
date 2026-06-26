# Session memory — ESP32 INS display + motor bring-up

Last updated: 2026-06-22. Board **#1 destroyed** (thermal runaway on USB after motor/battery shorts). Firmware and docs survive in **`esp32_playground/`** (renamed from `esp32_ins_display`).

## Project location

**`c:\Users\liz\scratch\esp32_playground/`** — see root `README.md` and `AGENTS.md`.

## Project goal

Custom firmware on **Waveshare ESP32-S3-Touch-LCD-1.28** (round 240×240, QMI8658 onboard) for an INS-style display, external **MPU-6050**, and **9053 coax main motors** via **DRV8833** — all from CLI (`arduino-cli`, no Arduino IDE).

## Toolchain

| Item | Value |
|------|--------|
| FQBN | `esp32:esp32:waveshare_esp32s3_touch_lcd_128:PSRAM=enabled` |
| Serial fix | `build.cdc_on_boot=0` → Serial on CH343 UART (GPIO43/44), not USB-CDC |
| Port | **COM16** (CH343) |
| Build | `.\build.ps1` in `esp32_playground/` |
| Python test | `tools/motor_app.py` @ 115200, `tools/motor_app_wifi.py` UDP |
| WiFi | AP `ESP32-Playground`, IP `192.168.4.1`, cmd `4242`, tlm `4243` — see [WIFI.md](WIFI.md) |

## What we built

### Firmware (`projects/ins_display/`)

Shared libraries under `libraries/pg_*` (board, display, imu, attitude, link).

- **GC9A01 display** via `esp_lcd` (pins in `board_pins.h`)
- **Dual-IMU debug UI** — onboard QMI8658 + external MPU-6050 (`imu.cpp`, `debug_screen.cpp`)
- **Pin finder** — cycles SH1.0 GPIOs 15/16/17/18/21/33 for wire ID (`pin_finder.cpp`)
- **DRV8833 motor driver** — sign-magnitude, 25 kHz PWM, `TEST,A` / `TEST,B` / `TEST,ON` hold-until-key (`motor_drv8833.cpp`)
- **GPIO4 nSLEEP** — optional EEP wake/fault clear (`PIN_DRV_SLEEP`); J2 should stay **OPEN**, EEP wired to GPIO4 @ 3.3 V
- **WiFi UDP link** — SoftAP + command/telemetry (`libraries/pg_link`, `docs/WIFI.md`)
- **Horizon / attitude** scaffold (`horizon.cpp`, filter in loop for telemetry)

### Boot mode (last flash)

- Boots **IMU debug** + motor serial commands
- `p` = pin finder, `d` = IMU debug (single-char lines)
- Motor lines: `PING`, `ARM`, `A,80`, `B,80`, `M,80`, `STOP`, `WAKE`, `TEST,A`, `TEST,B`, `TEST,ON`, `TEST,FULL`, `TEST,A,REV`, `INV,B,0|1`, `RAMP,M,...`

### Docs

- [WIRING.md](WIRING.md) — MPU-6050, JST power (3.7 V only on JST)
- [MOTORS_WIRING.md](MOTORS_WIRING.md) — DRV8833 ribbon mapping, power split

## SH1.0 ribbon (6 live wires, pins 7–12)

| Cable pin | GPIO | Use |
|-----------|------|-----|
| 7 | 15 | DRV8833 IN4 (motor B reverse) |
| 8 | 16 | DRV8833 IN1 (motor A PWM) |
| 9 | 17 | MPU SCL |
| 10 | 18 | MPU SDA |
| 11 | 21 | DRV8833 IN2 (motor A reverse) |
| 12 | 33 | DRV8833 IN3 (motor B PWM) |

Pins 1–6 on the 12-wire cable are **NC**.

## Power rules (learned the hard way)

| Source | Connect to | Never |
|--------|------------|-------|
| **USB-C** | ESP32 logic | — |
| **3.7 V cell / JST** | ESP32 JST, MPU VCC, *can* feed DRV8833 VCC for bench | **Not 7.4 V** |
| **7.4 V heli pack** | **DRV8833 VCC/GND only** | ESP32 JST, EEP pin |
| **GND** | Common: ESP32 JST + DRV8833 + all batteries | — |

- JST **BAT+ is ~0 V with USB only and no LiPo** — not a motor rail.
- **Do not** power MPU from GPIO15 once motors use that pin for IN4.

## DRV8833 clone (EEP / ULT / J2)

| Label | Real meaning |
|-------|----------------|
| **EEP** | nSLEEP — must be **HIGH** to run (use GPIO4, J2 **open**) |
| **ULT** | nFAULT — **LOW = fault** (overcurrent, UVLO, etc.) |
| **J2** | Closed = EEP pulled up; **open + EEP→GPIO4** preferred |

Healthy test (motor disconnected): **ULT high**, **OUT1−OUT2 ≈ VCC** (~7 V on 2S).

We saw **ULT=0**, **OUT diff ~0–1 V**, **VCC ~4 V** on weak battery → fault + no spin. Motors **did** spin when wired straight to 7.4 V.

## Bugs fixed in firmware

- `uint8_t` overflow on PWM freq (20000 → 32 Hz) — use `uint32_t`
- TEST mode `detach_pwm()` between A/B channels left pins floating
- PWM on both IN pins → switched to **digital LOW on off pin**
- Motor B invert default for coax (later set **off** for open-gearbox testing)
- `TEST,ON` holds until serial keypress

## Board #1 outcome

After motor/battery experiments: **`invalid header: 0xffffff0f`** boot loop (corrupt flash), upload sync failures, then **chip/regulator burning hot on USB only** → treat board as **dead**. Likely short on power path or regulator latch-up.

**Do not plug that board in again.**

## Recovering on a new board

1. `cd esp32_ins_display && .\build.ps1`
2. Wire MPU per [WIRING.md](WIRING.md); confirm `MPU6050: OK` in serial
3. Motors: [MOTORS_WIRING.md](MOTORS_WIRING.md), **7.4 V → DRV8833 only**, J2 open, EEP → GPIO4
4. `python motor_app.py WAKE` then `python motor_app.py "TEST,A"` (motor disconnected first)
5. Verify **ULT** and **OUT1−OUT2** before connecting motors

## Related scratch projects (same repo, not in this folder)

- `heli_9053/l298n_motor_mvp/` — Due + L298N motor MVP (serial command pattern we copied)
- `esp32_s3_lcd_ref/` — Waveshare DualEye reference clone (different GPIOs)

## Next steps (when hardware returns)

- [ ] New Waveshare ESP32-S3-Touch-LCD-1.28
- [ ] Confirm IN3 on **GPIO33** (user had GPIO35 once)
- [ ] Coax: `INV,B,1` when gearbox closed
- [ ] Horizon UI + attitude filter
- [ ] Tail motor: second driver or MOSFET (see `heli_9053/tail_motor_mvp/`)
