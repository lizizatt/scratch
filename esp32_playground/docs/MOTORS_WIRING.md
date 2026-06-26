# DRV8833 × 2 motors — wiring plan

Dual **DRV8833** H-bridge for two small DC motors (e.g. 9053 coax mains). Logic from the **SH1.0 ribbon**; motor power from the **JST battery port**.

Assumes the **MPU-6050** stays on GPIO17/18 (ribbon pins 9–10) as in [WIRING.md](WIRING.md).

---

## Pin budget

The ribbon exposes **six** GPIOs. Three are used by the MPU today:

| Cable pin | GPIO | Current use | Motor plan |
|-----------|------|-------------|------------|
| 7 | 15 | MPU VCC hack *(USB-only)* | **BIN2** *(once LiPo powers MPU)* |
| 8 | 16 | spare | **AIN1** (PWM) |
| 9 | 17 | MPU SCL | keep |
| 10 | 18 | MPU SDA | keep |
| 11 | 21 | spare | **AIN2** (PWM / dir) |
| 12 | 33 | spare | **BIN1** (PWM) |

**You need GPIO15 for motors.** Move MPU **VCC → JST BAT+** when you plug in a LiPo (same as Option B in WIRING.md). USB-only bench without a battery: use **GPIO4** (board pad, see below) as the fourth motor input instead of GPIO15.

### ESP32 → DRV8833 (recommended)

| DRV8833 input | ESP32 GPIO | Ribbon pin | Role |
|---------------|------------|------------|------|
| **AIN1** | **16** | 8 | Motor A PWM |
| **AIN2** | **21** | 11 | Motor A direction / reverse PWM |
| **BIN1** | **33** | 12 | Motor B PWM |
| **BIN2** | **15** | 7 | Motor B direction / reverse PWM |
| **GND** | **GND** | JST GND | Common ground |
| **nSLEEP** | *(module)* | — | Leave **HIGH** (see below) |

**USB-only fallback** (MPU still on GPIO15 for power): swap **BIN2 → GPIO4** (solder pad near battery holder — not on the ribbon).

---

## DRV8833 module hookup

Typical purple/red **DRV8833 breakout** labels vary; map by function:

```
  Motor battery (+) ──────► VM  (or VIN / MOTOR VCC — motor supply pin)
  Motor battery (−) ──────► GND ─────────────► ESP32 JST GND

  ESP32 GPIO16 ───────────► IN1 / AIN1
  ESP32 GPIO21 ───────────► IN2 / AIN2
  ESP32 GPIO33 ───────────► IN3 / BIN1
  ESP32 GPIO15 ───────────► IN4 / BIN2

  nSLEEP / STBY / SLP ────► 3.3 V  (or leave floating if board has pull-up)
  nFAULT / FLT ───────────► (optional) spare GPIO for fault read later

  Motor A wires ───────────► OUT1 & OUT2  (either polarity; swap if spin wrong)
  Motor B wires ───────────► OUT3 & OUT4
```

### nSLEEP (important)

DRV8833 stays **asleep** when nSLEEP is LOW. Most breakouts:

- Have **J1 solder jumper** closed → onboard pull-up keeps it awake, or
- Label **EEP / STBY** — tie to **3.3 V** if the motor outputs never respond

If both motors are dead but logic looks fine, check nSLEEP first.

### Logic vs motor power

| Pin on module | Connect to | Notes |
|---------------|------------|-------|
| **VM / VIN** | **JST BAT+** (LiPo +) | 2.7–10.8 V; 1S (3.7 V) or 2S (7.4 V) per your motors |
| **GND** | **JST GND** | Must be common with ESP32 |
| **VCC** *(if separate)* | Same as VM **or** 3.3 V | Many boards use one **VCC** pin for both; 3.7 V from LiPo is fine |

ESP32 GPIOs are **3.3 V** — DRV8833 accepts that (VIH ≥ 2.5 V). **No 5 V required.**

**Do not** power motors from GPIO15 — that pin is only for the MPU during USB-only IMU bench tests.

---

## Power architecture

