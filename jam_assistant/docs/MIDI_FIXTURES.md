# MIDI fixture library

The fixture source of truth is
[src/fixtures/midi-library.ts](../src/fixtures/midi-library.ts). It defines
chord roots, supported qualities, start beats, durations, and tempo explicitly.

Generate the MIDI files and FluidSynth renders with:

```bash
npm run midi:fixtures
```

Generated outputs live under `tests/fixtures/midi/`:

- `quality-tour.mid`: all seven supported qualities at C, four beats each.
- `four-chord-cycle.mid`: Am, F, C, G progression.
- `seventh-resolution.mid`: Dm7, G7, Cmaj7 resolution.
- `irregular-durations.mid`: fractional and changing chord durations.
- matching `.wav` renders using `soundfont_sm64.sf2` when FluidSynth is
  available;
- `manifest.json`: source definitions, durations, labels, and file names.

The MIDI tests parse the generated files and verify note starts and ends against
the source event definitions. The WAV renders are useful for running the actual
PCM detector over known harmony without relying on a copyrighted recording.

## Pirate reference

The local reference is not copied into the repository. Its recorded metadata is:

- file: `~/Downloads/He's a Pirate.mp3`;
- duration: 90.488163 seconds;
- format: stereo MP3, 44.1 kHz;
- SHA-256: `d3603e7f74c22dcd23d1bcb69b043e2c2933994b99c4fb55103549d8576170d5`.

There is no publicly available authorized score or authoritative chord/timing
transcription for the exact theatrical recording. Public references document
the disputed Klaus Badelt/Hans Zimmer/Geoffrey Zanelli credits and describe the
orchestration, but they do not establish a chord-by-chord oracle. Treat labels
inferred from this MP3 as exploratory annotations, never as acceptance truth.

Useful context sources:

- [He's a Pirate](https://en.wikipedia.org/wiki/He%27s_a_Pirate)
- [Pirates of the Caribbean soundtrack](https://en.wikipedia.org/wiki/Pirates_of_the_Caribbean:_The_Curse_of_the_Black_Pearl_(soundtrack))
- [midi-file package](https://github.com/carter-thaxton/midi-file)
- [FluidSynth](https://www.fluidsynth.org/)

For future alignment, create a separately licensed reference annotation with
section-level labels, align its chroma to the audio using DTW or manual anchors,
and retain a tolerance of roughly half a second at section boundaries. Do not
claim frame-perfect truth for an orchestral recording with expressive timing,
doubling, inversions, and possible arrangement differences.

`ffprobe` may reject these small generated MIDI files even though the standard
`file` utility, `midi-file` parser, and FluidSynth consume them successfully;
MIDI parser acceptance and rendered WAV output are the fixture checks used here.
