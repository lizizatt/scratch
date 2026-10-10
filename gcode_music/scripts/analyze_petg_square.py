"""Reproduce one exploratory AAC/source comparison, never a calibration or print job."""

import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
from zipfile import ZipFile

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from gcode_source import parse_source
from motion_planner import PlannerConfig, plan_motion, sample_motion
from motion_timeline import ExecutionContext, build_timeline
from motor_audio import AudioProfile, protect_audio_paths, render_audio


RAW_HASHES = {
    'New Recording 15 copy.m4a': '756f714ab89ca307a4aa536bc497625dddb75c384fb30130ea89dda20c360d4e',
    'gcode_to_music_square.gcode.3mf': 'ab21c24824e63a957d24e478689b6e9933ff7f3aa724642533bce97d589cacde',
    'gcode_to_music_square.3mf': '8b24568844a1ad3f972ed1904f3b910cc2139325184ad8839d84290f725808bc',
}
GCODE_SHA256 = 'a6b6672d7b24047743dc6e80b04011d6465aa6f31688c91f6475e4df4e55ecff'
GCODE_MEMBER = 'Metadata/plate_1.gcode'
FULL_GCODE = 'source/plate_1.full.gcode'
FIRST_LINE, LAST_LINE = 820, 1076
RATE, WINDOW, HOP = 48000, 4096, 480
STEP = HOP / RATE
HP_SAMPLES = 101
BANDS = ((200, 400), (400, 800), (800, 1600))
MODULES = ('scripts/analyze_petg_square.py', 'gcode_source.py', 'motion_timeline.py',
           'motion_planner.py', 'models.py', 'motor_audio.py')
