# TODO: a higher-quality stock P1S simulator

Created: 2026-10-05. Last updated: 2026-10-05. Status: continuous linear planning and uncalibrated audio audition implemented and tested; M0/M1/M2 remain partial. No hardware validation or acoustic calibration.

## Goal and scope

Predict the timing and audible output of GCODE on an **unmodified Bambu Lab P1S**, well enough to decide whether a feedrate edit will produce a recognizable melody during a real print. Success means agreement with held-out recordings, not merely a pleasing synthetic WAV.

The simulator runs offline on a computer; the deployment target for its eventual GCODE output is the stock P1S. No custom firmware, root access, external motor drivers, attached speakers, or disabled thermal/motion protections. External microphones and optional video are measurement equipment, not printer modifications. Hardware experiments require human review, setup, and execution; this roadmap does not authorize printer operations.

Initial validation scope: a single-material print with the stock 0.4 mm hotend, normal speed mode, and recorded enclosure/fan settings. Confirm the actual nozzle, firmware, calibration state, and AMS presence rather than inferring them from "stock." Preserve and report AMS/startup commands even before their sounds are modeled. Other configurations are explicit profiles, not silent variations.

**First milestone:** trustworthy GCODE interpretation and a unit-correct, inspectable motion timeline. Do not start by adding richer tones to the current timing model.

## P1S facts and modeling limits

