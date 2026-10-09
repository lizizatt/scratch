# Periodic generated-drum hitch

## Evidence

Investigated during the 2026-10-04 session (Pi measurements continued past
midnight on October 5). The live host was playing four-on-floor at 118 BPM,
drum volume 0.45, with Miku Sustain selected. No settings, transport, or
SoundFonts were changed during diagnosis.

- Recent service logs contained no reported audio underruns or renderer recovery.
- The Pi reported no throttling (`0x0`), about 55.5°C, and no service restarts.
- A 25-second local WebSocket observation, including partial updates, saw
  median updates around 50 ms and one 74 ms gap. UI updates are not audio timing.
- Deployed `drum-patterns.ts` matched the local source. Deployed `main.ts`
  called its floor-based current-step scheduler only every 50 ms.
- Deterministic reproduction at 118 BPM yielded hi-hat intervals of 250 and
  300 ms instead of 254.237 ms: approximately 46 ms extra delay every three
  seconds, even without CPU load or an audio device.

This establishes a timing defect consistent with the reported hitch, not proof
that every audible interruption has this cause.

## Fix

`DrumPlaybackScheduler` projects individual step deadlines from the authoritative
engine position and monotonic timestamp. It keeps one timer, rounds delays up,
rechecks deadlines, and cancels queued work on state/configuration changes.
The host's background 50 ms polling rate and audio buffers are unchanged. Generated drums
still bypass loop capture. Exported drum pattern generation is unchanged.

Late backlog is skipped rather than burst-replayed. Ordinary timer jitter has
a tolerance of the smaller of 20 ms or one-quarter step. The shared playback
adapter now advances the engine at the count-in deadline; both opening hits
are retained up to 50 ms late if callback delivery is delayed. Node and the
FluidSynth command interface are not hard-real-time; blocking host operations
and output-device latency remain possible sources of delay.

Independent review identified an omitted opening hit after a fractional
count-in boundary. That was fixed and covered using real engine advancement,
not an artificial exact-zero transition.

## Silent Pi comparison

`scripts/drum-timing-diagnosis.ts` runs old and new schedulers together with
recording callbacks instead of audio output. It sends no control commands and
does not access MIDI or the speaker. The Pi ran a copy in a separate diagnostic
directory, not in its live application. The corrected shared-start 20-second
run produced:

| Metric | Old 50 ms polling | New deadlines |
| --- | ---: | ---: |
| Hi-hat hits | 79 | 79 |
| Minimum interval | 249.20 ms | 251.88 ms |
| Maximum interval | 302.15 ms | 256.71 ms |
| Largest interval error | 47.92 ms | 2.47 ms |
| Interval errors over 10 ms | 6 | 0 |

An earlier run also showed no new-scheduler interval errors above 10 ms
(maximum 6.85 ms); its probe start preceded construction, so the new scheduler
correctly skipped the already-past opening boundary. The diagnostic now starts
both after construction.

## Shared drum/arpeggiator grid

The previous arpeggiator lookahead started its own phase when notes arrived.
Matching BPM did not align it to drum beats. `TransportPlayback` now owns
transport advancement and supplies a common monotonic beat anchor to both
schedulers. Note selection occurs at delivery rather than during lookahead.

- While playing, a newly entered chord waits for the next arpeggio grid point.
- Count-in silences the arp, retains held notes, and starts both at beat zero.
- Standalone keyboard arpeggiation remains available when transport is stopped.
- Swing intentionally delays alternating arp notes; triplets retain triplet
  spacing and share quarter-beat boundaries with drums.
- Changes cancel obsolete deadlines. Gates release before same-pitch attacks.
- Timing configuration publishes a position consistent with its new duration,
  preserving the engine's elapsed-seconds policy rather than stale progress.
- Clear/stop recording cleanup finishes before new-epoch playback delivery,
  preserving the first recorded arp attack after a clear.

The production-adapter tests use the real engine and capture path with 50 ms
background polling, including delayed count-in callbacks, restarts, multiple
cycles, late chord entry, tempo changes, gates, latch, and stalls. Shared grid
hits stay within 2 ms in deterministic timer tests at 118 and 137 BPM.

`scripts/transport-alignment-diagnosis.ts` was run silently in an isolated Pi
directory, with no connection to the live host/audio/MIDI. Its 20-second run
at 118 BPM, including count-in and off-grid chord entry, produced 71 hi-hat
hits and 71 arp notes. Maximum callback offset was 4.53 ms; none exceeded
5 ms. Maximum arp interval error was 6.20 ms. This measures callback alignment,
not acoustic attack alignment or a hard real-time guarantee.

## Validation and deployment status

The status below describes the earlier deployed release. Subsequent local UI
and recording/replay fixes are documented in
[Recording and kiosk QA](RECORDING_UI_QA_2026-10-05.md); they are not yet deployed.

- 40 dedicated scheduler tests cover timing at 118/137 BPM, complete pattern
  sequences, count-in, loop wraps, stop/replay, configuration changes, stalls,
  stale callbacks, and disposal.
- 56 shared-playback tests and 10 additional engine timing tests cover the
  alignment changes and independent-review findings.
- Full suite: 439 unit/integration tests; 42 browser tests; typecheck and build pass.
- Deployed and activated on the Pi on 2026-10-05 after the operator restarted
  `alesis-server.service` at 00:55 PDT. Service active, no automatic restarts,
  and all readiness dependencies healthy. The Pi also passed all 148 focused
  engine/drum/arp/alignment tests before activation.
- Ten deployed timing/engine/UI file checksums match the validated workstation
  build. This release also includes stopped sample export and floating,
  scrollable kiosk navigation from the earlier validated changes.
- The two staged takes were exported before restart and restored only after
  confirming the restarted host was empty and stopped. Re-export matched the
  backup apart from regenerated IDs. Miku Sustain and drum/arp settings were
  preserved; transport remains stopped.
- Rollback app and editable session backups are in
  `/home/alesis/deployment-backups/before-shared-clock-20261005/` on the Pi.
- No test playback was triggered on the live instrument. Silent timing probes
  and readiness checks are not speaker/listening acceptance.
