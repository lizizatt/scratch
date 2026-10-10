"""Fixed-offset, acceleration-aware diagnostics for one preserved PETG capture.

No fitting, hardware operations, source extraction, or default-profile changes.
The audition and the single-voice diagnostic are deliberately different signals.
"""

import argparse
from dataclasses import asdict
import html
import json
import math
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.parse import quote
import wave

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts import analyze_petg_square as baseline
from motor_audio import AudioProfile, protect_audio_paths, render_audio


RATE, HOP = 48000, 480
WINDOWS = (4096, 8192)
RATES = (2.5, 5.0, 8.0)
BAND = (100, 2000)
EPSILON = 1e-20
DEFAULT_BUNDLE = ROOT / 'data/recordings/petg_square_2026-10-05'
CANDIDATE_DIR = 'acoustic_candidates'
BASELINE_SHA = 'fbeaa6f1746e80a433eb76cf6950c5bf0437cd6e08a328174898762b7c7ebef2'
ANALYSIS_SHA = 'd369b66d0fddb31208783ed8af31e80ace8381b352fa191159a4525cef0b215a'
MODULES = (*baseline.MODULES, 'scripts/compare_petg_acoustics.py')
REGIONS = {'outer': (0.0, 2.3), 'bottom': (2.54, 31.0),
           'bottom_early': (2.54, 16.77), 'bottom_late': (16.77, 31.0)}


def candidate_name(rate):
    return 'candidate_' + f'{rate:g}'.replace('.', 'p') + '.wav'


PLAYBACK_NAME = 'recording_playback.wav'
OUTPUT_NAMES = (*(candidate_name(rate) for rate in RATES), PLAYBACK_NAME,
                'report.json', 'REPORT.md', 'scores.svg', 'index.html')


def check_output_paths(outputs, inputs):
    """Check the complete destination set, including symlink ancestors, before writes."""
    outputs = list(outputs)
    for path in outputs:
        if any(part.is_symlink() for part in (path, *path.parents)):
            raise ValueError(f'Symlink output path refused: {path}')
    protect_audio_paths(outputs, inputs)


def bundle_snapshot(bundle):
    # Never exclude arbitrary output directories from the preservation inventory.
    return {str(path.relative_to(bundle)): baseline.file_hash(path)
            for path in sorted(bundle.rglob('*'))
            if path.is_file() and path.relative_to(bundle).parts[0] != CANDIDATE_DIR}


def offset_samples(alignment):
    offset = alignment['offset_s']
    hops = offset * RATE / HOP
    if (not math.isfinite(hops) or hops < 0 or not math.isclose(hops, round(hops), abs_tol=1e-9, rel_tol=0)
            or alignment['time_scale'] != 1 or alignment['shift_samples'] != round(hops)
            or not math.isclose(alignment['grid_step_s'], HOP / RATE, abs_tol=1e-12, rel_tol=0)):
        raise ValueError('Frozen offset must be an unscaled integer-hop alignment')
    if round(hops) != 1215:
        raise ValueError('Expected preserved 1215-hop offset; no retiming permitted')
    return round(hops) * HOP


def preflight(bundle, output):
    bundle, output = Path(bundle).absolute(), Path(output).absolute()
    src, dest = bundle.resolve(), output.resolve()
    allowed = src / CANDIDATE_DIR
    if (dest == src or dest in src.parents
            or (src in dest.parents and dest != allowed)):
        raise ValueError('Output conflicts with preserved bundle; use acoustic_candidates or a separate directory')
    manifest = json.loads((bundle / 'manifest.json').read_text())
    required = {**{f'raw/{name}': value for name, value in baseline.RAW_HASHES.items()},
                baseline.FULL_GCODE: baseline.GCODE_SHA256,
                'baseline_motor.wav': BASELINE_SHA, 'analysis.json': ANALYSIS_SHA}
    artifacts = manifest['artifact_sha256']
    for name, digest in required.items():
        if artifacts.get(name) != digest:
            raise ValueError(f'Pinned manifest artifact SHA256 mismatch: {name}')
    for name, digest in artifacts.items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or relative.parts[0] == CANDIDATE_DIR:
            raise ValueError('Invalid preserved artifact path')
        if baseline.file_hash(bundle / name) != digest:
            raise ValueError(f'Preserved artifact SHA256 mismatch: {name}')
    analysis = json.loads((bundle / 'analysis.json').read_text())
    offset_samples(analysis['alignment'])
    snapshot = bundle_snapshot(bundle)
    # Explicit manifest paths also cover assets reached through symlink directories,
    # which Path.rglob intentionally does not descend into.
    inputs = [*(bundle / name for name in snapshot), *(bundle / name for name in artifacts),
              *(ROOT / name for name in MODULES)]
    outputs = [output / name for name in OUTPUT_NAMES]
    check_output_paths(outputs, inputs)
    return manifest, analysis, snapshot, inputs