SOURCE_STATEMENTS = {
    3: '; model printing time: 48s; total estimated time: 8m 5s',
    505: 'M201 X20000 Y20000 Z500 E5000',
    506: 'M203 X500 Y500 Z20 E30',
    508: 'M205 X9.00 Y9.00 Z3.00 E2.50',
    784: 'M106 P3 S180',
    788: 'G90',
    789: 'G21',
    790: 'M83 ; use relative distances for extrusion',
    800: 'M106 S0',
    801: 'M106 P2 S0',
    802: 'M204 S6000',
    817: 'G1 X141.762 Y140.776',
    818: 'G1 Z.2',
    819: 'G1 E.8 F1800',
    820: '; FEATURE: Outer wall',
    823: 'M204 S500',
    825: 'G1 X116.823 Y140.776 E.90046',
    839: '; FEATURE: Bottom surface',
    1076: 'M106 P2 S0',
    1077: 'M981 S0 P20000 ; close spaghetti detector',
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_source(data):
    """Only this pinned source permits using the declared commanded boundary."""
    if sha256(data) != GCODE_SHA256:
        raise ValueError('Full GCODE SHA256 mismatch; boundary must not be used')
    commands = parse_source(data)
    for line, expected in SOURCE_STATEMENTS.items():
        if commands[line - 1].line_num != line or commands[line - 1].raw_line != expected:
            raise ValueError(f'Exact source/boundary statement mismatch at line {line}')
    return commands


def make_plan(data):
    commands = validate_source(data)
    context = ExecutionContext((141.762, 140.776, .2), 0, 'absolute', 'relative', 'mm', 1800)
    config = PlannerConfig(default_acceleration_mm_s2=6000)
    # Slice physical records, including comments/state: no opcode whitelist/filter.
    region = commands[FIRST_LINE - 1:LAST_LINE]
    full_timeline = build_timeline(commands, context=context)
    if full_timeline.complete:
        raise ValueError('Expected full input to remain unsupported; review source/API change')
    try:
        plan_motion(commands, context=context, config=config)
    except ValueError as exc:
        refusal = str(exc)
    else:
        raise ValueError('Full-input planner unexpectedly accepted unsupported operations')
    return plan_motion(region, context, config), context, commands, refusal


def preflight(input_dir, output_dir):
    """No writes, including directory creation, before all source/path checks pass."""
    input_dir, output_dir = Path(input_dir), Path(output_dir)
    src, dest = input_dir.resolve(), output_dir.resolve()
    if src == dest or src in dest.parents or dest in src.parents:
        raise ValueError('Input/output directory alias or nesting')
    inputs = [input_dir / name for name in RAW_HASHES]
    for path in inputs:
        if file_hash(path) != RAW_HASHES[path.name]:
            raise ValueError(f'Raw input SHA256 mismatch: {path.name}')
    with ZipFile(input_dir / 'gcode_to_music_square.gcode.3mf') as archive:
        data = archive.read(GCODE_MEMBER)
        md5_text = archive.read(GCODE_MEMBER + '.md5').decode('ascii').strip()
    validate_source(data)
    if hashlib.md5(data).hexdigest() != md5_text.lower():
        raise ValueError('Embedded GCODE MD5 mismatch')
    copies = {f'raw/{name}': digest for name, digest in RAW_HASHES.items()}
    copies[FULL_GCODE] = GCODE_SHA256
    outputs = [output_dir / name for name in
               (*copies, 'manifest.json', 'analysis.json', 'baseline_motor.wav',
                'comparison.svg', 'REPORT.md')]
    protect_audio_paths(outputs, [*inputs, *(ROOT / name for name in MODULES)])
    for path in outputs:
        if dest not in path.resolve().parents:
            raise ValueError('Output escapes bundle directory')
        for parent in (path, *path.parents):
            if parent.is_symlink():
                raise ValueError('Symlink output path refused')
            if parent == output_dir:
                break
    for name, digest in copies.items():
        path = output_dir / name
        if path.exists() and file_hash(path) != digest:
            raise ValueError(f'Existing preserved source mismatch: {name}')
    return data, md5_text


def highpass(values):
    values = np.asarray(values, dtype=float)
    if values.ndim != 1 or len(values) < HP_SAMPLES or not np.isfinite(values).all():
        raise ValueError('Need at least 101 finite samples for high-pass analysis')
    return values - np.convolve(np.pad(values, (50, 50), mode='edge'),
                                np.ones(HP_SAMPLES) / HP_SAMPLES, mode='valid')


def correlation(left, right):
    left, right = np.asarray(left, dtype=float), np.asarray(right, dtype=float)
    left, right = left - left.mean(), right - right.mean()
    denominator = np.linalg.norm(left) * np.linalg.norm(right)
    if denominator <= 1e-12:
        return None
    return float(np.clip(np.dot(left, right) / denominator, -1, 1))


def alignment_search(predicted_hp, observed_hp, max_shift, *, polarity=1, minimum_correlation=.2):
    """Scan integer shifts; positive means recording clock = local clock + shift.

    Inputs share a 10 ms grid and are already high-passed. Polarity is explicit,
    never chosen by absolute correlation. The .2 gate rejects weak/no signal; it
    is an engineering guard, not a multiple-search significance test.
    """
    predicted = np.asarray(predicted_hp, dtype=float)
    observed = np.asarray(observed_hp, dtype=float)
    if (predicted.ndim != 1 or observed.ndim != 1 or len(predicted) < 3
            or type(max_shift) is not int or max_shift < 0
            or len(observed) < len(predicted) + max_shift
            or polarity not in (-1, 1) or not 0 < minimum_correlation <= 1
            or not np.isfinite(predicted).all() or not np.isfinite(observed).all()):
        raise ValueError('Invalid alignment samples, shift range, or polarity')
    centered = predicted - predicted.mean()
    norm = np.linalg.norm(centered)
    if norm <= 1e-10 or np.std(observed) <= 1e-10:
        raise ValueError('Flat/no signal: alignment undefined')
    windows = np.lib.stride_tricks.sliding_window_view(observed, len(predicted))[:max_shift + 1]
    # Center each window for numerical stability without allocating the whole matrix.
    means = windows.mean(axis=1)
    energy = np.einsum('ij,ij->i', windows, windows) - len(predicted) * means**2
    denominator = norm * np.sqrt(np.maximum(energy, 0))
    numerator = np.correlate(observed, centered, mode='valid')[:max_shift + 1]
    scores = np.full(max_shift + 1, np.nan)
    np.divide(polarity * numerator, denominator, out=scores, where=denominator > 1e-10)
    scores = np.clip(scores, -1, 1)
    if not np.isfinite(scores).any():
        raise ValueError('Flat/no signal: alignment undefined')
    best = int(np.nanargmax(scores))
    if scores[best] < minimum_correlation:
        raise ValueError('No sufficiently correlated signal for exploratory alignment')
    return {'shift_samples': best, 'offset_s': best * STEP,
            'correlation': float(scores[best]), 'polarity': polarity,
            'minimum_correlation_gate': minimum_correlation,
            'scores': [float(value) if np.isfinite(value) else None for value in scores]}


def spectral_bands(audio):
    if audio.ndim != 1 or len(audio) < WINDOW or not np.isfinite(audio).all():
        raise ValueError('Need finite mono audio with at least one full STFT window')
    windows = np.lib.stride_tricks.sliding_window_view(audio, WINDOW)[::HOP]
    centers = (np.arange(len(windows)) * HOP + WINDOW / 2) / RATE
    frequencies = np.fft.rfftfreq(WINDOW, 1 / RATE)
    power = np.abs(np.fft.rfft(windows * np.hanning(WINDOW), axis=1))**2
    bands = {f'{lo}-{hi}': 10 * np.log10(power[:, (frequencies >= lo) & (frequencies < hi)].sum(axis=1) + 1e-20)
             for lo, hi in BANDS}
    return centers, bands


def analyze(plan, audio):
    centers, bands = spectral_bands(audio)
    duration = len(audio) / RATE
    max_shift = int(np.floor((duration - plan.total_duration_s) / STEP + 1e-9))
    if max_shift < 0:
        raise ValueError('Recording shorter than nominal plan; full-overlap scan unavailable')
    # Every selected window lies wholly within the plan at every tested offset.
    local = centers[centers + WINDOW / (2 * RATE) <= plan.total_duration_s]
    _, velocity = sample_motion(plan, local)
    speed = np.max(np.abs(velocity[:, :2]), axis=1)
    predicted_hp = highpass(speed)
    observed_hp = {name: highpass(values) for name, values in bands.items()}
    primary = observed_hp['400-800']
    best = alignment_search(predicted_hp, primary, max_shift)
    shift = best['shift_samples']
    thirds = np.linspace(2.54, 31.0, 4)
    intervals = [('outer_wall', 0, 2.308)] + [
        (f'bottom_third_{i + 1}', float(thirds[i]), float(thirds[i + 1])) for i in range(3)]
    segments = []
    for name, lo, hi in intervals:
        indices = np.flatnonzero((local >= lo) & (local < hi))
        segments.append({'name': name, 'local_range_s': [lo, hi], 'sample_count': len(indices),
                         'fixed_offset_correlation': correlation(predicted_hp[indices], primary[indices + shift])})
    halves = {}
    for name, mask in [('first_half', local < plan.total_duration_s / 2),
                       ('second_half', local >= plan.total_duration_s / 2)]:
        indices = np.flatnonzero(mask)
        search = alignment_search(predicted_hp[indices], primary[indices[0]:], max_shift)
        halves[name] = {key: value for key, value in search.items() if key != 'scores'}
        halves[name]['local_center_range_s'] = [float(local[indices[0]]), float(local[indices[-1]])]
    result = {
        'schema_version': 1, 'calibrated': False, 'exploratory': True,
        'recording_duration_s': duration, 'nominal_plan_duration_s': plan.total_duration_s,
        'planned_moves': len(plan.moves),
        'slicer_header': {'model_s': 48, 'total_s': 485, 'source_line': 3,
                          'comparable_scope': False, 'timing_error_percent': None},
        'stft': {'sample_rate_hz': RATE, 'window_samples': WINDOW, 'hop_samples': HOP,
                 'window': 'numpy.hanning (symmetric Hann)', 'bin_spacing_hz': RATE / WINDOW,
                 'window_duration_s': WINDOW / RATE, 'center_definition': '(start_sample + N/2) / rate',
                 'bands_hz_half_open': BANDS, 'power': 'sum(abs(rfft(windowed_audio))**2)',
                 'db_reference': '10*log10(band_power + 1e-20); arbitrary digital units, not SPL'},
        'alignment': {'primary_band_hz': [400, 800], 'clock_equation': 'recording_s = local_s + offset_s',
                      'time_scale': 1.0, 'grid_step_s': STEP, 'grid_range_s': [0, max_shift * STEP],
                      'candidate_count': max_shift + 1, 'highpass_samples': HP_SAMPLES,
                      'highpass_duration_s': HP_SAMPLES * STEP, 'highpass_padding': 'edge replication',
                      'highpass_scope': 'whole recording and full-window local speed series, before subsetting',
                      'speed': 'max(abs(A), abs(B)) in mm/s from sample_motion',
                      'window_policy': 'only complete STFT windows within the plan; full plan fits in recording',
                      'local_center_range_s': [float(local[0]), float(local[-1])],
                      'sample_count': len(local), **best,
                      'fixed_offset_band_correlations': {
                          name: correlation(predicted_hp, values[shift:shift + len(local)])
                          for name, values in observed_hp.items()},
                      'fixed_offset_segments': segments, 'independent_half_searches': halves,
                      'validation': 'All intervals/halves reuse this capture; none are scientifically held out.'},
        'spectral_inference': 'No peak-to-component labels, acoustic calibration, or detailed peak inference attempted.',
        'plot_data': {'recording_centers_s': centers.tolist(),
                      'observed_band_db': {name: values.tolist() for name, values in bands.items()},
                      'local_centers_s': local.tolist(), 'predicted_speed_mm_s': speed.tolist()},
    }
    return result


def provenance():
    return {
        'user_confirmations': {
            name: {'value': value, 'provenance': 'user report in 2026-10-05 task',
                   'independently_verified': False}
            for name, value in {'entire_square_captured': True, 'calibration_procedures_removed': True,
                                'printer_speed_mode': 'Standard 100%',
                                'trimmed_only_ends': True, 'internal_cuts': False,
                                'recording_app': 'Voice Memos', 'skip_silence_enabled': False,
                                'phone_placement': 'Phone wedged in the otherwise closed enclosure via the top hatch'}.items()},
        'user_timing_estimates': {
            'provenance': 'user report in 2026-10-05 task, after candidate alignment was shared',
            'clock': 'seconds in the supplied trimmed recording',
            'approximate': True, 'uncertainty_s': None,
            'independently_verified': False, 'used_for_alignment_fit': False,
            'estimates_s': {'border_start': 12, 'infill_start': 15, 'printing_end': 43},
            'qualification': 'User has no solid timing; rough recollections, not measured landmarks or held-out validation.',
        },
        'assumptions': [
            'Commanded XYZ boundary is nominal; mesh, trim and physical position are unknown.',
            'E starts at arbitrary zero because the sourced extrusion mode is relative.',
            'Planner assumes rest at the selected region boundaries; preceding/following motion is excluded.',
            'Default PlannerConfig limits match sourced M201/M203/M205; only initial acceleration is overridden to 6000.',
            'M204 S500 at line 823 supersedes that initial acceleration before the first XYZ move.',
            'No physical pressure-advance, vibration/noise-compensation, or firmware planner state is established.',
            'One constant exploratory offset, no time warping or speed rescaling; not a measured print start.',
            'Outer-wall alignment is extrapolated from a globally selected offset, not independently validated.',
            'Phone placement is user-described, not geometrically measured; hatch contact may couple vibration and the opening may alter enclosure acoustics.',
            'Voice Memos Skip Silence was off and only ends were trimmed per user; gain/AGC, enhancement and other processing remain unknown. AAC is lossy.',
            'Approximate user timing estimates are consistent with the candidate alignment but were supplied after it was shared; they are not independent timing validation.',
            'No measured SPL, fan/motor identification, acoustic calibration, physical validation or safety guarantee.',
            'Complete square capture is only the user report, not a guarantee established by this analysis.',
            'Fans are excluded from the baseline, not assumed physically off: P3 S180 at line 784, part/aux S0 at 800/801; hotend/board state unknown.',
        ],
    }


def comparison_svg(analysis):
    plot, alignment = analysis['plot_data'], analysis['alignment']
    duration = analysis['recording_duration_s']
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="790" viewBox="0 0 1200 790">',
             '<rect width="1200" height="790" fill="#101827"/>',
             '<g fill="#e6edf7" font-family="sans-serif" font-size="14">',
             '<text x="70" y="30" font-size="22">PETG square: exploratory recording-clock comparison</text>',
             '<text x="70" y="55">Observed digital band energy and nominal AB speed; no calibration, no time scaling</text>']
    series = [(f'{name} Hz observed band power (arbitrary dB)', plot['recording_centers_s'], values, '#59cbe8')
              for name, values in plot['observed_band_db'].items()]
    series.append(('Predicted max(|A|, |B|) speed (mm/s)',
                   [t + alignment['offset_s'] for t in plot['local_centers_s']],
                   plot['predicted_speed_mm_s'], '#ffc76b'))
    for i, (label, times, values, color) in enumerate(series):
        y, height = 100 + i * 160, 105
        low, high = min(values), max(values)
        scale = max(high - low, 1e-9)
        parts.append(f'<text x="70" y="{y - 12}">{label}</text>')
        for time in np.arange(0, duration + 1e-9, 5):
            x = 70 + 1070 * time / duration
            parts.append(f'<path d="M{x:.2f},{y} v{height}" stroke="#354155"/>')
            parts.append(f'<text x="{x:.2f}" y="{y + height + 18}" font-size="11">{time:g}s</text>')
        for bound in (alignment['offset_s'], alignment['offset_s'] + analysis['nominal_plan_duration_s']):
            x = 70 + 1070 * bound / duration
            parts.append(f'<path d="M{x:.2f},{y} v{height}" stroke="#ffc76b" stroke-dasharray="5 4"/>')
        points = ' '.join(f'{70 + 1070 * t / duration:.2f},{y + height * (1 - (v - low) / scale):.2f}'
                          for t, v in zip(times, values))
        parts.append(f'<polyline points="{points}" fill="none" stroke="{color}" stroke-width="1"/>')
        parts.append(f'<text x="8" y="{y + 12}" font-size="11">{high:.1f}</text>')
        parts.append(f'<text x="8" y="{y + height}" font-size="11">{low:.1f}</text>')
    parts.append(f'<text x="70" y="760">Recording seconds; dashed nominal boundaries at offset {alignment["offset_s"]:.2f}s and nominal end. Panels use separate scales.</text>')
    parts.append('</g></svg>\n')
    return '\n'.join(parts)


