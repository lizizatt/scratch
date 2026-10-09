# Miku Sustain

A separate, locally generated variation of the external **Hatsune Miku FNF**
SoundFont. The original is unchanged. No vocal samples or SoundFont binaries
are committed to this repository.

## Select it

The generated asset is `~/Downloads/Hatsune Miku FNF Sustain.sf2` on both the
workstation and Pi. In **Synth**, click **Refresh SoundFonts**, choose **Hatsune Miku
FNF Sustain**, then preset **000-000 Miku Sustain**. No application code change
or restart is needed for discovery.

## Sound changes

- The source's approximately 1.9-second recordings were unlooped.
- All 48 samples now loop a matched vowel region after the attack and before
  the original fade-out. Loop starts are selected between 0.30 and 0.55 seconds;
  loops are approximately 0.35–0.65 seconds long.
- A 40 ms raised-cosine crossfade matches the end to the audio just before the
  loop start. The original attack and audio outside the crossfade are preserved.
- Volume-envelope sustain has no attenuation. A nominal 125 ms release fades
  the sound after note-off. The sample keeps looping during release so it does
  not jump into the original recording's tail.
- Root pitches, tuning, gain, pan, preset bank/program, and key mappings are
  preserved. This is a sustain adjustment, not pitch correction.

The source has 48 samples but maps only MIDI keys 48–94, including two layers
on key 78. These source mapping quirks are intentionally unchanged.

Repeated vowels can sound more static than a natural long vocal take. Offline
checks do not establish perceived timbre or inaudibility of every loop join;
listening acceptance remains necessary, particularly on high notes.

## Rebuild and verify

The generator requires the exact source checksum and refuses to overwrite any
existing destination, including the source. Keep external assets outside git.

```sh
node scripts/miku-sustain.mjs "$HOME/Downloads/Hatsune Miku FNF.sf2" "$HOME/Downloads/Hatsune Miku FNF Sustain.sf2"
node scripts/check-miku-sustain.mjs "$HOME/Downloads/Hatsune Miku FNF Sustain.sf2" artifacts/miku-sustain/sustained --all
```

The checker renders to files using FluidSynth, with chorus/reverb off and gain
0.5. It never opens the speaker output. Every mapped key is held for six
seconds, then released. Checks cover continued level, 100 ms-window dropouts,
clipping, and silence after release. WAV files remain available for listening.
Without `--all`, it checks keys 48, 60, 72, 84, and 94. The original fails those
sustain checks; `--expect-one-shot` explicitly validates its one-shot behavior.

Tests in `tests/miku-sustain.test.ts` also check source immutability, unchanged
attacks and pitch metadata, loop seams, SF2 generator indices, exclusive file
creation, and original-versus-sustained FluidSynth renders. External-asset tests
skip if the source is absent; override its path with
`ALESIS_MIKU_FNF_SOUNDFONT_PATH`.

## Verified asset identities

- Source SHA-256: `96dad7c0f173e5c5a2cb465ce89e0c1b87555c557cce2c1f69ea10f7959404d9`
- Sustain SHA-256: `a0f9c752a65ab39d0289b3371ff5a1879b33e8f748563e62bef4b215d1bb52d8`

On 2026-10-04, all 47 mapped keys passed six-second sustain and release checks
on the workstation. This is not a physical Pi listening test.

Deployed the new asset to the Pi on 2026-10-04. Its SHA-256 matches the identity
above; Pi FluidSynth 2.4.4 loads preset 000-000 Miku Sustain. The running host
accepted a catalog refresh and exposes the new font. The original FNF Miku
selection (0:0) and stopped transport were unchanged. No service restart,
application deployment, or test-note playback was performed.