def audition_profile(rate):
    return AudioProfile(acoustic_cycles_per_mm=(rate, rate, 40, 8))


def diagnostic_profile(rate):
    return AudioProfile(harmonic_weights=(1,), voice_gains=(1, 0, 0, 0),
                        acoustic_cycles_per_mm=(rate, rate, 40, 8))


def read_pcm16(path):
    with wave.open(str(path), 'rb') as stream:
        if (stream.getframerate(), stream.getnchannels(), stream.getsampwidth()) != (RATE, 1, 2):
            raise ValueError('Diagnostic must be mono PCM16 at 48000 Hz')
        return np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(float) / 32767


def write_recording_playback(audio, path):
    """Quantize the complete decoded capture, without gain changes or retiming."""
    samples = np.asarray(audio, dtype=np.float64)
    if samples.ndim != 1 or not len(samples) or not np.isfinite(samples).all():
        raise ValueError('Playback requires nonempty finite mono decoded audio')
    clipping_count = int(np.count_nonzero(np.abs(samples) > 1))
    pcm = np.rint(np.clip(samples, -1, 1) * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(RATE)
        stream.writeframes(pcm.tobytes())
    return {'path': path.name, 'sha256': baseline.file_hash(path),
            'frames': len(samples), 'duration_s': len(samples) / RATE,
            'sample_rate_hz': RATE, 'channels': 1, 'sample_width_bytes': 2,
            'format': 'WAV PCM16 little-endian', 'derived': True,
            'source': 'raw/New Recording 15 copy.m4a',
            'conversion': 'Existing FFmpeg mono 48000 Hz f32le decode; promote to float64, '
                          'numpy.rint(numpy.clip(samples, -1, 1) * 32767).astype(<i2); '
                          'round nearest, ties to even; no gain normalization',
            'prequantization_clipping_samples': clipping_count,
            'timeline': 'Full decoded original end-trimmed file timeline; no new trim, stretch, or normalization',
            'lossy_source': 'Underlying AAC is still lossy; conversion cannot recover discarded detail'}


def stft_power(audio, window, starts):
    """Unpadded symmetric-Hann power, 100..2000 Hz inclusive; FFT batches of 128."""
    audio, starts = np.asarray(audio), np.asarray(starts)
    if (audio.ndim != 1 or not np.isfinite(audio).all() or window not in WINDOWS
            or starts.ndim != 1 or not np.issubdtype(starts.dtype, np.integer)
            or len(starts) == 0 or np.any(starts < 0) or np.any(starts + window > len(audio))):
        raise ValueError('Need finite mono audio and complete integer-indexed STFT windows')
    frequencies = np.fft.rfftfreq(window, 1 / RATE)
    band = (frequencies >= BAND[0]) & (frequencies <= BAND[1])
    result = np.empty((len(starts), int(band.sum())))
    hann = np.hanning(window)
    view = np.lib.stride_tricks.sliding_window_view(audio, window)
    for first in range(0, len(starts), 128):
        indices = starts[first:first + 128]
        fft = np.fft.rfft(view[indices] * hann, axis=1)
        result[first:first + len(indices)] = np.abs(fft[:, band])**2
    return result


def region_mask(starts, window, region):
    lo, hi = region
    return (starts >= math.ceil(lo * RATE)) & (starts + window <= math.floor(hi * RATE))


def observed_residual(power, remove_frame_median=True):
    power = np.asarray(power, dtype=float)
    if (power.ndim != 2 or min(power.shape) == 0 or np.any(power < 0)
            or not np.isfinite(power).all()):
        raise ValueError('Need nonempty finite nonnegative spectral power')
    db = 10 * np.log10(power + EPSILON)
    residual = db - np.median(db, axis=0, keepdims=True)
    if remove_frame_median:
        residual -= np.median(residual, axis=1, keepdims=True)
    return residual


def control_shifts(frames):
    """15 unique circular shifts, from 10% through 90% of this region's frames."""
    low, high = math.ceil(.1 * frames), math.floor(.9 * frames)
    shifts = np.rint(np.linspace(low, high, 15)).astype(int)
    if len(set(shifts)) != 15 or np.any(shifts <= 0) or np.any(shifts >= frames):
        raise ValueError('Region too short for 15 nontrivial circular controls')
    return shifts


def score_residual(model_power, residual):
    """Unit-sum *linear* power weights; equal frame weights, not an error/likelihood."""
    model_power, residual = np.asarray(model_power, dtype=float), np.asarray(residual, dtype=float)
    if (model_power.ndim != 2 or model_power.shape != residual.shape
            or not np.isfinite(model_power).all() or np.any(model_power < 0)
            or not np.isfinite(residual).all()):
        raise ValueError('Model and residual must have matching finite spectral shapes')
    shifts = control_shifts(len(model_power))
    energy = model_power.sum(axis=1)
    valid = energy > 0
    weights = np.divide(model_power, energy[:, None], out=np.zeros_like(model_power), where=valid[:, None])

    def mean_score(shift):
        selected = np.roll(valid, shift)
        if not selected.any():
            return None
        values = np.sum(np.roll(weights, shift, axis=0) * residual, axis=1)
        return float(values[selected].mean())

    actual = mean_score(0)
    controls = [mean_score(int(shift)) for shift in shifts]
    mean = float(np.mean(controls)) if actual is not None else None
    maximum = max(controls) if actual is not None else None
    return {'frames_total': len(valid), 'frames_used': int(valid.sum()),
            'frames_excluded_zero_inband_power': int((~valid).sum()),
            'actual_db': actual, 'control_shifts_frames': shifts.tolist(),
            'control_scores_db': controls, 'control_mean_db': mean, 'control_max_db': maximum,
            'actual_minus_control_mean_db': actual - mean if actual is not None else None,
            'actual_minus_control_max_db': actual - maximum if actual is not None else None}


def score_spectrogram(model_power, observed_power, remove_frame_median=True):
    """Standalone regional scorer; production halves inherit bottom whitening."""
    return score_residual(model_power, observed_residual(observed_power, remove_frame_median))


def diagnostics(signals, observed, shift):
    rows = []
    count = len(signals[RATES[0]])
    if any(len(signal) != count for signal in signals.values()) or len(observed) < shift + count:
        raise ValueError('Unequal diagnostic lengths or recording lacks full fixed-offset overlap')
    for window in WINDOWS:
        starts = np.arange(0, count - window + 1, HOP, dtype=int)
        measured = stft_power(observed, window, starts + shift)
        masks = {name: region_mask(starts, window, bounds) for name, bounds in REGIONS.items()}
        residuals = {}
        for name in ('outer', 'bottom'):
            residuals[name] = observed_residual(measured[masks[name]])
        for rate in RATES:
            modeled = stft_power(signals[rate], window, starts)
            for name, bounds in REGIONS.items():
                mask = masks[name]
                reference = 'outer' if name == 'outer' else 'bottom'
                subset = mask[masks[reference]]
                score = score_residual(modeled[mask], residuals[reference][subset])
                centers = (starts[mask] + window / 2) / RATE
                rows.append({'cycles_per_mm': rate, 'window_samples': window,
                             'region': name, 'local_range_s': list(bounds),
                             'center_range_s': [float(centers[0]), float(centers[-1])],
                             'normalization_region': reference, 'tiny_region': name == 'outer',
                             **score})
    return rows


CAVEATS = [
    'All results are diagnostic, uncalibrated, and unvalidated. No defaults changed.',
    'Rates 2.5 and 5 were selected after looking at this same capture; 8 is the original baseline. No held-out dataset or significance/p-value claim.',
    'The offset was previously selected by an envelope search on this capture. It is now frozen at +12.15 s; it is not an independently measured start. No retiming, refitting, new trim, time stretch, or gain normalization. Only the derived playback copy is quantized to PCM16; analysis still uses the decoded float32 audio.',
    'The 15 circular controls reuse each region; they are descriptive alignment checks, not independent trials. Early/late halves reuse the same recording and fixed rates.',
    'The diagnostic is single A voice, fundamental only, from render_audio/sample_motion signed displacement, including acceleration and corners across the entire Hann window. It is an idealized motor-driven chirp, not a physical step model or a physical source identification.',
    'Observed AAC is decoded by FFmpeg to mono 48 kHz float32; diagnostic WAVs are synthesized PCM16 decoded by wave and divided by 32767. Quantization, lossy compression, and real capture processing differ.',
    'The browser uses a decoded WAV playback copy, not the original AAC. The original m4a remains unchanged and available as a raw download. Underlying AAC is still lossy; conversion cannot recover discarded detail.',
    'Each model frame uses nonnegative linear spectral power normalized over 100..2000 Hz bins. Zero-inband-power frames are excluded, but any nonzero leakage is included and can dominate a normalized quiet frame.',
    'Per-frequency time-median whitening suppresses stationary tones, then per-frame frequency-median subtraction reduces broadband modulation. Neither removes every DC/leakage, frame-background, AGC, resonance, or correlated-motion confound.',
    'A synthetic stationary-tone check failed the stronger assumption of near-zero raw contrast: symmetric-Hann sidelobe power varies with tone phase, especially in quiet bins. Raw scores differed by candidate despite no moving source. Aligned-minus-control contrast stayed small and below control maxima in that test; this does not establish universal null rejection.',
    'Scores are arbitrary dB spectral contrast, not error, likelihood, calibrated SPL, or goodness-of-fit. A higher score alone does not identify a fundamental; 2.5/5 harmonic ambiguity remains.',
    'Outer-wall statistics use their own regional whitening and very little data. Bottom halves inherit bottom whitening; only complete windows inside each half are scored and controls never cross half boundaries.',
    'Auditions use full default harmonics/ABZE voices except the stated AB rate, with the same master gain and weights across files and no per-file normalization. They are NOT loudness matched to the recording.',
    'Fans are omitted from synthesis, NOT assumed physically off. Sourced P3 S180 precedes this region; hotend/board state is unknown. Real fans, enclosure resonances, and noise compensation are not identified.',
    'User reports complete square, Standard 100%, only end trims, Voice Memos Skip Silence off, phone wedged via top hatch otherwise closed. AGC/enhancement is unknown; hatch contact can couple vibration.',
    'Rough recording landmarks ~12/~15/~43 s were supplied after the fit and are not independent held-out timing evidence. Planner boundary state and firmware behavior remain approximate.',
]


def number(value):
    return 'n/a' if value is None else f'{value:+.4f}'


def markdown_report(report):
    rows = '\n'.join(
        f'| {row["window_samples"]} | {row["region"]} | {row["cycles_per_mm"]:g} | '
        f'{row["frames_used"]}/{row["frames_total"]} | {number(row["actual_db"])} | '
        f'{number(row["control_mean_db"])} | {number(row["control_max_db"])} | '
        f'{number(row["actual_minus_control_mean_db"])} | {number(row["actual_minus_control_max_db"])} |'
        for row in report['scores'])
    caveats = '\n'.join('- ' + text for text in CAVEATS)
    return f'''# PETG acoustic candidates — fixed-offset diagnostics

**Exploratory only. No calibration, validation, default changes, or hardware actions.**

[Listen](index.html) · [Numerical JSON / hashes / profiles](report.json) · [Score plot](scores.svg)

## Frozen inputs and clocks

Original source: {report['plan']['moves']} moves, {report['plan']['duration_s']:.9f} s.
Recording: {report['recording']['duration_s']:.6f} s, decoded mono 48000 Hz.
Recording seconds = local seconds + **12.15**, exactly **1215 hops / 583200 samples**.
The preserved analysis SHA256 is `{ANALYSIS_SHA}`; it is checked against the original
manifest before the offset is read. Every original manifest artifact is checked.
The 8-cycle audition is byte-identical to the original baseline: `{BASELINE_SHA}`.

## Decoded WAV playback copy

[Download decoded WAV playback copy](recording_playback.wav). The preview also links
the unchanged original AAC as a raw download; it is never an audio-player source.
Underlying AAC is still lossy; conversion cannot recover discarded detail.
This derived copy preserves the original end-trimmed file timeline with no new
trim, stretch, or normalization. Analysis continues to use the original f32 decode.

Conversion: {report['recording_playback']['conversion']}.
Format: mono 48000 Hz PCM16 WAV; **{report['recording_playback']['frames']} frames**,
{report['recording_playback']['duration_s']:.6f} s.
Prequantization clipping count (decoded samples outside [-1, 1]):
**{report['recording_playback']['prequantization_clipping_samples']}**.
Playback SHA256: `{report['recording_playback']['sha256']}`.

## Acceleration-aware evidence

FFT windows: symmetric `numpy.hanning`, 4096 (85.333 ms) and 8192 (170.667 ms),
hop 480 (10 ms), local start 0. Only complete windows inside each named interval;
no padding, fractional shifts, or center-speed approximation. Bin frequencies
are selected inclusively from 100 through 2000 Hz (spacing 11.71875 / 5.859375 Hz).
Power = `abs(rfft(windowed_audio))**2`. Model weights = power / in-band frame sum.
Observed residual = `10*log10(power + 1e-20)` minus each frequency's regional time
median, then minus each frame's in-band median. Score = mean over valid frames of
sum over bins of model weight × observed residual. Positive/negative values are
arbitrary spectral contrast, not probabilities or fit errors.

Controls circularly roll model weights **and their validity mask** over all frame
positions inside the scored region, using 15 rounded equally spaced shifts from
ceil(10% of frames) through floor(90%). There is no randomization or region leakage.
Halves exclude windows straddling 16.77 s and retain bottom-region whitening.

| Window | Region | cycles/mm | Used/total frames | Actual dB | Control mean | Control max | Δ mean | Δ max |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
{rows}

Outer = 0..2.3 s (tiny diagnostic); bottom = 2.54..31 s; early/late split = 16.77 s.
No candidate is promoted to a calibrated profile, regardless of ranking.

## Limitations and provenance

{caveats}

## Reproduce

From the project root, with the existing environment (NumPy and FFmpeg):
`python -B scripts/compare_petg_acoustics.py --bundle data/recordings/petg_square_2026-10-05`
uses this new subfolder by default. `--output` can specify a separate directory.
The original bundle cannot be an output. Input/output and output/output hardlinks,
symlinks and nesting conflicts are refused before opening output files.
Concurrent filesystem changes are unsupported; inputs and source modules are
rechecked before publication and preserved inputs afterward.

Candidate WAVs, the derived recording_playback.wav, and this report/preview/plot
are retained and included in output protection and artifact hashes. No new FFmpeg
installation is needed; the playback copy uses the existing decoded audio.
Single-voice WAVs
are temporary diagnostic scratch, not audition files. Current module hashes and
historical baseline module hashes are recorded separately; they need not match.
STFT FFT batches are capped at 128 windows; no full spectrograms are dumped to JSON.
'''


def score_svg(report):
    rows = [row for row in report['scores'] if row['region'] == 'bottom']
    values = [abs(row[key]) for row in rows for key in ('actual_db', 'control_mean_db', 'control_max_db')
              if row[key] is not None]
    bound = max([1, *values]) * 1.12
    x = lambda value: 590 + 360 * value / bound
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 480" role="img" aria-labelledby="title desc">',
             '<title id="title">Bottom-region acceleration-aware diagnostic scores</title>',
             '<desc id="desc">Bars: actual arbitrary dB contrast. White circle: control mean. Orange tick: control maximum. Not significance or calibration.</desc>',
             '<rect width="1040" height="480" rx="16" fill="#122031"/>',
             '<g font-family="sans-serif" fill="#e6eff8" font-size="14">',
             '<text x="28" y="34" font-size="21">Bottom region · acceleration-aware spectral contrast</text>',
             '<text x="28" y="60">Bar = actual · white circle = control mean · orange tick = control max</text>',
             '<path d="M590 82V415" stroke="#65758a"/>']
    for index, row in enumerate(rows):
        y = 110 + index * 50
        actual, mean, maximum = (row[key] for key in ('actual_db', 'control_mean_db', 'control_max_db'))
        parts.append(f'<text x="28" y="{y + 5}">{row["window_samples"]} / {row["cycles_per_mm"]:g} cycles/mm</text>')
        if actual is not None:
            parts.extend([f'<rect x="{min(x(actual), x(0)):.2f}" y="{y - 12}" width="{abs(x(actual) - x(0)):.2f}" height="24" fill="#65d6bf"/>',
                          f'<circle cx="{x(mean):.2f}" cy="{y}" r="5" fill="white"/>',
                          f'<path d="M{x(maximum):.2f} {y - 15}v30" stroke="#ffba77" stroke-width="3"/>',
                          f'<text x="970" y="{y + 5}">{actual:+.3f}</text>'])
    for value in (-bound, 0, bound):
        parts.append(f'<text x="{x(value):.2f}" y="434" text-anchor="middle">{value:+.2f} dB</text>')
    parts.append('<text x="28" y="465">One reused capture; fixed +12.15 s offset. See report for halves, outer region, and all controls.</text></g></svg>\n')
    return '\n'.join(parts)


