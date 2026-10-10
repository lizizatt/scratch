# Loop start, staged overdub, and input velocity

The original loop-editing update was deployed and activation verified on the Pi
on 2026-10-07. The newer [overdub presentation and export preview](LOOP_EXPORT_PREVIEW.md)
changes are **LOCAL ONLY** and are not included in that deployment. Neither is
physical audio acceptance.

## Historical deployment checkpoint — 2026-10-07

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

The current local UI chooses an optional start beat in either export dialog,
not through global **Loop start** / **Set start here** controls. It rotates the
export only. The host still preserves a saved/imported global marker and the
`set-loop-start` protocol command for compatibility: such a marker does not seek
running transport or interrupt held notes; its origin latches on the next Play.
See [export selection](LOOP_EXPORT_PREVIEW.md) for the default versus explicit
Beat 1 policies and stopped, exclusive host-output preview.

**Overdub staged loop** is opt-in and initially off. Default capture continues
to rotate completed staging into the previous-staged recovery slot; Stop still
discards an unfinished pass. Overdub instead keeps one stable staged take and
merges each pass. Silence leaves that take intact. The previous-staged slot is
held unchanged while overdubbing; promoted layers are never edited by overdub.

In the current local UI, **Overdub** is beside **Load loop session**. Enabling
it hides both staging lanes and presents the committed staged waveform and its
actions in **Current capture**. Disabling it restores the lanes. No merge,
replacement or capture semantics changed with that presentation update.

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
- Browser tests cover export start selection, default-off overdub, stable staging,
  Options floor, saved host settings, browser reload, and session roundtrips at
  800×480, 844×390 and 1280×800. Screenshots are under `artifacts/ui-qa/`.

Piano-roll grids, dragging/resizing and selected-note quantization are deferred
in [TODO](../TODO.md). On-device latency, acoustic fidelity and dense-load
acceptance remain hardware work. Development tests used no Pi access or live
audio; the deployment checks above subsequently ran silently on the Pi.

### Offline audio fidelity measurements — local tree after `68a360c`

[loop-audio-fidelity.test.ts](../apps/server/src/loop-audio-fidelity.test.ts)
now has twelve tests at the host MIDI → routed capture → replay/export boundary.
Four cases render Neon or FluidSynth/STH at explicit **Beat 1** or **Beat 2**
(a 500 ms rotation). They include physical note-off, velocity-zero release,
pedal-caught sustain across the selected seam, pitch bend, and STH hi-hat audio.
The oracle renders actual `MidiLoopScheduler` deliveries over five consecutive
passes: directly through `NeonPressureSynth`, or through a separately encoded
MIDI file and FluidSynth's offline renderer. It does not call the export MIDI
writer or copy an exported buffer to construct the replay oracle. Compare the
last three passes to the warm artifact. **The previous cold-export seam metrics
and accepted missing-tail characterization are superseded by this fix.**

The fixtures pin 120 BPM, a two-second cycle, 48 kHz, linear velocity/floor 1,
unity take level, STH bank/program 0:0 and standard percussion, gain 0.72, and
disabled SoundFont effects in the four original fixtures. The added reverb case
uses send 1, level 0.3, room size 0.2, damping 0 and width 0.5. Neon uses 4 ms
attack, 40 ms release (200 ms in the tail/boundary cases) and disabled
LFO/drive. Sample export's summed, non-normalized mix and stereo-average mono
downmix are applied to the reference comparison; neither gain fitting nor
waveform time alignment is used. Promoted-mix normalization is **not** covered
by this comparison. Default onset-trim export is covered separately; these
explicit-start cases must retain exactly 96,000 frames.

Measured with FluidSynth 2.3.4 and FFmpeg 6.1.1, STH SHA-256
`d56e5e9e5020c17f6d512dc59005456cec3647946640a75c23038cf6be983d2f`:

| Fixture | Maximum raw NRMSE vs warmed passes 3–5 | MP3 decode vs raw NRMSE | Seam step / interior RMS difference |
| --- | ---: | ---: | ---: |
| Neon, Beat 1 | 0.000075 | 0.0315 | 0 |
| Neon, Beat 2 | 0.000075 | 0.0344 | 0.222 |
| STH + percussion, Beat 1 | 0 | 0.0311 | 0 |
| STH + percussion, Beat 2 | 0 | 0.0289 | 1.692 |

