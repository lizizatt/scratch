# Sample pads

The Pads section keeps drum/sample mode separate from the target of the Vortex
+/− controls. Set **Pad mode** to **Samples** to use the eight live sample
triggers. Set **+ / − target** to **Voices**, **Drum kits**, or **Sample pages**
to choose what host navigation and incoming Program Change messages select.
The position readout shows the one-based selection, its label, and the total
number of entries. Host catalog indices are nonnegative safe integers and are
not limited by the MIDI Program Change byte, so the entry selector and + / −
buttons can navigate beyond index 127. Incoming MIDI Program Change messages
remain limited to wire values 0–127. Selecting an entry under **Voices**
changes the selected SoundFont voice but does not switch synthesizers; if Neon
is selected, Neon stays active.

## Configure a user library

The host recursively scans for `.mp3` files under:

```text
~/.local/share/alesis/samples
```

To use another directory, set `SAMPLE_LIBRARY_DIR` in the environment used to
start the host. Put MP3 files in that directory (subdirectories are scanned
too), then use **Refresh samples** in the Pads section. The browser reports
loading, ready/empty, and scan/decode/playback errors. An empty library still
shows all eight numbered slots, disabled, and explains where to put files.

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
renders one full cycle of the loop that is currently playing, with a maximum
cycle duration of 30 seconds, as a single MP3 in the configured sample
library.

The export includes audible, unmuted promoted takes and an audible staged take
(unless **Monitor only** is enabled), plus an enabled drum pattern with volume
above zero. The host verifies the completed recordings and actual note material
before rendering. It excludes the metronome, live MIDI input, the unfinished
current capture, and live sample-pad triggers. A playable source is required;
the browser's enabled/disabled state is only a guide, and the host can still
reject a capture that has no completed audible note material or required
instrument assets.

Tap **Export loop to sample library** once; no sample name or keyboard input is
needed. The host assigns rising names beginning with `Loop 0001.mp3` and avoids
overwriting existing files. The next number is retained in the hidden
`.loop-sample-sequence` directory inside the sample library, so it survives host
restarts and stays advanced even if exported samples are moved out of the
library or deleted. Keep `.loop-sample-sequence` with the library when moving
the library if you want the sequence to continue. Failed or colliding exports
can leave gaps; numbers are not reused. You can rename exported copies
off-device without changing the host's counter state. The host still accepts
explicit names from legacy clients, but the UI does not offer name entry.

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
  to 64 MiB. Samples are decoded to 48 kHz stereo for playback.
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
  when their WebSocket disconnects; releases are global per pad, so releasing a
  pad from one client also releases any voices currently sounding on that pad
  from another client.

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
