# ADR 0002: Capability-driven instrument host

Status: accepted

## Context

The first SoundFont UI exposed FluidSynth implementation details directly. Numeric bank/program combinations could be invalid for the selected file, and global effect level plus MIDI effect send were collapsed into single controls. Neon Pressure used a different parameter vocabulary, while shared MIDI effects such as arpeggiation and drum patterns did not belong to either synth.

The host must remain the timing and audio authority. The browser is a control surface and must not schedule performance MIDI or render audio.

## Decision

Use capability-driven instrument descriptors in the authoritative snapshot. Each instrument adapter declares its engine, controls, groups, ranges, defaults, and steps. The UI renders those descriptors and sends generic parameter commands; the host validates and routes them to the selected adapter.

SoundFont Player uses FluidSynth. The host recursively discovers `.sf2` and `.sf3` files, enumerates their actual presets, and exposes named preset IDs instead of raw bank/program sliders. Basic controls are Volume, Chorus Send, and Reverb Send. Advanced FluidSynth effect settings are grouped separately.

Neon Pressure is a host-rendered polyphonic subtractive synth. Its descriptor exposes cutoff, resonance, attack, release, LFO rate, and drive.

Arpeggiation and drum patterns are shared MIDI-effect modules ahead of the selected instrument. They use the authoritative host clock. Tonal provides note naming and octave transposition; it does not own scheduling. Drums use an isolated FluidR3 percussion layer and do not inherit selected-instrument effects.

All synth controls are verified through deterministic rendered-PCM comparisons. Physical smoke tests separately verify SoundFont, Neon Pressure, arpeggiator, drum, and metronome output on the host sink.

## LV2 decision

Do not add LV2 hosting yet.

The target host currently has no `lv2ls`, `lv2info`, Jalv, Carla, or installed LV2 bundles. Ubuntu packages are available, but integrating a plugin host before selecting a concrete plugin would add deployment and lifecycle complexity without validating a user workflow.

A future LV2 spike must use the same instrument descriptor seam and satisfy these gates:

1. Decide whether plugins are bundled or user-supplied. For bundled plugins, select one instrument and one effect whose licenses are compatible with the project's declared license and document redistribution obligations. Do not assume subprocess execution removes plugin license obligations.
2. Discover plugin metadata and parameters through Lilv, not hand-authored UI schemas.
3. Spawn and supervise one headless host process per plugin instance. Jalv is preferred for the first spike; process separation comes from the Alesis supervisor launching Jalv, not from Jalv internally isolating a plugin.
4. Route timestamped MIDI and PCM without moving timing authority to the browser.
5. Measure MIDI-event-to-sink-monitor onset over at least 1,000 notes. The median may add no more than 5 ms and p99 no more than 10 ms versus the better of FluidSynth and Neon Pressure; no PipeWire/JACK underruns are acceptable during the run.
6. Serialize plugin URI, preset/state, and parameter values across restart.
7. Add an adapter health interface backed by process-exit monitoring and a periodic heartbeat. Restart a failed host, reconnect audio/MIDI routing, and replay serialized state without terminating the control server.
8. Add deterministic render tests and physical sink-monitor smoke coverage.

The spike must be built and measured on the target Ubuntu release. If these gates cannot be met with a small adapter, LV2 remains deferred. Carla is not adopted as the main engine because it is a full plugin host with a larger process and routing surface, and its license must be reviewed for the intended distribution model. Lilv/Jalv is the preferred first spike because it offers focused LV2 discovery and headless hosting.

## Consequences

The current module interface stays small while engine-specific complexity remains local to adapters. New instruments can add descriptors without changing transport, loop state, or browser command semantics. Shared MIDI effects compose before any selected instrument.

The application does not claim arbitrary plugin compatibility. Native plugin hosting remains an explicit future capability rather than an implicit dependency.

## Primary references

- FluidSynth API: https://www.fluidsynth.org/api/
- FluidSynth source: https://github.com/FluidSynth/fluidsynth
- LV2 specification: https://lv2plug.in/
- Lilv: https://drobilla.net/software/lilv.html
- Jalv: https://drobilla.net/software/jalv.html
- Carla: https://github.com/falkTX/Carla
- Tonal: https://github.com/tonaljs/tonal
