# ESP32 playground

Monorepo for **Waveshare ESP32-S3-Touch-LCD-1.28** firmware and Python bench tools. No Arduino IDE — `arduino-cli` + PowerShell.

## Layout

```
esp32_playground/
  build.ps1              # entrypoint: compile / flash / monitor any project
  AGENTS.md              # conventions for AI agents working in this tree
  libraries/             # shared Arduino libraries (pg_*)
  projects/              # one sketch folder per firmware app
    ins_display/         # dual-IMU debug, motors, WiFi link
  tools/                 # Python serial / WiFi clients
  docs/                  # wiring, motors, session memory, WiFi
```

## Quick start

```powershell
cd c:\Users\liz\scratch\esp32_playground

# list firmware projects
.\build.ps1 -Action list

# compile + upload ins_display (default project, COM16)
.\build.ps1

# serial monitor
.\build.ps1 -Action monitor

# USB-only build (no WiFi AP)
.\build.ps1 -NoWifi
```

## Projects

| Project | Purpose |
|---------|---------|
| `ins_display` | Round LCD, QMI8658 + MPU-6050 debug, DRV8833 motor serial, WiFi UDP |

## Tools

| Script | Transport |
|--------|-----------|
| `tools/motor_app.py` | USB serial @ 115200 |
| `tools/motor_app_wifi.py` | WiFi UDP (join AP `ESP32-Playground`) |

## Docs

- [docs/WIRING.md](docs/WIRING.md) — MPU-6050, JST power
- [docs/MOTORS_WIRING.md](docs/MOTORS_WIRING.md) — DRV8833 ribbon
- [docs/WIFI.md](docs/WIFI.md) — SoftAP, ports, watchdog
- [docs/memory.md](docs/memory.md) — bench session notes

## Tests

```powershell
python run_tests.py
```

30+ unit tests — protocol, pin map, WiFi constants, attitude filter, compile smoke. See [AGENTS.md](AGENTS.md#tests).

```powershell
python run_tests.py              # fast tests only if no arduino-cli
python tools/tune_attitude.py --pitch-deg 20   # offline filter exploration
```

## Board

- FQBN: `esp32:esp32:waveshare_esp32s3_touch_lcd_128:PSRAM=enabled`
- `build.cdc_on_boot=0` → Serial on CH343 UART (GPIO43/44)

## Adding a project

1. Create `projects/<name>/<name>.ino`.
2. Put reusable code in `libraries/pg_<thing>/` with `library.properties`.
3. Flash with `.\build.ps1 -Project <name>`.

See [AGENTS.md](AGENTS.md) for library naming, dependencies, and safety rules.