def report_markdown(analysis, manifest):
    alignment = analysis['alignment']
    rows = '\n'.join(f'| {item["name"]} | {item["local_range_s"][0]:.3f}–{item["local_range_s"][1]:.3f} | {item["fixed_offset_correlation"]:.4f} |'
                     for item in alignment['fixed_offset_segments'])
    halves = '\n'.join(f'- {name}: independent peak offset **{item["offset_s"]:.2f} s**, r = **{item["correlation"]:.4f}**.'
                       for name, item in alignment['independent_half_searches'].items())
    bands = '\n'.join(f'- {name} Hz: r = **{value:.4f}** at the primary-band offset.'
                      for name, value in alignment['fixed_offset_band_correlations'].items())
    limitations = '\n'.join('- ' + text for text in manifest['assumptions'])
    sources = '\n'.join(f'- [{name}](raw/{name.replace(" ", "%20")}) — SHA256 `{digest}`'
                        for name, digest in RAW_HASHES.items())
    return f'''# First PETG-square recording comparison — 2026-10-05

Exploratory offline comparison of one AAC capture. **Not calibrated.** No printer
was contacted, no executable body snippet was produced, and the default audio
profile was not modified. Audio was decoded for numerical analysis only; no
transcription was performed.

## Numerical findings

- Decoded recording: **{analysis['recording_duration_s']:.6f} s**, mono {RATE} Hz.
- Nominal selected region: **{analysis['planned_moves']} moves**, **{analysis['nominal_plan_duration_s']:.6f} s**.
- Best positive 400–800 Hz high-pass energy/speed correlation: **r = {alignment['correlation']:.6f}**
  at **+{alignment['offset_s']:.2f} s**: recording time = local plan time + offset.
- No time scaling (factor 1). Search: {alignment['candidate_count']} offsets, 0–{alignment['grid_range_s'][1]:.2f} s in 0.01 s steps.
- Implied nominal interval on recording clock: **{alignment['offset_s']:.2f}–{alignment['offset_s'] + analysis['nominal_plan_duration_s']:.6f} s**;
  this is not a verified start/end of the physical square.
- Header [source line 3](source/plate_1.full.gcode#L3): **48 s model / 485 s total**.
  Those scopes differ from this selected region; **do not call the difference a 35% timing error**.

{bands}

### Fixed-offset segment checks (primary band)

| Nominal interval | Local seconds (half-open) | Pearson r |
|---|---:|---:|
{rows}

### Independent half searches: an ambiguity check, not validation

{halves}

The halves search the same full-plan-overlap offset range independently. Different
peaks expose local ambiguity. All intervals reuse this capture and none are
scientifically held out. The outer wall is particularly an extrapolation of the
global alignment. Correlation and a scan maximum are not proof of motor causation
or a uniquely identified physical timing relationship. The 0.2 rejection gate is
only an engineering guard, not a significance threshold corrected for searching.

## Method and scope

STFT: symmetric Hann (`numpy.hanning`), {WINDOW} samples, {HOP}-sample hop,
**{RATE / WINDOW:.5f} Hz bin spacing**, **{1000 * WINDOW / RATE:.4f} ms windows**.
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
`{GCODE_SHA256}`. The embedded MD5 is checked case-insensitively. Offline planning
uses original physical records **820–1076 inclusive**, including every comment and
state command. Excluded: **1–819** (header/startup, calibration/conditional and other
unsupported operations, travel/prime to boundary) and **1077–{manifest['source']['full_line_count']}**
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

{limitations}

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
{sources}

From the project root, with NumPy and FFmpeg available, run
`python scripts/analyze_petg_square.py --input-dir "$HOME/Downloads" --output-dir data/recordings/petg_square_2026-10-05`.
The generator is pinned to these inputs, checks source/boundary/path integrity
before writes, retains matching raw copies and refuses mismatches. It can also
read a separately located copy of the three preserved raw inputs. It never
writes to the input directory. No upload or hardware action is part of this tool.
'''


