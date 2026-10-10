"""Contracts at the source-to-timeline boundary, not firmware fidelity tests."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from gcode_analyzer import GCodeParser, MovementAnalyzer
from models import TimingParams


INVALID_NUMBERS = [
    True, False, '1', None, [], {}, 1 + 2j,
    float('nan'), float('inf'), -float('inf'),
    pytest.param(10**1000, id='overflowing-int'),
    pytest.param(-10**1000, id='negative-overflowing-int'),
]


@pytest.mark.parametrize('field', ['default_acceleration', 'time_scale', 'time_offset'])
@pytest.mark.parametrize('value', INVALID_NUMBERS)
@pytest.mark.parametrize('from_dict', [False, True])
def test_timing_configuration_rejects_invalid_numbers(field, value, from_dict):
    config = {field: value}
    with pytest.raises(ValueError, match=field):
        if from_dict:
            TimingParams.from_dict({'schema_version': 2, 'acceleration_units': 'mm/s^2', **config})
        else:
            TimingParams(**config)


@pytest.mark.parametrize('field', ['default_acceleration', 'time_scale'])
@pytest.mark.parametrize('value', [0, -1])
def test_timing_configuration_requires_positive_scale_and_acceleration(field, value):
    with pytest.raises(ValueError, match=field):
        TimingParams(**{field: value})


@pytest.mark.parametrize('config', [
    {'schema_version': 2.0}, {'schema_version': True}, {'schema_version': '2'},
    {'schema_version': None}, {'acceleration_units': None}, {'acceleration_units': 2},
    {'acceleration_units': ['mm/s^2']}, {'acceleration_units': b'mm/s^2'},
    {'mode': True}, {'mode': ['rest_to_rest']}, {'mode': None},
])
@pytest.mark.parametrize('from_dict', [False, True])
def test_timing_configuration_rejects_invalid_metadata(config, from_dict):
    with pytest.raises(ValueError):
        if from_dict:
            TimingParams.from_dict({'schema_version': 2, 'acceleration_units': 'mm/s^2', **config})
        else:
            TimingParams(**config)


@pytest.mark.parametrize('data', [None, [], [('schema_version', 2)], 'config', 2, True])
def test_timing_from_dict_requires_dictionary(data):
    with pytest.raises(ValueError, match='dict'):
        TimingParams.from_dict(data)


def test_timing_from_dict_identifies_unknown_fields():
    with pytest.raises(ValueError, match='Unknown.*typo'):
        TimingParams.from_dict({'schema_version': 2, 'acceleration_units': 'mm/s^2', 'typo': 1})


@pytest.mark.parametrize('offset', [-2, 0, 1.5])
def test_timing_configuration_accepts_numeric_values_and_optional_none(offset):
    from dataclasses import asdict

    timing = TimingParams(default_acceleration=1000, time_scale=2.5, time_offset=offset,
                          max_acceleration=None, accel_distance_threshold=None)
    assert timing.time_offset == offset
    assert TimingParams.from_dict(asdict(timing)) == timing


def parse(tmp_path, text):
    path = tmp_path / 'snippet.gcode'
    path.write_text(text)
    return GCodeParser().parse_file(str(path))


@pytest.mark.parametrize('value', INVALID_NUMBERS)
@pytest.mark.parametrize('axis', [0, 1, 2])
def test_execution_context_rejects_invalid_coordinate_values(value, axis):
    from motion_timeline import ExecutionContext

    xyz = [0, 0, 0]
    xyz[axis] = value
    with pytest.raises(ValueError, match='initial_xyz_mm'):
        ExecutionContext(initial_xyz_mm=xyz)


@pytest.mark.parametrize('xyz', [True, 1, '123', b'123', [], (0, 0), (0, 0, 0, 0),
                               {0: 0, 1: 0, 2: 0}, {0, 1, 2}])
def test_execution_context_requires_three_coordinate_sequence(xyz):
    from motion_timeline import ExecutionContext

    with pytest.raises(ValueError, match='initial_xyz_mm'):
        ExecutionContext(initial_xyz_mm=xyz)


@pytest.mark.parametrize('field', ['initial_e_mm', 'feedrate_mm_min'])
@pytest.mark.parametrize('value', INVALID_NUMBERS)
def test_execution_context_rejects_invalid_optional_numbers(field, value):
    from motion_timeline import ExecutionContext

    if value is None:
        assert getattr(ExecutionContext(**{field: value}), field) is None
    else:
        with pytest.raises(ValueError, match=field):
            ExecutionContext(**{field: value})


@pytest.mark.parametrize('feedrate', [0, -1])
def test_execution_context_requires_positive_feedrate(feedrate):
    from motion_timeline import ExecutionContext

    with pytest.raises(ValueError, match='feedrate_mm_min'):
        ExecutionContext(feedrate_mm_min=feedrate)


@pytest.mark.parametrize('field', ['xyz_mode', 'e_mode', 'units'])
@pytest.mark.parametrize('value', [True, 1, [], {}, b'absolute', 'invalid'])
def test_execution_context_rejects_invalid_modes_and_units(field, value):
    from motion_timeline import ExecutionContext

    with pytest.raises(ValueError, match='mode|units'):
        ExecutionContext(**{field: value})


@pytest.mark.parametrize('sequence', [tuple, list])
def test_execution_context_accepts_numeric_coordinates_and_snapshots_sequence(sequence):
    from motion_timeline import ExecutionContext

    xyz = sequence([-1, 0, 2.5])
    context = ExecutionContext(initial_xyz_mm=xyz, initial_e_mm=-2, feedrate_mm_min=600)
    assert context.initial_xyz_mm == (-1, 0, 2.5)
    assert isinstance(context.initial_xyz_mm, tuple)
    if isinstance(xyz, list):
        xyz[0] = 99
        assert context.initial_xyz_mm == (-1, 0, 2.5)
    assert context.initial_e_mm == -2
    assert context.feedrate_mm_min == 600


@pytest.mark.parametrize('mode', [None, 'absolute', 'relative'])
@pytest.mark.parametrize('units', [None, 'mm', 'inch'])
def test_execution_context_accepts_optional_state_and_valid_modes(mode, units):
    from motion_timeline import ExecutionContext

    context = ExecutionContext(xyz_mode=mode, e_mode=mode, units=units)
    assert context.xyz_mode == context.e_mode == mode
    assert context.units == units
    assert context.initial_xyz_mm is context.initial_e_mm is context.feedrate_mm_min is None


@pytest.mark.parametrize('field', ['distance_mm', 'velocity_mm_s', 'acceleration_mm_s2'])
@pytest.mark.parametrize('value', INVALID_NUMBERS)
def test_movement_duration_rejects_invalid_numbers(field, value):
    from motion_timeline import movement_duration

    params = {'distance_mm': 1, 'velocity_mm_s': 10, 'acceleration_mm_s2': 4}
    params[field] = value
    with pytest.raises(ValueError, match=field):
        movement_duration(**params)


@pytest.mark.parametrize('distance', [0, 1])
@pytest.mark.parametrize('field', ['velocity_mm_s', 'acceleration_mm_s2'])
@pytest.mark.parametrize('value', [0, -1, True, '1', float('inf')])
def test_movement_duration_requires_positive_speed_and_acceleration_even_at_zero_distance(distance, field, value):
    from motion_timeline import movement_duration

    params = {'distance_mm': distance, 'velocity_mm_s': 10, 'acceleration_mm_s2': 4}
    params[field] = value
    with pytest.raises(ValueError, match=field):
        movement_duration(**params)


def test_movement_duration_rejects_negative_distance():
    from motion_timeline import movement_duration

    with pytest.raises(ValueError, match='distance_mm'):
        movement_duration(-1, 10, 4)


@pytest.mark.parametrize('distance,velocity,acceleration,expected', [
    (0, 10, 4, 0), (1, 10, 4, 1), (25, 10, 4, 5), (100, 10, 4, 12.5),
    (100.0, 100.0, 1000.0, 1.1),
])
def test_movement_duration_preserves_zero_triangle_boundary_and_trapezoid(distance, velocity, acceleration, expected):
    from motion_timeline import movement_duration

    assert movement_duration(distance, velocity, acceleration) == pytest.approx(expected)


def test_linear_timeline_zero_coordinates_and_unit_correct_timing(tmp_path):
    from motion_timeline import build_timeline, ExecutionContext

    commands = parse(tmp_path, 'G1 F6000\nG1 X100\nG1 X0\n')
    result = build_timeline(commands, TimingParams(default_acceleration=1000),
                            ExecutionContext.known_origin())
    moves = [e for e in result.events if e.kind == 'move']
    assert result.complete
    assert len(moves) == 2
    assert moves[0].source_line == 2
    assert moves[0].start_xyz_mm == (0, 0, 0)
    assert moves[0].end_xyz_mm == (100, 0, 0)
    assert moves[1].delta_xyz_mm == (-100, 0, 0)
    assert moves[0].velocity_mm_s == 100
    assert moves[0].duration_s == pytest.approx(1.1)
    assert result.total_duration_s == pytest.approx(2.2)
    segments = MovementAnalyzer(commands).segment_movements(TimingParams(default_acceleration=1000))
    assert sum(s.distance for s in segments) == 200
    assert segments[-1].end_time == pytest.approx(2.2)


def test_modal_offsets_units_and_independent_extruder(tmp_path):
    from motion_timeline import build_timeline, ExecutionContext

    commands = parse(tmp_path, 'G21\nG90\nM83\nG1 X10 E2 F600\nG92 X0 E0\n'
                     'G1 X5 E-1\nG91\nG1 X5 E2\nG90\nG1 X0 E1\n'
                     'M82\nG92 E0\nG1 E-2 F120\nG20\nG91\nG1 X1 F60\nG21\nG1 X0\n')
    result = build_timeline(commands, TimingParams(mode='constant_speed'), ExecutionContext.known_origin())
    assert result.complete, result.diagnostics
    moves = [e for e in result.events if e.kind in ('move', 'extrusion', 'retraction')]
    assert [e.delta_e_mm for e in moves[:5]] == [2, -1, 2, 1, -2]
    assert [e.end_xyz_mm[0] for e in moves[:5]] == [10, 15, 20, 10, 10]
    assert moves[0].distance_xyz_mm == 10  # E is coordinated, not extra Cartesian distance.
    assert moves[0].duration_s == 1
    assert moves[4].kind == 'retraction'
    assert moves[4].distance_xyz_mm == 0
    assert moves[4].duration_s == 1
    assert moves[5].delta_xyz_mm[0] == pytest.approx(25.4)
    assert moves[5].velocity_mm_s == pytest.approx(25.4)
    assert moves[5].duration_s == pytest.approx(1)
    resets = [e for e in result.events if e.opcode == 'G92']
    assert all(e.duration_s == 0 for e in resets)
    assert resets[0].state_changes['xyz_offset_mm'] == (10, 0, 0)


def test_waits_state_events_and_unsupported_stop_with_full_coverage(tmp_path):
    from motion_timeline import build_timeline, ExecutionContext
    from dataclasses import asdict
    import json

    commands = parse(tmp_path, '; header\nG4 P500\nG4 S10\nM400\nM400 S2\nM400 P250\n'
                     'M73 P50 R1\nM106 P2 S128\nM104 S200\nM204 S1000\n'
                     'G1 X100 F6000\nM109 S200\nG1 X0\nM970.3 Q1\n')
    result = build_timeline(commands, context=ExecutionContext.known_origin())
    assert not result.complete
    assert result.total_duration_s is None
    assert [e.duration_s for e in result.events[1:6]] == [.5, 10, 0, 2, .25]
    assert [e.kind for e in result.events[1:6]] == ['dwell', 'dwell', 'synchronization', 'wait', 'wait']
    assert result.events[7].kind == 'fan'
    assert result.events[7].state_changes == {'fan': {'index': 2, 'duty': 128}}
    assert result.events[8].kind == 'temperature'
    assert result.events[10].duration_s == pytest.approx(1.1)
    assert result.known_prefix_duration_s == pytest.approx(13.85)
    assert result.events[11].kind == 'unknown_wait'
    for event in result.events[11:]:
        assert event.start_time_s is None and event.duration_s is None
        assert event.end_xyz_mm is None
    assert len(result.support_report) == len(commands)
    assert result.support_report[-1].opcode == 'M970.3'
    assert result.support_report[-1].status == 'unsupported'
    assert result.support_report[12].status == 'modeled'  # Supported form, not executed after stop.
    assert result.events[12].diagnostics
    json.dumps(asdict(result), allow_nan=False)
    with pytest.raises(ValueError, match='Unsupported timeline'):
        MovementAnalyzer(commands).segment_movements()


@pytest.mark.parametrize('unsupported', [
    'G28', 'G29', 'G2 X1 I1', 'G3 X1 J1', 'G1 X1 Q1', 'G1.1 X1',
    'G90 E1', 'G92', 'G92.1', 'M622 J1', 'M623', 'M1002 judge_flag x',
    'M620 S1', 'T1', 'M970.3 Q1', 'M201 X1000', 'M203 X100', 'M205 X8',
    'M204 P1000 T2000', 'M204 S1000 T2000', 'M400 U1', 'M400 S1 P1',
    'G4 S1 P1', 'G4 S-1', 'M106', 'M106 P1.5 S10', 'M104 S200 T1',
    'M73 Q1', 'M999', 'G1 X1 X2', 'G1 XNaN', 'G1 F0', 'G1 F-1',
    'N1 G1 X1 F600*10', 'G1 X1 (unclosed',
])
def test_unknown_forms_block_all_later_prediction(tmp_path, unsupported):
    from motion_timeline import build_timeline, ExecutionContext

    result = build_timeline(parse(tmp_path, f'G1 X10 F600\n{unsupported}\nG90\nG1 X20\n'),
                            context=ExecutionContext.known_origin())
    assert not result.complete
    assert result.events[0].duration_s > 0
    assert result.support_report[1].status == 'unsupported'
    assert result.support_report[1].source_line == 2
    assert result.support_report[1].reason
    for event in result.events[1:]:
        assert event.start_time_s is None and event.end_time_s is None and event.duration_s is None
    assert result.events[-1].end_xyz_mm is None


def test_unknown_initial_state_cannot_be_homed_by_g92(tmp_path):
    from motion_timeline import build_timeline, ExecutionContext

    for text in ('G21\nG90\nG1 X0 Y0 Z0 F600', 'G21\nG92 X0 Y0 Z0\nG1 X10 F600'):
        result = build_timeline(parse(tmp_path, text))
        assert not result.complete
        assert result.total_duration_s is None
    xyz_context = ExecutionContext(initial_xyz_mm=(0, 0, 0), xyz_mode='absolute', units='mm')
    assert build_timeline(parse(tmp_path, 'G1 X10 F600'), context=xyz_context).complete
    assert not build_timeline(parse(tmp_path, 'G1 E1 F600'), context=xyz_context).complete
    e_context = ExecutionContext(initial_e_mm=0, e_mode='relative', units='mm')
    result = build_timeline(parse(tmp_path, 'G1 E-2 F120'), TimingParams(mode='constant_speed'), e_context)
    assert result.complete and result.events[0].duration_s == 1
    for missing in ('units', 'xyz_mode', 'initial_xyz_mm'):
        context = ExecutionContext.known_origin()
        setattr(context, missing, None)
        assert not build_timeline(parse(tmp_path, 'G1 X10 F600'), context=context).complete


def test_empty_wait_only_timing_modes_and_versioned_config(tmp_path):
    from motion_timeline import build_timeline, ExecutionContext
    from dataclasses import asdict

    assert build_timeline([]).total_duration_s == 0
    assert build_timeline(parse(tmp_path, 'G4 S10\nM400')).total_duration_s == 10
    commands = parse(tmp_path, 'G1 X1 F6000\nG4 S10\n')
    context = ExecutionContext.known_origin()
    timing = TimingParams(default_acceleration=1000, time_scale=2, time_offset=5)
    result = build_timeline(commands, timing, context)
    assert result.events[0].duration_s == pytest.approx(0.12649110640673517)
    assert result.events[0].start_time_s == 5
    assert result.events[1].duration_s == 10  # Explicit waits are not fitted/scaled.
    assert result.events[-1].end_time_s == pytest.approx(15.126491106406736)
    assert build_timeline(commands, None, context) == build_timeline(commands, TimingParams(), context)
    constant = build_timeline(commands, TimingParams(mode='constant_speed'), context)
    assert constant.events[0].duration_s == .01
    assert TimingParams.from_dict(asdict(timing)) == timing
    for config in ({}, {'default_acceleration': 10000}, {'schema_version': 1, 'acceleration_units': 'mm/min^2'}):
        with pytest.raises(ValueError, match='Legacy'):
            TimingParams.from_dict(config)
    for config in ({'max_acceleration': 20000}, {'accel_distance_threshold': 5}, {'mode': 'lookahead'},
                   {'default_acceleration': 0}, {'time_scale': float('nan')}, {'time_offset': float('inf')}):
        with pytest.raises(ValueError):
            TimingParams(**config)


def test_unit_conversion_overflow_stops_without_nonfinite_json(tmp_path):
    from motion_timeline import build_timeline, ExecutionContext
    from dataclasses import asdict
    import json

    huge = '1' + '0' * 308
    result = build_timeline(parse(tmp_path, f'G20\nG1 X1 F{huge}\nG1 X2\n'),
                            context=ExecutionContext.known_origin())
    assert not result.complete
    assert result.events[-1].start_time_s is None
    json.dumps(asdict(result), allow_nan=False)
