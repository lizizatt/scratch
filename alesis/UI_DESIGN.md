# UI Behavior

Landscape phone and tablet are primary. The interface uses a black canvas, blue/cyan signal styling, fixed bottom-left navigation, and no page scrolling.

## Options

- BPM, beats per measure, and loop measures define cycle duration.
- Timing changes with captured material require confirmation and clear it.
- MIDI input, audio output, count-in, metronome enablement, and metronome volume are host settings.
- Count-in runs before each Play from Stop.

## Synth

- Instrument descriptors drive control rendering.
- SoundFont Player discovers host `.sf2`/`.sf3` files, refreshes the catalog, and selects named presets.
- Its primary controls are Volume, Chorus Send, and Reverb Send. Advanced effect parameters are expandable.
- Neon Pressure exposes cutoff, resonance, attack, release, LFO rate, and drive.
- Arpeggiator and drum controls apply to either instrument.
- Up to root then down ascends through held notes to the lowest note transposed by the selected octave count, then descends without repeating either endpoint.

## Loops

### Toolbar

- Stop, Play, Monitor Only, and Metronome Mute appear at upper left.
- Save prompts for a host folder name and exports each promoted take plus `mix.mp3` under `~/alesis_recordings/<name>/`.
- Monitor Only suppresses staged and promoted playback while preserving direct synth output.
- Metronome defaults to 25% and triggers once per beat.

### Current

- Displays live MIDI intensity over the cycle with beat and measure guides.
- Stop discards a partial current capture.

### Staged

- Rollover replaces staging with the completed cycle.
- Quantization choices are Off, 1/4, 1/8, 1/16, and 1/32.
- Quantization snaps current staged MIDI to the nearest circular grid, deduplicates equivalent events per bin, and preserves a minimum note duration.
- Changing quantization reprocesses current staging from raw timestamps.
- Staging can be auditioned, muted, or promoted.

### Previous staged

- Displaced staging remains for one cycle in a narrower recovery row.
- It is silent and can only be promoted.
- Its timing is frozen; the next rollover replaces it.

### Promoted

- Promoted takes play as immutable synchronized layers.
- Each row has waveform, level, mute, and delete controls.
- Export includes every promoted take, even when its playback mute is active, and applies each take's level.
- One-level undo restores the latest deleted take.

## Accessibility

- Icon controls have accessible names and tooltips.
- State is communicated by fill/shape as well as color.
- Only the promoted list scrolls.
- Portrait asks the performer to rotate the device.
