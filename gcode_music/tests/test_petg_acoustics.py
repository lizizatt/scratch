"""Preservation, spectral controls, real renderer chirps, and fresh-run reproducibility."""

from dataclasses import asdict
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import subprocess
import wave
import xml.etree.ElementTree as ET

import numpy as np
import pytest

from gcode_source import parse_source
from motion_planner import PlannerConfig, plan_motion
from motion_timeline import ExecutionContext
from motor_audio import AudioProfile, render_audio
from scripts import compare_petg_acoustics as subject


BUNDLE = subject.DEFAULT_BUNDLE


def test_playback_quantization_clips_before_rounding_without_normalization(tmp_path):
    audio = np.array([-1.5, -1, -.5, -.1, 0, .1, .5, 1, 1.5], dtype='<f4')
    before = audio.copy()
    path = tmp_path / subject.PLAYBACK_NAME
    result = subject.write_recording_playback(audio, path)
    with wave.open(str(path), 'rb') as stream:
        assert (stream.getframerate(), stream.getnchannels(), stream.getsampwidth(),
                stream.getnframes(), stream.getcomptype()) == (48000, 1, 2, len(audio), 'NONE')
        pcm = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2')
    np.testing.assert_array_equal(pcm, [-32767, -32767, -16384, -3277, 0, 3277, 16384, 32767, 32767])
    np.testing.assert_array_equal(audio, before)
    assert result['frames'] == len(audio)
    assert result['prequantization_clipping_samples'] == 2
    assert result['sha256'] == subject.baseline.file_hash(path)
    quiet = tmp_path / 'quiet.wav'
    subject.write_recording_playback(audio[3:6], quiet)
    np.testing.assert_array_equal(subject.read_pcm16(quiet) * 32767, [-3277, 0, 3277])


@pytest.mark.parametrize('audio', [[], [[0]], [np.nan], [np.inf]])
def test_invalid_playback_audio_refused_before_open(tmp_path, audio):
    path = tmp_path / subject.PLAYBACK_NAME
    with pytest.raises(ValueError, match='finite mono'):
        subject.write_recording_playback(audio, path)
    assert not path.exists()


def test_saved_playback_matches_full_original_decode_and_pcm_header():
    output = BUNDLE / subject.CANDIDATE_DIR
    report = json.loads((output / 'report.json').read_text())
    playback = report['recording_playback']
    original = BUNDLE / playback['source']
    before = subject.baseline.file_hash(original), original.stat().st_mtime_ns
    audio = np.frombuffer(subprocess.run(
        ['ffmpeg', '-v', 'error', '-nostdin', '-i', str(original), '-ac', '1', '-ar', '48000',
         '-f', 'f32le', 'pipe:1'], check=True, capture_output=True).stdout, dtype='<f4')
    with wave.open(str(output / subject.PLAYBACK_NAME), 'rb') as stream:
        assert (stream.getframerate(), stream.getnchannels(), stream.getsampwidth(),
                stream.getcomptype()) == (48000, 1, 2, 'NONE')
        assert stream.getnframes() == len(audio) == playback['frames'] == report['recording']['samples']
        pcm = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2')
    np.testing.assert_array_equal(pcm, np.rint(np.clip(audio.astype(float), -1, 1) * 32767).astype('<i2'))
    assert playback['prequantization_clipping_samples'] == np.count_nonzero(np.abs(audio) > 1) == 0
    assert playback['duration_s'] == len(audio) / 48000 == report['recording']['duration_s']
    assert playback['sha256'] == report['artifact_sha256'][subject.PLAYBACK_NAME]
    assert before == (subject.baseline.file_hash(original), original.stat().st_mtime_ns)
    assert before[0] == subject.baseline.RAW_HASHES[original.name]


