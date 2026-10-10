# Sample pads

The Pads section keeps drum/sample mode separate from the target of the Vortex
+/− controls. Set **Pad mode** to **Samples** to use the eight live sample
triggers. Set **+ / − target** to **Voices**, **Drum kits**, or **Sample pages**
to choose what host navigation and incoming Program Change messages select.
The position readout shows the one-based selection, its label, and the total
number of entries. Host catalog indices are nonnegative safe integers and are
not limited by the MIDI Program Change byte, so the entry selector and on-screen
+ / − buttons can navigate beyond index 127. The physical Vortex + / − controls
send MIDI Program Change values 0–127: the first or non-adjacent value selects
`value % entryCount`, adjacent values step by one entry, and `127 ↔ 0` also
counts as an adjacent step so hardware browsing continues across both MIDI-byte
and catalog boundaries. Repeated duplicate Program Change values are ignored.
The Vortex on-board display still shows its physical preset number, not the
host's absolute catalog index. Selecting an entry under **Voices** changes the
selected SoundFont voice but does not switch synthesizers; if Neon is selected,
Neon stays active.

## Edit an ordinary pad press

Every displayed pad has a separate pencil button, including empty slots and
drum-mode pads. It opens **Edit pad** without playing audio. Choose:

- **Default**: the mode's normal drum note or the sample at that page's slot.
- **Sample / saved loop MP3**: any MP3 in the host sample library, including
  exported loops. Hold to play, release to fade. Current MIDI takes and loop
  session JSON files are not samples and are not offered here.
- **Control**: Transport, Configured drums, Metronome, or Arpeggiator. Each has
  a toggle and explicit start/stop, mute/unmute, or enable/disable choices.

Controls run once on ordinary press, not long press. Releasing, cancelling a
hold, or disconnecting does not reverse a control action. Transport start uses
the normal readiness/count-in path; stop uses normal recording cleanup.
Even a rejected acknowledgement keeps the control latched until release: a
settings-write failure can occur after the action has already taken effect.
Configured drums start/stop enables/disables the selected pattern; it does not
start transport. The pattern sounds only while transport is playing.
Metronome mute/unmute changes its enabled state without changing click volume.

**Save** waits for the host acknowledgement and settings write. **Reset to
default** removes the override. Assignments are sparse and independent for each
mode, sample-page index, and pad (0–7 internally). Voice/kit navigation does not
move assignments; sample-page navigation selects another bank of assignments.
The same mapping handles on-screen pads and hardware channel 10 notes 36–43.
Host settings retain assignments across restarts; browser storage is not used.
Loop-session import/export does not replace these host pad settings.

Explicit samples use an opaque SHA-256 identity derived from the exact
library-relative filename, not its sorted slot or a collision-prone display
name. Adding/reordering other files cannot change an explicit assignment.
Renaming/moving/deleting an assigned file makes it unavailable until the same
relative filename returns or the pad is reassigned. No other sample is silently
substituted. Default slots intentionally follow library ordering. Assigned
pages remain reachable if the library shrinks, including control-only pages.

The picker receives the full bounded catalog (ID and display name only), never
host paths. The host verifies IDs against its scan, validates canonical paths
within the library, and decodes the selected eight slots on edit/page/mode
changes, never on an ordinary press. Unreadable/oversized assigned samples stay
assigned and display **Unavailable**. Page memory limits can also make a slot
unavailable. Refresh after repairing an asset.

The dialog uses native modal focus management, Escape/Cancel, and a scrollable
layout for the 800×480 touch display. Editing releases this browser's held
pads; applying changes, changing mode/page, or refreshing the library resets
held playback and invalidates queued hardware controls from the old mapping.
An edit overlapping an audio-reconnect refresh supersedes that refresh so old
slot audio cannot be installed under the new assignment.

## Configure a user library

The host recursively scans for `.mp3` files under:

```text
~/.local/share/alesis/samples
```