def generate(input_dir, output_dir):
    input_dir, output_dir = Path(input_dir), Path(output_dir)
    data, embedded_md5 = preflight(input_dir, output_dir)
    plan, context, commands, refusal = make_plan(data)
    module_hashes = {name: file_hash(ROOT / name) for name in MODULES}
    ffmpeg_version = subprocess.run(['ffmpeg', '-version'], check=True, capture_output=True, text=True).stdout
    audio_bytes = subprocess.run(
        ['ffmpeg', '-v', 'error', '-nostdin', '-i', str(input_dir / 'New Recording 15 copy.m4a'),
         '-ac', '1', '-ar', str(RATE), '-f', 'f32le', 'pipe:1'],
        check=True, capture_output=True).stdout
    analysis = analyze(plan, np.frombuffer(audio_bytes, dtype='<f4'))
    # Recheck before committing copies; concurrent filesystem modification is not supported.
    preflight(input_dir, output_dir)
    for name in RAW_HASHES:
        target = output_dir / 'raw' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.copyfile(input_dir / name, target)
        if file_hash(target) != RAW_HASHES[name]:
            raise ValueError('Raw copy verification failed')
    full_gcode = output_dir / FULL_GCODE
    full_gcode.parent.mkdir(parents=True, exist_ok=True)
    if not full_gcode.exists():
        full_gcode.write_bytes(data)
    baseline = render_audio(plan, output_dir / 'baseline_motor.wav', profile=AudioProfile(),
                            sample_rate=RATE, motors=True, fans=False)
    baseline['path'] = 'baseline_motor.wav'
    manifest = {
        'schema_version': 1, 'capture_date': '2026-10-05', 'calibrated': False,
        **provenance(),
        'source': {'full_gcode_path': FULL_GCODE, 'full_gcode_sha256': sha256(data),
                   'archive_member': GCODE_MEMBER, 'embedded_md5_as_stored': embedded_md5,
                   'embedded_md5_normalized': embedded_md5.lower(), 'embedded_md5_verified': True,
                   'full_line_count': len(commands), 'retained_original_lines_inclusive': [FIRST_LINE, LAST_LINE],
                   'retained_record_count': LAST_LINE - FIRST_LINE + 1,
                   'excluded_original_lines_inclusive': [[1, FIRST_LINE - 1], [LAST_LINE + 1, len(commands)]],
                   'exclusion_reason': 'Explicit nominal body scope, not unsupported-op filtering; startup/boundary and end sequence excluded.',
                   'full_input_supported': False, 'full_input_planner_refusal': refusal,
                   'exact_statements': {str(line): {'text': text, 'provenance': 'pinned full GCODE',
                                                   'reference': f'{FULL_GCODE}#L{line}'}
                                        for line, text in SOURCE_STATEMENTS.items()}},
        'model': {'execution_context': asdict(context), 'planner_config': asdict(plan.config),
                  'audio_profile': asdict(AudioProfile()), 'render_audio': baseline,
                  'global_defaults_modified': False, 'plan_diagnostics': plan.diagnostics},
        'inferences': {'provenance': 'exploratory analysis of one capture, not user-confirmed',
                       'alignment_independently_validated': False, 'details': 'analysis.json'},
        'software': {'source_module_sha256': module_hashes, 'source_path_basis': 'gcode_music project root, not bundle directory',
                     'python_version': platform.python_version(), 'numpy_version': np.__version__,
                     'ffmpeg_version': ffmpeg_version,
                     'decode_arguments': ['-v', 'error', '-nostdin', '-i', 'raw/New Recording 15 copy.m4a',
                                          '-ac', '1', '-ar', str(RATE), '-f', 'f32le', 'pipe:1']},
    }
    (output_dir / 'analysis.json').write_text(json.dumps(analysis, indent=2, allow_nan=False) + '\n')
    (output_dir / 'comparison.svg').write_text(comparison_svg(analysis))
    (output_dir / 'REPORT.md').write_text(report_markdown(analysis, manifest))
    artifacts = [*(f'raw/{name}' for name in RAW_HASHES), FULL_GCODE,
                 'baseline_motor.wav', 'analysis.json', 'comparison.svg', 'REPORT.md']
    manifest['artifact_sha256'] = {name: file_hash(output_dir / name) for name in artifacts}
    if any(file_hash(input_dir / name) != digest for name, digest in RAW_HASHES.items()):
        raise ValueError('Original inputs changed during generation')
    if any(file_hash(ROOT / name) != digest for name, digest in module_hashes.items()):
        raise ValueError('Source modules changed during generation')
    (output_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2, allow_nan=False) + '\n')
    return analysis


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    result = generate(args.input_dir, args.output_dir)
    alignment = result['alignment']
    print(json.dumps({'moves': result['planned_moves'], 'duration_s': result['nominal_plan_duration_s'],
                      'best_offset_s': alignment['offset_s'], 'correlation': alignment['correlation']}, indent=2))


if __name__ == '__main__':
    main()