def preview_html(report, recording_link):
    cards = [f'''<article><span class="tag">CAPTURE · RECORDING CLOCK</span><h2>Original recording / PCM playback</h2>
<p>0–{report['recording']['duration_s']:.2f} s · decoded WAV playback copy · mono 48 kHz PCM16</p>
<audio controls preload="metadata" data-offset="12.15" aria-label="Original recording PCM playback" src="{PLAYBACK_NAME}"></audio>
<p class="media-status" role="status">Paused. Seeking requires a loaded seekable range.</p>
<p><a href="{html.escape(recording_link, quote=True)}" download>Download unchanged original AAC (raw)</a> ·
<a href="{PLAYBACK_NAME}" download>Download decoded WAV playback copy</a></p>
<p>Underlying AAC is still lossy; conversion cannot recover discarded detail. No new trim, stretch, or normalization.</p>
<p>Real fans and processing may be present. Not loudness matched to the candidates.</p></article>''']
    for rate in RATES:
        tag = 'ORIGINAL BASELINE · BYTE-IDENTICAL' if rate == 8 else 'CANDIDATE · NOT CALIBRATED'
        cards.append(f'''<article><span class="tag">{tag}</span><h2>{rate:g} cycles/mm</h2>
<p>Local 0–{report['plan']['duration_s']:.2f} s · AB rate only changed</p>
<audio controls preload="metadata" data-offset="0" aria-label="{rate:g} cycles per mm candidate" src="{candidate_name(rate)}"></audio>
<p class="media-status" role="status">Paused. Seeking requires a loaded seekable range.</p>
<p><a href="{candidate_name(rate)}" download>Download candidate WAV</a></p>
<p>Full default ABZE voices and harmonics · fixed gain · motors only.</p></article>''')
    return '''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>PETG acoustic candidates</title>
<style>
:root{color-scheme:dark;font:16px/1.6 system-ui,sans-serif;background:#0c1521;color:#e6eff8}
body{max-width:1080px;margin:auto;padding:36px 22px}h1{font-size:clamp(2rem,5vw,3rem);line-height:1.15;margin:12px 0}
h2{margin:10px 0;font-size:1.5rem}p{color:#b9c9d9}.tag{font-size:.72rem;letter-spacing:.09em;color:#70dfc7;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin:24px 0}article{padding:23px;background:#152336;border:1px solid #334459;border-radius:16px}
audio{width:100%;margin:10px 0}button{font:inherit;border:1px solid #607a90;background:#233950;color:#fff;border-radius:9px;padding:10px 16px;cursor:pointer}
button:hover,button:focus-visible{background:#35526f}nav{display:flex;gap:10px;flex-wrap:wrap}a{color:#79dfcd}img{width:100%;height:auto}small{color:#b9c9d9}
.notice{padding:16px;border-left:3px solid #ffba77;background:#192638}footer{margin:26px 0}@media(max-width:700px){.grid{grid-template-columns:1fr}}
</style></head><body><header><span class="tag">PETG SQUARE / 2026-10-05 / OFFLINE</span>
<h1>Three rates. One unchanged capture.</h1>
<p>Auditions plus acceleration-aware single-voice spectral diagnostics. No calibrated profile or physical motor identification.</p></header>
<p class="notice">Not matched to recording loudness. No per-file normalization, new trim, or time stretch.
Recording playback is a derived PCM16 copy of the existing AAC decode; quantization is documented in the report.
Fans are omitted from synthesis, not assumed off in the printer. The 8-cycle audio is the original baseline.</p>
<h2>Compare a moment</h2><p>Approximate correspondence: recording = local + 12.15 s, frozen from the earlier envelope fit.
Buttons pause all four players and request seeks only within available seekable ranges; they never start playback.
Seek completion is checked after the seeked event, not inferred from loading readiness.</p>
<nav aria-label="Synchronized seek"><button data-local="0">Border · 0 / 12.15 s</button>
<button data-local="2.54">Fill · 2.54 / 14.69 s</button><button data-local="20">Later · 20 / 32.15 s</button></nav>
<p id="status" role="status">Paused. Choose a moment, then play one clip.</p>
<section class="grid" aria-label="Recording and candidates">''' + '\n'.join(cards) + '''</section>
<h2>Acceleration-aware evidence</h2><p>The plot uses a separate A-only fundamental chirp, not the full audition mix.
Its entire window follows synthesized signed displacement and acceleration. Scores are arbitrary spectral contrast, not likelihood or significance.</p>
<img src="scores.svg" alt="Bottom-region actual scores versus circular control mean and maximum at 4096 and 8192 samples">
<p>2.5 and 5 were selected after examining this same recording. Stationary tones are suppressed by regional median whitening,
but harmonic ambiguity and background/AGC confounds remain. The offset and early/late checks are not independent validation.</p>
<footer><a href="REPORT.md">Full report and all regional scores</a> · <a href="report.json">Hashes, profiles, and controls (JSON)</a>
<p><small>Standard 100%, complete square, only ends trimmed, Skip Silence off: user reports, not independent measurements.
Phone wedged through the top hatch, otherwise closed; AGC unknown. No defaults changed.</small></p></footer>
<script>
const players = [...document.querySelectorAll('audio')];
const status = document.getElementById('status');
const inSeekableRange = (player, target) => {
    for (let i = 0; i < player.seekable.length; i++) {
        if (target >= player.seekable.start(i) && target <= player.seekable.end(i)) return true;
    }
    return false;
};
const mediaMessage = (player, message) => {
    player.closest('article').querySelector('.media-status').textContent = message;
};
for (const player of players) {
    player.addEventListener('play', () => {
        for (const other of players) if (other !== player) other.pause();
    });
    player.addEventListener('error', () => {
        delete player.dataset.seekTarget;
        const reasons = {1: 'loading aborted', 2: 'network/loading failure',
            3: 'audio decoding failure', 4: 'unsupported codec or source'};
        const message = `Codec/loading error: ${reasons[player.error?.code] || 'unknown media failure'}. ` +
            'Try the direct WAV download; check server byte-range support if seeking fails.';
        mediaMessage(player, message);
        status.textContent = `${player.getAttribute('aria-label')}: ${message}`;
    });
    player.addEventListener('seeked', () => {
        if (player.dataset.seekTarget === undefined) return;
        const target = Number(player.dataset.seekTarget);
        const verified = !player.error && !player.seeking && inSeekableRange(player, target) &&
            Math.abs(player.currentTime - target) <= 0.05;
        mediaMessage(player, verified ? `Seek confirmed at ${player.currentTime.toFixed(2)} s. Paused; press play to listen.` :
            'Seek not confirmed. Check loading/byte-range support or use the WAV download.');
        delete player.dataset.seekTarget;
    });
}
for (const button of document.querySelectorAll('button[data-local]')) {
  button.addEventListener('click', () => {
    const local = Number(button.dataset.local);
        status.textContent = 'Players paused. Seek requested; see each player for completion or loading errors.';
    for (const player of players) {
      player.pause();
            delete player.dataset.seekTarget;
            const target = local + Number(player.dataset.offset);
            if (player.error || !Number.isFinite(target) || !inSeekableRange(player, target)) {
                mediaMessage(player, 'Cannot seek: codec/loading error or target outside available seekable ranges. Wait for loading and retry, or download the WAV.');
                continue;
            }
            player.dataset.seekTarget = String(target);
            mediaMessage(player, `Seeking to ${target.toFixed(2)} s; awaiting confirmation.`);
            try { player.currentTime = target; }
            catch (error) {
                delete player.dataset.seekTarget;
                mediaMessage(player, `Seek failed (loading/codec): ${error.message}`);
            }
    }
  });
}
</script></body></html>\n'''


