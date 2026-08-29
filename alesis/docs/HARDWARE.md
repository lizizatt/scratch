# Vortex Wireless 2 Hardware Notes

Verified on 2026-08-28:

- USB receiver ID: `13b2:005f` (`ALESIS Vortex Wireless 2`)
- ALSA sequencer port: `20:0` during this session
- ALSA raw-MIDI port: `hw:1,0,0` during this session (diagnostics only)
- ALSA sequencer runtime identifier: `alsa-seq:20:0`

Card and client numbers are not stable. Runtime discovery enumerates ALSA sequencer inputs and selects the port named `Vortex Wireless 2`. The maintained `@julusian/midi` RtMidi binding subscribes without exclusively opening the raw device, normalizes events for host telemetry, and forwards them to FluidSynth. The server falls back to the software Vortex when the receiver is absent. Set `MIDI_MODE=software` to force deterministic software input.

The raw stream decoder supports MIDI 1.0 channel note on/off, Control Change, channel pressure, and 14-bit pitch bend. It preserves running status across read chunks, ignores interleaved realtime bytes, and skips SysEx payloads. The software assignments for faders, pads, accelerometer, touch strip, and sustain are provisional because the Alesis editor can remap controller presets.

## Physical acceptance check

1. Start the server in auto mode.
2. Confirm startup prints `MIDI input: Vortex Wireless 2 (alsa-seq:...)`.
3. Open the control surface and note `MIDI 0` in the upper-right status.
4. Play keys, move pitch, apply aftertouch, move the touch strip and accelerometer, move each fader, press each pad, and press sustain.
5. Confirm the MIDI count increments and the final event class changes among `note-on`, `note-off`, `pitch-bend`, `control-change`, and `channel-pressure`.
6. Capture the emitted controller numbers for every remappable control and replace provisional profile values with a recorded fixture.

Opening, ownership, and physical note delivery are verified. During acceptance, ALSA received 132 bytes with zero overruns and the host normalized 92 MIDI events; the UI reported `note-off` as the final event and produced live capture plus a staged take. Full pitch, pressure, pad, fader, touch-strip, accelerometer, and sustain mapping remains pending a systematic control-by-control capture.

## System speaker output

- Audio server: PulseAudio compatibility on PipeWire 1.0.5
- Format: 48 kHz stereo
- Selected node: `Meteor Lake-P HD Audio Controller Speaker + Headphones`
- Active port: `Speaker`
- Synth: FluidSynth 2.3.4 with `/usr/share/sounds/sf2/FluidR3_GM.sf2`

A generated 440 Hz tone and direct FluidSynth note/CC/pitch commands completed through the selected sink. The first integrated adapter produced digital silence (`-91.0 dB` peak) because FluidSynth command output was piped but never consumed; its output buffer filled, followed by `Ringbuffer full` and `Failed to allocate a synthesis process` warnings. The final path observes the Vortex through ALSA sequencer input, forwards normalized events through a local FluidSynth command shell, and actively drains shell output to prevent backpressure. FluidSynth's TCP shell was rejected because it binds to all interfaces.

Measured at the physical speaker sink monitor after the final gain and routing fixes:

- Deterministic synth notes with transport stopped: `-16.7 dB` peak
- Full sequencer-observer/normalizer/synth path: `-22.8 dB` peak before the final gain increase
- Host metronome with no note source: `-7.4` to `-7.5 dB` peak
- No FluidSynth allocation or ring-buffer warnings

Run `npm run test:audio` on the host to repeat isolated synth and metronome PCM checks. The command fails if the speaker monitor receives no frames, peak level remains at or below `-60 dB`, startup times out, or FluidSynth reports saturation.

During silence diagnosis, the physical Speaker sink was also found OS-muted at 70%. It was restored to unmuted at 70%. The smoke test now detects this state explicitly and reports the muted sink instead of waiting for monitor frames.

A later connected-but-silent incident was not exclusive device ownership: `fuser` showed PipeWire as the only playback PCM owner, the FluidSynth Pulse stream was uncorked and unmuted on the correct sink, and the Vortex ALSA subscription remained connected. PipeWire was repeatedly logging `snd_pcm_avail after recover: Broken pipe` for `hw:sofhdadspp`; even suspending and resuming the sink did not restore monitor frames. Restarting the per-user `pipewire`, `pipewire-pulse`, and `wireplumber` services rebuilt the ALSA node and restored measured output to `-16.7 dB` synth and `-7.5 dB` metronome peaks.

FluidSynth now detects its `Ringbuffer full` and `Failed to allocate a synthesis process` signatures, terminates the stale child with a bounded shutdown, and reconnects a fresh renderer to the selected sink. If PipeWire itself is in the persistent ALSA broken-pipe state, stop the host and run `systemctl --user restart pipewire pipewire-pulse wireplumber` before restarting it.

The metronome uses short preset-0 notes on reserved channel 16 so it remains audible with non-GM SoundFonts, follows authoritative count-in and transport beats, accents each measure start, and remains outside the take capture path. Audible host output has been confirmed by the user. A systematic control-by-control keytar acceptance pass remains pending.
