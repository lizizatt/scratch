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

## Limits and hardware behavior

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
  from the displayed sample-library status.

The controller setup references are the [Alesis setup guide](https://support.alesis.com/support/solutions/articles/69000865912-alesis-vortex-wireless-2-setup-guide)
and [Vortex Wireless 2 Editor user guide](https://www.alesis.com/rscdn/1856/documents/Vortex%20Wireless%202%20Editor%20-%20User%20Guide%20-%20v1.0.pdf).
No undocumented display-writing SysEx is sent. Configure the pad channel and
notes above in every preset used for navigation; the host cannot distinguish
keys from pads when they send identical MIDI messages.

## Verification

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