To use another directory, set `SAMPLE_LIBRARY_DIR` in the environment used to
start the host. Put MP3 files in that directory (subdirectories are scanned
too), then use **Refresh samples** in the Pads section. The browser reports
loading, ready/empty, and scan/decode/playback errors. An empty library still
shows all eight numbered slots; default sample triggers are disabled but their
edit buttons remain available for assigning controls.

For local UI testing, generate ten synthetic MP3 tones into an explicit
directory, then point the host at that directory before starting it:

```sh
node scripts/generate-sample-fixtures.mjs /tmp/alesis-samples
SAMPLE_LIBRARY_DIR=/tmp/alesis-samples MIDI_MODE=software AUDIO_MODE=simulated npm start
```

The fixture script requires `ffmpeg`; its single positional argument is the
output directory. It creates `Synthetic Tone 01.mp3` through `Synthetic Tone
10.mp3`, which fill one page and two slots of a second page. `SAMPLE_LIBRARY_DIR`
must be set on the host process, not in the browser.

## Loop sample export

In the Loops toolbar, **Export loop to sample library** is separate from
**Save promoted tracks as MP3 files**. The latter writes each promoted take
and a merged mix to a named recordings folder. Loop sample export instead
renders one full cycle from the completed loop sources, with a maximum cycle
duration of 30 seconds, as a single MP3 in the configured sample library.
Export works while stopped, playing, or counting in; it does not start, stop,
or reset the transport.

With no start-beat override and a saved origin of zero, the host trims leading
silence before MP3 encoding so the pad starts near the first sound, rather than
waiting for its original beat position. Explicit start beats and nonzero saved
origins preserve the complete cycle. The local-only warm-cycle policy includes
preceding-cycle decay even on the first preview pass. Audible wrapped audio
before the first attack is never onset-trimmed. Warm-up uses at least two cycles,
targets four seconds and caps at sixteen cycles; it does not lengthen the sample
or guarantee convergence for every long reverb/preset. There is no fade or gain
change. Detection uses a conservative -80 dBFS threshold with 5 ms of pre-roll;
onsets within the first 10 ms are left alone. Quiet attacks above that threshold,
pauses between notes, relative layer timing, and the remaining audio through the
cycle end are preserved. The resulting pad sample can be shorter than one cycle.
An entirely silent render is rejected. Promoted exports without a beat override
keep their historical cold render and trailing tails; explicit-beat promoted
exports use the same warm-cycle policy. Existing files are not automatically rewritten;
re-export a loop to make a trimmed copy.

The export includes audible, unmuted promoted takes and an audible staged take
(unless **Monitor only** is enabled), plus an enabled drum pattern with volume
above zero. The host verifies the completed recordings and actual note material
before rendering. It excludes the metronome, live MIDI input, the unfinished
current capture, and live sample-pad triggers. A playable source is required;
the browser's enabled/disabled state is only a guide, and the host can still
reject a capture that has no completed audible note material or required
instrument assets.

Open **Export loop to sample library**, then **Save**; no sample name or keyboard
input is required. The local-only [shared export dialog](LOOP_EXPORT_PREVIEW.md)
also offers optional naming, start-beat selection and explicit host-output
preview while stopped. The host assigns rising names beginning with `Loop 0001.mp3` and avoids
overwriting existing files. The next number is retained in the hidden
`.loop-sample-sequence` directory inside the sample library, so it survives host
restarts and stays advanced even if exported samples are moved out of the
library or deleted. Keep `.loop-sample-sequence` with the library when moving
the library if you want the sequence to continue. Failed or colliding exports
can leave gaps; numbers are not reused. You can rename exported copies
off-device without changing the host's counter state. The host still accepts
explicit names, now also available through the shared dialog.

After a successful write, the host refreshes the sample catalog automatically.
The result reports the generated filename, not a machine-specific path. If the
result says the file was saved but the library could not be refreshed, the MP3
is still present in `SAMPLE_LIBRARY_DIR`; use **Refresh samples** in Pads to
rescan it. If the connection drops before confirmation, the outcome is unknown:
check the sample library before retrying, because the file may already have been
written. This action does not change **Pad mode** or the **+ / − target**.

## Limits and hardware behavior

