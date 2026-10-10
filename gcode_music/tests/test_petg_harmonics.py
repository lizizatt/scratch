"""Full-mixture synthetic checks and strict frozen-input/publication contracts."""

from dataclasses import asdict, replace
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import shutil
from urllib.parse import unquote
import wave

import numpy as np
import pytest

from gcode_source import parse_source
from motion_planner import PlannerConfig, plan_motion, sample_motion
from motion_timeline import ExecutionContext
from motor_audio import AudioProfile, render_audio
from scripts import compare_petg_harmonics as subject

BUNDLE = subject.DEFAULT_BUNDLE
acoustic = subject.acoustic


def test_profiles_only_change_ab_rate_and_all_voice_harmonics():
    defaults = asdict(AudioProfile())
    for rate in subject.RATES:
        for ablation, weights in subject.ABLATIONS.items():
            profile = asdict(subject.profile_for(rate, ablation))
            assert profile.pop('acoustic_cycles_per_mm') == (rate, rate, 40, 8)
            assert profile.pop('harmonic_weights') == weights
            assert profile == {key: value for key, value in defaults.items()
                               if key not in ('acoustic_cycles_per_mm', 'harmonic_weights')}


@pytest.fixture(scope='module')
def synthetic(tmp_path_factory):
    directory = tmp_path_factory.mktemp('harmonic-chirps')
    commands = parse_source(('G91\nM204 S110\n' + '\n'.join(
        f'G1 X{distance} Y{y} E{e} F{feed}' for distance, y, e, feed in
        [(45, 8, 1.7, 5100), (-78, 19, 2.3, 6600), (32, -14, .8, 4200),
         (-105, -6, 2.1, 7200), (61, 17, 1.6, 5400), (-38, -10, 1.9, 3900),
         (94, 4, 2.4, 6300)])).encode())
    plan = plan_motion(commands, ExecutionContext((0, 0, 0), 0, 'absolute', 'relative', 'mm', 600))
    assert any(phase.acceleration_mm_s2 != 0 for move in plan.moves for phase in move.phases)
    signals = {}
    for rate in subject.RATES:
        for ablation in subject.ABLATIONS:
            identity = subject.profile_id(rate, ablation)
            path = directory / (identity + '.wav')
            render_audio(plan, path, profile=subject.profile_for(rate, ablation), motors=True, fans=False)
            signals[identity] = acoustic.read_pcm16(path)
    times = np.arange(len(signals['full_5'])) / subject.RATE
    return plan, signals, .8 * np.sin(2 * np.pi * 937.5 * times)


@pytest.mark.parametrize('window', subject.WINDOWS)
@pytest.mark.parametrize('identity', ['full_2p5', 'full_5', 'full_8'])
def test_nonperiodic_full_profile_rate_recovery_with_strong_fixed_tone(synthetic, window, identity):
    _, signals, tone = synthetic
    assert np.sqrt(np.mean(tone**2)) > 5 * np.sqrt(np.mean(signals[identity]**2))
    starts = np.arange(0, len(tone) - window + 1, subject.HOP)
    observed = acoustic.stft_power(signals[identity] + tone, window, starts)
    scores = {name: acoustic.score_spectrogram(acoustic.stft_power(signals[name], window, starts), observed)
              for name in ('full_2p5', 'full_5', 'full_8')}
    assert max(scores, key=lambda name: scores[name]['actual_db']) == identity
    assert scores[identity]['actual_minus_control_mean_db'] > 0
    assert scores[identity]['actual_minus_control_max_db'] > 0
    if identity == 'full_2p5' and window == 4096:
        # This known synthetic counterexample prevents treating contrast ranking
        # as guaranteed rate recovery, even when the aligned score recovers it.
        assert scores['full_5']['actual_minus_control_mean_db'] > scores[identity]['actual_minus_control_mean_db']