@pytest.fixture(scope='module')
def synthetic(tmp_path_factory):
    directory = tmp_path_factory.mktemp('acoustic-chirps')
    # Alternating unequal moves give acceleration, reversals, and nonperiodic timing.
    commands = parse_source(('G91\nM204 S110\n' + '\n'.join(
        f'G1 X{distance} F{feed}' for distance, feed in
        [(45, 5100), (-78, 6600), (32, 4200), (-105, 7200), (61, 5400), (-38, 3900), (94, 6300)])).encode())
    plan = plan_motion(commands, ExecutionContext((0, 0, 0), 0, 'absolute', 'relative', 'mm', 600))
    assert any(phase.acceleration_mm_s2 != 0 for move in plan.moves for phase in move.phases)
    signals = {}
    for rate in subject.RATES:
        path = directory / subject.candidate_name(rate)
        render_audio(plan, path, profile=subject.diagnostic_profile(rate), motors=True, fans=False)
        signals[rate] = subject.read_pcm16(path)
    time = np.arange(len(signals[5])) / subject.RATE
    return signals, .8 * np.sin(2 * np.pi * 937.5 * time)


@pytest.mark.parametrize('window', subject.WINDOWS)
def test_accelerating_renderer_known_rate_loud_fixed_tone_and_unrelated_shift(synthetic, window):
    signals, tone = synthetic
    starts = np.arange(0, len(tone) - window + 1, subject.HOP)
    observed = subject.stft_power(signals[5] + tone, window, starts)
    modeled = {rate: subject.stft_power(signal, window, starts) for rate, signal in signals.items()}
    scores = {rate: subject.score_spectrogram(power, observed) for rate, power in modeled.items()}
    assert max(scores, key=lambda rate: scores[rate]['actual_db']) == 5
    correct = scores[5]
    assert correct['actual_db'] > correct['control_max_db']
    unrelated = subject.stft_power(np.roll(signals[5], 2 * subject.RATE) + tone, window, starts)
    shifted = subject.score_spectrogram(modeled[5], unrelated)
    assert correct['actual_minus_control_mean_db'] > shifted['actual_minus_control_mean_db']
    assert correct['actual_db'] > shifted['actual_db']


@pytest.mark.parametrize('window', subject.WINDOWS)
def test_stationary_tone_null_does_not_support_moving_rate(synthetic, window):
    signals, tone = synthetic
    starts = np.arange(0, len(tone) - window + 1, subject.HOP)
    observed = subject.stft_power(tone, window, starts)
    for rate in subject.RATES:
        result = subject.score_spectrogram(subject.stft_power(signals[rate], window, starts), observed)
        # Hann leakage varies with tone phase: raw-zero contrast is not a valid null.
        # All three raw scores can differ without aligned evidence for any rate.
        assert abs(result['actual_minus_control_mean_db']) < .02
        assert result['actual_db'] <= result['control_max_db']


def test_score_matches_explicit_linear_weights_medians_and_circular_controls():
    rng = np.random.default_rng(32)
    model = rng.uniform(size=(80, 7))
    model[5:9] = 0
    observed = rng.uniform(.01, 8, size=model.shape)
    result = subject.score_spectrogram(model, observed)
    db = 10 * np.log10(observed + subject.EPSILON)
    residual = db - np.median(db, axis=0)
    residual -= np.median(residual, axis=1)[:, None]
    valid = model.sum(axis=1) > 0
    weights = model / np.where(valid, model.sum(axis=1), 1)[:, None]
    assert result['frames_excluded_zero_inband_power'] == 4
    for shift, value in zip([0, *result['control_shifts_frames']],
                            [result['actual_db'], *result['control_scores_db']]):
        expected = (np.roll(weights, shift, axis=0) * residual).sum(axis=1)[np.roll(valid, shift)].mean()
        assert value == pytest.approx(expected)
    assert result['control_mean_db'] == pytest.approx(np.mean(result['control_scores_db']))
    assert result['control_max_db'] == max(result['control_scores_db'])


def test_all_silent_models_are_excluded_without_confidence():
    result = subject.score_spectrogram(np.zeros((80, 3)), np.ones((80, 3)))
    assert result['frames_used'] == 0
    assert result['actual_db'] is None
    assert result['control_scores_db'] == [None] * 15
    assert result['actual_minus_control_max_db'] is None


def test_frame_background_removal_and_stationary_spectral_whitening():
    model = np.arange(240, dtype=float).reshape(80, 3) + 1
    power = np.exp(np.linspace(-2, 2, 80))[:, None] * np.array([1, 30, 900])[None, :]
    result = subject.score_spectrogram(model, power)
    assert abs(result['actual_db']) < 1e-12
    assert abs(result['actual_minus_control_mean_db']) < 1e-12
    np.testing.assert_allclose(subject.observed_residual(np.tile([1., 100, 3], (80, 1))), 0)