NRMSE is error energy divided by reference energy, then square-rooted. The
SoundFont comparison includes native MIDI-render block timing and voice state;
zero error here is a result for these fixtures, not a universal guarantee.
Checked limits were tightened to 0.0003 Neon / 0.02 STH on each of the three
warmed passes, with the existing 0.06 MP3 limit unchanged. Independently rendered
artifacts and raw cycles must agree within 0.0001 NRMSE. The shifted warm artifact
differs from cold first live playback by 0.00230 Neon / 0.06087 STH NRMSE, as
expected under the explicitly selected first-pass policy.

All three passes have the first attack at 250 ms (Beat 1) or 0 ms (Beat 2),
with the pedal released at 800/300 ms. At a -60 dBFS, 5 ms RMS-window threshold,
Neon ends at 840/340 ms and STH at 805/305 ms. Tests also bound the later
velocity-zero gate and percussion attack, and check for dropouts throughout the
held segment. Shifted decoded seams have 0 ms Neon / 0.0208 ms STH runs below
three PCM counts in a ±20 ms window; the 40 ms silence around Beat 1 is
intentional phrase rest, not a missing gate. Nonzero endpoint steps do **not**
establish click-free acoustic playback.

Each encoded MP3 is separately decoded and compared byte-for-byte against all
three full cycles from the actual preview circular reader. Requests include
1, 479, 2047, 96,013 and 127 frames, crossing seams inside chunks and spanning
more than a cycle. A controlled negative test inserts a 20 ms silent gap and
separately drops a physical note-off; the corresponding held/release assertions
both reject the damaged PCM.

**Red → green evidence:** the desired Neon tail assertion first failed with
**0.081570 RMS replay vs zero export** at 20–100 ms after rollover. It now passes
with **0.081529 RMS decoded export**; seam step/interior difference fell from
5.77 to 0.408 without a fade. Three additional real STH cases first failed on
absent opening audio, then passed:

| Opening window | Running replay RMS | Warm raw RMS | Decoded MP3 RMS |
| --- | ---: | ---: | ---: |
| STH release, 0–4 ms | 0.020212 | 0.020212 | 0.020189 |
| STH reverb, 0–100 ms | 0.0012112 | 0.0012111 | 0.0012055 |
| STH percussion, 0–100 ms | 0.0031128 | 0.0031128 | 0.0032005 |

The same percussion result passes through the Neon-plus-percussion path.
Boundary-held keys, sustained releases and pitch reset are compared to actual
scheduler deliveries, including their exact order and attack count. Sample
default and explicit promoted paths both retain the opening decay; separate
tests retain default onset trimming when no audible wrap precedes the attack.
Decoded MP3s match the production circular reader byte-for-byte on all three
passes, including the first. Dropped-note-off and inserted-gap negative controls
still reject damaged audio.

**Policy and remaining limits:** sample and explicit-beat promoted exports use
INCLUDE_WRAPPED_TAILS: at least two preceding cycles, targeting four seconds,
capped at sixteen cycles, then one complete extracted cycle. Warm-up does not
count toward export duration. First preview includes the preceding decay by
design; exact cold first playback cannot universally match a steady cycle.
Long reverbs, free-running modulation and voice stealing may not converge within
this bound, and MP3/endpoint differences remain. Promoted exports with no beat
override keep their historical cold/trailing-tail policy; cold renderer utility
PCM tests remain unchanged. No crossfade, gain change or overdub backend change.

Final validation after the render-order follow-up: **729 tests passed across
47 modules**, with STH and no skipped tests; the focused loop/audio/schedule/export
suite passed **523 tests across 25 modules**. Stable chronological input sorting
fixes fast breakbeat negative MIDI deltas while preserving equal-time pedal order.
All workspace typechecks, production build and repository diff check passed.
Full browser validation passed **111/111** on port 8917 after correcting a
trace-confirmed transient promotion-button assertion; nine repeated targeted
browser checks also passed. All validation commands completed. No Pi, physical
output, deployment, or commit was involved. This evidence covers offline PCM and
preview-reader content, not native-clock scheduling, underruns or speaker fidelity.