@pytest.mark.parametrize('window', subject.WINDOWS)
def test_fixed_tone_no_motion_null_and_silent_renderer(synthetic, tmp_path, window):
    _, signals, tone = synthetic
    starts = np.arange(0, len(tone) - window + 1, subject.HOP)
    observed = acoustic.stft_power(tone, window, starts)
    for signal in signals.values():
        score = acoustic.score_spectrogram(acoustic.stft_power(signal, window, starts), observed)
        assert abs(score['actual_minus_control_mean_db']) < .02
        assert score['actual_minus_control_max_db'] < .02
    plan = plan_motion(parse_source(b'G4 S2\n'), ExecutionContext((0, 0, 0), 0, 'absolute', 'relative', 'mm', 600))
    path = tmp_path / 'no-motion.wav'
    render_audio(plan, path, profile=subject.profile_for(5, 'full'), motors=True, fans=False)
    silence = acoustic.read_pcm16(path)
    assert np.count_nonzero(silence) == 0
    starts = np.arange(0, len(silence) - window + 1, subject.HOP)
    score = acoustic.score_residual(acoustic.stft_power(silence, window, starts), np.zeros((len(starts), observed.shape[1])))
    assert score['frames_used'] == 0 and score['actual_db'] is None
    assert score['actual_minus_control_mean_db'] is None


@pytest.mark.parametrize('window', subject.WINDOWS)
def test_missing_fundamental_supports_both_harmonic_explanations(synthetic, window):
    plan, signals, tone = synthetic
    _, velocity = sample_motion(plan, np.arange(1000) * plan.total_duration_s / 1000)
    np.testing.assert_array_equal(abs(velocity[:, :2]) * 2.5 * 2, abs(velocity[:, :2]) * 5)
    assert not np.array_equal(signals['second_2p5'], signals['fundamental_5'])
    starts = np.arange(0, len(tone) - window + 1, subject.HOP)
    observed = acoustic.stft_power(signals['second_2p5'] + tone, window, starts)
    scores = {identity: acoustic.score_spectrogram(acoustic.stft_power(signals[identity], window, starts), observed)
              for identity in ('second_2p5', 'fundamental_5', 'fundamental_2p5')}
    # The lower physical fundamental is absent, yet the doubled-rate fundamental
    # follows its second harmonic. Neither spectral match identifies physical rate.
    for identity in ('second_2p5', 'fundamental_5'):
        assert scores[identity]['actual_minus_control_max_db'] > 0
        assert scores[identity]['actual_db'] > scores['fundamental_2p5']['actual_db']


def test_stationary_template_is_zero_contrast_by_construction():
    rng = np.random.default_rng(12)
    residual = rng.normal(size=(100, 8))
    median = rng.uniform(.01, 5, size=8)
    score = subject.stationary_control(median, residual)
    assert score['actual_db'] == pytest.approx(np.mean(residual @ (median / median.sum())))
    assert score['actual_minus_control_mean_db'] == score['actual_minus_control_max_db'] == 0
    assert score['control_scores_db'] == [score['actual_db']] * 15


def test_score_uses_mixed_pcm_power_not_independent_powers(synthetic, tmp_path):
    plan, signals, _ = synthetic
    path, stems = tmp_path / 'mixed.wav', tmp_path / 'stems'
    render_audio(plan, path, profile=subject.profile_for(5, 'full'), motors=True, fans=False, stems_dir=stems)
    starts, window = np.arange(0, 150000, subject.HOP), 4096
    mixed = acoustic.stft_power(signals['full_5'], window, starts)
    independent = sum(acoustic.stft_power(acoustic.read_pcm16(stems / (voice + '.wav')), window, starts)
                      for voice in ('A', 'B', 'Z', 'E'))
    assert np.max(abs(mixed - independent)) > 1
    residual = np.random.default_rng(2).normal(size=mixed.shape)
    observations = {window: (starts, {'test': (np.ones(len(starts), dtype=bool), residual, {'region': 'test'})})}
    score = subject.score_model(signals['full_5'], observations, 'full_5')[0]
    assert score['actual_db'] == acoustic.score_residual(mixed, residual)['actual_db']
    assert score['actual_db'] != acoustic.score_residual(independent, residual)['actual_db']


@pytest.mark.parametrize('kind', ['bundle', 'ancestor', 'candidates', 'inside-candidates', 'source-directory',
                                  'source-file', 'symlink-parent', 'symlink-file', 'hardlink-input',
                                  'hardlink-candidate', 'hardlink-own-source', 'pair-hardlink',
                                  'hardlink-external', 'directory-file', 'unrelated-output'])
