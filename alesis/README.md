# Alesis

Host-rendered synthesizer and MIDI looper for the Alesis Vortex Wireless 2, controlled from a landscape browser or iPad PWA.

The Linux host owns MIDI, synthesis, transport, loops, and audio output. Browser clients send WebSocket commands and receive authoritative state; performance MIDI and audio never cross the network.

## Features

- Vortex input through ALSA sequencer, with a deterministic software fallback.
- HS Synthetic Electronic and other host SoundFonts through FluidSynth.
- Named SoundFont presets, bounded effects, and the Neon Pressure subtractive synth.
- Host-timed arpeggiator and synchronized drum patterns.
- Independent drum/sample pad mode, preset navigation, and live MP3 sample pads.
- MIDI loop capture with staging, up to 12 promoted layers, mute, level, delete/undo, pitch bend, and percussion-channel preservation.
- Staged quantization at 1/4, 1/8, 1/16, or 1/32 resolution.
- A silent previous-staged recovery slot that expires after one cycle.
- Beat-aligned waveform intensity summaries and a monitor-only metronome.
- Named MP3 export of every promoted take plus a merged mix, and single-cycle loop sample export to the live sample library.

PCM loop capture and session persistence are not implemented.
Live sample-pad triggers are not included in loop capture or MP3 exports. The
sample-pad controls show host/controller state only; the host cannot write the
Vortex's onboard display, and host UI changes do not synchronize that display.

See [Sample pads](docs/SAMPLE_PADS.md) for configuring a sample library, making
synthetic test pages, the Vortex Program Change setup, and sample limits.

Use the save control in the Loops toolbar to choose a folder name. The host writes every promoted take, including muted takes, to `~/alesis_recordings/<name>/track-01.mp3`, `track-02.mp3`, and so on, with the combined result at `mix.mp3`. Existing folders are never overwritten.

The separate **Export loop to sample library** control renders one currently
playing loop cycle (up to 30 seconds) from audible loop layers and an enabled
drum pattern into the configured sample library with one tap and no name entry.
The host assigns a rising numbered filename and refreshes the Pads catalog; it
does not change pad mode or navigation target. See
[Sample pads](docs/SAMPLE_PADS.md#loop-sample-export) for naming, counter
storage, included sources, and exclusions.

## Run

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:8787`.

The server uses a connected Vortex automatically. Production readiness requires
an exact `STH.sf2` discovered under `~/Downloads`, `/usr/share/sounds/sf2`, or
`/usr/share/sounds/sf3`; it does not silently substitute another melodic bank.
Missing FluidSynth, SoundFont, audio, or MIDI dependencies are reported through
`/health` and the control UI, and Play remains blocked while Not Ready.

For deterministic development without hardware:

```bash
MIDI_MODE=software AUDIO_MODE=simulated SOFTWARE_VORTEX_DEMO=1 npm start
```

## Raspberry Pi bridge

Connect the Pi and this workstation to the same router/switch, or use the tested
direct Ethernet profile `alesis-pi-bridge` on this workstation. Wi-Fi also works
after configuration. In Raspberry Pi Imager, set hostname and username
`alesis`, enable SSH with public-key authentication, then verify the connection:

```bash
ssh <username>@alesis.local
```

The bridge helper keeps inspection, code transfer, and the external SoundFont
as separate explicit operations:

```bash
deploy/pi-bridge.sh probe <username>@alesis.local
deploy/pi-bridge.sh sync <username>@alesis.local
deploy/pi-bridge.sh asset <username>@alesis.local
```

`probe` runs read-only hardware diagnostics and never uses `sudo`. `sync` copies
the checkout to `~/alesis` without dependencies and does not start it. `asset`
verifies the known SHA-256 before and after copying `STH.sf2` to `~/Downloads`.
No operation installs packages, starts services, or produces audio.

## Validate

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run test:audio
```

The loop-sample browser test runs only when `SAMPLE_LIBRARY_DIR` is set in the
Playwright process environment. Use a fresh isolated directory and a dedicated
`PORT` so Playwright starts its own demo server with that library setting; the
test removes only the exact MP3 filenames returned by its own exports.

```sh
SAMPLE_LIBRARY_DIR="$(mktemp -d)" PORT=8878 npm run test:e2e
```

`test:audio` is the legacy workstation sink-monitor check and requires Linux,
PipeWire/PulseAudio, FluidSynth, FFmpeg, and a physical speaker sink. Pi
production playback uses the `alesis_cm108` ALSA route instead.

## Workstation audio recovery

If streams appear connected but `test:audio` receives no PCM, check:

```bash
journalctl --user -u pipewire --since "5 minutes ago" | grep "Broken pipe"
```

For a persistent ALSA `Broken pipe` loop, stop Alesis and run:

```bash
systemctl --user restart pipewire pipewire-pulse wireplumber
pactl set-sink-mute @DEFAULT_SINK@ 0
```

Then restart Alesis. FluidSynth renderer saturation is recovered automatically.

## iPad access

With Tailscale connected on both devices:

```bash
tailscale serve --bg localhost:8787
tailscale serve status
```

Open the reported HTTPS URL in Safari and use **Add to Home Screen**. The receiver and audio device remain connected to the host.

## Jarvis deployment

[`deploy/run-jarvis.sh`](deploy/run-jarvis.sh) starts the production host on
loopback port `8787`, waits for `/health`, replaces any stale private Tailscale
Serve mapping on HTTPS port `8787`, and removes that mapping while forwarding
shutdown signals to the host.

The runner accepts `JARVIS_ALESIS_HOST`, `JARVIS_ALESIS_PORT`,
`JARVIS_ALESIS_TAILSCALE_PORT`, `JARVIS_ALESIS_ROOT`, and
`JARVIS_TAILSCALE_EXECUTABLE` overrides. The host override must resolve directly
to a loopback address. The committed [`jarvis.deployment.json`](jarvis.deployment.json)
is the discovery contract for Jarvis.

## Design

- [Raspberry Pi v1 TODO](TODO.md)
- [Scope](SCOPE.md)
- [UI behavior](UI_DESIGN.md)
- [Digital window recreation specification](docs/DIGITAL_WINDOW_RECREATION_SPEC.md)
- [Hardware notes](docs/HARDWARE.md)
- [Minimum hardware BOM](docs/MINIMUM_HARDWARE_BOM.md)
- [Host-owned engine ADR](docs/adr/0001-host-owned-realtime-engine.md)
- [Capability-driven instruments ADR](docs/adr/0002-capability-driven-instrument-host.md)
