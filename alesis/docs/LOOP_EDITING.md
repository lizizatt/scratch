# Loop start, staged overdub, and input velocity

The update was deployed and activation verified on the Pi on 2026-10-07.
This is not physical audio acceptance.

## Deployment checkpoint — 2026-10-07

- Pre-update host was stopped with no staged, previous-staged, or promoted MIDI
  takes. Do not restore an older loop-session backup: there is no current MIDI
  session to restore. The 15 sample catalog entries and seven pad assignments
  are preserved, with FluidR3 GM preset `0:49` selected.
- Verified rollback backup on the Pi:
  `/home/alesis/deployment-backups/loop-editing-20261007-v1/`.
  `app.tar.gz` includes dependencies; `user-data-complete.tar.gz` includes
  settings, sample storage and Downloads/SoundFonts; `system-config.tar.gz`
  includes ALSA and service configuration. Snapshot and settings JSON are
  separate. Use these complete archives, not the earlier `user-data.tar.gz`
  attempt that referenced a nonexistent per-user ALSA config.
- Copies are in local ignored `artifacts/deployment/loop-editing-20261007/`;
  SHA-256 checks matched the Pi archives. Application upload used no deletions,
  and a checksum dry-run found no differences for uploaded files. Dependencies
  were unchanged. Build assets: `index-Du2YwNmA.js`, `index-BHLPjztN.css`.
- All 151 focused Pi tests passed using simulated/offline audio. Live musical
  settings, sample catalog, pad assignments and empty/stopped capture state
  matched the saved snapshot after copying and tests. No playback was triggered.
- Both services restarted at 18:15:13 PDT after the user's sudo action:
  server PID 3143, kiosk PID 3144, both running with zero automatic restarts.
  All four readiness dependencies passed after startup completed.
- The backup's `pi-state.mjs verify` confirmed new snapshot fields
  (`minimumVelocity: 1`, `loopStart: 0`, `overdub: false`, transport `origin: 0`)
  and exact preservation of musical settings, sound selection, pad assignments,
  sample catalog, and empty/stopped capture state. It saved `snapshot-after.json`.
  No session import was needed or performed.
- A browser connected to the deployed host through a temporary loopback SSH
  tunnel confirmed the Loop start/Overdub controls and Options velocity floor.
  Only browser navigation was used; no performance controls were changed and
  no playback was triggered. Physical kiosk interaction/listening remains a
  separate acceptance step.

## Performer behavior

In Loops, select a **Loop start** beat or press **Set start here** while playing.
The latter uses the latest browser snapshot, so its precision is limited by
snapshot/network latency; it is not an audio-timestamped punch-in. The dashed
gold marker applies globally to staged and promoted layers, generated drums,
and the arpeggiator's source-beat grid.
It does not seek running transport, change its next rollover, or interrupt held
notes. Stop then Play to hear the new origin. Exports use the selected marker
immediately, without changing live transport.

**Overdub staged loop** is opt-in and initially off. Default capture continues
to rotate completed staging into the previous-staged recovery slot; Stop still
discards an unfinished pass. Overdub instead keeps one stable staged take and
merges each pass. Silence leaves that take intact. The previous-staged slot is
held unchanged while overdubbing; promoted layers are never edited by overdub.

For each new attack, the nearest older attack of the same MIDI channel and pitch
within **±1/8 beat** is replaced, including its release. The distance wraps around
the source seam and is measured before quantization. Each older attack can be
replaced only once per pass; new fast repeated attacks do not replace one another.
Different pitches and attacks outside the window are added. Equidistant older
attacks use the first in stored order. No configurable replacement window is
exposed yet.

Stop, disabling overdub, and promoting staging flush the accepted partial
overdub, closing held keys at that position. A held key carried into the next
pass is a continuation, not a fresh replacement attack. A key held for a whole
cycle saturates at one circular gate instead of accumulating overlapping voices.
Separate overlapping attacks of the same pitch retain FIFO release ownership,
including velocity-zero releases and continuations across passes. Each old gate
accepts at most one continuation per pass; every accepted held owner reserves a
closure within the capture limits.
Promotion freezes rendered MIDI, including quantization; deletion/Undo restores
that frozen recording. Timing changes still require explicit audio clearing.

In Options, **Minimum impact velocity** floors positive note-ons after the
selected Key Response curve and before routing/arpeggiation/capture. Default 1
preserves existing behavior. Velocity-zero note-ons and note-offs remain releases.
Replay/export use captured velocity and take level, not the current input floor.
The floor does not change saved sample audio or generated drum-pattern velocity.