@pytest.mark.parametrize('bad', [np.nan, np.inf, -1])
def test_invalid_spectral_power_rejected(bad):
    model = np.ones((80, 3))
    observed = model.copy()
    observed[1, 1] = bad
    with pytest.raises(ValueError, match='power'):
        subject.score_spectrogram(model, observed)
    with pytest.raises(ValueError, match='spectral shapes'):
        subject.score_spectrogram(observed, model)


def test_control_shifts_are_reproducible_unique_and_nontrivial():
    shifts = subject.control_shifts(2838)
    np.testing.assert_array_equal(shifts, subject.control_shifts(2838))
    assert len(set(shifts)) == 15
    assert min(shifts) >= .1 * 2838 and max(shifts) <= .9 * 2838
    with pytest.raises(ValueError, match='too short'):
        subject.control_shifts(10)


@pytest.mark.parametrize('window', subject.WINDOWS)
def test_stft_exact_symmetric_hann_no_padding_and_full_region_windows(window):
    audio = np.random.default_rng(4).normal(size=100000)
    starts = np.array([0, 480, 960])
    result = subject.stft_power(audio, window, starts)
    bins = np.fft.rfftfreq(window, 1 / subject.RATE)
    use = (bins >= 100) & (bins <= 2000)
    expected = np.array([abs(np.fft.rfft(audio[start:start + window] * np.hanning(window)))[use]**2
                         for start in starts])
    np.testing.assert_array_equal(result, expected)
    with pytest.raises(ValueError, match='complete'):
        subject.stft_power(audio, window, np.array([len(audio) - window + 1]))
    with pytest.raises(ValueError, match='complete'):
        subject.stft_power(audio, window, np.array([-1]))
    all_starts = np.arange(0, int(31.082 * subject.RATE) - window + 1, subject.HOP)
    for bounds in subject.REGIONS.values():
        selected = all_starts[subject.region_mask(all_starts, window, bounds)]
        assert (selected / subject.RATE >= bounds[0]).all()
        assert ((selected + window) / subject.RATE <= bounds[1]).all()


@pytest.mark.parametrize('field,value', [('offset_s', 12.151), ('offset_s', 12.16),
                                         ('shift_samples', 1214), ('time_scale', 1.01),
                                         ('grid_step_s', .02)])
def test_offset_requires_preserved_integer_hop_grid(field, value):
    alignment = json.loads((BUNDLE / 'analysis.json').read_text())['alignment']
    assert subject.offset_samples(alignment) == 583200
    alignment[field] = value
    with pytest.raises(ValueError, match='offset|alignment'):
        subject.offset_samples(alignment)


@pytest.mark.parametrize('name', ['baseline_motor.wav', 'analysis.json', 'REPORT.md',
                                 'raw/New Recording 15 copy.m4a', 'source/plate_1.full.gcode'])
def test_changed_baseline_assets_abort_before_output(tmp_path, name):
    bundle = tmp_path / 'bundle'
    shutil.copytree(BUNDLE, bundle, ignore=shutil.ignore_patterns(subject.CANDIDATE_DIR))
    (bundle / name).write_bytes(b'changed input must not be rewritten')
    output = tmp_path / 'never-created'
    with pytest.raises(ValueError, match='SHA256 mismatch'):
        subject.generate(bundle, output)
    assert not output.exists()
    assert (bundle / name).read_bytes() == b'changed input must not be rewritten'


def test_analysis_and_baseline_hashes_are_pinned_even_if_manifest_rewritten(tmp_path):
    bundle = tmp_path / 'bundle'
    shutil.copytree(BUNDLE, bundle, ignore=shutil.ignore_patterns(subject.CANDIDATE_DIR))
    path = bundle / 'analysis.json'
    path.write_text('{}')
    manifest_path = bundle / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['artifact_sha256']['analysis.json'] = subject.baseline.file_hash(path)
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match='Pinned manifest artifact'):
        subject.preflight(bundle, tmp_path / 'never-created')


