# Alesis Synth + Looper: Project Scope

Status: discovery

## Product idea

A host-rendered performance instrument for the Alesis Vortex Wireless 2. The host accepts live MIDI, turns the controller's keys and expressive controls into synthesized sound, routes that sound to a selected host audio output, and builds an arbitrary number of synchronized audio loops. A landscape browser or installed iPad PWA controls and observes the host engine.

The first delivery target is a private web app served from the audio host to landscape phones, tablets, and desktop browsers. The iPad PWA is a control surface, not an audio or MIDI endpoint. Tailscale HTTPS provides private remote access. A native shell remains an option only if browser control ergonomics or lifecycle behavior proves inadequate.

## Primary experience

1. Open the app and connect to the host engine.
2. Select a host MIDI input and host audio output.
3. Confirm incoming notes, pitch bend, aftertouch, pads, ribbon, tilt, faders, and buttons in a MIDI monitor.
4. Load a synth, map physical controls to its parameters, and save the mapping as a preset.
5. Set BPM, meter, count-in, and loop length in bars, beats, or seconds.
6. Play live while an optional metronome is mixed into monitoring only.
7. Capture, promote, set level, mute, undo the latest deletion, and delete any number of synchronized takes.
8. Save and restore a session locally; export loops and a stereo mix.

## MVP scope

### Device and MIDI

- Host MIDI input with connection and disconnection handling; browser clients never own performance MIDI.
- A tested Vortex default profile plus MIDI-learn for every assignable synth parameter and application action.
- MIDI channel and zone-aware routing; no assumption that a preset always emits the same CC numbers.
- Note on/off, velocity, poly/channel aftertouch where received, pitch bend, Control Change, Program Change, and sustain handling.
- Raw event monitor and live control activity indicators for setup and diagnosis.
- Per-control curves, inversion, dead zone, min/max range, smoothing, and pickup mode where useful.

### Synth host

- One built-in polyphonic subtractive synth for a dependable baseline.
- SoundFont playback through a browser-capable FluidSynth implementation is part of MVP.
- Oscillator, filter, amplifier envelope, filter envelope, LFO, glide, voice count, and a small effects chain.
- Parameter schema independent from the visual knobs so MIDI mappings and session state survive UI changes.
- Adapter boundary for additional engines. Investigate Web Audio Modules 2 (WAM), Faust-generated AudioWorklets/WASM, Tone.js instruments, and SoundFont playback.
- Preset save/load and deterministic parameter serialization.

### Transport, metronome, and loops

- One audio-clock-based transport with BPM, beats per measure, loop measures, play/stop, count-in, and quantization.
- When enabled, count-in runs on every Play from Stop before transport and capture begin.
- Optional audible metronome with accent and level controls.
- Metronome and count-in route to the monitor bus only; they must never feed loop recording or exports unless a future explicit bounce option requests it.
- Arbitrarily many loop tracks, bounded only by measured CPU and memory budgets.
- Loop cycle length is `beats per measure × loop measures` at the selected BPM; loop measures supports 1, 2, 4, 8, and custom positive integers.
- Quantized cycle capture, promotion, level, mute, delete, and one-level delete undo.
- Live cycle capture records direct synth output only; loop playback, staged audition, and metronome are excluded from the record bus.
- Promoting a staged take moves it to persistent playback and clears the staged lane immediately.
- Automatic latency compensation measured or calibrated per output path.
- Changing BPM after audio exists requires confirmation; confirming clears current, staged, and promoted audio before applying the change.
- New staged takes inherit the previous staged-audition mute state.
- Promoted-take deletion is immediate with one-level undo for the most recently deleted take.
- Promoted takes are immutable equal-cycle layers; layering creates another promoted take rather than destructively overdubbing an existing take.
- Stop discards a partial current capture, resets to cycle start, and preserves staged and promoted takes.

### Audio and persistence

- Low-latency host audio graph with a single master limiter and meter.
- Host audio-device enumeration and output selection.
- Host session persistence, including mappings, synth state, transport state, and loop audio.
- The latest working session autosaves and restores automatically; current and staged captures remain transient across reloads.
- WAV export for individual loops and an MP3 export of the promoted mix. Other compressed export formats are post-MVP.
- The loop-pane save action exports an MP3 of currently unmuted promoted takes only; it excludes staged audio, live synth, and metronome.
- No account, cloud sync, collaboration, microphone recording, MIDI clip editor, or third-party plugin marketplace in MVP.

## Audio graph invariant

```text
Host MIDI -> mapping/router -> synth engine -> synth bus ---+-> record bus -> loop capture
                                                            |
loop players -----------------------------------------------+-> mix bus -> limiter -> output
                                                            ^
metronome ---------------------------------------------------+  monitor-only injection
```

