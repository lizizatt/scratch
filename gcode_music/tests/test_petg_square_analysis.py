"""Pinned first-recording fixture plus synthetic tests of the real shift search."""

from dataclasses import asdict
import json
from pathlib import Path
import shutil
import wave
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import numpy as np
import pytest

from gcode_source import parse_source
from motion_planner import PlannerConfig, plan_motion
from motion_timeline import build_timeline
from motor_audio import AudioProfile
from scripts import analyze_petg_square as subject


BUNDLE = Path(__file__).resolve().parents[1] / 'data/recordings/petg_square_2026-10-05'


@pytest.fixture
def raw_dir():
    # Deliberately required: the generated, hash-pinned bundle is the regression fixture.
    assert (BUNDLE / 'manifest.json').is_file(), 'Generate the first-recording bundle before running tests'
    return BUNDLE / 'raw'


@pytest.mark.parametrize('polarity', [1, -1])
@pytest.mark.parametrize('shift', [0, 137, 250])
def test_alignment_known_shift_and_explicit_polarity(polarity, shift):
    rng = np.random.default_rng(41)
    predicted = subject.highpass(rng.normal(size=1200))
    observed = rng.normal(scale=.01, size=1450)
    observed[shift:shift + len(predicted)] = polarity * predicted * 2.7 + 5
    result = subject.alignment_search(predicted, observed, 250, polarity=polarity)
    assert result['shift_samples'] == shift
    assert result['offset_s'] == pytest.approx(shift * .01)
    assert result['correlation'] == pytest.approx(1)
    assert result['polarity'] == polarity


def test_alignment_never_silently_takes_absolute_correlation():
    signal = subject.highpass(np.random.default_rng(7).normal(size=1000))
    with pytest.raises(ValueError, match='No sufficiently correlated'):
        subject.alignment_search(signal, -signal, 0)


@pytest.mark.parametrize('which', ['predicted', 'observed', 'both'])
def test_flat_signal_rejected(which):
    rng = np.random.default_rng(51)
    predicted = rng.normal(size=1000) if which == 'observed' else np.ones(1000)
    observed = rng.normal(size=1200) if which == 'predicted' else np.ones(1200)
    with pytest.raises(ValueError, match='Flat/no signal'):
        subject.alignment_search(subject.highpass(predicted), subject.highpass(observed), 200)


def test_uncorrelated_noise_rejected():
    rng = np.random.default_rng(1234)
    with pytest.raises(ValueError, match='No sufficiently correlated'):
        subject.alignment_search(subject.highpass(rng.normal(size=2000)),
                                 subject.highpass(rng.normal(size=2500)), 500)


@pytest.mark.parametrize('bad', [np.nan, np.inf])
def test_nonfinite_alignment_rejected(bad):
    with pytest.raises(ValueError, match='Invalid alignment'):
        subject.alignment_search([1, bad, 3], [1, 2, 3], 0)


def test_stft_centers_bands_and_highpass():
    time = np.arange(subject.RATE) / subject.RATE
    centers, bands = subject.spectral_bands(np.sin(2 * np.pi * 600 * time))
    assert centers[0] == pytest.approx(2048 / 48000)
    np.testing.assert_allclose(np.diff(centers), .01)
    assert centers[-1] + 2048 / 48000 <= 1
    assert np.mean(bands['400-800']) > np.mean(bands['200-400']) + 50
    assert np.mean(bands['400-800']) > np.mean(bands['800-1600']) + 50
    np.testing.assert_allclose(subject.highpass(np.ones(1000)), 0, atol=1e-14)


def test_pinned_source_region_and_full_input_refusal(raw_dir):
    with ZipFile(raw_dir / 'gcode_to_music_square.gcode.3mf') as archive:
        data = archive.read(subject.GCODE_MEMBER)
        embedded = archive.read(subject.GCODE_MEMBER + '.md5').decode()
    assert embedded == embedded.upper()
    assert data == (BUNDLE / subject.FULL_GCODE).read_bytes()
    plan, context, commands, refusal = subject.make_plan(data)
    assert [event.source_line for event in plan.events] == list(range(820, 1077))
    assert len(plan.moves) == 157
    assert plan.total_duration_s == pytest.approx(31.082, abs=.001)
    assert not build_timeline(commands, context=context).complete
    with pytest.raises(ValueError, match='incomplete timeline'):
        plan_motion(parse_source(data), context, plan.config)
    assert 'incomplete timeline' in refusal
    assert context.initial_xyz_mm == (141.762, 140.776, .2)
    assert context.initial_e_mm == 0 and context.e_mode == 'relative'
    assert context.feedrate_mm_min == 1800
    assert plan.config.default_acceleration_mm_s2 == 6000
    assert plan.moves[0].source_line == 825
    assert plan.moves[0].effective_acceleration_mm_s2 == 500
    for line, expected in subject.SOURCE_STATEMENTS.items():
        assert commands[line - 1].raw_line == expected