@pytest.mark.parametrize('kind', ['same', 'ancestor', 'raw', 'source', 'symlink-parent',
                                  'symlink-file', 'hardlink-input', 'pair-hardlink', 'pair-symlink'])
def test_all_destination_aliases_refused_before_any_write(tmp_path, kind):
    output = tmp_path / 'output'
    before = subject.bundle_snapshot(BUNDLE)
    if kind == 'same':
        output = BUNDLE
    elif kind == 'ancestor':
        output = BUNDLE.parent
    elif kind in ('raw', 'source'):
        output = BUNDLE / kind
    elif kind == 'symlink-parent':
        output.symlink_to(BUNDLE / subject.CANDIDATE_DIR, target_is_directory=True)
    else:
        output.mkdir()
        first = output / subject.OUTPUT_NAMES[0]
        second = output / subject.OUTPUT_NAMES[1]
        if kind == 'symlink-file':
            first.symlink_to(BUNDLE / 'baseline_motor.wav')
        elif kind == 'hardlink-input':
            first.hardlink_to(BUNDLE / 'baseline_motor.wav')
        else:
            first.write_bytes(b'keep')
            if kind == 'pair-hardlink':
                second.hardlink_to(first)
            else:
                second.symlink_to(first)
    with pytest.raises(ValueError, match='conflict|Symlink|alias'):
        subject.generate(BUNDLE, output)
    assert subject.bundle_snapshot(BUNDLE) == before
    if kind.startswith('pair'):
        assert first.read_bytes() == b'keep'


def test_profiles_only_change_intended_fields():
    defaults = asdict(AudioProfile())
    for rate in subject.RATES:
        audition = asdict(subject.audition_profile(rate))
        assert audition.pop('acoustic_cycles_per_mm') == (rate, rate, 40, 8)
        assert audition == {key: value for key, value in defaults.items() if key != 'acoustic_cycles_per_mm'}
        diagnostic = subject.diagnostic_profile(rate)
        assert diagnostic.harmonic_weights == (1,)
        assert diagnostic.voice_gains == (1, 0, 0, 0)
        assert diagnostic.master_gain == defaults['master_gain']


@pytest.mark.parametrize('name', subject.OUTPUT_NAMES)
def test_every_output_including_playback_protects_raw_recording(tmp_path, name):
    original = BUNDLE / 'raw/New Recording 15 copy.m4a'
    before = subject.baseline.file_hash(original), original.stat().st_mtime_ns
    output = tmp_path / 'output'
    output.mkdir()
    (output / name).hardlink_to(original)
    with pytest.raises(ValueError, match='alias'):
        subject.generate(BUNDLE, output)
    assert list(output.iterdir()) == [output / name]
    assert before == (subject.baseline.file_hash(original), original.stat().st_mtime_ns)


@pytest.mark.parametrize('kind', ['symlink', 'hardlink'])
def test_playback_aliasing_other_output_refused_before_writes(tmp_path, kind):
    first, playback = tmp_path / 'candidate_2p5.wav', tmp_path / subject.PLAYBACK_NAME
    first.write_bytes(b'preserve existing output')
    if kind == 'symlink':
        playback.symlink_to(first)
    else:
        playback.hardlink_to(first)
    with pytest.raises(ValueError, match='alias|Symlink'):
        subject.generate(BUNDLE, tmp_path)
    assert first.read_bytes() == b'preserve existing output'
    assert not (tmp_path / 'report.json').exists()


def test_hardlink_to_input_inside_symlink_directory_is_protected(tmp_path):
    bundle = tmp_path / 'bundle'
    shutil.copytree(BUNDLE, bundle, ignore=shutil.ignore_patterns(subject.CANDIDATE_DIR))
    raw = tmp_path / 'external-raw'
    (bundle / 'raw').rename(raw)
    (bundle / 'raw').symlink_to(raw, target_is_directory=True)
    output = tmp_path / 'output'
    output.mkdir()
    (output / 'candidate_2p5.wav').hardlink_to(raw / 'New Recording 15 copy.m4a')
    with pytest.raises(ValueError, match='alias'):
        subject.preflight(bundle, output)
    assert not (output / 'report.json').exists()


