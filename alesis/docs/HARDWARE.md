# Hardware

Verified on 2026-08-28:

- Vortex USB receiver: `13b2:005f`
- Runtime input: ALSA sequencer port named `Vortex Wireless 2`
- Audio server: PipeWire 1.0.5 through PulseAudio compatibility
- Speaker sink: `Meteor Lake-P HD Audio Controller Speaker + Headphones`
- FluidSynth: 2.3.4

ALSA card and client numbers are unstable. Runtime discovery selects the sequencer port by name. Raw MIDI paths are diagnostic only.

## MIDI

The input adapter normalizes note on/off, velocity, control change, channel pressure, and 14-bit pitch bend. It preserves channel identity; channel 10 remains percussion during loop replay. Vortex presets are remappable, so control assignments remain provisional until captured from the active hardware preset.

To validate a preset, exercise keys, pitch, pressure, touch strip, accelerometer, faders, pads, and sustain while confirming the UI event count and event class change.

## Audio routing

- Selected instruments use melodic channels.
- Generated and recorded drums use the auxiliary FluidR3 kit on channel 10.
- Metronome woodblocks use the same kit on reserved channel 16, preventing note-off collisions with drums.
- SoundFont effects do not feed the drum or metronome channels.
- Metronome triggers once per beat and defaults to 25%.

`npm run test:audio` measures SoundFont, arpeggiator, drums, Neon Pressure, and metronome PCM at the physical sink monitor. It fails on muted output, missing frames, inaudible peaks, startup timeout, or FluidSynth saturation.

## Recovery

FluidSynth stdout must remain drained; otherwise its command shell can stall and report `Ringbuffer full` or `Failed to allocate a synthesis process`. The adapter detects these signatures and replaces the child process.

If PipeWire repeatedly logs `snd_pcm_avail after recover: Broken pipe`, stop Alesis and restart the user audio graph:

```bash
systemctl --user restart pipewire pipewire-pulse wireplumber
pactl set-sink-mute @DEFAULT_SINK@ 0
```