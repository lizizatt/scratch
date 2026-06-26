# WiFi link (ins_display)

The board runs a **SoftAP** so you can talk to it in flight without a USB cable.

## Join the network

| Setting | Value |
|---------|--------|
| SSID | `ESP32-Playground` |
| Password | `heli9053` |
| Board IP | `192.168.4.1` |
| Command UDP | `4242` (laptop → board) |
| Telemetry UDP | `4243` (board → laptop) |

1. Flash `ins_display` with default WiFi enabled (`.\build.ps1`).
2. Power the board (USB or JST cell).
3. Connect your laptop to **ESP32-Playground**.
4. Run Python tools from `tools/`.

## Commands

Same newline text protocol as USB serial:

```
PING
ARM
M,60
STOP
```

```powershell
cd c:\Users\liz\scratch\esp32_playground
python tools\motor_app_wifi.py PING
python tools\motor_app_wifi.py ARM
python tools\motor_app_wifi.py "M,50"
python tools\motor_app_wifi.py STOP
```

Interactive session with link keepalive (recommended if holding throttle):

```powershell
python tools\motor_app_wifi.py --keepalive 0.25
```

Telemetry only:

```powershell
python tools\motor_app_wifi.py --listen
```

Lines look like: `TLM,pitch,roll,yaw` at ~20 Hz.

## Link-loss watchdog

If the board has received at least one WiFi command and hears **nothing for 500 ms**, it runs **STOP** automatically.

Implications:

- A single `M,80` without follow-up will disarm after 0.5 s — by design.
- Use interactive mode, repeat commands, or `--keepalive 0.25` during tests.

Disable WiFi at compile time (USB bench only):

```powershell
.\build.ps1 -NoWifi
```

## 2.4 GHz coexistence

Stock **9053 RC** is also 2.4 GHz. Keep the ESP antenna away from the receiver; test props-off with RC + WiFi both on before flight.

## Replies

Command responses go to **serial and UDP** (unicast to the last client that sent a command).
