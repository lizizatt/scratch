# Melody-matching GCODE

**Goal:** Take a complex print GCODE and target melodies, then produce a **new GCODE file** by adjusting feedrates so matching regions sound like the target melodies—**without** disrupting the print geometry.

Output = **modified GCODE**. Melodies (MIDI or note lists) are the target pitch/rhythm spec.

## First real recording

The [PETG-square comparison](data/recordings/petg_square_2026-10-05/REPORT.md) preserves the user's recording, sliced archive and project byte-for-byte, with hashes and explicit commanded-state assumptions. The user confirmed the entire square was captured, calibration procedures were removed, and Standard/100% mode was used.

The exploratory bottom-surface energy/speed match selects a **+12.15 s** recording offset without time scaling. Outer-wall alignment remains uncertain; this is not a calibrated pitch model or a verified whole-print timing result. See the [comparison plot](data/recordings/petg_square_2026-10-05/comparison.svg), [original recording](data/recordings/petg_square_2026-10-05/raw/New%20Recording%2015%20copy.m4a), and [unchanged-model motor-only baseline](data/recordings/petg_square_2026-10-05/baseline_motor.wav).

[scripts/analyze_petg_square.py](scripts/analyze_petg_square.py) reproduces the analysis using NumPy and a system FFmpeg executable. Its input hashes and offline region boundary are pinned to this capture, not a generic way to skip unsupported startup. The original full input remains unsupported. Do not publish the local recording bundle without permission.

### Experimental acoustic candidates

The [candidate listening page](data/recordings/petg_square_2026-10-05/acoustic_candidates/index.html) compares 2.5, 5 and the original 8 acoustic cycles/mm for A/B. Timing, gains and other voices remain unchanged; fans are omitted, not assumed physically off. The 8-cycle WAV is byte-identical to the preserved baseline. The original recording has a derived PCM16 WAV playback copy because the VS Code browser cannot decode this AAC; conversion does not restore lost detail or normalize loudness. Serve the page with the local HTTP server described below.

[scripts/compare_petg_acoustics.py](scripts/compare_petg_acoustics.py) reproduces the clips and [diagnostic report](data/recordings/petg_square_2026-10-05/acoustic_candidates/REPORT.md). The diagnostic follows a synthesized A-only fundamental through full accelerating FFT windows, at the frozen +12.15 s offset. The 5-cycle candidate scores above 2.5 and 8 at both window sizes, but rates were selected using this same recording; harmonic ambiguity, background sound and phone coupling remain unresolved. These are experimental alternatives, **not a calibrated replacement for the default profile**.

### Full-harmonic follow-up and next real test

The [full-harmonic report](log/petg_harmonics/REPORT.md) compares 12 fixed ABZE
profiles: full, fundamental-only, second-only and upper harmonics at each AB
rate. [Listen to five selected renders](log/petg_harmonics/index.html), including
the original full profiles and the 2.5-second / 5-fundamental ambiguity.

Full 5 still leads the infill contrast, but a synthetic known-rate test shows
that contrast ranking can choose the wrong base rate. The two harmonic
explanations score nearly identically. The user's preference for 2.5 remains
recorded in [LISTENING_NOTES.md](LISTENING_NOTES.md); **no defaults changed**.

[scripts/compare_petg_harmonics.py](scripts/compare_petg_harmonics.py) regenerates
the report and selected WAVs when run with the configured Python environment
from this project. Its default destination is [log/petg_harmonics/](log/petg_harmonics/),
outside the frozen bundle. It checks all archived hashes and preserves bundle
content and modification times. Report mtimes describe the local input snapshot;
fresh checkouts can have different mtimes without different recording bytes.

The next useful measurement is an ordinary square print at two orientations,
with fixed external microphone placement: [NEXT_RECORDING.md](NEXT_RECORDING.md).
No modified music GCODE is ready for a printer yet.

## Setup

Requires Python 3.12 (other versions untested). Create an isolated environment and install:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

[requirements-dev.txt](requirements-dev.txt) includes runtime dependencies (`mido==1.3.3`, `numpy==2.5.3`) and pytest for testing. Run setup commands from this project directory. No live printer is needed for tests.

