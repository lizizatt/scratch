"""Fixed harmonic hypotheses against one frozen PETG capture; offline, not fitting."""

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

from scripts import compare_petg_acoustics as acoustic
from motor_audio import AudioProfile, render_audio

baseline = acoustic.baseline
RATE, HOP, WINDOWS = acoustic.RATE, acoustic.HOP, acoustic.WINDOWS
RATES, REGIONS = acoustic.RATES, acoustic.REGIONS
DEFAULT_BUNDLE = acoustic.DEFAULT_BUNDLE
DEFAULT_OUTPUT = ROOT / 'log/petg_harmonics'
MODULES = (*acoustic.MODULES, 'scripts/compare_petg_harmonics.py')
ARCHIVE_REPORT_SHA = 'caa73470a202d0161fbc7a0bbfc9acee5b93c0390acc29176444d529d2a523be'
ABLATIONS = {'full': (1, .32, .12, .06), 'fundamental': (1,),
             'second': (0, .32), 'upper': (0, .32, .12, .06)}
SELECTED = ('full_2p5', 'full_5', 'full_8', 'second_2p5', 'fundamental_5')
OUTPUT_NAMES = (*(name + '.wav' for name in SELECTED), 'report.json', 'REPORT.md', 'index.html')


def profile_id(rate, ablation):
    return ablation + '_' + f'{rate:g}'.replace('.', 'p')


def profile_for(rate, ablation):
    return AudioProfile(acoustic_cycles_per_mm=(rate, rate, 40, 8),
                        harmonic_weights=ABLATIONS[ablation])


def bundle_snapshot(bundle):
    """Inventory every file and directory, including candidates and directory mtimes."""
    bundle = Path(bundle)
    inventory = {}
    for path in [bundle, *sorted(bundle.rglob('*'))]:
        if path.is_symlink():
            raise ValueError('Symlink preserved input refused')
        stat = path.stat()
        item = {'kind': 'directory' if path.is_dir() else 'file', 'mtime_ns': stat.st_mtime_ns}
        if path.is_file():
            item.update(size_bytes=stat.st_size, sha256=baseline.file_hash(path))
        elif not path.is_dir():
            raise ValueError('Nonregular preserved input refused')
        inventory[path.relative_to(bundle).as_posix()] = item
    return inventory


def check_output_paths(outputs, inputs):
    outputs = list(outputs)
    acoustic.check_output_paths(outputs, inputs)
    # Refuse even hardlinks to unknown files outside the protected input inventory.
    for path in outputs:
        if path.exists() and path.stat().st_nlink != 1:
            raise ValueError('Hardlink output refused')


def protected_inputs(bundle, inventory):
    # Existing project source/assets directories are never generation destinations.
    return [*(bundle / name for name in inventory),
            *(ROOT / name for name in MODULES),
            *(path for path in ROOT.iterdir() if path.name != 'log')]


def preflight(bundle, output):
    bundle, output = Path(bundle).absolute(), Path(output).absolute()
    src, dest = bundle.resolve(), output.resolve()
    if dest == src or src in dest.parents or dest in src.parents:
        raise ValueError('Output conflicts with preserved bundle or ancestor')
    if any(path.is_symlink() for path in (bundle, *bundle.parents)):
        raise ValueError('Symlink preserved input ancestor refused')
    # Check destinations before expensive hashing or decoding, including every file.
    check_output_paths([output / name for name in OUTPUT_NAMES], protected_inputs(bundle, {}))
    if output.exists():
        if not output.is_dir() or any(path.name not in OUTPUT_NAMES for path in output.iterdir()):
            raise ValueError('Existing output directory contains unrelated inputs')
        if any(output.iterdir()):
            if {path.name for path in output.iterdir()} != set(OUTPUT_NAMES):
                raise ValueError('Existing output is not a complete harmonic report; refusing overwrite')
            previous = json.loads((output / 'report.json').read_text())
            artifacts = previous.get('artifact_sha256', {})
            if (previous.get('frozen_hashes', {}).get('archive_report_sha256') != ARCHIVE_REPORT_SHA
                    or set(artifacts) != set(OUTPUT_NAMES) - {'report.json'}
                    or any(baseline.file_hash(output / name) != digest for name, digest in artifacts.items())):
                raise ValueError('Existing output is not an intact harmonic report; refusing overwrite')
    manifest, analysis, _, _ = acoustic.preflight(bundle, output)
    archive_dir = bundle / acoustic.CANDIDATE_DIR
    if baseline.file_hash(archive_dir / 'report.json') != ARCHIVE_REPORT_SHA:
        raise ValueError('Pinned archived report SHA256 mismatch')
    archive = json.loads((archive_dir / 'report.json').read_text())
    for name, digest in archive['artifact_sha256'].items():
        if Path(name).name != name or name in ('', '.', '..'):
            raise ValueError('Invalid archived artifact path')
        if baseline.file_hash(archive_dir / name) != digest:
            raise ValueError(f'Archived artifact SHA256 mismatch: {name}')
    inventory = bundle_snapshot(bundle)
    inputs = protected_inputs(bundle, inventory)
    check_output_paths([output / name for name in OUTPUT_NAMES], inputs)
    return manifest, analysis, archive, inventory, inputs