```
                    USB-C
                      │
                 ┌────┴────┐
                 │ ESP32   │  logic + LCD + IMUs
                 │ board   │
                 └────┬────┘
                      │ GND (common)
         ┌────────────┼────────────┐
         │            │            │
    JST GND      JST BAT+     GPIO16/21/33/15
         │            │            │
         │       ┌────┴────┐       │
         └──────►│ DRV8833 │◄──────┘
                 │         │
                 └───┬─────┘
              OUT1/2  │  OUT3/4
                 Motor A   Motor B
```

- **ESP32:** USB (or JST if you want portable)
- **Motors:** LiPo on JST **BAT+** / **GND**
- **One shared GND** between ESP32, DRV8833, and battery

---

## Control scheme (firmware to match)

Sign-magnitude on each half-bridge (same idea as the Due + L298N sketch):

| Command | AIN1 | AIN2 | BIN1 | BIN2 |
|---------|------|------|------|------|
| Motor A forward @ speed | PWM | LOW | — | — |
| Motor A reverse @ speed | LOW | PWM | — | — |
| Motor A stop / coast | LOW | LOW | — | — |
| Motor B forward @ speed | — | — | PWM | LOW |
| Motor B reverse @ speed | — | — | LOW | PWM |
| Motor B stop / coast | — | — | LOW | LOW |

Swap **OUT1↔OUT2** (or flip AIN1/AIN2 in software) if a motor spins backward.

---

## Bench bring-up checklist

### Phase 0 — wiring only (props off, motors unloaded)

- [ ] LiPo on JST; MPU **VCC → BAT+** (not GPIO15)
- [ ] DRV8833 **GND → JST GND**
- [ ] DRV8833 **VM → BAT+**
- [ ] nSLEEP **HIGH** (or jumper closed)
- [ ] Four GPIO wires on ribbon pins 8, 11, 12, 7
- [ ] Measure **VM–GND** on driver → ~3.7–4.2 V (1S) or ~7.4 V (2S)
- [ ] IMU still works (`MPU6050: OK` in serial)

### Phase 1 — one motor at a time

- [ ] Motor A only on OUT1/2
- [ ] Serial command or touch UI: short pulse ~10% duty
- [ ] Then motor B on OUT3/4
- [ ] Wrong direction → swap one motor pair or flip sign in firmware

### Phase 2 — both motors

- [ ] Matched ramp both channels
- [ ] For coax: mains should spin **opposite** mechanically — fix in wiring or `motor_b_invert` flag, not by matching L298N “forward” on both

---

## Limits & tail motor note

| Topic | DRV8833 |
|-------|---------|
| VM range | 2.7–10.8 V |
| Current | ~1.2–1.5 A continuous per channel (module dependent) |
| Channels | **2** — enough for **two mains**; **no tail** on this chip |

Tail on the 9053 is a third motor. Options later:

- Second DRV8833 (needs 4 more GPIOs — only GPIO4/5 left on board without new wiring), or
- Single **MOSFET** low-side switch (see `heli_9053/tail_motor_mvp/BREADBOARD.md`)

---

## Quick reference — full stack on the bench

| From | To |
|------|-----|
| Ribbon pin 8 (GPIO16) | DRV8833 AIN1 |
| Ribbon pin 11 (GPIO21) | DRV8833 AIN2 |
| Ribbon pin 12 (GPIO33) | DRV8833 BIN1 |
| Ribbon pin 7 (GPIO15) | DRV8833 BIN2 |
| Ribbon pin 9 (GPIO17) | MPU SCL |
| Ribbon pin 10 (GPIO18) | MPU SDA |
| JST BAT+ | MPU VCC + DRV8833 VM |
| JST GND | MPU GND + DRV8833 GND |
| DRV8833 OUT1/2 | Main motor A |
| DRV8833 OUT3/4 | Main motor B |

---

## Next firmware step

When you’re back with the drivers, we can add a `motor_drv8833` module + serial commands (`A,10` / `B,10` / `STOP`) mirroring the Due `l298n_motor_mvp` app — same bring-up flow, different pins and sign-magnitude instead of ENA/ENB.
