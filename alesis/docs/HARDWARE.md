# Raspberry Pi V1 Hardware

## Target appliance

- Raspberry Pi 4 Model B, 2 GB RAM.
- Raspberry Pi OS Desktop 64-bit (Debian Trixie 13 for the first bench image).
- 64 GB high-endurance microSD.
- PiSugar S Plus 5000 mAh mounted beneath the Pi.
- Waveshare `4inch HDMI LCD`, directly stacked and rotated to an 800 by 480
  landscape application viewport.
- External trackpad as the primary pointer; keyboard available as a secondary
  input. The panel's resistive touch remains enabled but is not required for
  operation.
- Vortex Wireless 2 USB receiver and a CM108-class USB audio dongle.
- Existing mono amplifier connected through the left plug of a 3.5 mm stereo
  TRS-to-dual-1/4-inch TS breakout.
- Open bench prototype with passive heatsinks. No enclosure or LEDs in v1.

Inventory update 2026-09-04: the Pi 4B, PiSugar S Plus, and Waveshare display
are assembled and reach a soft boot. The fan is intentionally unplugged.

Bring-up update 2026-09-06: the Pi boots Raspberry Pi OS Desktop 64-bit Trixie,
advertises hostname `alesis`, and accepts key-only SSH over both the direct
Ethernet bridge and Wi-Fi. The display persists at 800 by 480 landscape after
reboot; the stock `ads7846` overlay registers touch on `spi0.1`, and physical
taps align with the display. Its pressure response is too inconsistent for the
primary interface, so v1 uses an external trackpad instead. The CM108
(`0d8c:013c`) is visible as ALSA playback
card `USB PnP Sound Device`. With the full stack attached, its hardware playback
format is two-channel S16_LE at 48 or 44.1 kHz. The Vortex cable receiver
enumerates as `13b2:005e`, ALSA card ID `V2`, and sequencer port
`Vortex Wireless 2`. ARM64 unit tests, typecheck, and production build pass.
Temperature was 54-58 C with `throttled=0x0` during setup and build load.

The Debian FluidSynth package enables a generic per-user daemon that loads
`default-GM.sf3`. It is masked for user `alesis`; the application must remain
the only FluidSynth owner and explicitly load the verified `STH.sf2`.

Raspberry Pi documents 5 V at 3 A for Pi 4B. PiSugar documents the S Plus as Pi
4B-compatible but rates its output at 5 V/2.5 A. Compatibility therefore remains
an acceptance test, not an assumption: reject the stack if it reports
undervoltage, corrupts audio, or resets under combined display, USB, Chromium,
and synthesis load.

## Physical assembly

Mount the PiSugar beneath the Pi with its auto-start switch **off**. With this
setting, external power does not hold GPIO3/SCL low; the custom button can wake
the Pi or serve as a local input. Hold the custom button for two seconds to
initiate orderly shutdown once the shutdown helper is installed.

Stack the Waveshare display on the GPIO header and connect its HDMI plug to the
Pi 4 micro-HDMI output with the supplied bridge or a short adapter. Power the
display through GPIO only. Do not also connect the display's micro-USB power
input.

The display uses physical pins 19, 21, 23, and 26 for SPI touch and pin 22 for
touch IRQ (GPIO 10, 9, 11, 7, and 25). PiSugar uses GPIO3/SCL for startup and
the custom button. No signal conflict is identified in the documented pinout.

Use passive Pi 4-compatible heatsinks for first boot. The owned 30 by 30 by 7 mm
fan is deferred because direct display stacking leaves uncertain clearance. Add
active cooling only if throttling occurs or sustained temperature exceeds 75 C.

## Required SoundFont

The local source asset is `/home/liz.izatt/Downloads/STH.sf2`:

- size: 145,330,818 bytes;
- format: RIFF SoundFont bank;
- SHA-256: `d56e5e9e5020c17f6d512dc59005456cec3647946640a75c23038cf6be983d2f`.

Its original download source or license is not documented locally. Preserve
the file unchanged and resolve provenance before redistributing it.

## Audio wiring

The software target is direct ALSA to the CM108 at 48 kHz, 16-bit, dual-mono,
with an initial 20-30 ms buffer. PipeWire, JACK, Bluetooth audio, and the Pi's
analogue output are outside v1.

Set CM108 `Speaker Playback Volume` to 151/151 (approximately -0.06 dB) and
control listening volume at the powered speaker or amplifier. The factory
60/151 setting attenuated the synth by roughly 17 dB and required enough
downstream gain to make speaker/cable noise prominent. Muting the CM108 did not
remove that static, confirming it originated downstream of the DAC.

Use a 3.5 mm TRS stereo male-to-dual-1/4-inch TS male breakout cable. Connect
only the **left** 1/4-inch plug to the mono amplifier and leave the right plug
unconnected. Never combine or short left and right outputs.

Match the Vortex and CM108 by USB vendor/product identity plus ALSA name, never
by ALSA card or client number. If duplicate matches exist, use the first and
report the selected identity in diagnostics. The attached Vortex cable receiver
is `13b2:005e`, with ALSA sequencer name `Vortex Wireless 2`; the wireless USB
receiver variant previously observed on the development host was `13b2:005f`.

## Power and storage behavior

PiSugar S Plus has no battery-status data interface. Its documented battery
protection cuts power immediately below 3 V, so v1 cannot promise an orderly
low-battery shutdown. Keep the first bench image writable, save settings only
on explicit Save and orderly shutdown, use atomic replacement plus filesystem
sync, and cap persistent journal and Chromium cache growth. Consider overlay or
read-only root only after acceptance; keep settings and assets on a dedicated
writable path excluded from the overlay.

## First physical bring-up

1. Keep the amplifier disconnected or at minimum volume.
2. Verify the display bridge/adapter and fit passive heatsinks before stacking.
3. Mount the PiSugar underneath with auto-start off; stack and GPIO-power the
   display with no display USB power cable attached.
4. Insert the imaged card, Vortex receiver, CM108, and Ethernet cable.
5. Connect a regulated 5 V/3 A charger to the PiSugar charging input.
6. Boot, connect over key-only SSH at hostname `alesis`, and inspect readiness,
   undervoltage, temperature, USB, ALSA, and touch diagnostics before enabling
   the amplifier.

## Acceptance gate

Before enclosure work or overlay-root activation, run a four-hour bench test
covering sustained notes/loops, Chromium load, USB disconnect/reconnect,
app/service crash recovery, repeated orderly shutdowns, and one deliberate hard
power cutoff. Fail for audio corruption, surprise playback, filesystem damage,
throttling, undervoltage, or sustained temperature above 75 C.

## Primary sources

- [Raspberry Pi 4 specifications](https://www.raspberrypi.com/products/raspberry-pi-4-model-b/specifications/)
- [Raspberry Pi setup, storage, power, HDMI, and SSH guidance](https://www.raspberrypi.com/documentation/computers/getting-started.html)
- [Waveshare 4inch HDMI LCD wiki](https://www.waveshare.com/wiki/4inch_HDMI_LCD)
- [PiSugar S series documentation](https://docs.pisugar.com/docs/product-wiki/battery/pisugar-s-series)