def test_nonmatching_eight_cycle_render_aborts_before_publication(tmp_path, monkeypatch):
    output = tmp_path / 'output'
    original_render = subject.render_audio

    def changed_render(*args, **kwargs):
        result = original_render(*args, **kwargs)
        result['sha256'] = '0' * 64
        return result

    monkeypatch.setattr(subject, 'render_audio', changed_render)
    with pytest.raises(ValueError, match='8-cycle WAV differs'):
        subject.generate(BUNDLE, output)
    assert not output.exists()


def test_saved_artifact_checksums_and_historical_metadata():
    output = BUNDLE / subject.CANDIDATE_DIR
    report = json.loads((output / 'report.json').read_text())
    assert not report['calibrated'] and not report['validated'] and not report['defaults_changed']
    assert report['fixed_alignment']['analysis_sha256'] == subject.ANALYSIS_SHA
    assert report['fixed_alignment']['offset_hops'] == 1215
    assert report['candidate_8_matches_baseline']
    assert subject.baseline.file_hash(output / 'candidate_8.wav') == subject.baseline.file_hash(BUNDLE / 'baseline_motor.wav')
    for candidate in report['candidates']:
        with wave.open(str(output / candidate['render']['path']), 'rb') as stream:
            assert (stream.getframerate(), stream.getnchannels(), stream.getsampwidth(),
                    stream.getcomptype(), stream.getnframes()) == (48000, 1, 2, 'NONE', 1491942)
            assert stream.getnframes() == candidate['render']['frames']
    for name, digest in report['artifact_sha256'].items():
        assert subject.baseline.file_hash(output / name) == digest
    for name, digest in report['preserved_bundle_sha256'].items():
        assert subject.baseline.file_hash(BUNDLE / name) == digest
    # Stored software provenance is historical, not a demand to freeze live modules forever.
    for mapping in (report['software']['source_module_sha256'], report['historical_baseline_module_sha256']):
        for name, digest in mapping.items():
            assert not Path(name).is_absolute()
            assert len(digest) == 64 and set(digest) <= set('0123456789abcdef')
    assert len(report['scores']) == 24
    assert {(row['cycles_per_mm'], row['window_samples']) for row in report['scores']} == {
        (rate, window) for rate in subject.RATES for window in subject.WINDOWS}
    assert all(len(row['control_scores_db']) == 15 for row in report['scores'])
    assert not report['method']['significance_test']
    for row in report['scores']:
        assert row['normalization_region'] == ('outer' if row['region'] == 'outer' else 'bottom')
    ET.parse(output / 'scores.svg')
    page = (output / 'index.html').read_text()
    assert page.count('<audio ') == 4
    assert 'autoplay' not in page and '.play()' not in page
    assert '../raw/New%20Recording%2015%20copy.m4a' in page
    class Elements(HTMLParser):
        def __init__(self):
            super().__init__()
            self.audio, self.downloads = [], []

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == 'audio':
                self.audio.append(attrs)
            if tag == 'a' and 'download' in attrs:
                self.downloads.append(attrs['href'])

    elements = Elements()
    elements.feed(page)
    wavs = [subject.PLAYBACK_NAME, *(subject.candidate_name(rate) for rate in subject.RATES)]
    assert [audio['src'] for audio in elements.audio] == wavs
    assert [audio['data-offset'] for audio in elements.audio] == ['12.15', '0', '0', '0']
    assert set(elements.downloads) == {*wavs, '../raw/New%20Recording%2015%20copy.m4a'}
    assert 'Original recording / PCM playback' in page
    assert 'Underlying AAC is still lossy; conversion cannot recover discarded detail.' in page
    assert 'readyState' not in page
    assert set(report['artifact_sha256']) == set(subject.OUTPUT_NAMES) - {'report.json'}
    assert 'data-local="0"' in page and 'data-local="2.54"' in page and 'data-local="20"' in page
    for name in ('report.json', 'REPORT.md', 'index.html', 'scores.svg'):
        assert '/home/' not in (output / name).read_text()


