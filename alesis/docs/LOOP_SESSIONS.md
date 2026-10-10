# Editable loop sessions

In **Loops**, stop transport and choose **Save loop session** to download JSON to
the browser's downloads. To restore it, choose **Load loop session**, select the
JSON file, and confirm **Replace completed takes**. Cancel leaves the host alone.
Loading replaces the completed takes and musical settings; it is not a merge and
cannot be undone. Transport stays stopped. Both operations are rejected by the
host if another client starts playback first.

MP3 exports and sample-pad MP3s are rendered audio, **not editable backups**.
They cannot restore recorded MIDI. Save a loop-session file before restarting the
host; recordings are otherwise held only in memory. There is no autosave.

## Included

- Every promoted take, including muted/zero-level takes, and both staged slots;
  levels, mute flags, waveforms, and ordered cycle-relative MIDI events.
- Raw staged MIDI for reversible quantization, plus rendered MIDI for the staged
  take. Previous-staged and promoted takes retain their frozen rendered timing.
- Tempo, meter, loop measures, quantization, staged audition, monitor-only,
  metronome/count-in/key response, selected synth and its parameters,
  arpeggiator settings, drum pattern/volume and selected percussion kit.
- Global loop-start marker, staged-overdub mode, and minimum positive input
  velocity. MIDI stays in source coordinates; moving the marker does not rewrite
  stored takes. See [loop editing](LOOP_EDITING.md) for playback/export semantics.
- SoundFont ID/name and named preset bank/program identity. The percussion layer
  references the host's FluidR3 GM font and its kit.

In default rotating-capture mode, Stop discards the partial current cycle. In
overdub mode, Stop closes accepted held gates at the stop position and merges
the partial capture into staging before saving becomes available.

The uncommitted current cycle, held live notes/arpeggiator latch state, delete-undo
history, sample-pad audio/triggers, device IDs, paths and SoundFont assets are
excluded. All takes use the host's current synth, just as during normal playback;
this is not a per-take instrument archive.

## Validation and portability

Version 1 uses `format: "alesis-loop-session"`, `version: 1`, and JSON MIDI event
arrays (not base64). Limits: 4 MiB UTF-8 file, 12 promoted takes plus the two
staged slots, 32,768 events per array, 100,000 events total including staged raw
events. Timing uses the engine's normal ranges; the MP3 sample-export 30-second
limit does not apply. Missing recordings and oversized sessions fail explicitly;
no tracks or MIDI are silently dropped. Unknown versions, fields, malformed MIDI,
duplicate IDs, unordered events and incompatible parameters are rejected.

Older version-1 files remain readable: absent `sourceOrigin`/`loopStart` default
to zero, `overdub` to false, and `settings.minimumVelocity` to 1 (unchanged input).
New files include these fields and may include `continuation: true` on synthetic
wrapped note attacks. This metadata keeps one held gate from becoming a second
replacement attack and survives quantization. New files are not guaranteed to
load in older hosts with strict schemas; retain old backups before upgrading.

Install the same SoundFonts on the destination host first. Missing fonts, named
presets or kits reject the whole import, with no fallback. IDs/names identify
catalog entries, not cryptographic asset hashes: use the same asset versions.
Files contain references only and do not grant or transfer asset licenses.

The host validates the entire file and local capabilities before preparing a
separate, silent renderer. Failed preparation closes that renderer without
changing the current renderer, takes, recordings or settings. A successful import
swaps renderer, recordings and engine state synchronously before publishing the
new snapshot. Native preparation temporarily needs resources for two renderers;
insufficient resources cause a recoverable rejection. Live MIDI still reaches the
old renderer during preparation (including note releases), but the stopped
transport prevents any MIDI from entering a partial recording. No loop playback
is started.

Session commands use the serialized control queue. Download data goes only to
the requesting connection and is not retained in the command-result cache;
request a fresh save rather than retrying a completed download's command ID.
Files within the size limit produce recoverable validation errors. The WebSocket
also has a hard frame-size limit for abusive/oversized envelopes.
At most four browser session transfers may be queued at once; excess requests
receive a recoverable busy error.

This is an explicit bulk-file transfer exception to ADR 0001's prohibition on
streaming performance MIDI through the browser. The browser never schedules MIDI,
renders the session, or owns transport/capture timing.

## Deployment verification — 2026-09-26

- 321 tests, typecheck, production build, and 24 phone/tablet browser tests passed.
- 39 session/health tests passed on the Pi. Native Miku renderer preparation and
  disposal also passed without sending notes or replacing the live renderer.
- After the user restarted the host, readiness and the new save command were
  verified. The deployed browser shows both session buttons. Live session import
  was not used to overwrite the user's instrument state during verification.
- Existing pad loops 0001 and 0002 were separately backed up and trimmed by
  117.67 ms and 52.81 ms, respectively, then reloaded. This repairs their audio
  onset but cannot reconstruct the lost MIDI recordings.