def test_negative_destination_preflight_never_decodes(tmp_path, monkeypatch, kind):
    def unexpected(*args, **kwargs):
        pytest.fail('negative preflight must not decode or render')
    monkeypatch.setattr(subject.subprocess, 'run', unexpected)
    monkeypatch.setattr(subject, 'render_audio', unexpected)
    before = subject.bundle_snapshot(BUNDLE)
    output = tmp_path / 'output'
    if kind == 'bundle':
        output = BUNDLE
    elif kind == 'ancestor':
        output = BUNDLE.parent
    elif kind == 'candidates':
        output = BUNDLE / acoustic.CANDIDATE_DIR
    elif kind == 'inside-candidates':
        output = BUNDLE / acoustic.CANDIDATE_DIR / 'nested'
    elif kind == 'source-directory':
        output = subject.ROOT / 'scripts'
    elif kind == 'source-file':
        output = subject.ROOT / 'motor_audio.py'
    elif kind == 'symlink-parent':
        real = tmp_path / 'real'
        real.mkdir()
        output.symlink_to(real, target_is_directory=True)
    else:
        output.mkdir()
        first = output / subject.OUTPUT_NAMES[0]
        if kind == 'symlink-file':
            first.symlink_to(BUNDLE / 'baseline_motor.wav')
        elif kind == 'hardlink-input':
            first.hardlink_to(BUNDLE / 'baseline_motor.wav')
        elif kind == 'hardlink-candidate':
            first.hardlink_to(BUNDLE / acoustic.CANDIDATE_DIR / 'index.html')
        elif kind == 'hardlink-own-source':
            first.hardlink_to(Path(subject.__file__))
        elif kind == 'pair-hardlink':
            first.write_bytes(b'unchanged')
            (output / subject.OUTPUT_NAMES[1]).hardlink_to(first)
        elif kind == 'hardlink-external':
            external = tmp_path / 'unknown-source'
            external.write_bytes(b'unchanged')
            first.hardlink_to(external)
        elif kind == 'directory-file':
            first.mkdir()
        elif kind == 'unrelated-output':
            (output / 'unrelated.py').write_bytes(b'unchanged')
    report_path = output / 'report.json'
    existing_report = report_path.read_bytes() if report_path.is_file() else None
    with pytest.raises(ValueError):
        subject.generate(BUNDLE, output)
    assert subject.bundle_snapshot(BUNDLE) == before
    if existing_report is None:
        assert not report_path.exists()
    else:
        assert report_path.read_bytes() == existing_report


@pytest.mark.parametrize('name', subject.OUTPUT_NAMES)
def test_all_final_paths_protect_sources(tmp_path, name):
    output = tmp_path / 'output'
    output.mkdir()
    (output / name).hardlink_to(BUNDLE / acoustic.CANDIDATE_DIR / 'recording_playback.wav')
    with pytest.raises(ValueError, match='alias|Hardlink'):
        subject.preflight(BUNDLE, output)
    assert [path.name for path in output.iterdir()] == [name]


def test_existing_source_with_output_filename_is_not_overwritten(tmp_path, monkeypatch):
    output = tmp_path / 'source'
    output.mkdir()
    (output / 'index.html').write_bytes(b'original unrelated source')
    monkeypatch.setattr(subject, 'render_audio', lambda *args, **kwargs: pytest.fail('source overwrite'))
    with pytest.raises(ValueError, match='refusing overwrite'):
        subject.generate(BUNDLE, output)
    assert (output / 'index.html').read_bytes() == b'original unrelated source'
    assert not (output / 'report.json').exists()


@pytest.mark.parametrize('name', ['analysis.json', 'baseline_motor.wav', 'raw/New Recording 15 copy.m4a',
                                 'source/plate_1.full.gcode', 'acoustic_candidates/candidate_2p5.wav',
                                 'acoustic_candidates/report.json', 'acoustic_candidates/recording_playback.wav'])
