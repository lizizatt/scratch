# Alesis

Host-rendered synthesizer and live looper built around the Alesis Vortex Wireless 2, controlled from a landscape browser or installed iPad PWA.

## Documents

- [Project scope](SCOPE.md)
- [Research and architecture recommendation](RESEARCH.md)
- [Selected UI design](UI_DESIGN.md)
- [Host-engine architecture decision](docs/adr/0001-host-owned-realtime-engine.md)
- [Verified hardware and acceptance notes](docs/HARDWARE.md)
- [Interactive layout studies](mockups/index.html)
- [Landscape UI comparison prototype](mockups/ui-prototype.html) (`?variant=A`, `B`, or `C`)

## View the mockups

Open `mockups/index.html` directly in a browser. The layout selector switches among performance, loop-first, and controller-mapping concepts; controls are visual interaction prototypes and do not produce audio yet.

## Current recommendation

Run MIDI, synthesis, transport, loop capture/playback, persistence, MP3 export, and physical audio output on the host. Serve the landscape PWA over Tailscale HTTPS and connect it to the host engine through WebSocket commands and state updates. Network traffic never carries performance MIDI or audio, so browser latency cannot affect note-to-sound timing. Develop against software MIDI and audio-engine mocks until the physical Vortex is available.

## Current implementation

The first vertical slice is runnable with the real ALSA Vortex input and native FluidSynth output to the host's default system speakers, with software MIDI and silent-audio fallbacks for tests. It includes USB-ID-based hardware discovery, raw MIDI stream decoding, observable MIDI activity, PulseAudio/PipeWire sink discovery, SoundFont synthesis, audible count-in/metronome clicks, the versioned control protocol, WebSocket server, reconnecting landscape PWA, synth parameter schemas, transport/cycle capture, staging, promotion, level, mute, delete/undo, and responsive phone/tablet layouts.

The host now captures normalized MIDI performances into cycle-aligned staged takes and replays staged and promoted takes with mute, level, monitor-only, and held-note cleanup. Neon Pressure is a host-rendered polyphonic subtractive synth with cutoff, resonance, attack, release, LFO rate, and drive controls. PCM loop capture/playback, durable host persistence, and MP3 encoding are not implemented yet. The simulated loop engine rejects MP3 export rather than pretending a file was produced.

## Run locally

```bash
npm install
npm run build
npm run start --workspace @alesis/server
```

Open `http://127.0.0.1:8787`. The server automatically uses a connected Vortex Wireless 2 and otherwise falls back to the software source. The upper-right status displays the normalized MIDI event count.

When PulseAudio/PipeWire and at least one SoundFont are available, the server starts FluidSynth on the default host sink and selects SoundFont Player. It discovers `.sf2` and `.sf3` files in `~/Downloads`, `/usr/share/sounds/sf2`, and `/usr/share/sounds/sf3`; the SoundFont Player selector loads them by host-owned ID. Its refresh button rescans those directories without restarting the host. HS Synthetic Electronic is preferred by default, followed by Sonic/STH, FluidR3, and then the first discovered file. Bank, program, gain, chorus, and reverb controls are applied directly to FluidSynth and retained when changing SoundFonts. Set `AUDIO_MODE=simulated` to disable physical audio output.

Rendered-audio tests feed the same deterministic MIDI phrase through both synth engines. They verify that opposite valid preset extremes and every continuous dial extreme produce measurably different PCM, and that switching from SoundFont Player to Neon Pressure changes the rendered result.

Force the deterministic software source and demo notes with:

```bash
MIDI_MODE=software AUDIO_MODE=simulated SOFTWARE_VORTEX_DEMO=1 npm run start --workspace @alesis/server
```

Validation:

```bash
npm test
npm run typecheck
npm run test:e2e
npm run test:audio  # Linux host with PulseAudio/PipeWire speakers
```

If the host and FluidSynth stream are visible but both synth and metronome are silent, run `npm run test:audio`. Repeating `snd_pcm_avail after recover: Broken pipe` entries in `journalctl --user -u pipewire` indicate a wedged PipeWire ALSA node rather than another application owning the device. With the Alesis host stopped, recover the per-user audio graph with:

```bash
systemctl --user restart pipewire pipewire-pulse wireplumber
```

Then restart the Alesis host. The FluidSynth adapter automatically replaces its own child process if that renderer reports ring-buffer saturation; restarting PipeWire is only needed when the underlying ALSA node itself remains in an `EPIPE` loop.

## Serve privately to an iPad

With the app running on port 8787 and Tailscale connected on both devices:

```bash
tailscale serve --bg localhost:8787
tailscale serve status
```

Open the reported `https://<host>.<tailnet>.ts.net` URL in Safari. Use Share, **Add to Home Screen**, and **Open as Web App**. The host and iPad must remain connected to the tailnet. Tailscale HTTPS and MagicDNS must be enabled for the tailnet; certificate transparency publishes the host and tailnet DNS names.

The receiver and audio interface connect to the host, not the iPad. Browser/WebSocket delay affects control acknowledgement only; MIDI-to-audio timing stays entirely on the host.
