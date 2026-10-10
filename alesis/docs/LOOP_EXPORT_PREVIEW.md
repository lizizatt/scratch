# Loop export selection and host preview

Status: **LOCAL ONLY**, based on the working tree after `68a360c`, 2026-10-07.
Not deployed, committed or pushed. The earlier Pi deployment in
[Loop editing](LOOP_EDITING.md#historical-deployment-checkpoint--2026-10-07)
does not include this work. No Pi access or physical audio was used for it.

## Performer workflow

The **Overdub** checkbox sits beside **Load loop session**. When enabled,
**Current capture** displays the persistent staged take with its quantize,
promote and mute actions. Both staging lanes disappear; disabling overdub
restores them, including the retained previous take. This is presentation only:
replacement, continuation, partial-flush and promotion behavior are unchanged.
The displayed waveform is the host's committed staged summary, not a new
client-side MIDI merge or an instantaneous view of the unfinished pass.

Global **Loop start** / **Set start here** controls are removed. Both MP3 export
destinations use one dialog and the reusable `LoopInteraction` beat selector.
**Choose start beat** enables a horizontal, single-thumb slider. Left/right
advances one beat; the visible beats are numbered 1 through N. There is no end
handle or length selection. Selecting a beat rotates one whole cycle without
changing `capture.loopStart`, `transport.origin`, live playback or stored MIDI.

Leaving the selector off retains the saved origin, including fractional legacy
origins. Explicit **Beat 1** is different from the default: it preserves one
whole cycle, including leading silence. With no override, sample export at
origin zero retains shared onset trimming only when there is no audible wrapped
opening before the first attack; a nonzero saved origin retains the full cycle.
All sample exports and explicit-beat promoted exports include preceding-cycle
decay, even on the first preview pass. Promoted export without an override
retains the historical cold render and trailing renderer tails. Choosing any
beat gives exact-cycle promoted tracks and mix.

- **Sample library:** audible completed staged and unmuted promoted takes plus
  enabled drums. Excludes previous staging, unfinished capture, metronome and
  standalone sample-pad audio. Maximum 30 seconds. Name is optional; blank
  uses the persistent `Loop NNNN.mp3` sequence. Save refreshes the catalog.
- **Promoted MP3s:** every promoted track, including muted tracks, and their
  normalized mix; excludes staged takes and generated drums. A folder name
  is required. Existing destinations are never overwritten. Set
  `ALESIS_EXPORT_DIR` to isolate the default `~/alesis_recordings` destination.

**Preview on host output** is explicit and requires stopped transport. Opening
the dialog, preparing and saving do not automatically Stop or Play. Preview
uses the host's configured audio output (the Pi output when hosted there), not
browser audio. Stop preview keeps the prepared artifact and draft beat; changing
the beat releases it and requires another preparation. Cancel/Escape closes the
dialog after release. An output error retains the draft selection for retry.
If another connection owns the export slot, a rejected preparation does not
claim local ownership: Cancel/Escape still closes the dialog without releasing
that connection's artifact. Cancel during a pending preparation releases the
requested ID and suppresses late preview/save continuations.

## Ownership and audio policy

`LoopExports` owns one connection-scoped, bounded frozen artifact. Its recipe is
captured before rendering yields, when Preview or Save first requests
preparation. The dialog waveform is an opening-time summary; it is not a promise
that transport continuing behind the dialog has stopped changing the next recipe.
Once prepared, Save copies those exact files, even if live state subsequently
changes. Preview repeatedly plays PCM decoded from the final encoded mix;
neither preview nor publication rerenders it. Promoted publication also copies
the prepared individual tracks. No browser media stream or MIDI replay is used.

While preview owns output, the production host suppresses raw hardware/software
MIDI, controller navigation, drum/sample pads, arp, metronome and capture, and
rejects conflicting performance commands. Entry clears held/latching inputs
and sample voices. Stop preview, Stop, Panic, Cancel, owner disconnect, output
failure, audio/MIDI loss and shutdown release preview. They never restart
transport or resurrect held keys/latching input. **Browser disconnect stops
its preview**, unlike normal host-owned transport. Other browsers cannot stop
or publish an owner's artifact through artifact commands; global Stop/Panic
remain safety controls.

Rendering and publication run outside the serialized performance-command queue,
so cancellation can abort cooperative Neon rendering and owned encoder children.
Five-minute expiry bounds abandoned artifacts. Bounds include 256 MiB retained
track WAV data, 192 MiB decoded preview, 32 MiB sample MP3s and a 120-second limit per
render subprocess. Canceled or stale startup completions cannot acquire output
or cancel a newer preview. Failed output teardown retains exclusivity and can
be retried; it does not silently release the performance gate.

The selected **INCLUDE_WRAPPED_TAILS** policy favors a running loop, not a cold
synth start. Render at least two preceding cycles, targeting four seconds of
warm-up and capping at sixteen cycles, then extract exactly one complete cycle.
Neon, SoundFont and percussion use the same ordered schedule: terminal held-note
releases, bend reset, sustain lift, then the next opening events. Mapped drum-pad
releases remain suppressed. No duplicate warm-up attack is mixed onto the result.
Render inputs are stably sorted by source position before rotation and controller
tracking: generated gates can cross later attacks. Equal-time release/pedal order
is preserved, with no event-type priority sorting.
Warm-up does not extend the exported duration or change the selected beat.
Neon discards warm-up PCM in cooperative 480-frame chunks; FluidSynth writes a
temporary disk-backed multi-cycle render, extracts one cycle and removes the
warm-up file. MIDI preparation yields between bounded batches. Artifact size
is preflighted before allocating/rendering the cycle.

The output pump crosses repeat seams within frame buffers, not by restarting a
pad or child process. It repeats the same decoded final bytes from the very first
pass. There is no hidden crossfade or gain change. Sample mixes remain dual-mono
and non-normalized; promoted mixes retain stereo and normalization. A fixed
artifact cannot both contain preceding-cycle decay and match a cold first live
pass. Bounded warm-up also cannot guarantee convergence for all long reverbs,
free-running modulation, presets or voice-stealing conditions. MIDI rotation
reconstructs gates/controllers, not the original live oscillator/effect phase;
codec and residual endpoint differences can still be audible. Preview is
exported-audio acceptance, not universal bit-exact or click-free live synthesis.

## Module and protocol seams

- `loop-render.ts`: frozen recipe, layer selection, shared render/encode/decode,
  duration policies and temporary artifact lifetime.
- `midi-render.ts`, `loop-layers.ts`, `render-process.ts`: existing MIDI/PCM
  implementation extracted for both destinations, plus cancellable subprocesses.
- `cycle-render-schedule.ts`: shared bounded warm-up and chronological rollover
  schedule; legacy cold rendering remains an independent utility policy.
- `loop-export.ts`: connection ownership, prepare/preview/publish/release,
  performance lock and status. Destination modules only publish prepared files.
- `loop-output.ts`: shared circular frame reader and native/silent output adapters.
- `loop-export-dialog.tsx`, `loop-interaction.tsx`: shared UI and source-coordinate
  waveform/beat selection; draft export selection never sends `set-loop-start`.

WebSocket protocol is **v7**: prepare, preview, publish, release, Panic, artifact
acknowledgements and authoritative export status, including new connections.
Editable loop-session file format remains v1. Legacy export commands still use
the new host artifact workflow; old v6 browser clients must reload the v7 bundle.
Legacy one-shot commands release their own prepared artifact on publication
failure as well as success, so the same connection can retry. Interactive
publication failures retain the prepared artifact for retry in the dialog.
After a lost save acknowledgement, inspect the destination before retrying:
publication may have committed, and saved user files are not removed afterward.

## Validation and limitations

Regression coverage includes actual host MIDI routing/capture, direct sample
commands and both raw pad modes, stopped latched arp, generated drums/metronome,
simulated audio/MIDI loss, output error, owner disconnect, Stop/Panic, cancellation
during render/start, late completion, failed teardown and retry. Export tests
check exact prepared bytes, arbitrary repeat-buffer seams, frozen source state,
legacy/default origins, explicit Beat 1 and publication collision/retry.
Browser coverage includes all three viewport sizes, selector keyboard behavior,
overdub presentation/session persistence, rejection while playing, draft retention,
save/cancel and disconnect. Native pump tests use fake owned children; native
renderer tests use null output or offline files only.

Ownership follow-up: two production-control regressions first failed on retry
after real filesystem publication errors; both pass after legacy cleanup.
Browser Cancel/Escape and delayed-rejection cases first failed with a trapped
dialog, while pending successful-preparation cancellation already passed.
Final targeted validation: 47 server/control tests and 30 browser checks across
three viewports on isolated port 8916, plus typecheck and build, passed. The
warm-cycle follow-up additionally passed the full 722-test suite with STH,
all workspace typechecks, production build and task-scoped diff check.
The twelve offline fidelity cases cover near-end Neon release, STH release,
reverb and percussion (including the Neon/percussion route), key-held and
pedal-held boundaries, shifted beats, three warmed scheduler passes, and exact
decoded MP3/preview repeats. See [measured results](LOOP_EDITING.md#offline-audio-fidelity-measurements--local-tree-after-68a360c).
Final ordering follow-up: the 240 BPM, 4/4 one-bar breakbeat reproduced three
failures, including negative MIDI deltas at default origin and explicit Beat 1.
All seven review cases now pass, including both equal-time release/pedal orders
on unsorted input. Focused loop/audio/schedule/export validation passed 523 tests
across 25 modules; the full STH suite passed 729 tests across 47 modules, with no
skips. Workspace typechecks, production build and repository diff check passed.
The first full browser run passed 110/111: the remaining test asserted a transient
disabled promotion button while 200 ms capture cycles refilled its slot. The
trace showed a promoted track; the test now checks the command acknowledgement
and track instead. Nine repeated checks passed, then the full 111 browser tests
passed across all three viewports on isolated port 8917. All commands completed.

No physical latency, ALSA underrun, hotplug-device, speaker/listening or kiosk
touch acceptance is claimed. Those require a separately authorized hardware
session. No overdub merge-backend changes are part of this presentation/export
work.