def observation_windows(audio, count, shift):
    if len(audio) < shift + count:
        raise ValueError('Recording lacks full frozen-offset overlap')
    result, background = {}, []
    for window in WINDOWS:
        starts = np.arange(0, count - window + 1, HOP, dtype=int)
        measured = acoustic.stft_power(audio, window, starts + shift)
        masks = {name: acoustic.region_mask(starts, window, bounds) for name, bounds in REGIONS.items()}
        residuals = {name: acoustic.observed_residual(measured[masks[name]]) for name in ('outer', 'bottom')}
        frequencies = np.fft.rfftfreq(window, 1 / RATE)
        frequencies = frequencies[(frequencies >= acoustic.BAND[0]) & (frequencies <= acoustic.BAND[1])]
        regions = {}
        for name, mask in masks.items():
            reference = 'outer' if name == 'outer' else 'bottom'
            residual = residuals[reference][mask[masks[reference]]]
            median = np.median(measured[mask], axis=0)
            stationary = stationary_control(median, residual)
            peaks = np.argsort(-median, kind='stable')[:8]
            centers = (starts[mask] + window / 2) / RATE
            metadata = {'window_samples': window, 'region': name,
                        'local_range_s': list(REGIONS[name]),
                        'center_range_s': [float(centers[0]), float(centers[-1])],
                        'normalization_region': reference, 'tiny_region': name == 'outer'}
            regions[name] = (mask, residual, metadata)
            background.append({**metadata, 'frequencies_hz': frequencies.tolist(),
                               'time_median_power': median.tolist(),
                               'top_stationary_bins': [
                                   {'frequency_hz': float(frequencies[i]), 'median_power': float(median[i])}
                                   for i in peaks], 'stationary_template_control': stationary})
        result[window] = (starts, regions)
    return result, background


def stationary_control(median_power, residual):
    template = np.broadcast_to(median_power, residual.shape)
    score = acoustic.score_residual(template, residual)
    if score['actual_db'] is not None:
        # A circular roll of identical rows is identical, including its validity mask.
        # Avoid rounding in the mean of 15 equal floats obscuring this exact identity.
        assert all(value == score['actual_db'] for value in score['control_scores_db'])
        score.update(control_mean_db=score['actual_db'], control_max_db=score['actual_db'],
                     actual_minus_control_mean_db=0.0, actual_minus_control_max_db=0.0)
    return score


def score_model(signal, observations, identity):
    rows = []
    for window, (starts, regions) in observations.items():
        modeled = acoustic.stft_power(signal, window, starts)
        for mask, residual, metadata in regions.values():
            rows.append({'profile_id': identity, **metadata,
                         **acoustic.score_residual(modeled[mask], residual)})
        del modeled
    return rows


