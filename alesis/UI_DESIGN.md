# Selected UI Design

Status: selected for implementation

Source: Variant A, “Signal Stack,” in [the comparison prototype](mockups/ui-prototype.html?variant=A).

## Target

- Landscape phone and tablet are the primary form factors.
- The application uses a fully black canvas with Cherenkov-blue text, outlines, waveforms, and active states.
- Persistent navigation sits at the bottom left and contains only three icon buttons: options, synth, and loops.
- Production UI will not include the prototype variant switcher.

## Options pane

Selecting the gear replaces the main content with large, centered rows. The pane grows as configuration needs are identified; four rows is the initial set, not a limit:

1. BPM
2. Beats per measure
3. Input device
4. Output device
5. Loop measures
6. Metronome enabled
7. Metronome volume
8. Count-in

Loop duration is musical: cycle length equals `beats per measure × loop measures` at the selected BPM. Loop measures offers 1, 2, 4, 8, and a custom positive integer.

Changing BPM after staged or promoted audio exists requires confirmation. Confirming clears current capture, staged capture, and all promoted takes before applying the new BPM.

When count-in is enabled, every Play from Stop counts in before transport and capture begin.

## Synth pane

- A synth selector appears at the top.
- Neon Pressure renders on the host and exposes cutoff, resonance, attack, release, LFO rate, and drive controls.
- SoundFont Player adds a second selector populated from `.sf2` and `.sf3` files discovered on the host. A refresh icon rescans the host directories for files added after startup. HS Synthetic Electronic is selected by default when present, followed by Sonic/STH as fallback.
- Bank, program, gain, chorus, and reverb controls update the active FluidSynth instance and persist across SoundFont changes.
- The selected synth owns the controls inside a faint rectangular outline.
- The per-synth control surface is an isolated module driven by a parameter schema. It must be independently renderable and testable so control layouts can evolve without changing navigation, transport, or loop state.
- Knobs and labels may vary by synth; the surrounding pane remains stable.

## Loop pane

The loop pane follows a vertical signal stack.

### Toolbar

- Stop, play, monitor-only, and metronome mute controls sit at the upper left.
- Stop discards a partial current capture and resets transport to the start of the cycle. Staged and promoted takes remain unchanged.
- Monitor-only means promoted and staged playback are muted while direct synth output remains audible.
- Metronome mute toggles the same host setting shown in Options and takes effect on the next scheduled beat.
- New host sessions start with the metronome enabled at 25% volume.
- Save sits at the upper right and exports the current audible promoted mix as an MP3 download. Muted promoted takes, staged audio, direct synth, and metronome are excluded.

### Current capture

- While transport is playing, the current loop cycle is continuously captured.
- Capture contains direct synth output only. Promoted takes, staged audition, and metronome never feed the record bus.
- Its waveform is drawn live in the widest lane, directly beneath the toolbar. Until PCM capture is implemented, the waveform plots normalized MIDI note intensity in fixed time buckets rather than a synthetic carrier wave.
- Every waveform lane shows a faint vertical guide at each beat boundary, with measure boundaries slightly stronger.
- A playhead communicates progress through the current cycle.

### Staged capture

- At cycle rollover, the completed current capture replaces the staged capture.
- The staged waveform is slightly narrower and indented beneath the current lane.
- A plus button promotes the staged take into persistent loop playback.
- Promotion moves the take into the promoted list and clears the staged lane immediately.
- A mute/unmute button controls whether the staged take is auditioned with current playback.
- Each new staged take inherits the previous staged take's audition state.
- An unpromoted staged take is replaced at the next rollover.

### Promoted takes

- A faint horizontal rule separates capture workflow from promoted material.
- Promoted takes appear below in a vertically scrollable list.
- Each row has a waveform, level control, mute/unmute control, and delete control. Pan is not exposed.
- Promoted takes are immutable, equal-cycle layers. Layering is performed by promoting another take rather than overdubbing an existing take.
- Delete acts immediately and offers one-level undo for the most recently deleted promoted take.
- The list supports an arbitrary number of takes within measured storage and performance limits.

## Interaction and accessibility

- Icons use familiar symbols and expose accessible names and tooltips.
- Active states use shape/fill in addition to brightness; color alone must not carry state.
- Touch targets remain at least 40 CSS pixels where the landscape height permits it.
- The interface must not require page scrolling; only the promoted-take list scrolls.
- Portrait orientation asks the performer to rotate the device rather than compressing the performance layout.

## Session continuity

- Configuration, synth state, promoted audio, mute states, and ordering are autosaved locally.
- Reopening or reloading restores the most recent working session automatically.
- Current and staged captures are transient and are not restored after an interrupted page lifecycle.

## Implementation boundary

This document locks the information hierarchy and workflow, not the prototype code. Production implementation should re-create Variant A using application components and tested state transitions rather than promote the throwaway HTML directly.