def test_tampered_inputs_refused_before_output(tmp_path, monkeypatch, name):
    bundle = tmp_path / 'bundle'
    shutil.copytree(BUNDLE, bundle)
    (bundle / name).write_bytes(b'changed input')
    monkeypatch.setattr(subject.subprocess, 'run', lambda *args, **kwargs: pytest.fail('decoded tampered input'))
    output = tmp_path / 'never'
    with pytest.raises(ValueError, match='SHA256 mismatch'):
        subject.generate(bundle, output)
    assert not output.exists() and (bundle / name).read_bytes() == b'changed input'


def test_whole_inventory_includes_unmanifested_files_and_mtimes(tmp_path):
    bundle = tmp_path / 'bundle'
    shutil.copytree(BUNDLE, bundle)
    extra = bundle / acoustic.CANDIDATE_DIR / 'unmanifested.txt'
    extra.write_bytes(b'preserve too')
    *_, before, _ = subject.preflight(bundle, tmp_path / 'output')
    key = extra.relative_to(bundle).as_posix()
    assert before[key]['sha256'] == subject.baseline.file_hash(extra)
    extra.touch()
    assert before != subject.bundle_snapshot(bundle)


@pytest.mark.parametrize('field,value', [('offset_s', 12.16), ('time_scale', 1.01), ('shift_samples', 1214)])
def test_no_alignment_refit(field, value):
    alignment = json.loads((BUNDLE / 'analysis.json').read_text())['alignment']
    assert acoustic.offset_samples(alignment) == 583200
    alignment[field] = value
    with pytest.raises(ValueError):
        acoustic.offset_samples(alignment)


def test_plan_drift_refused_before_decode(tmp_path, monkeypatch):
    original = subject.baseline.make_plan
    def changed(*args):
        plan, *rest = original(*args)
        return replace(plan, total_duration_s=plan.total_duration_s + .01), *rest
    monkeypatch.setattr(subject.baseline, 'make_plan', changed)
    monkeypatch.setattr(subject.subprocess, 'run', lambda *args, **kwargs: pytest.fail('decoded changed plan'))
    with pytest.raises(ValueError, match='no retiming'):
        subject.generate(BUNDLE, tmp_path / 'never')
    assert not (tmp_path / 'never').exists()


@pytest.mark.parametrize('change', ['hash', 'frames'])
def test_render_drift_refused_without_full_run(tmp_path, monkeypatch, change):
    monkeypatch.setattr(subject, 'observation_windows', lambda *args: ({}, []))
    monkeypatch.setattr(subject, 'render_audio', lambda *args, **kwargs:
                        {'frames': 1491942 + (change == 'frames'), 'truncated': False, 'sha256': '0' * 64})
    with pytest.raises(ValueError, match='differs from'):
        subject.generate(BUNDLE, tmp_path / 'never')
    assert not (tmp_path / 'never').exists()


@pytest.mark.parametrize('kind', ['extra-bundle-file', 'bundle-mtime', 'source-hash', 'late-output-alias'])
def test_publication_rechecks_all_inputs_and_destinations_without_full_render(tmp_path, monkeypatch, kind):
    bundle, output = tmp_path / 'bundle', tmp_path / 'output'
    shutil.copytree(BUNDLE, bundle)
    archived = json.loads((bundle / acoustic.CANDIDATE_DIR / 'report.json').read_text())
    monkeypatch.setattr(subject, 'observation_windows', lambda *args: ({}, []))
    monkeypatch.setattr(subject, 'score_model', lambda *args: [])
    monkeypatch.setattr(acoustic, 'read_pcm16', lambda *args: np.zeros(1))
    real_hash = subject.baseline.file_hash
    calls = 0
    def hash_with_drift(path):
        if kind == 'source-hash' and calls == 12 and Path(path) == subject.ROOT / subject.MODULES[-1]:
            return '0' * 64
        return real_hash(path)
    monkeypatch.setattr(subject.baseline, 'file_hash', hash_with_drift)
    def stub_render(plan, path, profile, **kwargs):
        nonlocal calls
        calls += 1
        path.write_bytes(b'staged test artifact')
        if calls == 12:
            if kind == 'extra-bundle-file':
                (bundle / acoustic.CANDIDATE_DIR / 'new-input.txt').write_bytes(b'unexpected')
            elif kind == 'bundle-mtime':
                changed = bundle / acoustic.CANDIDATE_DIR / 'index.html'
                stat = changed.stat()
                os.utime(changed, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1000000))
            elif kind == 'late-output-alias':
                output.mkdir()
                (output / 'REPORT.md').hardlink_to(bundle / acoustic.CANDIDATE_DIR / 'REPORT.md')
        return {'frames': 1491942, 'truncated': False,
                'sha256': archived['artifact_sha256'][acoustic.candidate_name(profile.acoustic_cycles_per_mm[0])]}
    monkeypatch.setattr(subject, 'render_audio', stub_render)
    with pytest.raises(ValueError, match='changed|alias|Hardlink'):
        subject.generate(bundle, output)
    assert calls == 12
    assert not (output / 'report.json').exists()
    assert not (output / 'full_8.wav').exists()


