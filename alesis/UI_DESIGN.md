# UI Behavior

The Pi kiosk (800×480 CSS pixels), landscape phone (844×390), and tablet
(1280×800) are the layout QA targets. The Pi appliance uses an external
trackpad as its primary pointer and a keyboard as secondary input; resistive
touch is optional. The interface uses a black canvas, blue/cyan signal styling,
floating bottom-left navigation, and no document-level page scrolling.

## Scrolling and status

- Each full pane owns vertical scrolling, including its toolbar and content.
	The promoted list does not have a nested scroll area.
- Navigation stays fixed over the pane. Only its icon buttons intercept input;
	there is no bottom bar. Bottom padding lets the final controls scroll clear
	of the icons, including safe-area insets.
- Host errors, readiness failures, and sample-export progress/results reserve
	space above the pane instead of covering controls. Long notices wrap; the
	notice area scrolls if it exceeds 30% of the viewport height.
- Connection telemetry occupies a 24px header so scrolled controls never pass
	underneath it.
- Session feedback and delete Undo stay in the looper's scroll flow.
- Dialogs have opaque panels and scroll within the viewport when needed.

## Options

- BPM, beats per measure, and loop measures define cycle duration.
- Timing changes with captured material require confirmation and clear it.
- MIDI input, audio output, count-in, metronome enablement, and metronome volume are host settings.
- Key Response selects Linear, Responsive, Strong, or Fixed 127 note-on
	velocity mapping. Strong is the default for the Vortex.
- Count-in runs before each Play from Stop.

## Synth

- Instrument descriptors drive control rendering.
- SoundFont Player discovers host `.sf2`/`.sf3` files, refreshes the catalog, and selects named presets.
- Its controls are Volume and Reverb Mix, with Room Size and Damping under Shape.
- Instrument and SoundFont selectors share a row; the named preset occupies the
	next row. The SoundFont column has extra room for names such as
	Hatsune Miku FNF Sustain.
- Neon Pressure exposes cutoff, resonance, attack, release, LFO rate, and drive.
- Arpeggiator and drum controls apply to either instrument.
- Shared-effect fields use at least 12px text. Arpeggiator mode has room for
	Up to root then down; drums retain three columns on short screens.
- The Synth pane scrolls independently when zoom or viewport height puts
	Arpeggiator or drum controls below the fold.
- Up to root then down ascends through held notes to the lowest note transposed by the selected octave count, then descends without repeating either endpoint.

## Loops

### Toolbar

- Stop, Play, Monitor Only, and Metronome Mute appear at upper left.
- The right-hand actions are Export loop to sample library and Save promoted
	tracks as MP3 files. The latter prompts for a host folder name and exports
	each promoted take plus `mix.mp3` under `~/alesis_recordings/<name>/`.
- Sample-library export works while stopped, counting in, or playing. It needs
	an audible completed loop layer or nonzero drums and a cycle no longer than
	30 seconds. Its pending label does not replace or cover transport controls.
- A second toolbar holds Save loop session and Load loop session. These require
	stopped transport; JSON preserves editable completed takes and musical
	settings, whereas MP3 does not. Loading asks for replacement confirmation.
- Monitor Only suppresses staged and promoted playback while preserving direct synth output.
- Metronome defaults to 25% and triggers once per beat.

### Current

- Displays live MIDI intensity over the cycle with beat and measure guides.
- Populating a waveform does not resize its lane: SVGs fill the allocated box
	without contributing their intrinsic square aspect ratio to grid sizing.
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

- Up to 12 promoted takes play as immutable synchronized layers, leaving one isolated melodic channel for staged audition.
- Each row has waveform, level, mute, and delete controls.
- Export includes every promoted take, even when its playback mute is active, and applies each take's level.
- One-level undo restores the latest deleted take.

## Accessibility

- Icon controls have accessible names and tooltips.
- State is communicated by fill/shape as well as color.
- All panes scroll; the document does not. Navigation remains reachable while
  inspecting the twelfth take, expanded effects, or the end of pad help.
- Portrait asks the performer to rotate the device.

## Browser regression coverage

The production build is served by an isolated software-MIDI/simulated-audio
host. Layout checks cover all three viewports, 0/2/12 takes, empty/short/256-point
waveforms, named Miku selectors, expanded effects, MP3/session dialogs, status
messages, and all panes. They measure child bounds, selected-text width including
the native select arrow, waveform heights, and actual hit targets—not just a
pane's scroll width. The kiosk scrolling test also sends native touch swipes.
Screenshots are retained under `artifacts/ui-qa/`; snapshot-replay layout cases
do not send mutations to the host. Hardware and physical legibility still need
on-device acceptance.
