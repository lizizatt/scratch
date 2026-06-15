# Melody-matching GCODE

**Goal:** Take a complex print GCODE and a set of short single-note melodies. Produce a **new GCODE file** by nudging segments of the print that already “kind of” match a melody so they **fully** match it—**without** disrupting the print (no collisions, stay in build volume, preserve geometry).

Output = **modified GCODE**, not MIDI. Melodies (MIDI or note lists) are the **target spec** only.

---

## Commands

```bash
# Parse GCODE and emit MIDI (for debugging / dry-run)
python cli.py gcode path/to/print.gcode -o out.mid

# Optimize print GCODE to match target melodies (output = modified GCODE)
python cli.py melody-optimize print.gcode melody1.mid melody2.mid -o optimized.gcode --min-score 0.5
```

**Try it with the included melodies:**

```bash
python cli.py melody-optimize data/ground_truth/calibration.gcode data/melodies/*.mid -o out.gcode --min-score 0.3
```

**Simulate audio (A/B test original vs optimized by ear):**

```bash
# Simulate what each GCODE would sound like (same feedrate→frequency model as the pipeline)
python cli.py simulate data/ground_truth/calibration.gcode -o original.wav
python cli.py melody-optimize data/ground_truth/calibration.gcode data/melodies/Major\ Scale_C_1bars_60bpm_no_arpeggios_no_rests_no_chords.mid -o optimized.gcode --min-score 0.3
python cli.py simulate optimized.gcode -o optimized.wav
# Then play original.wav and optimized.wav in any player to compare.
```

---

## Design and small parts

See **MELODY_GCODE_OPTIMIZATION.md** for:

- Problem formulation (variables, objective, constraints)
- High-level procedure (parse → load melodies → find regions → optimize F → write GCODE)
- **Small parts** – table of 7 testable pieces (melody loader, segment→note, similarity, region finder, F-optimizer, GCODE writer, end-to-end) with how to test each

---

## What’s in the repo

| Path | Purpose |
|------|--------|
| `gcode_analyzer.py` | Parse GCODE; segment moves; feedrate → frequency (note). |
| `models.py` | Shared types: `Note`, `GCodeParams`, `TimingParams`. |
| `midi_io.py` | Load notes from MIDI (for loading melodies). |
| `cli.py` | `gcode` (GCODE→MIDI), `melody-optimize` (GCODE + melodies → optimized GCODE). |
| `scripts/generate_instrument_gcode.py` | Generate axis-sweep calibration GCODE + manifest. |
| `data/ground_truth/` | Calibration GCODE, manifest, fixtures for tests. |
| `data/melodies/` | Example target melodies (MIDI; e.g. C major scale 1–4 bars) for testing. |
| `audio_simulator.py` | GCODE segments → WAV (simulate printer audio for A/B testing). |

---

## Tests

```bash
# WSL (recommended)
cd /mnt/c/Users/liz/scratch/gcode_music
pip install pytest mido numpy dataclasses   # once
python -m pytest tests/ -v
```

Or run `python verify.py` for a quick smoke check (requires `data/ground_truth/calibration.gcode` or `data/Bench.gcode`).

---

## Requirements

- Python 3.7+ (or 3.6 + `dataclasses` backport)
- `mido`, `numpy` (see `requirements.txt`)
