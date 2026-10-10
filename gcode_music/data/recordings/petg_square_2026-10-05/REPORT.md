# First PETG-square recording comparison — 2026-10-05

Exploratory offline comparison of one AAC capture. **Not calibrated.** No printer
was contacted, no executable body snippet was produced, and the default audio
profile was not modified. Audio was decoded for numerical analysis only; no
transcription was performed.

## Numerical findings

- Decoded recording: **57.066667 s**, mono 48000 Hz.
- Nominal selected region: **157 moves**, **31.082142 s**.
- Best positive 400–800 Hz high-pass energy/speed correlation: **r = 0.683172**
  at **+12.15 s**: recording time = local plan time + offset.
- No time scaling (factor 1). Search: 2599 offsets, 0–25.98 s in 0.01 s steps.
- Implied nominal interval on recording clock: **12.15–43.232142 s**;
  this is not a verified start/end of the physical square.
- Header [source line 3](source/plate_1.full.gcode#L3): **48 s model / 485 s total**.
  Those scopes differ from this selected region; **do not call the difference a 35% timing error**.

- 200-400 Hz: r = **0.5411** at the primary-band offset.
- 400-800 Hz: r = **0.6832** at the primary-band offset.
- 800-1600 Hz: r = **0.5812** at the primary-band offset.

### Fixed-offset segment checks (primary band)

| Nominal interval | Local seconds (half-open) | Pearson r |
|---|---:|---:|
| outer_wall | 0.000–2.308 | -0.1823 |
| bottom_third_1 | 2.540–12.027 | 0.6311 |
| bottom_third_2 | 12.027–21.513 | 0.7483 |
| bottom_third_3 | 21.513–31.000 | 0.7920 |

### Independent half searches: an ambiguity check, not validation

- first_half: independent peak offset **12.15 s**, r = **0.5670**.
- second_half: independent peak offset **12.16 s**, r = **0.7812**.

The halves search the same full-plan-overlap offset range independently. Different
peaks expose local ambiguity. All intervals reuse this capture and none are
scientifically held out. The outer wall is particularly an extrapolation of the
global alignment. Correlation and a scan maximum are not proof of motor causation
or a uniquely identified physical timing relationship. The 0.2 rejection gate is
only an engineering guard, not a significance threshold corrected for searching.

## Method and scope

STFT: symmetric Hann (`numpy.hanning`), 4096 samples, 480-sample hop,
**11.71875 Hz bin spacing**, **85.3333 ms windows**.
Centers are `(start_sample + N/2)/rate`; only full windows within the nominal
plan are compared. Power is summed squared FFT magnitude in half-open bands
200–400, 400–800, and 800–1600 Hz, then `10*log10(power + 1e-20)`.
These are arbitrary digital dB, not measured SPL or calibrated dBFS.
High-pass subtraction uses a centered 101-point (1.01 s) mean with edge padding,
separately over the full recording series and nominal speed series before subsetting.
Speed is sampled once as `max(abs(A), abs(B))` from `sample_motion` on the STFT
center grid. Integer shifts avoid repeated planning/sampling and preserve the
same center semantics without interpolation or time warping.

[Full extracted GCODE](source/plate_1.full.gcode) is byte-identical, SHA256
`a6b6672d7b24047743dc6e80b04011d6465aa6f31688c91f6475e4df4e55ecff`. The embedded MD5 is checked case-insensitively. Offline planning
uses original physical records **820–1076 inclusive**, including every comment and
state command. Excluded: **1–819** (header/startup, calibration/conditional and other
unsupported operations, travel/prime to boundary) and **1077–1136**
(detector/custom/end sequence). No unsupported-op filtering is performed.
The original full input is still rejected by the planner as incomplete; its
refusal is recorded in the manifest. This artifact is not a runnable print file.

The explicit `ExecutionContext` is XYZ `(141.762, 140.776, 0.2)`, E `0`, absolute
XYZ, relative E, mm, F `1800`. Exact supporting statements: [G90/G21/M83](source/plate_1.full.gcode#L788-L790)
and [XYZ/Z/E/F boundary](source/plate_1.full.gcode#L817-L819).
Default limits match [M201/M203/M205](source/plate_1.full.gcode#L505-L508).
Initial acceleration is 6000 from [M204](source/plate_1.full.gcode#L802), with
[M204 S500](source/plate_1.full.gcode#L823) before the first XYZ motion.

## Provenance and limitations

The user reported that the entire square was captured, calibration procedures
were removed, and speed mode was Standard 100%. These are **user confirmations,
not independently verified capture or firmware facts**. Source settings, user
reports, model assumptions and exploratory inferences are separate in the JSON.

The user further confirmed **only the ends were trimmed**, with no internal cuts,
and Voice Memos **Skip Silence was off**. The phone was **wedged in the otherwise
closed enclosure via the top hatch**. Enhancement/AGC settings and exact microphone
geometry remain unknown; do not infer that all processing was disabled or that
the enclosure was fully sealed.

Approximate user recollections on the supplied recording clock: **border ~12 s,
infill ~15 s, print end ~43 s**. The user explicitly has no solid timing; no
uncertainty interval is assigned. These estimates were supplied after the
candidate alignment was shared, are not used in the numerical search, and do not
resolve the weak outer-wall correlation or establish subsecond timing accuracy.

- Commanded XYZ boundary is nominal; mesh, trim and physical position are unknown.
- E starts at arbitrary zero because the sourced extrusion mode is relative.
- Planner assumes rest at the selected region boundaries; preceding/following motion is excluded.
- Default PlannerConfig limits match sourced M201/M203/M205; only initial acceleration is overridden to 6000.
- M204 S500 at line 823 supersedes that initial acceleration before the first XYZ move.
- No physical pressure-advance, vibration/noise-compensation, or firmware planner state is established.
- One constant exploratory offset, no time warping or speed rescaling; not a measured print start.
- Outer-wall alignment is extrapolated from a globally selected offset, not independently validated.
- Phone placement is user-described, not geometrically measured; hatch contact may couple vibration and the opening may alter enclosure acoustics.
- Voice Memos Skip Silence was off and only ends were trimmed per user; gain/AGC, enhancement and other processing remain unknown. AAC is lossy.
- Approximate user timing estimates are consistent with the candidate alignment but were supplied after it was shared; they are not independent timing validation.
- No measured SPL, fan/motor identification, acoustic calibration, physical validation or safety guarantee.
- Complete square capture is only the user report, not a guarantee established by this analysis.
- Fans are excluded from the baseline, not assumed physically off: P3 S180 at line 784, part/aux S0 at 800/801; hotend/board state unknown.

No detailed stationary-peak attribution is attempted. Spectral activity alone
cannot distinguish motors, fans, resonances, environment or microphone processing.

## Artifacts and reproduction

- [Manifest](manifest.json): hashes, confirmations, exact source statements,
  planner/context/profile values, source module hashes, Python/NumPy and FFmpeg version.
- [Analysis](analysis.json): complete offset score curve, band series, sampled
  speed, segment/half checks and numerical method parameters.
- [Comparison SVG](comparison.svg): observed band energy and aligned speed on the
  recording clock; separate panel scales, not calibrated amplitudes.
- [Motor-only baseline WAV](baseline_motor.wav): `render_audio`, unchanged default
  `AudioProfile`, `motors=True`, `fans=False`; illustrative, not printer prediction.
  The renderer’s generic zero-initial-fan assumption does not describe this capture.
  Startup P3 is nonzero and hotend/board state is unknown, so no fan bed is rendered.

Preserved original inputs:
- [New Recording 15 copy.m4a](raw/New%20Recording%2015%20copy.m4a) — SHA256 `756f714ab89ca307a4aa536bc497625dddb75c384fb30130ea89dda20c360d4e`
- [gcode_to_music_square.gcode.3mf](raw/gcode_to_music_square.gcode.3mf) — SHA256 `ab21c24824e63a957d24e478689b6e9933ff7f3aa724642533bce97d589cacde`
- [gcode_to_music_square.3mf](raw/gcode_to_music_square.3mf) — SHA256 `8b24568844a1ad3f972ed1904f3b910cc2139325184ad8839d84290f725808bc`

From the project root, with NumPy and FFmpeg available, run
`python scripts/analyze_petg_square.py --input-dir "$HOME/Downloads" --output-dir data/recordings/petg_square_2026-10-05`.
The generator is pinned to these inputs, checks source/boundary/path integrity
before writes, retains matching raw copies and refuses mismatches. It can also
read a separately located copy of the three preserved raw inputs. It never
writes to the input directory. No upload or hardware action is part of this tool.
