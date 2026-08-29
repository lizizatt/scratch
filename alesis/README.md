# Alesis

Host-rendered synthesizer and MIDI looper for the Alesis Vortex Wireless 2, controlled from a landscape browser or iPad PWA.

The Linux host owns MIDI, synthesis, transport, loops, and audio output. Browser clients send WebSocket commands and receive authoritative state; performance MIDI and audio never cross the network.

## Features

- Vortex input through ALSA sequencer, with a deterministic software fallback.
- HS Synthetic Electronic and other host SoundFonts through FluidSynth.
- Named SoundFont presets, bounded effects, and the Neon Pressure subtractive synth.
- Host-timed arpeggiator and synchronized drum patterns.
- MIDI loop capture with staging, promotion, mute, level, delete/undo, pitch bend, and percussion-channel preservation.
- Staged quantization at 1/4, 1/8, 1/16, or 1/32 resolution.
- A silent previous-staged recovery slot that expires after one cycle.
- Beat-aligned waveform intensity summaries and a monitor-only metronome.

PCM loop capture, persistence, and MP3 export are not implemented.

## Run

```bash
npm install
npm run build
npm run start --workspace @alesis/server
```

Open `http://127.0.0.1:8787`.

The server uses a connected Vortex automatically. SoundFonts are discovered recursively from `~/Downloads`, `/usr/share/sounds/sf2`, and `/usr/share/sounds/sf3`. HS Synthetic Electronic is preferred, followed by Sonic/STH and FluidR3.

For deterministic development without hardware:

```bash
MIDI_MODE=software AUDIO_MODE=simulated SOFTWARE_VORTEX_DEMO=1 npm run start --workspace @alesis/server
```

## Validate

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run test:audio
```

`test:audio` requires Linux, PipeWire/PulseAudio, FluidSynth, FFmpeg, and a physical speaker sink.

## Audio recovery

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

## Design

- [Scope](SCOPE.md)
- [UI behavior](UI_DESIGN.md)
- [Hardware notes](docs/HARDWARE.md)
- [Host-owned engine ADR](docs/adr/0001-host-owned-realtime-engine.md)
- [Capability-driven instruments ADR](docs/adr/0002-capability-driven-instrument-host.md)