## Coordinates, playback, and export

Stored raw MIDI, quantized MIDI and waveform summaries use fixed source-cycle
coordinates `[0, 1]`. The selected start is `capture.loopStart` in `[0, 1)`;
`transport.origin` is latched only when starting from Stop. New capture after a
rotated restart is mapped back into source coordinates before merging. Clear
audio resets both origins. Quantization remains reversible from raw staging.

Generated arp and drum deadlines use the same latched source phase. For example,
at 120 BPM in a four-beat loop with start 0.1, straight eighth notes first occur
50 ms after Play/count-in ends, then every 250 ms. Count-in does not invent an
attack at an off-grid marker. Triplet spacing and alternating swing remain on
their source grids; delivered arp MIDI is mapped back to source coordinates for
capture and quantization. Editing the marker while playing changes neither grid
until the next Stop/Play.

Playback, MIDI export, offline Neon rendering and SoundFont rendering share the
circular transformation. Gates crossing the selected seam are split into terminal
and opening segments; continuation metadata joins them when subsequently rotated
or overdubbed. Pitch bend and sustain state are seeded at the selected origin,
including controller events exactly on it. Released keys are reconstructed at
the opening only if the pedal caught their release and has not lifted by the
marker. Same-timestamp pedal/release events follow stored source order; pressing
the pedal after a release does not resurrect the note. Overdub preserves that
order, including lift/repress transitions within one pass; incoming controller
edits replace older controls at the same source position and controller key.
Joined seam-crossing gates retain the physical release's source provenance, so
a pedal-caught release before the marker sounds at the opening only until its
later lift. This reproduces
the MIDI arrangement, not the exact envelope phase of an already sounding synth.
The existing cycle boundary still releases/restarts gates; moving a marker during
playback does not add a new boundary.

Promoted-track MIDI/MP3 files and their mix share the selected origin. Sample-pad
MP3 export preserves leading silence for a nonzero selected marker instead of
applying onset trimming; the duration stays one full cycle. Resetting the marker
to zero retains the existing sample-export onset-trim policy (shared mixed onset,
not independent track trimming). MP3 is rendered audio, not an editable backup.

## Persistence and bounds

Save an [editable loop session](LOOP_SESSIONS.md) to retain the marker, overdub
mode, velocity floor and MIDI across host restarts. Reloading only the browser
does not reset the host. The floor also lives in the normal host settings cache;
the marker, overdub mode and recordings do not. Boot with an old cache or import
an old session preserves its musical settings and supplies the new defaults.
Unrelated partial configure commands do not reset the velocity floor.

Overdub admission reserves room for note closures, seam splits and controller
initialization within the existing 32,768-event-per-array and 100,000-total-event
session limits. On capacity exhaustion new capture is rejected with an inline
error; already accepted notes and their releases are retained. Direct playing
continues. Save, then clear audio or load a smaller session to reset rejection.
The existing 4 MiB serialized-file limit is independently checked on save/load.

## Regression evidence

- Live software MIDI through the production router, transport, capture,
  replay and export seams: non-seeking marker edits, count-in/drum alignment,
  circular replacement, partial Stop/promotion, mode changes, undo, velocity
  floor, exact-marker controllers, long-held gates, and quantized continuations.
- Independent regressions cover late pedal presses in replay/MIDI/PCM,
  same-timestamp pedal order, overlapping FIFO gates and capacity, full-cycle
  continuation ownership, and nonzero-origin count-in, triplets and swing.
- Final-review regressions cover equal-time ordering through repeated overdubs
  and rotated capture, exact release/lift markers, velocity-zero releases,
  seam-release provenance after JSON roundtrips, and later-lift replay silence.
- Actual offline Neon PCM and MIDI checks for carried/pedal-held notes; decoded
  MP3 checks for deliberate leading silence. Audio tests use the required STH
  SoundFont; native renderer tests use null output, not physical audio.
- Settings-cache boot/restore and protocol partial-command tests; browser
  session restore also exercises legacy defaults.
- Browser tests cover marker controls, default-off overdub, stable staging,
  Options floor, saved host settings, browser reload, and session roundtrips at
  800×480, 844×390 and 1280×800. Screenshots are under `artifacts/ui-qa/`.

Piano-roll grids, dragging/resizing and selected-note quantization are deferred
in [TODO](../TODO.md). On-device latency, acoustic fidelity and dense-load
acceptance remain hardware work. Development tests used no Pi access or live
audio; the deployment checks above subsequently ran silently on the Pi.