## Commands

### preview_audio — Continuous motor audio (start here)

Open the [listening page](audio_preview.html) for a 23.79-second audition, or play the [motors-only WAV](log/audio_preview/audio_demo_motors.wav) and [motor/fan mix](log/audio_preview/audio_demo_mix.wav). The page includes synchronized seek landmarks and isolated motor stems. **Uncalibrated synthesis, not a P1S recording or verified stock sound prediction.** Start at low playback volume.

For browser playback and reliable seeking, serve this directory with HTTP byte-range support (requires Node/npm):

```bash
npm exec --yes --package=http-server@14.1.1 -- http-server . -a 127.0.0.1 -p 8766 -c-1
```

Then open <http://127.0.0.1:8766/audio_preview.html>. The VS Code integrated browser may block audio loaded from local file URLs. Python's basic HTTP server loaded the WAVs in Chromium but did not provide working seeking; the pinned server above passed playback and landmark-seek checks. Stop it with Ctrl+C when finished.

Regenerate the page's audio from this project directory:

```bash
python preview_audio.py data/audio_demo.gcode -o log/audio_preview/audio_demo_mix.wav --assume-origin --profile data/audio_preview_profile.json --stems-dir log/audio_preview/stems
python preview_audio.py data/audio_demo.gcode -o log/audio_preview/audio_demo_motors.wav --assume-origin --profile data/audio_preview_profile.json --no-fans
python preview_audio.py data/audio_demo.gcode -o log/audio_preview/audio_demo_fans.wav --assume-origin --profile data/audio_preview_profile.json --no-motors
```

Each render writes a source-hashed JSON sidecar with context, planner limits, acoustic assumptions, duration, peak, clipping count, and WAV hash. All outputs use the same fixed gain, without peak normalization. Optional `--max-duration SEC` truncates audio **after the entire input has passed planning**; it cannot bypass unknown startup or unsupported suffixes. `--context JSON` replaces `--assume-origin`; its fields are described below. Additional options include `--sample-rate`, `--chunk-size`, and `--report`.

The [authored demo](data/audio_demo.gcode) is simulation-only, not a print job: do not send it to hardware. Its C4–C5 scale uses an assumed 8 acoustic cycles/mm for A/B, not measured steps/mm. Fan noise begins around 11.25 seconds. No hardware is accessed. The standalone preview does not change the legacy `simulate` or optimizer paths.

### timeline — Offline motion report with support coverage

```bash
python cli.py timeline INPUT_GCODE [-o REPORT.json] [--assume-origin | --context CONTEXT.json] [--timing-params TIMING.json]
```

Produces a JSON report with:
- Source file hash and byte count
- Whole-file command support coverage (modeled / irrelevant / unsupported counts)
- Timed and untimed events
- Approximation flags (timing certainty, command interpretation limits)
- Optional: downstream (incomplete prediction) intervals with diagnostics

**Example:** Analyze [data/ground_truth/calibration.gcode](data/ground_truth/calibration.gcode) with an assumed origin and uncalibrated timing:

```bash
python cli.py timeline data/ground_truth/calibration.gcode -o report.json \
  --assume-origin --timing-params data/timing_v2.json
```

The output report includes source SHA, coverage summary, and event timeline. Exit code is 0 on complete predictions, 1 if incomplete; incomplete reports are still written. Without `-o`, stdout contains only JSON. Unsupported operations stop evaluation: subsequent times and positions are null, while command-form coverage still covers the entire file.

**State assumptions:** By default, initial position and modes are unknown. Use `--assume-origin` to assume zero XYZ/E position, mm units, and absolute XYZ/E modes. Alternatively, `--context` accepts these fields; omitted fields stay unknown:

| Context field | Meaning |
| --- | --- |
| `initial_xyz_mm` | Three finite physical coordinates in mm |
| `initial_e_mm` | Initial physical extruder coordinate in mm |
| `xyz_mode`, `e_mode` | Independently `absolute` or `relative` |
| `units` | `mm` or `inch` for subsequent source words |
| `feedrate_mm_min` | Positive initial modal feedrate in mm/min |

