"""File-level preview acceptance tests; no substituted planner or sampler."""

from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import wave

import pytest

from motion_timeline import ExecutionContext
from motor_audio import AudioProfile
from preview_audio import preview_gcode


def test_preview_has_full_source_and_assumptions_with_clipped_audio(tmp_path):
    source = tmp_path / 'input.gcode'
    raw = b'; preserve CRLF\r\nG1 X100 F3000\r\nG4 S1\r\n'
    source.write_bytes(raw)
    profile = tmp_path / 'profile.json'
    profile.write_text(json.dumps(asdict(AudioProfile())))
    output = tmp_path / 'preview.wav'
    report = preview_gcode(source, output, context=ExecutionContext.known_origin(),
                           profile_path=profile, max_duration_sec=0.25, sample_rate=8000,
                           stems_dir=tmp_path / 'stems')
    saved = json.loads(output.with_suffix('.json').read_text())
    assert saved['source']['sha256'] == hashlib.sha256(raw).hexdigest()
    assert saved['source']['size_bytes'] == len(raw)
    assert saved['profile_source']['sha256'] == hashlib.sha256(profile.read_bytes()).hexdigest()
    assert saved['context']['initial_xyz_mm'] == [0, 0, 0]
    assert saved['planner_config']['default_acceleration_mm_s2'] == 10000
    assert saved['profile']['calibrated'] is False
    assert saved['frames'] == report['frames'] == 2000
    assert saved['planned_duration_sec'] > 3
    assert saved['truncated']
    assert source.read_bytes() == raw
    assert set(saved['stems']) == {'A', 'B', 'Z', 'E', 'fans', 'motors', 'mix'}
    assert not saved['firmware_accurate']


@pytest.mark.parametrize('tail', ['M109 S200', 'G28', 'M106 P99 S255'])
def test_incomplete_or_unknown_fan_after_preview_window_never_writes(tmp_path, tail):
    source = tmp_path / 'input.gcode'
    source.write_text('G4 S10\n' + tail)
    output = tmp_path / 'preview.wav'
    output.write_bytes(b'keep wav')
    sidecar = output.with_suffix('.json')
    sidecar.write_text('keep report')
    with pytest.raises(ValueError):
        preview_gcode(source, output, max_duration_sec=0.01, stems_dir=tmp_path / 'stems')
    assert output.read_bytes() == b'keep wav'
    assert sidecar.read_text() == 'keep report'
    assert not (tmp_path / 'stems').exists()


@pytest.mark.parametrize('kind', ['direct', 'symlink', 'hardlink'])
@pytest.mark.parametrize('target_name', ['input', 'profile', 'context'])
@pytest.mark.parametrize('destination', ['output', 'report', 'stem'])
def test_every_write_target_refuses_every_input_alias(tmp_path, kind, target_name, destination):
    source = tmp_path / 'input.gcode'
    source.write_text('G4 S0.1')
    profile = tmp_path / 'profile.json'
    profile.write_text(json.dumps(asdict(AudioProfile())))
    context = tmp_path / 'context.json'
    context.write_text(json.dumps(asdict(ExecutionContext.known_origin())))
    target = {'input': source, 'profile': profile, 'context': context}[target_name]
    output, report, stems = tmp_path / 'mix.wav', tmp_path / 'report.json', tmp_path / 'stems'
    stems.mkdir()
    if destination == 'stem' and kind == 'direct':
        # A named input itself may live at a renderer's fixed stem name.
        renamed = stems / 'A.wav'
        target.rename(renamed)
        if target_name == 'input':
            source = renamed
        elif target_name == 'profile':
            profile = renamed
        else:
            context = renamed
        target = renamed
    alias = target if kind == 'direct' else (stems / 'A.wav' if destination == 'stem' else tmp_path / 'alias')
    if kind == 'symlink':
        alias.symlink_to(target)
    elif kind == 'hardlink':
        alias.hardlink_to(target)
    if destination == 'output':
        output = alias
    elif destination == 'report':
        report = alias
    before = {p: p.read_bytes() for p in (source, profile, context)}
    with pytest.raises(ValueError, match='alias'):
        preview_gcode(source, output, context=context, profile_path=profile,
                      report_path=report, stems_dir=stems)
    assert all(p.read_bytes() == content for p, content in before.items())
    assert not (stems / 'B.wav').exists()
    if output not in before and not output.is_symlink() and kind != 'hardlink':
        assert not output.exists()


