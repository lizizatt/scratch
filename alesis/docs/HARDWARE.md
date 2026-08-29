# Vortex Wireless 2 Hardware Notes

Verified on 2026-08-28:

- USB receiver ID: `13b2:005f` (`ALESIS Vortex Wireless 2`)
- ALSA sequencer port: `20:0` during this session
- ALSA raw-MIDI port: `hw:1,0,0` during this session
- Raw device: `/dev/snd/midiC1D0` during this session
- Runtime identifier: `alsa:midiC1D0`

Card and client numbers are not stable. Runtime discovery scans `/proc/asound/card*/usbid` for `13b2:005f`, verifies `midi0`, and opens the corresponding `/dev/snd/midiC*D0` device. The server falls back to the software Vortex when the receiver is absent. Set `MIDI_MODE=software` to force deterministic software input.

The raw stream decoder supports MIDI 1.0 channel note on/off, Control Change, channel pressure, and 14-bit pitch bend. It preserves running status across read chunks, ignores interleaved realtime bytes, and skips SysEx payloads. The software assignments for faders, pads, accelerometer, touch strip, and sustain are provisional because the Alesis editor can remap controller presets.

## Physical acceptance check

1. Start the server in auto mode.
2. Confirm startup prints `MIDI input: Vortex Wireless 2 (alsa:midiC...D0)`.
3. Open the control surface and note `MIDI 0` in the upper-right status.
4. Play keys, move pitch, apply aftertouch, move the touch strip and accelerometer, move each fader, press each pad, and press sustain.
5. Confirm the MIDI count increments and the final event class changes among `note-on`, `note-off`, `pitch-bend`, `control-change`, and `channel-pressure`.
6. Capture the emitted controller numbers for every remappable control and replace provisional profile values with a recorded fixture.

Opening, ownership, and physical note delivery are verified. During acceptance, ALSA received 132 bytes with zero overruns and the host normalized 92 MIDI events; the UI reported `note-off` as the final event and produced live capture plus a staged take. Full pitch, pressure, pad, fader, touch-strip, accelerometer, and sustain mapping remains pending a systematic control-by-control capture.
