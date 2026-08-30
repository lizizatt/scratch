# Scope

## Product

A host-rendered performance instrument and MIDI looper for the Alesis Vortex Wireless 2. A landscape PWA controls the host over WebSocket; it does not own performance MIDI or audio.

## Implemented

- ALSA sequencer Vortex input and software-device fallback.
- FluidSynth SoundFont player with recursive discovery, named presets, semantic effects, and renderer recovery.
- Neon Pressure polyphonic subtractive synth.
- Host-timed arpeggiator and isolated FluidR3 drum patterns.
- Musical transport, count-in, beat-only metronome, and monitor-only mode.
- Cycle-aligned MIDI capture, staging, previous-staged recovery, promotion, quantization, level, mute, delete, and undo.
- Percussion-channel, sustain, controller, and pitch-bend replay.
- SoundFont and Neon Pressure MP3 rendering, with individual promoted tracks and a merged mix written on the host.
- Versioned WebSocket protocol and responsive landscape PWA.

## Invariants

- The host remains the timing and audio authority.
- Loop capture records generated performance MIDI, not metronome or loop playback.
- Previous staged capture is silent and expires at the next rollover.
- Promoted takes are immutable equal-cycle layers.
- Timing changes require confirmation and clear all captured material.
- Stop discards partial current capture and preserves staged and promoted takes.
- Metronome and drum channels are isolated from melodic take channels.

## Deferred

- PCM loop capture/playback and boundary crossfades.
- Session persistence and migration.
- WAV export.
- MIDI learn and complete Vortex control mapping.
- Device selection beyond the discovered defaults.
- LV2 hosting; see [ADR 0002](docs/adr/0002-capability-driven-instrument-host.md).

## Quality gates

- Deterministic unit and rendered-PCM tests for synth controls and MIDI scheduling.
- Phone and tablet E2E checks without page overflow.
- Physical sink-monitor checks for SoundFont, Neon, arpeggiator, drums, and metronome.
- No browser disconnect may stop host transport or audio.