Physical and logical coordinates initially coincide (zero coordinate offsets). An arbitrary print-body excerpt may require prior state that this context cannot express; do not invent an origin or strip unsupported startup to obtain a complete report. `G92` changes coordinate offsets, not physical position.

**Timing config:** Optional version-2 JSON with acceleration and scale parameters (mm/s² units). Legacy unversioned files are rejected; refit and re-save if migrating from old configs.

### gcode — Parse GCODE and emit MIDI (debug / dry-run)

```bash
python cli.py gcode INPUT_GCODE [-o OUTPUT.mid] [--params FREQ_PARAMS.json]
```

Extract move segments and convert feedrates to frequencies/notes. Output is MIDI for inspection.

**Legacy behavior:** Assumes zero origin, mm units, absolute XYZ/E. Warns that feedrate→frequency mapping is uncalibrated heuristic, not firmware simulation.

### melody-optimize — Modify GCODE to match target melodies

```bash
python cli.py melody-optimize PRINT.gcode MELODY1.mid [MELODY2.mid ...] -o OUTPUT.gcode [--min-score 0.5]
```

Find regions where segments match target melodies (by pitch/duration), then adjust feedrates to improve pitch match.

**Legacy behavior:** Same assumptions and warnings as `gcode` command.

### simulate — GCODE to audio WAV (A/B testing)

```bash
python cli.py simulate INPUT_GCODE [-o OUTPUT.wav] [--max-duration SEC]
```

Simulate printer audio: one sine tone per segment, using feedrate→frequency mapping. Output WAV for listening comparison (legacy heuristic, not firmware-accurate).

## How it works (high-level)

1. **Parse:** [gcode_source.py](gcode_source.py) – Lossless source records; every physical line (including comments).
2. **Timeline:** [motion_timeline.py](motion_timeline.py) – Build commanded motion timeline from parsed source; track timing, position, E, and state changes; mark unsupported opcodes.
3. **Segments:** Divide XYZ motion into runs; analyze each for feedrate/frequency.
4. **Melody matching:** Find print regions that sound like target melodies (slide window, score pitch+duration similarity).
5. **Optimize:** Adjust feedrate in matching regions toward target pitches within the legacy mapping and clamps; rhythm and physical accuracy are not guaranteed.
6. **Write:** [gcode_writer.py](gcode_writer.py) – Reconstruct output GCODE with updated F values, byte-identical elsewhere.

## Implementation notes

**Parsing:** Every physical line is recorded, including comments and blanks. Source spans track decoded text positions. Tokens separate opcode/parameters from source bytes.

**Motion timeline:** Independent XYZ and E modes (G90/G91 ≠ M82/M83). The diagnostic timeline and legacy adapter retain rest-to-rest timing with configurable acceleration (default 10,000 mm/s²).

**Continuous planning:** [motion_planner.py](motion_planner.py) consumes the same interpreter, rejects incomplete inputs, and adds whole-run lookahead, entry/exit-speed acceleration phases, per-axis/E limits, and signed CoreXY trajectories (`A = X + Y`, `B = X - Y`). Collinear segments retain motion; waits and reversals stop. `M204 S` is honored. Classic velocity-jump corner limits are a theoretical P1S-reference approximation, not verified firmware behavior. Z and E are independent voices; optional A/B belt limits are separate from Cartesian limits.

**Audio preview:** [motor_audio.py](motor_audio.py) streams simultaneous A/B/Z/E voices using signed-displacement phase, assumed acoustic cycles/mm, harmonic tapering below Nyquist, and fixed gain. Illustrative fans have seeded noise and spin-up/down; default/P1 aliasing and fan acoustics are assumptions. All fans start off; no hotend/board fan or measured stock compensation is modeled. [data/audio_preview_profile.json](data/audio_preview_profile.json) requires schema 1 and `calibrated: false`.

**Legacy simulation:** One sine per segment, phase reset on every note; XYZ only, per-file peak normalization, linear feedrate→frequency mapping. The legacy optimizer still uses this heuristic, not the continuous renderer.