LIMITATIONS = [
    'Fixed hypothesis comparison, NOT fitting or calibration. No defaults or source modules changed; no hardware actions.',
    'Rates 2.5 and 5 were chosen after examining this capture. The +12.15 s offset was previously selected on this same recording, not independently measured. No held-out capture.',
    'No retiming, time stretch, duration truncation, or waveform gain normalization. Same master gain and default ABZE voice gains for every render. Ablations are quieter at this shared fixed gain, not loudness matched.',
    'Weights ablate harmonics on ALL ABZE voices. ZE base rates remain 40/8 cycles/mm; their harmonic content changes with each ablation.',
    'AB h2 at 2.5 shares frequency trajectories with AB h1 at 5. Harmonic phase offsets, amplitudes, coherent voice interference, and ZE trajectories differ. This is not waveform identity or physical fundamental identification.',
    'The model spectrum is power of the actual coherent ABZE PCM16 mixture, not a sum of independent voice powers. Signed displacement phase includes acceleration and reversals throughout every window.',
    'Scores are arbitrary dB spectral contrasts, not error, likelihood, significance, calibrated SPL, or evidence of a physical source identity. The 15 circular controls are dependent descriptive alignment checks, not independent trials.',
    'Only linear spectral weights are normalized within each model frame over 100..2000 Hz. This does not normalize audio gain. Zero-power frames are excluded; any nonzero leakage in quiet frames still receives a unit-sum weight.',
    'Regional per-bin time-median and per-frame frequency-median subtraction reduce stationary/broadband influence but do not isolate motors or remove real resonances, AGC, leakage, or correlated motion.',
    'Background tables describe regional time-median linear power and the eight strongest stationary bins (adjacent bins can be one peak). No bin is assigned to a physical component.',
    'Stationary-template negative controls repeat that regional median spectrum over all frames. Their aligned-minus-control contrast is zero by construction, not proof that real resonances have been removed.',
    'Outer has few frames and its own whitening. Both bottom halves inherit bottom whitening; only complete windows inside each half are scored and circular controls stay within that half.',
    'Observation is the original FFmpeg mono 48 kHz float32 AAC decode, not the archived quantized playback WAV. Models are PCM16 / 32767. AAC/phone processing and synthesis quantization differ.',
    'Fans omitted from synthesis are not assumed physically off. P3 S180 preceded this scope; hotend/board state, enclosure resonances and noise compensation are unknown. Phone/hatch contact may couple vibration; AGC is unknown.',
    'Standard 100%, complete square, end trims only and Skip Silence off are user reports. Rough timing landmarks supplied after alignment are not independent validation. Planner boundary and firmware behavior remain approximate.',
    'Historical source hashes may differ from current modules. Reproduction is checked using plan duration/frame count and all three archived full-render WAV hashes.',
    'In a nonperiodic accelerating synthetic full2.5 mixture plus a strong fixed tone, the 4096-sample aligned score recovers full2.5 among full profiles but actual-minus-control-mean favors full5. Contrast ranking is not guaranteed rate recovery; no scoring parameters were tuned to change this result.',
    'Preflight and post-generation preservation checks are not a lock against concurrent filesystem changes. Do not modify inputs or destinations while generating.',
]