- The P1 series uses CoreXY, with advertised maximum toolhead speed of 500 mm/s and acceleration up to 20,000 mm/s². These are product ceilings, not the speed or acceleration of every move. Bambu also documents XY vibration compensation and pressure advance. [Official product information](https://bambulab.com/en/p1).
- The pinned [official P1S 0.4 profile](https://github.com/bambulab/BambuStudio/blob/da8b44ee34dd349f2ae0df3f1cbae366df482354/resources/profiles/BBL/machine/Bambu%20Lab%20P1S%200.4%20nozzle.json) contains distinct XY/Z/E speed and acceleration limits. Resolve profile inheritance, includes, and mode/variant arrays; do not copy a generic X1/P1P profile or treat every array entry as interchangeable. Runtime commands can change requested settings. The bundled [data/Bench.gcode](data/Bench.gcode) identifies itself as P1S and includes explicit motion limits.
- P1 firmware 01.05.00.00 introduced motor noise cancellation and requires a motor noise calibration to use it. Record firmware and calibration state; do not assume raw step pulses are what a stock, calibrated printer sounds like. [Official P1 firmware history](https://wiki.bambulab.com/en/p1/manual/p1p-firmware-release-history).
- The P1S enclosure and cooling system are part of the acoustic target. Part, auxiliary, chamber, hotend, and control-board cooling must not be collapsed into a single background tone. The [official writer](https://github.com/bambulab/BambuStudio/blob/da8b44ee34dd349f2ae0df3f1cbae366df482354/src/libslic3r/GCodeWriter.cpp) emits ordinary part-fan commands, P2 for the additional fan, and P3 for exhaust. Verify explicit P1/default-fan equivalence for the selected dialect; do not mistake it for the thermostatic hotend fan. The local print's startup comments separately identify hotend and board cooling.
- Public slicer profiles and source describe slicer behavior, **not an exact stock-firmware implementation**. Planner details, driver waveforms, compensation filters, motor-to-sound coupling, and some proprietary commands remain uncertain. Do not import Klipper-only settings such as `accel_to_decel` as verified P1S behavior.
- Printable area is not the complete service-motion envelope: the bundled print contains wiping/purging moves outside the usual bed rectangle. Distinguish print, service, and unknown motion; neither clamp these paths nor declare every service move safe.

Upstream code references are pinned to BambuStudio commit `da8b44ee34dd349f2ae0df3f1cbae366df482354`, consulted on 2026-10-05. This is research provenance, not a claim that it matches the user's installed Studio. Resolve the actual slicer version separately.

## Current baseline and recent progress

### What has been completed or substantially advanced

- **Lossless source parsing** ([gcode_source.py](gcode_source.py)): Every physical line is recorded with source spans, token positions, and comment handling. Lexical numbers are not modal state.
- **Versioned timing parameters** ([models.py](models.py)): TimingParams enforces `schema_version: 2` and `acceleration_units: mm/s^2`. Legacy unversioned JSON is rejected; do not relabel or silently fit old scales.
- **Command classification and state tracking** ([motion_timeline.py](motion_timeline.py)): Execution context distinguishes unknown/known state; XYZ and E modes are independent (G90/G91 ≠ M82/M83).
- **Python 3.12.3 isolated environment** with pinned dependencies: `numpy==2.5.3`, `mido==1.3.3`, `pytest==9.1.1`.
- **Validation:** all 31 original tests passed before changes; the independently rerun suite now passes 561 cases, including parametrized input validation. Regression tests cover the reproduced state/timing/writer failures, continuous planning and streaming audio. A reviewer-found leading-comment feedrate-insertion bug was reproduced and fixed.
- **Continuous motion** ([motion_planner.py](motion_planner.py)): forward/backward lookahead, nonzero entry/exit-speed profiles, theoretical per-axis/E limits, classic velocity-jump corners and signed A/B/Z/E trajectories. Collinear split invariance and deliberate stops are tested. These are analytic model tests, not firmware validation.
- **Listenable preview** ([audio_preview.html](audio_preview.html)): 23.79-second authored demo, motors-only/mix/fans-only WAVs and seven stems. [motor_audio.py](motor_audio.py) streams fixed-gain, phase-continuous voices and illustrative seeded fan noise; [preview_audio.py](preview_audio.py) records source hashes, context, configuration and clipping. Parent checks verified WAV headers/hashes, no clipping, fixed-gain mix consistency and eight intended scale pitches. Pitch agreement is with the toy profile, not a recording.
- **Diagnostic CLI:** `timeline` emits source-hashed JSON with explicit context, timing parameters, events, and whole-file support coverage. Incomplete prediction returns nonzero but writes its report. Legacy commands now use the corrected source/timing implementation and reject unsupported execution rather than skipping it.
- **Historical baseline:** [data/legacy_simulator_baseline.json](data/legacy_simulator_baseline.json) records old fixture timing and five-second WAV fingerprints. The synthetic 100 mm move at 100 mm/s and 1000 mm/s² changed from an erroneous 37.947 seconds to the analytic 1.1 seconds.

### Known limitations (work carried forward from old model)

| Area | Present behavior | Consequence |
| --- | --- | --- |
| [gcode_analyzer.py](gcode_analyzer.py) adapter | Zero/relative coordinates, feedrate persistence and waits now use the corrected timeline; legacy adapter explicitly assumes an initial origin | Full P1S startup still cannot be interpreted; use the diagnostic timeline to inspect support |
| [motion_timeline.py](motion_timeline.py) / [models.py](models.py) | Diagnostic/legacy timing remains rest-to-rest; the new preview uses [motion_planner.py](motion_planner.py) | Legacy timing and continuous-preview timing are intentionally different |
| [gcode_analyzer.py](gcode_analyzer.py) (legacy) | Total feedrate maps linearly to one frequency | No CoreXY motor separation, speed ramps, or axis-specific acoustics |
| [audio_simulator.py](audio_simulator.py) | One sine per segment, reset phase, per-file peak normalization | Unphysical timbre/transitions, lost loudness comparisons across files |
| [gcode_writer.py](gcode_writer.py) | Lossless no-op and source-preserving F edits with modal restoration | Files with unsupported execution can round-trip unchanged, but edits are rejected |
| [scripts/generate_instrument_gcode.py](scripts/generate_instrument_gcode.py) | Manifest covers sweep moves only; constant-speed estimates | Existing "ground truth" is commanded geometry, not measured timing |
| [midi_io.py](midi_io.py) | Fixed ticks-per-second loading | Tempo changes and overlapping notes not handled correctly |

The old feedrate-to-frequency model and sine renderer remain on the legacy commands, separate from the new preview. The parser, writer, and movement adapter now use the new source/timeline implementation; the known data-loss and unit bugs are not retained as a compatibility mode. The authored audio demo is offline-only and must not be sent to a printer.

## Work order and release gates

| Priority | Milestone | Depends on | Actual/current status | Completion gate |
| --- | --- | --- | --- | --- |
| P0 | M0: reproducible baseline | Nothing | Partial: suite, dependencies, regressions and historical baselines done; provenance audit remains | Full suite runs; old-model outputs and known failures recorded |
| P0 | M1: faithful input and machine state | M0 | Linear-motion slice implemented; stock dialect validation and broader execution support remain | Lossless no-op round trip; explicit unsupported-command handling; state tests verified offline |
| P0 | M2: motion timeline and CoreXY kinematics | M1 | Continuous linear lookahead/CoreXY and reference limits implemented; runtime limit forms and stock validation remain | Analytic timing tests; CoreXY motor trajectory tests; no fabricated timing |
| P1 | M3: stock-P1S measurement corpus | M1 safety review | One user-recorded PETG square ingested; recording metadata/repeats/splits incomplete | Repeatable recordings with locked train/validation/test splits |
| P1 | M4: calibrated acoustic renderer | M2 + training portion of M3 | Uncalibrated streaming prototype implemented; measured calibration not started | Motor/fan stems beat old model on validation metrics |
| P1 | M5: independent validation and usable reports | M3 + M4 | Exploratory single-capture report exists; independent validation not started | Acceptance targets met within declared support envelope |
| P2 | M6: reconnect melody optimization | M5 + writer gates | Not started | Proposed edits re-simulated and independently checked |

## Detailed status and next actions

### M0 — Reproducible baseline (PARTIAL)

**Completed:**
- [x] Create isolated Python 3.12.3 environment with pinned dependencies ([requirements-dev.txt](requirements-dev.txt)).
- [x] Declare supported Python versions explicitly (3.12 only; other versions untested).
- [x] Separate runtime/test dependencies ([requirements.txt](requirements.txt), [requirements-dev.txt](requirements-dev.txt)). No analysis packages needed for this slice.
- [x] Capture old-model baseline artifacts ([data/legacy_simulator_baseline.json](data/legacy_simulator_baseline.json) for regression reference).

**Test/baseline progress and remaining work:**
- [x] Run full pytest suite and inventory actual test failures (31 original tests passed; new regressions demonstrated missing behavior).
- [x] Record old-model timings and five-second WAV fingerprints for calibration and Bench inputs, plus the synthetic timing failure. Temporary WAVs were discarded; hashes are historical comparisons, not test expectations.
- [ ] Verify [data/Bench.gcode](data/Bench.gcode) against its embedded settings (firmware, profile version, material, AMS state).
- [x] Add regression tests for known data-loss cases: zero-valued coordinates, feedrate-only commands, relative XYZ/E, `G92`, dwells, dropped `T` commands.
- [ ] Inventory existing recordings and plots; verify against input GCODE hashes and metadata. Label exploratory material.

### M1 — Preserve input and interpret machine state (LINEAR SLICE IMPLEMENTED)

Primary work: [gcode_source.py](gcode_source.py), [motion_timeline.py](motion_timeline.py), [models.py](models.py), [gcode_writer.py](gcode_writer.py) (new version, not legacy).

**Completed/in progress:**
- [x] Lossless source records: [gcode_source.py](gcode_source.py) preserves every physical line, source spans, comments.
- [x] Execution context API: known/unknown state tracking; XYZ/E mode independence.
- [x] Versioned timing params: schema v2, mm/s² units enforced; legacy config rejected.

**M1 tasks to complete:**
- [x] Modal state machine: track G90/G91, M82/M83, G21/G20, coordinate offsets (G92), and modal F. Interaction tests cover the declared independent-XYZ/E approximation; stock firmware equivalence is not established.
- [x] Feedrate persistence: F-only/zero-distance commands update modal state; E-only movement consumes time without adding Cartesian distance.
- [x] Byte-identical no-op output, including comments, unknown commands, mixed line endings and undecodable comment bytes. Targeted F edits restore modal F before unedited moves; reject malformed/numbered/checksummed or unsupported files before opening output.
- [x] Source-linked events represent XYZ, E-only, retraction, explicit waits, fan/temperature commands and synchronization. Thermal/acoustic effects are explicitly unmodeled.
- [x] Internal mm/seconds/mm-per-second/mm-per-s². Source lexical F remains in source units; interpretation normalizes it to mm/min and derives requested mm/s. Versioned timing JSON rejects old units/scales.
- [ ] Opcode inventory: scan [data/Bench.gcode](data/Bench.gcode) for every opcode/form; classify as modeled, irrelevant, unsupported, or external. (Example: Bench halts at unsupported M201; not usable for full-file simulation yet.)
- [x] Known G4/M400 waits are separate from queue-drain events. Unsupported waits, conditionals, homing, AMS and other opaque operations stop prediction; subsequent times/positions remain unknown, with whole-file support classification retained.
- [ ] Add externally supplied conditional flags and measured duration/state recovery anchors. The current conservative stop cannot resolve or resume after these operations.
- [x] Reject G2/G3 arcs with a clear unsupported-command report; no silent truncation to linear moves.
- [ ] Test mode interaction: document which dialect assumptions are tested and which remain approximations (e.g., firmware-specific conditional behavior not verified on stock P1S).
- [ ] Add the arcs/helical forms emitted by the pinned slicer when needed; bound tessellation geometry/timing error without rewriting source arcs for convenience.
- [x] Unknown opcode/forms, including M300 and conditional operations, stop prediction rather than silently running both branches or fabricating time.

**Acceptance examples implemented and tested:**
- X10 then X0 travels 20 mm; two relative X10 moves travel 20 mm (XYZ mode tests)
- Feedrate-only command (G1 F600 with no XYZ) affects next move (modal F)
- Ten-second dwell adds exactly 10 seconds to timeline
- G92 changes coordinates without motion
- Tool command survives no-op round trip
- File with unsupported M201 is rejected for edits but preserves source bytes on no-op output

### M2 — Motion timeline and CoreXY kinematics (CONTINUOUS LINEAR SLICE IMPLEMENTED)

- [x] Source + explicit context + versioned timing parameters produce a JSON-ready timeline and diagnostics. The CLI records source hashes and coverage; this is not yet a machine-profile/continuous-trajectory interface.
- [x] Unit-correct analytic rest-to-rest triangle/trapezoid durations, explicit constant-speed mode, and unknown-wait stopping. Time scaling affects motion only; explicit waits retain their seconds.
- [ ] Version the machine-profile input contract. `plan_motion(source, context, config)` now returns trajectories/events/diagnostics, but `PlannerConfig` is not a versioned stock machine profile.
- [ ] Complete machine-limit/runtime-override support (M201/M203/M205). The planner currently applies explicit reference Cartesian/E limits and honors M204 S; unsupported forms fail rather than being skipped.
- [x] Triangular/trapezoidal acceleration profiles with entry/exit speeds and whole-run lookahead. Tests include 10,000 irregular collinear segments without artificial stops.
- [x] CoreXY motor coordinates: `a = x + y`, `b = x - y`, cumulative signed belt displacement from simulation start; optional AB limits distinct from Cartesian limits.
- [ ] Measure step-to-mm and audible-cycle relationships; the renderer's acoustic cycles/mm are assumptions, not step calibration.
- [x] Separate Z and E trajectories, including E-only moves/retractions and coordinated extrusion limits.
- [ ] Track pressure-advance/vibration-compensation state; neither behavior is simulated yet.
- [ ] Keep local motion time and wall-clock time distinct. Handle unknown-duration waits without fabricating durations.
- [x] Analytic tests: straight moves, reversals, corners, mixed XYZ/E, retractions, deliberate stops and sample continuity. Arcs remain explicitly unsupported.

**Acceptance (analytic only, no hardware validation yet):**
- 100 mm rest-to-rest move at 100 mm/s with 1000 mm/s² acceleration: 1.1 seconds
- Pure X and Y drive CoreXY motors with expected sign separation; 45° diagonals leave one coordinate stationary
- Integrated trajectories recover commanded displacement within numerical tolerance

### M3 — Stock-P1S measurement corpus (FIRST EXPLORATORY CAPTURE)

The [2026-10-05 PETG-square bundle](data/recordings/petg_square_2026-10-05/REPORT.md) preserves one 57.07-second mono AAC recording, matching sliced/project archives and full GCODE. The user confirmed complete square coverage, calibration procedures removed by trimming only the ends, Standard/100% mode, and Voice Memos with Skip Silence off. The phone was wedged in the otherwise closed enclosure via the top hatch; contact vibration and altered enclosure acoustics are possible, not measured. Firmware, gain/AGC/enhancement, precise microphone geometry and actual calibration state remain unknown. Rough user estimates (border ~12 s, infill ~15 s, end ~43 s) were supplied after the candidate alignment and are not independent measured landmarks. Reproducible single-offset analysis remains unchanged at +12.15 s; outer-wall agreement is weak. No pitch fitting, time warping, calibrated gain or default-model changes were made. The independently rerun suite passes 592 cases. This capture is exploratory data, not a held-out test or completion of the corpus gate.

This is the first human/hardware checkpoint. Prepare offline first; do not run existing sweep generator unchanged.

- [ ] Record exact printer state: firmware, Studio version/profile, nozzle, material, AMS, speed mode, calibration history, plate, enclosure/fan settings, microphone position/gain/sample rate.
- [ ] Build complete commanded-event manifest (homing, positioning, sweeps, returns, pauses, landmarks). Separate commanded from measured values.
- [ ] Review jobs for safety: homing, clearance, thermal state, cooling/protection enabled.
- [ ] Validate both upper/lower bounds and distinguish printable, service and unknown motion areas. Do not clamp service paths to the bed rectangle. Respect per-drive limits; never extrude cold or disable required cooling/protections. No candidate job runs until the human operator reviews it.
- [ ] Collect conservative repeated sweeps: XY lines (both directions), diagonals, multiple positions/speeds/accelerations, corners, short-move sequences. Exclude Z/E until separately approved.
- [ ] Measure background noise: part/auxiliary/chamber fans, hotend/board fans independently where safe.
- [ ] Include stock-sliced prints with extrusion and fans active (not quiet sweeps alone).
- [ ] Use fixed-gain lossless audio; record AGC/noise-reduction settings.
- [ ] Preserve raw recordings and use measured audio/video landmarks, not assumed internal step telemetry. Flag uncontrolled gain as unsuitable for absolute loudness fitting. Do not change stock firmware or disable compensation to improve fit.
- [ ] Separate startup/calibration sequences from steady-print intervals.
- [ ] Fit one alignment per recording; avoid time-warping that hides motion errors.
- [ ] Reserve unseen speed/direction combinations and ≥1 print for held-out testing. Collect repeats to measure evaluation noise floor.
- [ ] Split by complete recording/job, never adjacent windows. Separate clock offset/drift from planner error and publish alignment parameters.

### M4 — Calibrated acoustic renderer (UNCALIBRATED PROTOTYPE ONLY)

The [PETG acoustic candidate report](data/recordings/petg_square_2026-10-05/acoustic_candidates/REPORT.md) now compares 2.5/5/8 cycles/mm using synthesized acceleration-aware A-only fundamental spectra at two window sizes. At the unchanged +12.15 s offset, bottom-region actual-minus-circular-control-mean contrast favors 5 (+2.943/+2.220 arbitrary dB) over 2.5 (+1.044/+0.824) and 8 (-0.646/-0.233). These are same-capture diagnostics, not significance or calibrated pitch accuracy; fundamental/harmonic and source-attribution ambiguity remain. Separate full-voice audition WAVs preserve gain and timing, and 8 remains byte-identical to the original baseline. No defaults changed. Browser checks verified decoded PCM recording playback, candidate loading, programmatic landmark seeking and exclusive playback; pointer interaction was blocked by the hidden browser tab. The independently rerun suite passes 647 tests. Next: distinguish moving components from motion-excited fixed resonances, then evaluate on independent data before promoting a profile.

- [x] Add simultaneous CoreXY A/B, Z, E sources driven by continuous trajectories on the new preview path. Legacy commands remain unchanged.
- [ ] Measured harmonic/resonance model per drive (step rate, velocity, acceleration, direction, position dependencies).
- [ ] Distinguish motor rotation/step rates, audible fundamentals and harmonics; permit missing/weak fundamentals and include broadband energy. Fit added complexity only where it improves held-out prediction.
- [x] Continuous signed-displacement phase across motion; no phase reset per G1. Direction reversal runs phase backward; pitch magnitude follows absolute motor speed.
- [ ] Measure part/auxiliary/chamber command-to-response curves, spin-up/down and duty vs. RPM. The prototype has illustrative first-order responses for three fan sources only; default/P1 aliasing and acoustics remain assumptions.
- [ ] Include hotend/control-board fan backgrounds and uncertainty; do not assume every fan is independently controllable. Preserve stock cooling behavior.
- [ ] Fit enclosure/microphone response and stock compensation empirically.
- [ ] Calibrate output gain. Fixed-gain A/B/Z/E/fans/motors/mix stems exist, without per-file normalization or measured SPL.
- [ ] Optional listening normalization must be labeled and shared across A/B outputs. Do not report dB SPL without a calibrated recording chain; initial acoustic scope is one documented microphone position, not full room/structural simulation.
- [x] Streaming output in bounded chunks; reproducible noise; harmonics tapered out below Nyquist. No measured resonance or compensation model.
- [x] Test empty/all-wait input, clipping, sample-rate changes, duration truncation and chunk-size invariance with phase/filter/noise state retained. Full source must pass planning even for truncated audio.

### M5 — Independent validation and reports (EXPLORATORY REPORT ONLY)

- [ ] Produce one reproducible report: model/input hashes, support coverage, uncertain intervals, command-to-time mapping, motor traces, fan states, waveform, spectrograms, residuals.
- [ ] Compare against legacy model, motion-only model, and full calibrated mix. Separate timing/pitch/envelope/noise errors.
- [ ] Motor-track scoring: median pitch error ≤25 cents; report octave errors.
- [ ] Report missed tracks, onset/offset error, band-energy/envelope error and multi-resolution log-spectral error. A fan-only fit must not hide missing motor melody. Fix measurement metrics before final held-out testing.
- [ ] Replace unexplained 0.4/0.7 confidence labels with documented scores or measured calibration. Distinguish predicted motor identity from uncertain measured source attribution. Generated MIDI is not acoustic ground truth.
- [ ] MIDI fixes: tempo changes and overlapping notes handled correctly.
- [ ] Blind A/B listening on held-out clips (melody recognizability vs. stock fan noise, not just "sounds like printer").
- [ ] Unit/integration tests and CI. Large recordings in artifact storage with checksums; CI never requires live printer.

**Provisional acceptance targets** (to agree before final evaluation):

| Quantity | Initial target |
| --- | --- |
| Input fidelity | Byte-identical no-op; no silently skipped state/motion commands |
| Known-duration motion | Total error ≤5%; p95 timing error ≤100 ms after one alignment |
| Motor pitch tracking | Median error ≤25 cents; p95 ≤50 cents; report missed/octave errors |
| Envelope | Median absolute error ≤3 dB in fixed 100 ms RMS windows above noise floor; no per-file renormalization |
| Spectral agreement | ≥25% lower log-spectral error than old model on held-out clips |
| Runtime/memory | Render 20-minute 48 kHz mono mix faster than real time, ≤1 GiB peak RSS |

Until targets met, label output **uncalibrated** or **validated only for listed conditions**. Report unknown-time intervals and out-of-calibration inputs separately; do not silently exclude.

### M6 — Reconnect melody optimization (NOT STARTED)

- [ ] Share calibrated simulator across analysis, preview, optimization.
- [ ] Score pitch/rhythm/harmonics/audibility together; re-simulate after edits.
- [ ] Select non-overlapping complete regions; report infeasible notes.
- [ ] Constrain relative to original speed and stock limits; preserve XYZ/E paths; protect startup/purge/retract/unknown regions.
- [ ] Re-simulate affected planner neighborhoods after edits, including adjacent moves changed by lookahead; pitch and duration are coupled by path length. Include volumetric-flow constraints and protection of service/unknown operations. Geometry preservation alone is not a print-quality guarantee.
- [ ] Independently re-parse and re-validate edited output.
- [ ] Human review and conservative A/B trials before deployment.

## Recommended next implementation steps

The offline foundation now includes a tested, source-linked interpreter, continuous linear-motion planner, byte-identical no-op writing and listenable fixed-gain motor/fan previews. It is an approximation, not a stock-P1S firmware emulator. Audition the [demo](audio_preview.html) before adding timbral complexity.

1. Use the support report to inventory the bundled P1S dialect against its historical slicer settings; add verified motion-limit forms without relaxing conservative unknown-state handling.
2. Prepare the complete recording manifest and human calibration checklist. Audit existing recording provenance; hardware execution remains a separate human checkpoint.
3. Compare the model's timing and motor tracks against suitable recordings before fitting acoustic cycles, harmonics, fan levels or compensation. Listener feedback on the toy scale cannot substitute for measured validation.
4. Add reproducible model-version/trajectory reports and benchmark a full 20-minute render before claiming the runtime/memory gate.

Do not start optimizer rewrites, neural audio, firmware emulation, or high-fidelity visualization before the motion and measurement foundations. Stock-compensated motor/fan acoustics and independent recording validation remain later milestones.