def test_staging_paths_checked_before_render(tmp_path, monkeypatch):
    scratch = tmp_path / 'staging'
    scratch.mkdir()
    (scratch / 'full_8.wav').symlink_to(BUNDLE / 'baseline_motor.wav')
    class Staging:
        def __enter__(self):
            return str(scratch)
        def __exit__(self, *args):
            return False
    monkeypatch.setattr(subject, 'TemporaryDirectory', lambda **kwargs: Staging())
    monkeypatch.setattr(subject, 'observation_windows', lambda *args: ({}, []))
    monkeypatch.setattr(subject, 'render_audio', lambda *args, **kwargs: pytest.fail('unsafe staging render'))
    with pytest.raises(ValueError, match='Symlink'):
        subject.generate(BUNDLE, tmp_path / 'output')
    assert not (tmp_path / 'output').exists()


@pytest.fixture(scope='module')
def fresh_runs(tmp_path_factory):
    directory = tmp_path_factory.mktemp('harmonic-fresh')
    first, second = directory / 'first', directory / 'second'
    before = subject.bundle_snapshot(BUNDLE)
    defaults = asdict(AudioProfile()), asdict(PlannerConfig())
    report = subject.generate(BUNDLE, first)
    other = subject.generate(BUNDLE, second)
    assert subject.bundle_snapshot(BUNDLE) == before
    assert defaults == (asdict(AudioProfile()), asdict(PlannerConfig()))
    assert report == other
    for name in subject.OUTPUT_NAMES:
        assert subject.baseline.file_hash(first / name) == subject.baseline.file_hash(second / name)
    return first, report