@pytest.mark.parametrize('filename', list(subject.RAW_HASHES))
def test_invalid_raw_hash_leaves_destination_untouched(raw_dir, tmp_path, filename):
    inputs, output = tmp_path / 'inputs', tmp_path / 'output'
    shutil.copytree(raw_dir, inputs)
    (inputs / filename).write_bytes(b'not the pinned input')
    output.mkdir()
    (output / 'sentinel').write_bytes(b'keep')
    with pytest.raises(ValueError, match='Raw input SHA256 mismatch'):
        subject.generate(inputs, output)
    assert list(output.iterdir()) == [output / 'sentinel']
    assert (output / 'sentinel').read_bytes() == b'keep'


def test_invalid_gcode_hash_before_boundary_or_output(raw_dir, tmp_path, monkeypatch):
    inputs, output = tmp_path / 'inputs', tmp_path / 'never-created'
    shutil.copytree(raw_dir, inputs)
    path = inputs / 'gcode_to_music_square.gcode.3mf'
    with ZipFile(path, 'w') as archive:
        archive.writestr(subject.GCODE_MEMBER, b'G90\n')
        archive.writestr(subject.GCODE_MEMBER + '.md5', 'irrelevant')
    monkeypatch.setitem(subject.RAW_HASHES, path.name, subject.file_hash(path))
    with pytest.raises(ValueError, match='Full GCODE SHA256 mismatch'):
        subject.generate(inputs, output)
    assert not output.exists()


def test_boundary_statement_mismatch_leaves_destination_untouched(raw_dir, tmp_path, monkeypatch):
    # Simulate an incorrect transcription while the real source SHA remains verified.
    monkeypatch.setitem(subject.SOURCE_STATEMENTS, 817, 'G1 X0 Y0')
    output = tmp_path / 'never-created'
    with pytest.raises(ValueError, match='source/boundary statement mismatch at line 817'):
        subject.generate(raw_dir, output)
    assert not output.exists()


@pytest.mark.parametrize('name', [*(f'raw/{name}' for name in subject.RAW_HASHES), subject.FULL_GCODE])
def test_preserved_copy_mismatch_refused_without_writes(raw_dir, tmp_path, name):
    output = tmp_path / 'output'
    path = output / name
    path.parent.mkdir(parents=True)
    path.write_bytes(b'existing bytes must survive')
    before = sorted(str(item.relative_to(output)) for item in output.rglob('*'))
    with pytest.raises(ValueError, match='Existing preserved source mismatch'):
        subject.generate(raw_dir, output)
    assert path.read_bytes() == b'existing bytes must survive'
    assert sorted(str(item.relative_to(output)) for item in output.rglob('*')) == before


@pytest.mark.parametrize('kind', ['same', 'nested', 'ancestor', 'hardlink', 'symlink'])
def test_input_output_alias_preflight(raw_dir, tmp_path, kind):
    inputs = tmp_path / 'inputs'
    shutil.copytree(raw_dir, inputs)
    output = tmp_path / 'output'
    if kind == 'same':
        output = inputs
    elif kind == 'nested':
        output = inputs / 'nested'
    elif kind == 'ancestor':
        output = tmp_path
    else:
        output.mkdir()
        path = output / 'baseline_motor.wav'
        original = inputs / 'New Recording 15 copy.m4a'
        if kind == 'hardlink':
            path.hardlink_to(original)
        else:
            path.symlink_to(original)
    before = {path.name: subject.file_hash(path) for path in inputs.iterdir()}
    with pytest.raises(ValueError, match='alias|nesting|escapes|Symlink'):
        subject.generate(inputs, output)
    assert {path.name: subject.file_hash(path) for path in inputs.iterdir()} == before
    assert not (output / 'manifest.json').exists()