def markdown_report(report):
    rows = '\n'.join(
        f'| {row["profile_id"]} | {row["window_samples"]} | {row["region"]} | '
        f'{row["frames_used"]}/{row["frames_total"]} | {acoustic.number(row["actual_db"])} | '
        f'{acoustic.number(row["control_mean_db"])} | {acoustic.number(row["control_max_db"])} | '
        f'{acoustic.number(row["actual_minus_control_mean_db"])} | '
        f'{acoustic.number(row["actual_minus_control_max_db"])} |' for row in report['scores'])
    peaks = '\n'.join(f'| {row["window_samples"]} | {row["region"]} | ' +
                      ', '.join(f'{item["frequency_hz"]:.2f}' for item in row['top_stationary_bins']) + ' |'
                      for row in report['background'])
    return f'''# PETG full-waveform harmonic comparison

Fixed hypotheses, not fitting. No calibration, defaults changes, or hardware actions.

AB rates: 2.5, 5, 8 cycles/mm. Full (1,.32,.12,.06), fundamental (1),
second (0,.32), upper (0,.32,.12,.06); applied to every ABZE voice.
ZE rates remain 40/8. Default voice gains and master gain 0.18 are unchanged.
All renders: {report['plan']['frames']} PCM16 frames, nominal plan {report['plan']['duration_s']:.12f} s.
All three full renders reproduce archived WAV hashes; full8 reproduces the baseline.
Recording clock = local clock + 12.15 s; no refit, retiming or gain normalization.

## Method

Actual mixed waveform power, not summed independent powers. Symmetric Hann windows
4096/8192, hop480, complete windows, 100..2000 Hz inclusive. Observation uses the
original FFmpeg mono48k float32 decode. Per-bin regional time-median whitening,
then per-frame frequency-median subtraction; bottom halves inherit bottom whitening.
Linear-power unit-sum model weights score the residual, averaged equally across
nonzero-power frames. Fifteen circular controls shift weights and validity mask
within each scored region. JSON contains exact settings, all controls and provenance.

## Scores (arbitrary dB contrast)

| Profile | Window | Region | Used/total | Actual | Control mean | Control max | Actual−mean | Actual−max |
|---|---:|---|---:|---:|---:|---:|---:|---:|
{rows}

## Fixed background influence

Top regional time-median power bins, Hz, descending power; adjacent bins need not
be separate peaks. Full linear spectra are in JSON. The stationary-template model
repeats each regional spectrum over frames: actual−mean and actual−max are zero
by construction. This is NOT proof that real resonances have been removed.

| Window | Region | Strongest stationary bins (Hz) |
|---:|---|---|
{peaks}

## Interpretation limits

AB h2 at2.5 and h1 at5 share frequency trajectories, but not phases, gains or ZE
content. A spectral preference does not identify the physical fundamental. Compare
the full profiles and ablations across both windows/halves before choosing another
real test; these same-capture checks do not establish a winning physical model.

''' + '\n'.join('- ' + text for text in LIMITATIONS) + '\n'


def preview_html(report):
    links = report['listening']
    cards = [f'<article><h2>Original capture / archived PCM playback</h2>'
             f'<p>Full recording clock; local +12.15 s. Underlying AAC is lossy.</p>'
             f'<audio controls preload="metadata" aria-label="Original capture" src="{html.escape(links["playback"], quote=True)}"></audio></article>']
    for identity in SELECTED:
        cards.append(f'<article><h2>{identity}</h2><p>Local clock; fixed gain, ABZE motors only.</p>'
                     f'<audio controls preload="metadata" aria-label="{identity}" src="{identity}.wav"></audio></article>')
    return '''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>PETG harmonic hypotheses</title>
<style>body{font:17px/1.6 system-ui;max-width:1000px;margin:auto;padding:24px;background:#101a26;color:#eaf0f6}
section{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
article{background:#1c2d40;padding:20px;border-radius:12px}audio{width:100%}a{color:#83dfd0}</style></head><body>
<h1>PETG: full-waveform harmonic hypotheses</h1><p>Not calibrated; no physical fundamental identification.
Ablations are quieter at the shared fixed gain. No loudness matching, retiming, or normalization.
Only AB rate changes; harmonic ablations affect all ABZE voices, with ZE rates fixed at40/8.</p>
<p>AB h2 at2.5 shares frequency trajectories with h1 at5, not waveform identity: phases, gains and ZE differ.</p>
<p>Choose one native player; starting it pauses the others. Recording = local +12.15 s.</p><section>''' + ''.join(cards) + '''</section>
<p><a href="REPORT.md">All regional scores and limitations</a> · <a href="report.json">Profiles, controls and hashes</a> ·
<a href="''' + html.escape(links['raw'], quote=True) + '''" download>Unchanged original AAC</a></p>
<script>const players=[...document.querySelectorAll('audio')];
for(const player of players) player.addEventListener('play',()=>{
  for(const other of players) if(other!==player) other.pause();
});</script></body></html>
'''


