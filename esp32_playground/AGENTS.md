# ESP32 playground — agent guide

Conventions for AI agents editing this tree. Humans welcome too.

## Scope

This repo targets the **Waveshare ESP32-S3-Touch-LCD-1.28** (round 240×240, onboard QMI8658, SH1.0 ribbon). Firmware is **Arduino framework** via **arduino-cli**, not ESP-IDF projects.

## Directory rules

| Path | Put here |
|------|----------|
| `libraries/pg_*` | Reusable drivers: board pins, display, IMU, link layer |
| `projects/<name>/` | One sketch per app; app-specific UI and wiring glue |
| `tools/` | Python bench scripts (serial or WiFi) |
| `docs/` | Wiring, safety, session memory — not inline in code unless tiny |

**Do not** duplicate pin maps across projects — extend `libraries/pg_board/src/board_pins.h`.

**Do not** add Arduino IDE `.ino` tabs outside the sketch folder; extra `.cpp` files belong in the sketch dir or a `pg_*` library.

## Library naming

- Prefix shared libs with `pg_` (playground).
- Each library needs `library.properties` with `name=pg_*`, `architectures=esp32`, and `depends=` where needed.
- Headers stay short (`board_pins.h`, `pg_link.h`) — arduino-cli exposes `libraries/<lib>/src/` on the include path.

Dependency chain today:

```
pg_board → pg_display, pg_imu
pg_imu → pg_attitude
pg_link (standalone; WiFi)
```

## Build entrypoint

Always use root `build.ps1`:

```powershell
.\build.ps1 -Project ins_display -Action compile
.\build.ps1 -Project ins_display -Action flash -Port <PORT>
.\build.ps1 -NoWifi   # adds -DPG_LINK_NO_WIFI
```

FQBN is fixed in `build.ps1`:

`esp32:esp32:waveshare_esp32s3_touch_lcd_128:PSRAM=enabled`

Always pass `build.cdc_on_boot=0` so Serial uses CH343 UART.

## Command protocol

Motor and bench commands are **newline-terminated ASCII**, shared across USB and WiFi:

- Implemented in project code (`motor_drv8833.cpp` for ins_display).
- Transport in `pg_link`: serial + UDP:4242 in, replies + telemetry on UDP:4243.
- Python tools must not invent parallel binary protocols without updating firmware docs.

## WiFi / safety

- SoftAP: `ESP32-Playground` / `heli9053` — document changes in `docs/WIFI.md`.
- **Link watchdog**: 500 ms silence after a WiFi client has spoken → `STOP`. Do not disable without user request.
- `TEST,*` commands block until input — must use `pg_link_input_pending()` / `pg_link_consume_input()`, not raw `Serial`.
- Replies go through `pg_link_reply()` so USB and WiFi stay in sync.

## Power (heli hardware)

Critical — repeated because board damage already occurred:

| Rail | Connect to |
|------|------------|
| 3.7 V JST | ESP32 logic, MPU — **never 7.4 V** |
| 7.4 V pack | DRV8833 motor VCC only, common GND |
| EEP/nSLEEP | GPIO4 @ 3.3 V, J2 open |

See `docs/MOTORS_WIRING.md` and `docs/memory.md`.

## Code style

- Match existing C++: `namespace { }` for file-local state, minimal comments, no over-abstraction.
- Prefer extending `pg_*` libs over copying drivers into projects.
- Keep motor and flight-critical paths simple; avoid heavy work in ISRs.
- Python tools: stdlib + pyserial only unless `requirements.txt` is updated.

## Tests

Python unit tests (no hardware, no pytest required):

```powershell
cd esp32_playground
python run_tests.py
```

| Module | Covers |
|--------|--------|
| `tests/test_pg_protocol.py` | Command encoding, TLM/STATUS parse, WiFi ports |
| `tests/test_board_pins.py` | `board_pins.h` vs `pin_finder.h` ribbon map |
| `tests/test_wifi_constants.py` | `pg_link.cpp` / `docs/WIFI.md` / tools stay in sync |
| `tests/test_motor_commands.py` | Firmware handler strings in `motor_drv8833.cpp` |
| `tests/test_attitude.py` | Complementary filter + C++/Python config sync |
| `tests/test_compile_smoke.py` | `build.ps1 -Action compile` (skipped if no arduino-cli) |
| `tests/test_motor_tools.py` | `motor_app.py` / `motor_app_wifi.py` (mocked) |
| `tests/test_project_layout.py` | Libraries, projects, docs exist |

Shared modules: `tools/pg_protocol.py` (commands/WiFi), `tools/pg_attitude.py` (filter reference for tuning — keep in sync with `libraries/pg_attitude/src/attitude_config.h`).

Offline tuning: `python tools/tune_attitude.py --pitch-deg 15 --steps 300`

Firmware compile smoke runs automatically when arduino-cli is installed; otherwise skipped.

## New project checklist

1. `projects/foo/foo.ino` with `setup()` / `loop()`.
2. Shared code → new `libraries/pg_foo/`.
3. Document in root `README.md` projects table.
4. Optional Python tool in `tools/`.
5. Wiring doc in `docs/` if pins or power change.

## Related scratch repos

- `heli_9053/` — Arduino Due motor MVPs (serial command pattern source)
- `esp32_s3_lcd_ref/` — different Waveshare GPIO map; do not copy pins blindly