- In sample mode, hold a physical or on-screen pad to play its sample. Releasing
  it fades out that pad's active voices over 5 ms; other pads keep playing.
  Already-buffered audio adds a small delay. Retriggering restarts the sample,
  and releasing the pad ends all its overlapping triggers.
- In drum mode, the mapped physical pads (channel 10, notes 36–43) are one-shot
  hits: quick releases do not cut their tails. The same rule applies to recorded
  loop playback and SoundFont exports; other notes retain their normal releases.
- On-screen pads support pointer capture and Enter/Space holds. Cancellation,
  focus loss, leaving the Pads pane, and page/mode changes release held samples.
- Only `.mp3` files are discovered. Each file is limited to 32 MiB and 30
  seconds. A page contains up to eight samples and decoded page data is bounded
  to 64 MiB. Samples are decoded to 48 kHz stereo for playback. The catalog is
  limited to 4,096 files / 512 pages; an oversized scan reports an error instead
  of exposing a silently truncated picker. There are at most 8,192 overrides
  across the two modes. Page zero is editable with an empty library.
- Sample playback allows up to 32 simultaneous voices; a new trigger replaces
  the oldest voice when that limit is reached.
- The physical Vortex sample-pad profile uses MIDI channel 10 (wire channel 9),
  notes 36–43. Physical sample notes are consumed as live triggers while sample
  mode is active; they are not loop-captured and are not included in MP3 exports.
- Vortex +/− changes its onboard controller preset. To make those preset
  changes select the corresponding host entry, configure identical controller
  mappings and enable **Program Change Send On Load**, with programs numbered
  0 through N−1. The Vortex has 128 onboard controller presets (0–127), even
  though host catalogs can contain more entries. The Vortex display indicates
  its onboard controller preset only. Host UI navigation cannot write that
  display and does not synchronize it.
- The software sample-pad buttons trigger the same live sample service and do
  not require a connected Vortex. Physical input/output readiness is separate
  from the displayed sample-library status. Browser-held triggers are released
  when their WebSocket disconnects. Holds are tracked by connection or hardware
  source; a release from a different source cannot cancel them. If several
  sources hold the same sample pad, its overlapping voices fade only when the
  last owner releases. Repeated sample attacks still retrigger; repeated control
  attacks from an already-held source do not execute again.

The controller setup references are the [Alesis setup guide](https://support.alesis.com/support/solutions/articles/69000865912-alesis-vortex-wireless-2-setup-guide)
and [Vortex Wireless 2 Editor user guide](https://www.alesis.com/rscdn/1856/documents/Vortex%20Wireless%202%20Editor%20-%20User%20Guide%20-%20v1.0.pdf).
No undocumented display-writing SysEx is sent. Configure the pad channel and
notes above in every preset used for navigation; the host cannot distinguish
keys from pads when they send identical MIDI messages.

## Verification

Sample streaming accounts for elapsed time instead of sending a fixed amount
per timer callback. It primes 20 ms of PCM and bounds recovery work after stalls.
The pending-write cap applies to Node's queue, not audio already in OS/ALSA
buffers. `scripts/benchmark-sample-player.ts` compares the old timer pump
(`--baseline`) with the current player using a synthetic paced consumer and no
speaker output. A ten-second workstation run measured 2,862 missing frames for
the baseline and zero for the corrected pump, with similar CPU use. This is not
an ALSA measurement or confirmation that physical speaker static is resolved.

Automated audio tests generate distinct MP3 tones and verify the decoded
frequencies after triggering slots on both pages, plus empty slots, panic,
polyphony, invalid files, and decoded-memory limits. Host tests cover paging,
independent selection persistence, MIDI decoding, and audio reconnects.
Browser checks exercise the two-page synthetic library and an empty library
in landscape phone and tablet viewports.

Physical Vortex preset/display behavior and CM108 audio output still require
an on-device check. With identical preset mappings and send-on-load configured,
select each navigation target, press the controller's +/− buttons, and check
that its preset number corresponds to the host's entry. Then play all eight
pads on each sample page and check that keyboard notes on the melodic channel
still use the selected synthesizer.
