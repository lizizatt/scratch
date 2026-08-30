# Minimum Hardware BOM

Reviewed 2026-08-29. Prices are approximate US street prices before tax and
shipping; interfaces and support status matter more than a transient sale.

## Recommendation

Use a headless Raspberry Pi 4 Model B with at least 1 GB RAM and Ubuntu Server
24.04 LTS. It is the cheapest conservative target: Canonical lists the Pi 4B as
Ubuntu-certified, Ubuntu supplies arm64 packages for FluidSynth 2.3.4 and
PipeWire 1.0.5, and the board has enough USB ports for the Vortex receiver while
retaining its 3.5 mm line output.

Do not use Bluetooth for performance audio. Connect the host to a powered,
battery-operated speaker over a 3.5 mm AUX cable. Bluetooth codec buffering adds
latency outside the application's control.

### Minimum practical BOM

| Item | Minimum specification | Planning price |
| --- | --- | ---: |
| Host | Raspberry Pi 4B, 1 GB or greater | $35-45 |
| Storage | 32 GB A1/A2 microSD card | $7-10 |
| Host power | Regulated 5.1 V, 3 A USB-C supply | $8-12 |
| Audio cable | 3.5 mm stereo TRS male-to-male, short and shielded | $4-8 |
| Speaker | Battery-powered speaker with a physical 3.5 mm AUX input | $25-50 |
| MIDI | Existing Vortex Wireless 2 cable (`13b2:005e`) or USB receiver (`13b2:005f`) | existing |
| Controller | Existing landscape phone or iPad | existing |

Expected new-hardware total: **$79-125**. A case or heatsink is optional for an
open-air trial but appropriate for transport. The speaker must be self-powered;
the Pi jack is line-level, not a speaker amplifier.

For operation away from mains, add a reputable USB power bank able to sustain
5 V at 3 A and budget roughly $20-35. That makes the fully untethered estimate
**$99-160**. Power the speaker from its own battery to avoid ground noise and
unexpected load on the Pi.

## Cost-down candidate

A Raspberry Pi 3 Model A+ has the right physical interfaces in one board: a
1.4 GHz quad-core 64-bit CPU, 512 MB RAM, dual-band Wi-Fi, one full-size USB
port, and 3.5 mm output. Its one USB port can hold the Vortex receiver, so no hub
or DAC is required.

It is not the recommended purchase. Canonical's current supported-device table
does not list the 3A+, 512 MB leaves little margin for Ubuntu, Node, PipeWire,
FluidSynth, and SoundFonts, and this application has not passed its physical
audio test on ARM. Treat it as an experiment only if one is already available.

A Pi Zero 2 W is a worse minimum for this build: it also has 512 MB RAM, needs a
USB OTG adapter for the receiver, and has no 3.5 mm audio output, forcing a USB
DAC or audio HAT. Those additions erase most of the board-price advantage and
complicate the USB and power topology.

## Application review

The application is a good fit for a headless SBC: the browser is only a control
surface, while MIDI timing and audio stay on the host. Its production web bundle
is small, and all current workspaces typecheck and build successfully.

Hardware-relevant gaps remain:

1. The host silently selects software MIDI when the controller is absent and
   silent audio when no PulseAudio sink is found. A portable appliance needs a
   startup failure or prominent health indication instead.
2. MIDI is discovered only at startup. Controller disconnect/reconnect requires a
   host restart.
3. The control server binds to `127.0.0.1`. Remote control therefore requires
   the documented Tailscale proxy or a local reverse proxy. Joining the same
   Wi-Fi network alone is insufficient.
4. PipeWire recovery can still require manual user-service restart. There is no
   systemd deployment unit, boot ordering, or watchdog in the repository.
5. Neon Pressure renders 48 kHz stereo audio from a JavaScript 10 ms timer. This
   is the strongest reason not to buy below Pi 4 performance without measuring
   underruns and timing jitter.
6. SoundFont discovery recursively scans fixed directories, and preset
   inspection synchronously launches FluidSynth. Keep the target's SoundFont
   set small and intentional.

The current test run passes all 114 tests, workspace typechecks, the production
build, and the physical audio smoke test. MP3 export preserves pitch bend and
renders individual promoted tracks plus a merged mix.

## Target software

- Ubuntu Server 24.04 LTS arm64, without a desktop environment.
- Node.js 20 or 22 rather than Ubuntu 24.04's Node.js 18 package.
- `fluidsynth`, `pipewire`, `pipewire-pulse`, `wireplumber`, and
  `pulseaudio-utils`.
- A small known SoundFont in `/usr/share/sounds/sf2`.
- Tailscale Serve as currently documented, or an intentionally configured local
  reverse proxy for offline LAN use.

Build on another machine and deploy the built workspace when possible. Running
TypeScript through `tsx` is acceptable for the first trial, but a service image
should not need the full development toolchain at runtime.

## Purchase gate

Do not call a board supported until this exact stack passes on it with the
Vortex receiver and chosen speaker:

1. Run `npm test`, `npm run typecheck`, and `npm run build`.
2. Run `npm run test:audio` against the physical 3.5 mm sink.
3. Play dense chords with chorus and reverb while drums, arpeggiator,
   metronome, and several promoted loops run for 30 minutes.
4. Exercise Neon Pressure at maximum realistic polyphony for 30 minutes.
5. Confirm no PipeWire underruns, FluidSynth recovery, thermal throttling, or
   low-voltage warnings, and measure key-to-sound latency.
6. Reboot headless and verify audio, MIDI, network control, and the application
   recover without SSH intervention.

If Pi 4B passes with comfortable margin, test a borrowed Pi 3A+ only to discover
whether the BOM can be reduced further.

## Primary sources

- [Canonical: Ubuntu on Raspberry Pi](https://ubuntu.com/download/raspberry-pi)
- [Ubuntu 24.04 FluidSynth package](https://packages.ubuntu.com/noble/fluidsynth)
- [Ubuntu 24.04 PipeWire Pulse package](https://packages.ubuntu.com/noble/pipewire-pulse)
- [Raspberry Pi 4 specifications](https://www.raspberrypi.com/products/raspberry-pi-4-model-b/specifications/)
- [Raspberry Pi 3A+ specifications](https://www.raspberrypi.com/products/raspberry-pi-3-model-a-plus/)
- [Raspberry Pi power and audio guidance](https://www.raspberrypi.com/documentation/computers/getting-started.html)
- [Raspberry Pi analogue audio configuration](https://www.raspberrypi.com/documentation/computers/config_txt.html#onboard-analogue-audio-3-5-mm-jack)