def generate(bundle=DEFAULT_BUNDLE, output=DEFAULT_OUTPUT):
    bundle, output = Path(bundle).absolute(), Path(output).absolute()
    manifest, analysis, archive, before, inputs = preflight(bundle, output)
    module_hashes = {name: baseline.file_hash(ROOT / name) for name in MODULES}
    plan, context, _, _ = baseline.make_plan((bundle / baseline.FULL_GCODE).read_bytes())
    if (len(plan.moves) != analysis['planned_moves'] or not math.isclose(
            plan.total_duration_s, analysis['nominal_plan_duration_s'], rel_tol=0, abs_tol=1e-10)):
        raise ValueError('Current plan differs from frozen baseline; no retiming permitted')
    with wave.open(str(bundle / 'baseline_motor.wav'), 'rb') as stream:
        count = stream.getnframes()
    shift = acoustic.offset_samples(analysis['alignment'])
    decode_args = ['-v', 'error', '-nostdin', '-i', 'raw/New Recording 15 copy.m4a',
                   '-ac', '1', '-ar', str(RATE), '-f', 'f32le', 'pipe:1']
    decoded = subprocess.run(['ffmpeg', *decode_args], cwd=bundle, check=True, capture_output=True).stdout
    audio = np.frombuffer(decoded, dtype='<f4')
    if not np.isfinite(audio).all() or len(audio) / RATE != analysis['recording_duration_s']:
        raise ValueError('Decoded recording differs from preserved duration or is nonfinite')
    version = subprocess.run(['ffmpeg', '-version'], check=True, capture_output=True, text=True).stdout
    observations, background = observation_windows(audio, count, shift)
    with TemporaryDirectory(prefix='petg-harmonics-') as temporary:
        scratch = Path(temporary)
        identities = [profile_id(rate, ablation) for rate in RATES for ablation in ABLATIONS]
        scratch_names = [*(identity + '.wav' for identity in identities), 'report.json', 'REPORT.md', 'index.html']
        check_output_paths([*(output / name for name in OUTPUT_NAMES),
                            *(scratch / name for name in scratch_names)], inputs)
        profiles, scores = [], []
        # Verify full8 first. Retain only selected WAVs, but score every rendered mixture.
        for rate in (8.0, 2.5, 5.0):
            for ablation in ABLATIONS:
                identity = profile_id(rate, ablation)
                path = scratch / (identity + '.wav')
                render = render_audio(plan, path, profile=profile_for(rate, ablation), motors=True, fans=False)
                if render['frames'] != count or render['truncated']:
                    raise ValueError('Render differs from frozen frame count')
                archived_hash = None
                if ablation == 'full':
                    archived_hash = archive['artifact_sha256'][acoustic.candidate_name(rate)]
                    if render['sha256'] != archived_hash or (rate == 8 and render['sha256'] != acoustic.BASELINE_SHA):
                        raise ValueError('Full render differs from archived/baseline WAV; refusing publication')
                render['path'] = path.name if identity in SELECTED else None
                profiles.append({'id': identity, 'ab_rate_cycles_per_mm': rate, 'ablation': ablation,
                                 'archived_full_sha256': archived_hash, 'retained': identity in SELECTED,
                                 'render': render})
                signal = acoustic.read_pcm16(path)
                scores.extend(score_model(signal, observations, identity))
                del signal
        profiles.sort(key=lambda row: identities.index(row['id']))
        scores.sort(key=lambda row: (identities.index(row['profile_id']), row['window_samples'], list(REGIONS).index(row['region'])))
        report = {
            'schema_version': 1, 'exploratory': True, 'calibrated': False, 'validated': False,
            'defaults_changed': False, 'fitted': False,
            'source': manifest['source'], 'input_inventory': before,
            'historical_baseline_module_sha256': manifest['software']['source_module_sha256'],
            'historical_candidate_module_sha256': archive['software']['source_module_sha256'],
            'software': {'source_module_sha256': module_hashes, 'path_basis': 'gcode_music project root',
                         'python': platform.python_version(), 'numpy': np.__version__, 'ffmpeg': version,
                         'decode_arguments': decode_args, 'decode_working_directory': 'preserved bundle'},
            'frozen_hashes': {'analysis_sha256': acoustic.ANALYSIS_SHA, 'baseline_wav_sha256': acoustic.BASELINE_SHA,
                              'archive_report_sha256': ARCHIVE_REPORT_SHA,
                              'manifest_sha256': before['manifest.json']['sha256'],
                              'full_gcode_sha256': baseline.GCODE_SHA256},
            'fixed_alignment': {'offset_s': 12.15, 'offset_hops': shift // HOP, 'offset_samples': shift,
                                'time_scale': 1.0, 'refitted': False,
                                'clock_equation': 'recording_s = local_s + offset_s'},
            'plan': {'moves': len(plan.moves), 'duration_s': plan.total_duration_s, 'frames': count,
                     'context': asdict(context), 'planner_config': asdict(plan.config)},
            'recording': {'samples': len(audio), 'duration_s': len(audio) / RATE, 'sample_rate_hz': RATE,
                          'dtype': 'FFmpeg mono f32le', 'decoded_f32le_sha256': baseline.sha256(decoded),
                          'source_sha256': baseline.RAW_HASHES['New Recording 15 copy.m4a']},
            'user_confirmations': manifest['user_confirmations'],
            'post_fit_user_timing_estimates': manifest['user_timing_estimates'],
            'profiles': profiles, 'scores': scores, 'background': background,
            'method': {'sample_rate_hz': RATE, 'hop_samples': HOP, 'windows_samples': list(WINDOWS),
                       'window': 'numpy.hanning (symmetric Hann)', 'band_hz_inclusive': list(acoustic.BAND),
                       'local_start_sample': 0, 'padding': False, 'epsilon': acoustic.EPSILON,
                       'model': 'render_audio PCM16 / 32767; abs(rfft(Hann * coherent ABZE mixture))**2',
                       'phase': 'signed cumulative displacement with default voice phase offsets',
                       'weights': 'linear in-band power / frame power sum; zero sums excluded',
                       'residual': '10log10(power+epsilon) minus regional per-bin time median, then per-frame frequency median',
                       'score': 'mean over valid frames of sum_bins(weights * observed residual)',
                       'half_whitening': 'inherit bottom whitening, subset complete half windows',
                       'controls': '15 circular weight/validity rolls: rint(linspace(ceil(.1*n),floor(.9*n),15))',
                       'stationary_template': 'repeat regional time-median linear power over frames; constant weights make aligned-control contrasts exactly zero',
                       'normalization': 'spectral weights only, never waveform time or gain',
                       'fft_batch_frames': 128},
            'limitations': LIMITATIONS,
            'listening': {key: quote(os.path.relpath(bundle / relative, output), safe='/') for key, relative in
                          [('playback', acoustic.CANDIDATE_DIR + '/' + acoustic.PLAYBACK_NAME),
                           ('raw', 'raw/New Recording 15 copy.m4a')]},
        }
        (scratch / 'REPORT.md').write_text(markdown_report(report), encoding='utf-8')
        (scratch / 'index.html').write_text(preview_html(report), encoding='utf-8')
        report['artifact_sha256'] = {name: baseline.file_hash(scratch / name) for name in OUTPUT_NAMES if name != 'report.json'}
        (scratch / 'report.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        _, _, _, after, _ = preflight(bundle, output)
        if after != before:
            raise ValueError('Preserved bundle content or mtimes changed during generation')
        if any(baseline.file_hash(ROOT / name) != digest for name, digest in module_hashes.items()):
            raise ValueError('Source modules changed during generation')
        output.mkdir(parents=True, exist_ok=True)
        for name in OUTPUT_NAMES:
            shutil.copyfile(scratch / name, output / name)
        if bundle_snapshot(bundle) != before:
            raise ValueError('Preserved bundle content or mtimes changed during publication')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, default=DEFAULT_BUNDLE)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    report = generate(args.bundle, args.output)
    print(json.dumps([row for row in report['scores'] if row['region'] == 'bottom'], indent=2))


if __name__ == '__main__':
    main()