@pytest.mark.parametrize('kind', ['same', 'symlink', 'hardlink', 'stem_pair', 'report_stem', 'nested'])
def test_outputs_report_and_stems_must_be_pairwise_distinct(tmp_path, kind):
    source = tmp_path / 'input.gcode'
    source.write_text('G4 S0.1')
    output, report, stems = tmp_path / 'mix.wav', tmp_path / 'report.json', tmp_path / 'stems'
    stems.mkdir()
    output.write_bytes(b'keep')
    if kind == 'same':
        report = output
    elif kind == 'symlink':
        report.symlink_to(output)
    elif kind == 'hardlink':
        report.hardlink_to(output)
    elif kind == 'stem_pair':
        (stems / 'A.wav').write_bytes(b'stem')
        (stems / 'B.wav').hardlink_to(stems / 'A.wav')
    elif kind == 'report_stem':
        report = stems / 'fans.wav'
    else:
        output = tmp_path / 'new'
        report = output / 'report.json'
    with pytest.raises(ValueError, match='alias|conflict'):
        preview_gcode(source, output, report_path=report, stems_dir=stems)
    assert not (stems / 'Z.wav').exists()
    if kind != 'nested':
        assert output.read_bytes() == b'keep'
    else:
        assert not output.exists()


def test_preview_requires_explicit_context_and_bad_profile_preserves_output(tmp_path):
    source = tmp_path / 'input.gcode'
    source.write_text('G1 X10 F600')
    output = tmp_path / 'out.wav'
    output.write_bytes(b'keep')
    with pytest.raises(ValueError, match='incomplete'):
        preview_gcode(source, output)
    profile = tmp_path / 'bad.json'
    profile.write_text('{"schema_version":1,"calibrated":true}')
    with pytest.raises(ValueError, match='calibrated'):
        preview_gcode(source, output, ExecutionContext.known_origin(), profile)
    assert output.read_bytes() == b'keep'
    assert not output.with_suffix('.json').exists()


def test_standalone_cli_and_context_file(tmp_path):
    source = tmp_path / 'input.gcode'
    source.write_text('G1 X5 F600\nM106 S100\nG4 S0.1')
    context = tmp_path / 'context.json'
    context.write_text(json.dumps(asdict(ExecutionContext.known_origin())))
    output = tmp_path / 'out.wav'
    command = [sys.executable, str(Path(__file__).resolve().parents[1] / 'preview_audio.py'),
               str(source), '-o', str(output), '--context', str(context), '--no-fans',
               '--max-duration', '0.1', '--sample-rate', '8000', '--chunk-size', '73']
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    report = json.loads(output.with_suffix('.json').read_text())
    assert report['frames'] == 800
    assert report['fans'] is False
    assert 'uncalibrated' in result.stdout.lower()
    with wave.open(str(output), 'rb') as wav:
        assert wav.getnframes() == 800


def test_authored_demo_is_offline_labeled_and_15_to_30_seconds(tmp_path):
    from gcode_source import parse_source
    from motion_planner import plan_motion

    root = Path(__file__).resolve().parents[1]
    source = root / 'data/audio_demo.gcode'
    raw = source.read_bytes()
    assert raw.startswith(b'; offline audition only; not reviewed for printer execution')
    plan = plan_motion(parse_source(raw), ExecutionContext.known_origin())
    assert 15 <= plan.total_duration_s <= 30
    for event in plan.events:
        if event.end_xyz_mm is not None:
            assert all(0 <= coordinate <= 200 for coordinate in event.end_xyz_mm)
    report = preview_gcode(source, tmp_path / 'demo.wav', ExecutionContext.known_origin(),
                           root / 'data/audio_preview_profile.json', sample_rate=8000)
    assert report['clipped_samples'] == 0
    assert report['peak'] > 0.05
    assert not report['truncated']


def test_parent_can_use_api_with_custom_config_and_report_path(tmp_path):
    from motion_planner import PlannerConfig

    source = tmp_path / 'input.gcode'
    source.write_text('G1 X10 F600')
    output = tmp_path / 'mix.wav'
    report_path = tmp_path / 'reports/custom.json'
    result = preview_gcode(source, output, ExecutionContext.known_origin(),
                           config=PlannerConfig(default_acceleration_mm_s2=100), report_path=report_path)
    assert result == json.loads(report_path.read_text())
    assert result['planner_config']['default_acceleration_mm_s2'] == 100
    assert not output.with_suffix('.json').exists()