def test_two_fresh_generations_metadata_hashes_and_inventory(fresh_runs):
    output, report = fresh_runs
    assert set(path.name for path in output.iterdir()) == set(subject.OUTPUT_NAMES)
    assert len(report['profiles']) == 12 and len(report['scores']) == 96
    assert not any(report[key] for key in ('calibrated', 'validated', 'defaults_changed', 'fitted'))
    assert report['input_inventory'] == subject.bundle_snapshot(BUNDLE)
    assert 'acoustic_candidates/report.json' in report['input_inventory']
    assert report['frozen_hashes']['archive_report_sha256'] == subject.ARCHIVE_REPORT_SHA
    assert report['fixed_alignment']['offset_samples'] == 583200
    assert report['fixed_alignment']['time_scale'] == 1
    assert report['plan']['frames'] == 1491942
    analysis = json.loads((BUNDLE / 'analysis.json').read_text())
    assert report['plan']['duration_s'] == analysis['nominal_plan_duration_s']
    for profile in report['profiles']:
        render = profile['render']
        assert render['frames'] == report['plan']['frames']
        assert render['planned_duration_sec'] == report['plan']['duration_s']
        assert render['clipped_samples'] == 0 and not render['truncated']
        assert render['motors'] and not render['fans']
        assert len(render['sha256']) == 64
        if profile['ablation'] == 'full':
            assert render['sha256'] == profile['archived_full_sha256']
            if profile['ab_rate_cycles_per_mm'] == 8:
                assert render['sha256'] == acoustic.BASELINE_SHA
        if profile['retained']:
            assert render['sha256'] == subject.baseline.file_hash(output / render['path'])
            with wave.open(str(output / render['path'])) as stream:
                assert (stream.getnframes(), stream.getframerate(), stream.getsampwidth(), stream.getnchannels()) == (1491942, 48000, 2, 1)
        else:
            assert render['path'] is None
    for name, digest in report['artifact_sha256'].items():
        assert digest == subject.baseline.file_hash(output / name)
    for name, digest in report['software']['source_module_sha256'].items():
        assert digest == subject.baseline.file_hash(subject.ROOT / name)
    assert report['software']['decode_arguments'] == [
        '-v', 'error', '-nostdin', '-i', 'raw/New Recording 15 copy.m4a', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']
    for name in ('report.json', 'REPORT.md', 'index.html'):
        text = (output / name).read_text()
        assert 'petg-harmonics-' not in text
    def check_relative_strings(value):
        if isinstance(value, dict):
            for child in value.values():
                check_relative_strings(child)
        elif isinstance(value, list):
            for child in value:
                check_relative_strings(child)
        elif isinstance(value, str):
            assert not value.startswith(('/home/', '/tmp/'))
    check_relative_strings(report)
    for row in report['scores']:
        assert len(row['control_scores_db']) == 15
        assert row['actual_minus_control_mean_db'] == row['actual_db'] - row['control_mean_db']
        assert row['actual_minus_control_max_db'] == row['actual_db'] - row['control_max_db']
        assert row['normalization_region'] == ('outer' if row['region'] == 'outer' else 'bottom')
    assert len(report['background']) == 8
    for row in report['background']:
        assert len(row['top_stationary_bins']) == 8
        assert row['stationary_template_control']['actual_minus_control_mean_db'] == 0
        assert row['stationary_template_control']['actual_minus_control_max_db'] == 0


def test_generated_links_and_native_exclusive_playback(fresh_runs):
    output, report = fresh_runs
    class Links(HTMLParser):
        def __init__(self):
            super().__init__()
            self.paths, self.players = [], []
        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag in ('audio', 'a'):
                self.paths.append(attrs['src' if tag == 'audio' else 'href'])
            if tag == 'audio':
                self.players.append(attrs)
    page = (output / 'index.html').read_text()
    parsed = Links()
    parsed.feed(page)
    assert len(parsed.players) == 6
    assert all('controls' in player and 'autoplay' not in player for player in parsed.players)
    assert 'other.pause()' in page and '.play()' not in page
    assert 'quieter at the shared fixed gain' in page
    for link in parsed.paths:
        assert (output / unquote(link)).is_file()
    assert (output / unquote(report['listening']['playback'])).resolve() == BUNDLE / acoustic.CANDIDATE_DIR / acoustic.PLAYBACK_NAME


def test_existing_intact_output_can_be_regenerated_but_tampering_refused(fresh_runs, tmp_path):
    output, _ = fresh_runs
    subject.preflight(BUNDLE, output)
    changed = tmp_path / 'changed'
    shutil.copytree(output, changed)
    (changed / 'index.html').write_bytes(b'unrelated replacement source')
    with pytest.raises(ValueError, match='intact harmonic report'):
        subject.preflight(BUNDLE, changed)
    assert (changed / 'index.html').read_bytes() == b'unrelated replacement source'


def test_half_windows_inherit_bottom_whitening_and_exact_offset(monkeypatch):
    count, shift = 1491942, 583200
    captured = []
    def fake_stft(audio, window, starts):
        captured.append(starts.copy())
        return np.arange(len(starts) * 3).reshape(-1, 3).astype(float) + 1
    monkeypatch.setattr(acoustic, 'stft_power', fake_stft)
    # Keep frequency metadata consistent with the fake three-bin STFT.
    monkeypatch.setattr(np.fft, 'rfftfreq', lambda *args: np.array([100., 200., 300.]))
    observations, _ = subject.observation_windows(np.zeros(shift + count), count, shift)
    for index, (window, (starts, regions)) in enumerate(observations.items()):
        np.testing.assert_array_equal(captured[index], starts + shift)
        assert starts[0] == 0 and starts[-1] + window <= count
        bottom_mask, bottom_residual, _ = regions['bottom']
        for name in ('bottom_early', 'bottom_late'):
            mask, residual, metadata = regions[name]
            np.testing.assert_array_equal(residual, bottom_residual[mask[bottom_mask]])
            lo, hi = metadata['local_range_s']
            assert min(starts[mask]) / subject.RATE >= lo
            assert max(starts[mask] + window) / subject.RATE <= hi