def test_manifest_artifacts_provenance_and_defaults(raw_dir):
    manifest = json.loads((BUNDLE / 'manifest.json').read_text())
    analysis = json.loads((BUNDLE / 'analysis.json').read_text())
    assert manifest['calibrated'] is False and analysis['calibrated'] is False
    confirmations = manifest['user_confirmations']
    assert confirmations['entire_square_captured']['value'] is True
    assert confirmations['calibration_procedures_removed']['value'] is True
    assert confirmations['printer_speed_mode']['value'] == 'Standard 100%'
    assert confirmations['trimmed_only_ends']['value'] is True
    assert confirmations['internal_cuts']['value'] is False
    assert confirmations['skip_silence_enabled']['value'] is False
    assert confirmations['recording_app']['value'] == 'Voice Memos'
    assert 'top hatch' in confirmations['phone_placement']['value']
    estimates = manifest['user_timing_estimates']
    assert estimates['estimates_s'] == {'border_start': 12, 'infill_start': 15, 'printing_end': 43}
    assert estimates['approximate'] is True and estimates['uncertainty_s'] is None
    assert estimates['used_for_alignment_fit'] is False
    assert estimates['independently_verified'] is False
    assert 'after candidate alignment was shared' in estimates['provenance']
    for item in confirmations.values():
        assert item['independently_verified'] is False
        assert item['provenance'].startswith('user report')
    assert manifest['inferences']['alignment_independently_validated'] is False
    assert manifest['source']['full_input_supported'] is False
    assert manifest['source']['retained_original_lines_inclusive'] == [820, 1076]
    assert manifest['source']['embedded_md5_verified'] is True
    assert manifest['model']['audio_profile']['calibrated'] is False
    assert manifest['model']['global_defaults_modified'] is False
    baseline = manifest['model']['render_audio']
    assert baseline['motors'] is True and baseline['fans'] is False
    assert baseline['clipped_samples'] == 0 and baseline['truncated'] is False
    assert analysis['slicer_header']['timing_error_percent'] is None
    assert analysis['slicer_header']['comparable_scope'] is False
    alignment = analysis['alignment']
    assert alignment['time_scale'] == 1
    assert alignment['local_center_range_s'][0] >= subject.WINDOW / (2 * subject.RATE)
    assert alignment['local_center_range_s'][1] + subject.WINDOW / (2 * subject.RATE) <= analysis['nominal_plan_duration_s']
    assert alignment['offset_s'] == pytest.approx(np.nanargmax(alignment['scores']) * .01)
    assert alignment['candidate_count'] == len(alignment['scores'])
    assert set(alignment['independent_half_searches']) == {'first_half', 'second_half'}
    assert len(alignment['fixed_offset_segments']) == 4
    for name, digest in manifest['artifact_sha256'].items():
        assert subject.file_hash(BUNDLE / name) == digest
    for name, digest in manifest['software']['source_module_sha256'].items():
        assert not Path(name).is_absolute()
        assert len(digest) == 64 and all(c in '0123456789abcdef' for c in digest)
    for name, digest in subject.RAW_HASHES.items():
        assert subject.file_hash(raw_dir / name) == digest
    assert 'ffmpeg version' in manifest['software']['ffmpeg_version']
    with wave.open(str(BUNDLE / 'baseline_motor.wav')) as audio:
        assert audio.getnframes() == baseline['frames']
        assert audio.getframerate() == 48000
        assert audio.getnchannels() == 1
    ET.parse(BUNDLE / 'comparison.svg')
    for name in ('REPORT.md', 'manifest.json', 'analysis.json', 'comparison.svg'):
        assert '/home/' not in (BUNDLE / name).read_text()
    assert list((BUNDLE / 'source').iterdir()) == [BUNDLE / subject.FULL_GCODE]


def test_generation_reproducible_and_preserves_existing_raw(raw_dir, tmp_path):
    defaults = asdict(AudioProfile()), asdict(PlannerConfig())
    output = tmp_path / 'bundle'
    # Matching preexisting copies must be retained rather than overwritten.
    shutil.copytree(raw_dir, output / 'raw')
    before = {name: (output / 'raw' / name).stat().st_mtime_ns for name in subject.RAW_HASHES}
    subject.generate(raw_dir, output)
    assert before == {name: (output / 'raw' / name).stat().st_mtime_ns for name in subject.RAW_HASHES}
    assert defaults == (asdict(AudioProfile()), asdict(PlannerConfig()))
    manifest = json.loads((output / 'manifest.json').read_text())
    assert manifest['software']['source_path_basis'] == 'gcode_music project root, not bundle directory'
    for name, digest in manifest['software']['source_module_sha256'].items():
        assert subject.file_hash(subject.ROOT / name) == digest
    # Historical artifacts retain their original versions and hashes. Compare
    # two fresh runs here so dependency upgrades don't rewrite past evidence.
    second = tmp_path / 'second-bundle'
    subject.generate(raw_dir, second)
    for path in output.rglob('*'):
        if path.is_file():
            assert subject.file_hash(second / path.relative_to(output)) == subject.file_hash(path)