**Writer:** A no-op write is byte-identical, even for unsupported source. Requested F edits preserve other source bytes, with additional F words where needed to restore modal speed before unedited moves (including extrusion-only moves). Edits reject unsupported/malformed or numbered/checksummed source. CLI output paths cannot alias input/configuration files.

**Config:** `TimingParams` JSON requires `schema_version: 2` and `acceleration_units: mm/s^2`. Use [data/timing_v2.json](data/timing_v2.json) as an uncalibrated example. Unversioned legacy JSON is rejected: refit old parameters, not merely relabel them. Non-null `max_acceleration` and `accel_distance_threshold` settings are rejected. `mode` can be `rest_to_rest` (default) or `constant_speed`; `time_scale` scales motion only, not explicit waits, and `time_offset` shifts timestamps.

## Known limitations and approximations

- **Full Bench print halts at unsupported M201** (motion limit override). Not suitable for full-file simulation yet.
- **Parser counts every source line** (logical line ≠ executed instruction; comments have records).
- **No print-safety guarantee:** preserving geometry does not establish safe motion, extrusion flow, or print quality. All hardware trials need human review and execution.
- **XYZ/E modes are independent** and not verified against P1S firmware behavior.
- **Continuous preview is still approximate:** no verified stock lookahead, pressure advance, vibration/noise compensation, or measured acoustic response. Dynamic M201/M203/M205 remain unsupported. The diagnostic `timeline` and legacy paths still use per-move timing rather than continuous planning.
- **Internal acceleration is mm/s²;** old timing JSON is rejected. GCODE units are interpreted according to the declared dialect, not inferred from old fitted values.
- **Initial state unknown by default;** position and modes must be supplied or assumed explicitly.

See [SIMULATOR_TODO.md](SIMULATOR_TODO.md) for the full roadmap, milestones M0–M6, and validation strategy toward stock P1S calibration.

## Files and directories

| Path | Purpose |
|------|--------|
| [gcode_source.py](gcode_source.py) | Lossless GCODE parsing (tokens, source spans, comments). |
| [motion_timeline.py](motion_timeline.py) | Build commanded motion timeline; track state, timing, support. |
| [motion_planner.py](motion_planner.py) | Continuous linear lookahead and signed A/B/Z/E trajectories. |
| [motor_audio.py](motor_audio.py) | Streaming, fixed-gain, uncalibrated motor/fan synthesis and stems. |
| [preview_audio.py](preview_audio.py) | Standalone audio-preview CLI and provenance sidecars. |
| [audio_preview.html](audio_preview.html) | Local listening page for generated demo WAVs. |
| [models.py](models.py) | Shared types: `Note`, `GCodeParams`, `TimingParams`; `ExecutionContext` lives in the motion timeline module. |
| [cli.py](cli.py) | Command-line interface (timeline, gcode, melody-optimize, simulate). |
| [gcode_analyzer.py](gcode_analyzer.py) | Legacy segment/frequency analysis (uncalibrated heuristic). |
| [gcode_writer.py](gcode_writer.py) | Emit modified GCODE with F updates. |
| [audio_simulator.py](audio_simulator.py) | Segment timing → WAV audio (sine-per-segment preview). |
| [data/timing_v2.json](data/timing_v2.json) | Version-2 timing config (acceleration, scale). |
| [data/legacy_simulator_baseline.json](data/legacy_simulator_baseline.json) | Baseline audio/timing from old model for regression comparison. |
| [data/ground_truth/calibration.gcode](data/ground_truth/calibration.gcode) | Axis-sweep fixture for calibration. |
| [data/melodies/](data/melodies/) | Example target melodies (MIDI). |

## Testing

```bash
python -m pytest tests/ -v
```

Pytest runner validates all components. Full suite requires numpy, mido, pytest, and FFmpeg for the recording-comparison integration tests. Those tests use the preserved local recording bundle; no live printer is required.

## References

- [SIMULATOR_TODO.md](SIMULATOR_TODO.md) — Stock P1S simulator roadmap and milestones M0–M6 (validation, motion timeline, acoustic rendering).
- [MELODY_GCODE_OPTIMIZATION.md](MELODY_GCODE_OPTIMIZATION.md) — Problem formulation, procedure, and testable "small parts".