def test_fresh_generation_reproducible_and_preserves_bundle_and_defaults(tmp_path):
    before = subject.bundle_snapshot(BUNDLE)
    mtimes = {name: (BUNDLE / name).stat().st_mtime_ns for name in before}
    defaults = asdict(AudioProfile()), asdict(PlannerConfig())
    first, second = tmp_path / 'first', tmp_path / 'second'
    report = subject.generate(BUNDLE, first)
    subject.generate(BUNDLE, second)
    saved = json.loads((BUNDLE / subject.CANDIDATE_DIR / 'report.json').read_text())
    for field in ('scores', 'candidates', 'diagnostic_renders', 'recording', 'source', 'plan', 'fixed_alignment'):
        assert json.loads(json.dumps(report[field])) == saved[field]
    assert sorted(path.name for path in first.iterdir()) == sorted(subject.OUTPUT_NAMES)
    for name in subject.OUTPUT_NAMES:
        assert subject.baseline.file_hash(first / name) == subject.baseline.file_hash(second / name)
    for name, digest in report['software']['source_module_sha256'].items():
        assert subject.baseline.file_hash(subject.ROOT / name) == digest
    assert subject.bundle_snapshot(BUNDLE) == before
    assert {name: (BUNDLE / name).stat().st_mtime_ns for name in before} == mtimes
    assert defaults == (asdict(AudioProfile()), asdict(PlannerConfig()))


def test_preview_seek_guards_and_errors_with_media_events():
        """Exercise JS handlers; real browser media/HTTP validation remains separate."""
        node = shutil.which('node')
        if node is None:
                pytest.skip('Node unavailable for preview event-handler test')
        page = (BUNDLE / subject.CANDIDATE_DIR / 'index.html').read_text()
        script = page.split('<script>')[1].split('</script>')[0]
        harness = r'''
const assert = require('node:assert/strict');
const vm = require('node:vm');
const makePlayer = offset => {
    const handlers = {}, message = {textContent: ''};
    return {dataset: {offset}, handlers, message, currentTime: 0, seeking: false, error: null,
        readyState: 4, ranges: [], paused: false,
        get seekable() { const ranges = this.ranges; return {length: ranges.length,
            start: i => ranges[i][0], end: i => ranges[i][1]}; },
        pause() { this.paused = true; },
        addEventListener(name, callback) { handlers[name] = callback; },
        closest() { return {querySelector: () => message}; },
        getAttribute() { return `player ${offset}`; }};
};
const players = ['12.15', '0', '0', '0'].map(makePlayer);
const handlers = {}, status = {textContent: ''};
const button = {dataset: {local: '20'}, addEventListener: (event, fn) => { handlers[event] = fn; }};
const document = {querySelectorAll: selector => selector === 'audio' ? players : [button],
    getElementById: () => status};
vm.runInNewContext(SCRIPT, {document});
handlers.click();
assert(players.every(p => p.paused && p.currentTime === 0));
assert(players.every(p => p.message.textContent.includes('Cannot seek')));
assert(!status.textContent.includes('confirmed'));
players[0].ranges = [[0, 1], [30, 40]];
players[1].ranges = [[0, 10], [21, 31]];
players[2].ranges = [[0, 31]];
players[3].ranges = [[0, 31]];
handlers.click();
assert.equal(players[0].currentTime, 32.15);
assert.equal(players[1].currentTime, 0); // A gap is not seekable.
assert.equal(players[2].currentTime, 20);
assert(players[0].message.textContent.includes('awaiting confirmation'));
players[0].handlers.seeked();
assert(players[0].message.textContent.includes('Seek confirmed at 32.15'));
players[2].currentTime = 0;
players[2].handlers.seeked();
assert(players[2].message.textContent.includes('Seek not confirmed'));
players[3].error = {code: 4};
players[3].handlers.error();
assert(players[3].message.textContent.includes('unsupported codec or source'));
assert(status.textContent.includes('Codec/loading error'));
assert.equal(players[3].dataset.seekTarget, undefined);
handlers.click();
assert.equal(players[3].dataset.seekTarget, undefined);
Object.defineProperty(players[0], 'currentTime', {set() { throw new Error('cannot load'); }});
handlers.click();
assert(players[0].message.textContent.includes('Seek failed'));
assert.equal(players[0].dataset.seekTarget, undefined);
'''
        subprocess.run([node, '-e', harness.replace('SCRIPT', json.dumps(script))], check=True, capture_output=True, text=True)