def generate(bundle, output=None):
    bundle = Path(bundle).absolute()
    output = Path(output).absolute() if output is not None else bundle / CANDIDATE_DIR
    manifest, analysis, before, inputs = preflight(bundle, output)
    module_hashes = {name: baseline.file_hash(ROOT / name) for name in MODULES}
    plan, context, _, _ = baseline.make_plan((bundle / baseline.FULL_GCODE).read_bytes())
    if (len(plan.moves) != analysis['planned_moves']
            or not math.isclose(plan.total_duration_s, analysis['nominal_plan_duration_s'], rel_tol=0, abs_tol=1e-10)):
        raise ValueError('Current plan differs from frozen baseline; refusing to retime')
    shift = offset_samples(analysis['alignment'])
    decode_args = ['-v', 'error', '-nostdin', '-i', str(bundle / 'raw/New Recording 15 copy.m4a'),
                   '-ac', '1', '-ar', str(RATE), '-f', 'f32le', 'pipe:1']
    audio = np.frombuffer(subprocess.run(['ffmpeg', *decode_args], check=True, capture_output=True).stdout, dtype='<f4')
    if not np.isfinite(audio).all() or len(audio) / RATE != analysis['recording_duration_s']:
        raise ValueError('Decoded recording differs from preserved duration or is nonfinite')
    version = subprocess.run(['ffmpeg', '-version'], check=True, capture_output=True, text=True).stdout
    with TemporaryDirectory(prefix='petg-acoustic-') as temporary:
        scratch = Path(temporary)
        scratch_paths = [*(scratch / name for name in OUTPUT_NAMES),
                         *(scratch / f'diagnostic_{rate:g}.wav' for rate in RATES)]
        check_output_paths([*(output / name for name in OUTPUT_NAMES), *scratch_paths], inputs)
        playback = write_recording_playback(audio, scratch / PLAYBACK_NAME)
        candidates, signals, diagnostic_renders = [], {}, []
        # Verify reproduction before any final destination is opened.
        for rate in (8.0, 2.5, 5.0):
            path = scratch / candidate_name(rate)
            audition = render_audio(plan, path, profile=audition_profile(rate), motors=True, fans=False)
            if rate == 8 and audition['sha256'] != BASELINE_SHA:
                raise ValueError('8-cycle WAV differs from original baseline; refusing publication')
            audition['path'] = path.name
            candidates.append({'cycles_per_mm': rate, 'render': audition})
            diagnostic_path = scratch / f'diagnostic_{rate:g}.wav'
            diagnostic = render_audio(plan, diagnostic_path, profile=diagnostic_profile(rate), motors=True, fans=False)
            diagnostic['path'] = 'temporary diagnostic (not retained)'
            diagnostic_renders.append({'cycles_per_mm': rate, 'render': diagnostic})
            signals[rate] = read_pcm16(diagnostic_path)
        candidates.sort(key=lambda row: row['cycles_per_mm'])
        diagnostic_renders.sort(key=lambda row: row['cycles_per_mm'])
        report = {
            'schema_version': 1, 'exploratory': True, 'calibrated': False, 'validated': False,
            'defaults_changed': False, 'candidate_rates_cycles_per_mm': list(RATES),
            'source': manifest['source'],
            'preserved_bundle_sha256': before,
            'original_baseline_sha256': BASELINE_SHA, 'candidate_8_matches_baseline': True,
            'historical_baseline_module_sha256': manifest['software']['source_module_sha256'],
            'software': {'source_module_sha256': module_hashes, 'path_basis': 'gcode_music project root',
                         'python': platform.python_version(), 'numpy': np.__version__, 'ffmpeg': version,
                         'decode_arguments': [*decode_args[:4], 'raw/New Recording 15 copy.m4a', *decode_args[5:]]},
            'fixed_alignment': {'offset_s': analysis['alignment']['offset_s'], 'offset_hops': shift // HOP,
                                'offset_samples': shift, 'time_scale': 1.0, 'refitted': False,
                                'analysis_sha256': ANALYSIS_SHA, 'manifest_checked': True,
                                'clock_equation': 'recording_s = local_s + offset_s'},
            'plan': {'moves': len(plan.moves), 'duration_s': plan.total_duration_s,
                     'context': asdict(context), 'planner_config': asdict(plan.config)},
            'recording': {'samples': len(audio), 'duration_s': len(audio) / RATE,
                          'sample_rate_hz': RATE, 'dtype': 'ffmpeg f32le mono',
                          'rms': float(np.sqrt(np.mean(audio.astype(float)**2))),
                          'absolute_peak': float(np.max(np.abs(audio)))},
            'recording_playback': playback,
            'user_confirmations': manifest['user_confirmations'],
            'post_fit_user_timing_estimates': manifest['user_timing_estimates'],
            'candidates': candidates, 'diagnostic_renders': diagnostic_renders,
            'method': {'sample_rate_hz': RATE, 'hop_samples': HOP, 'windows_samples': list(WINDOWS),
                       'window': 'numpy.hanning (symmetric Hann)', 'band_hz_inclusive': list(BAND),
                       'local_start_sample': 0, 'padding': False, 'epsilon': EPSILON,
                       'model': 'render_audio/sample_motion signed displacement, A only, fundamental only; PCM16 / 32767',
                       'weights': 'nonnegative linear in-band power / frame in-band power sum; exclude zero sums',
                       'residual': '10log10(power+epsilon) minus regional per-frequency time median, then per-frame frequency median',
                       'score': 'mean_frames(sum_bins(weights * observed_residual)); arbitrary dB contrast',
                       'half_whitening': 'inherit bottom-region residual, then select full-window half frames',
                       'controls': '15 circular model-weight and validity-mask rolls within scored region, rounded linspace(ceil(.1*n),floor(.9*n),15)',
                       'significance_test': False, 'fft_batch_frames': 128},
            'scores': diagnostics(signals, audio, shift), 'limitations': CAVEATS,
        }
        recording_link = quote(os.path.relpath(bundle / 'raw/New Recording 15 copy.m4a', output), safe='/')
        (scratch / 'REPORT.md').write_text(markdown_report(report))
        (scratch / 'scores.svg').write_text(score_svg(report))
        (scratch / 'index.html').write_text(preview_html(report, recording_link))
        report['artifact_sha256'] = {name: baseline.file_hash(scratch / name)
                                     for name in OUTPUT_NAMES if name != 'report.json'}
        (scratch / 'report.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
        preflight(bundle, output)
        if bundle_snapshot(bundle) != before:
            raise ValueError('Preserved bundle changed during generation')
        if any(baseline.file_hash(ROOT / name) != digest for name, digest in module_hashes.items()):
            raise ValueError('Source modules changed during generation')
        output.mkdir(parents=True, exist_ok=True)
        for name in OUTPUT_NAMES:
            shutil.copyfile(scratch / name, output / name)
        if bundle_snapshot(bundle) != before:
            raise ValueError('Preserved bundle changed during publication')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, default=DEFAULT_BUNDLE)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = generate(args.bundle, args.output)
    print(json.dumps([row for row in report['scores'] if row['region'] == 'bottom'], indent=2))


if __name__ == '__main__':
    main()