Implementation note: the metronome must join after every loop record tap. Tests should verify that rendered loop buffers contain no click energy.

## Quality targets to validate

- Note-on-to-sound latency: measure p50/p95 on target machines; seek p95 below 30 ms on a wired output before setting a release threshold.
- No audible loop-boundary click under normal capture and layered-playback workflows.
- Transport drift below one render quantum over a 10-minute session.
- Stable playback with 16 simultaneous stereo loops on the reference laptop; establish a real CPU/memory budget during prototyping.
- All performance controls reachable without scrolling at 1280 x 720; device setup and detailed mapping may use secondary views.
- Keyboard and screen-reader operability for controls, with reduced-motion support.

## Questions to explore

### Hardware characterization

- Capture the exact raw messages from each Vortex control under factory presets and multi-zone setups.
- Confirm whether the keybed sends channel aftertouch, polyphonic aftertouch, or another form in practice.
- Determine pitch wheel/ribbon ranges and whether the editor can assign the ribbon and accelerometer to pitch bend, CC, or both.
- Measure wireless dongle versus wired USB latency, jitter, event coalescing, and disconnect behavior.
- Validate the app's tested default profile against presets produced by the Alesis editor; in-app MIDI learn remains authoritative for app mappings.

### Synthesis interoperability

- Keep WAM 2 behind the internal `SynthEngine` interface and outside MVP; reassess ecosystem maturity before hosting third-party modules.
- Keep Faust and native CLAP/VST hosting outside MVP. Evaluate them only if a later engine or native-shell requirement justifies the added toolchain.
- Verify that selected synth, FluidSynth, SoundFont, preset, and sample licenses permit redistribution in a hosted app.
- Model MIDI 1.0 for MVP without browser event types leaking into the domain; reserve extensibility for later MIDI 2.0/UMP or MPE work without implementing it now.

### Loop engine

- Capture PCM directly in an AudioWorklet/ring buffer versus use `MediaRecorder`; compare timing precision, memory, codecs, and export complexity.
- Define loop tail handling and boundary crossfades for immutable equal-cycle takes.
- Evaluate a scheduler built on Web Audio clock primitives against Tone.js Transport.

### Platform and delivery

- Safari on iPadOS and Chromium desktop browsers are MVP control-surface targets; install the iPad client as a Home Screen web app.
- Serve the UI and WebSocket privately over Tailscale HTTPS from the host.
- Test browser suspension, display sleep, network loss/reconnection, host device hot-plug, and host audio interruption.
- Verify that transport and audio continue safely when all browser clients disconnect.

## Discovery deliverables

- [x] Initial scope and explicit exclusions.
- [x] Standards/library and architecture research report.
- [x] Landscape UI exploration; Variant A “Signal Stack” selected and documented in [UI_DESIGN.md](UI_DESIGN.md).
- [ ] Complete raw Vortex control capture. Receiver discovery/opening and physical note delivery are verified; expressive controls still need systematic capture.
- [ ] Browser latency and loop-timing spike.
- [ ] Synth adapter proof of concept with two engines.
- [ ] Architecture decision record for web-only versus native shell.

## Resolved product decisions

- Variant A “Signal Stack” is the selected landscape UI.
- Capture records direct synth output only.
- Cycle length uses BPM, beats per measure, and loop measures.
- BPM changes clear all audio after confirmation.
- Promotion clears staging; new staged takes inherit the prior audition state.
- Promoted takes are immutable layers with immediate delete and one-level undo.
- Stop discards partial capture and resets phase without changing staged or promoted takes.
- Metronome configuration lives in Options; count-in runs on every Play from Stop.
- The current audible promoted mix is the MP3 export boundary.
- The latest session autosaves and restores promoted material.
- MVP ships the built-in subtractive synth, SoundFont playback, a tested Vortex profile, and MIDI learn.
- MVP runs its real-time engine on the host and supports Safari/iPadOS plus Chromium control clients.

## Selected UI direction

The implementation target is Variant A, “Signal Stack.” It uses bottom-left options/synth/loops navigation and a vertically ordered loop workflow: live current capture, indented staged capture with audition and promotion controls, then a divided scrollable list of promoted takes. [UI_DESIGN.md](UI_DESIGN.md) is the controlling UI description; the HTML comparison is a throwaway reference, not production code.

## Visual direction

- Black stage with Cherenkov-blue emission: cyan-white active states, electric blue structure, and deep blue inactive detail.
- Four-blue palette plus neutral black/white; color must not be the only state indicator.
- Monospace display typography, terse labels, waveform and signal-grid motifs, compact information density, and controlled glow.
- Modern rounding is restrained: 4-8 px corners, circular knobs, no pill-heavy dashboard styling.
- Motion communicates timing: beat pulses, playhead movement, recording state, and signal level. Decorative motion stays subordinate and honors reduced-motion preferences.
