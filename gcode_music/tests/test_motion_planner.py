"""Analytic trajectory checks through the public source/planner interfaces."""

from dataclasses import asdict
import json
import math

import numpy as np
import pytest

from gcode_source import parse_source
from motion_planner import MotionPhase, MotionPlan, PlannedMove, PlannerConfig, plan_motion, sample_motion
from motion_timeline import ExecutionContext, build_timeline


def plan(text, **kwargs):
    kwargs.setdefault('context', ExecutionContext.known_origin())
    kwargs.setdefault('config', PlannerConfig(default_acceleration_mm_s2=1000.0))
    return plan_motion(parse_source(text.encode()), **kwargs)


def test_reference_defaults_and_report():
    config = PlannerConfig()
    assert config.max_velocity_xyz_mm_s == (500, 500, 20)
    assert config.max_velocity_e_mm_s == 30
    assert config.max_acceleration_xyz_mm_s2 == (20000, 20000, 500)
    assert config.max_acceleration_e_mm_s2 == 5000
    assert config.default_acceleration_mm_s2 == 10000
    assert config.junction_velocity_jump_xyz_mm_s == (9, 9, 3)
    assert config.junction_velocity_jump_e_mm_s == 2.5
    assert config.max_velocity_ab_mm_s is None
    assert config.max_acceleration_ab_mm_s2 is None
    result = plan('G1 X100 F6000')
    assert isinstance(result, MotionPlan)
    assert isinstance(result.moves[0], PlannedMove)
    assert isinstance(result.moves[0].phases[0], MotionPhase)
    assert 'approximate' in result.label
    assert 'not measured' in result.label
    json.dumps(asdict(result), allow_nan=False)


def test_analytic_trapezoid():
    result = plan('G1 X100 F6000')
    move, = result.moves
    assert result.total_duration_s == pytest.approx(1.1)
    assert move.distance_mm == 100
    assert (move.entry_velocity_mm_s, move.exit_velocity_mm_s, move.peak_velocity_mm_s) == (0, 0, 100)
    assert [phase.duration_s for phase in move.phases] == pytest.approx([0.1, 0.9, 0.1])
    assert [phase.start_distance_mm for phase in move.phases] == pytest.approx([0, 5, 95])
    position, speed = sample_motion(result, [0, 0.05, 0.1, 0.55, 1, 1.05, 1.1, 5])
    np.testing.assert_allclose(position[:, 0], [0, 1.25, 5, 50, 95, 98.75, 100, 100])
    np.testing.assert_allclose(speed[:, 0], [0, 50, 100, 100, 100, 50, 0, 0], atol=1e-10)
    np.testing.assert_array_equal(position[:, 0], position[:, 1])
    np.testing.assert_array_equal(position[:, 2:], 0)


@pytest.mark.parametrize('segments', [2, 10, 100])
def test_collinear_split_invariance(segments):
    whole = plan('G1 X100 E10 F6000')
    split = plan('\n'.join(f'G1 X{100 * i / segments} E{10 * i / segments} F6000'
                           for i in range(1, segments + 1)))
    assert split.total_duration_s == pytest.approx(1.1, abs=1e-12)
    times = np.linspace(0, 1.2, 12001)
    for actual, expected in zip(sample_motion(split, times), sample_motion(whole, times)):
        np.testing.assert_allclose(actual, expected, atol=1e-9)
    assert all(move.exit_velocity_mm_s > 0 for move in split.moves[:-1])


def test_triangle_and_nonzero_boundary_phases():
    result = plan('G1 X1 F6000\nG1 X2')
    assert result.total_duration_s == pytest.approx(0.08944271909999159)
    assert result.moves[0].exit_velocity_mm_s == pytest.approx(44.721359549995796)
    assert result.moves[1].entry_velocity_mm_s == pytest.approx(44.721359549995796)
    assert result.moves[0].phases[0].acceleration_mm_s2 == 1000
    assert result.moves[1].phases[-1].acceleration_mm_s2 == -1000
    for move in result.moves:
        travel = sum(p.start_velocity_mm_s * p.duration_s + 0.5 * p.acceleration_mm_s2 * p.duration_s ** 2
                     for p in move.phases)
        assert travel == pytest.approx(1, abs=1e-12)


def test_irregular_short_fragments_do_not_create_unrepresentable_phases():
    rng = np.random.default_rng(41)
    endpoints = [*np.sort(rng.uniform(0, 100, 9999)), 100]
    result = plan('\n'.join(f'G1 X{x:.15f} F6000' for x in endpoints))
    assert result.total_duration_s == pytest.approx(1.1, abs=1e-10)
    position, velocity = sample_motion(result, [0, 0.05, 0.1, 0.55, 1, 1.05, 1.2])
    np.testing.assert_allclose(position[:, 0], [0, 1.25, 5, 50, 95, 98.75, 100], atol=1e-8)
    np.testing.assert_allclose(velocity[:, 0], [0, 50, 100, 100, 100, 50, 0], atol=1e-7)
    for move in result.moves:
        travel = sum(p.start_velocity_mm_s * p.duration_s + 0.5 * p.acceleration_mm_s2 * p.duration_s ** 2
                     for p in move.phases)
        assert travel == pytest.approx(move.distance_mm, abs=1e-11)


def test_unequal_collinear_speed_caps_do_not_force_stop():
    result = plan('G1 X100 F6000\nG1 X200 F3000')
    assert result.moves[0].exit_velocity_mm_s == 50
    assert result.moves[1].entry_velocity_mm_s == 50
    assert result.total_duration_s == pytest.approx(3.0875)
    assert result.moves[1].requested_velocity_mm_s == 50


def test_lookahead_reaches_a_stop_across_many_short_moves():
    result = plan('G1 X100 F6000\n' + '\n'.join(f'G1 X{x}' for x in range(101, 111)) + '\nM400')
    # Braking begins five mm before the endpoint, not just in the final 1 mm.
    assert result.moves[-1].entry_velocity_mm_s == pytest.approx(44.721359549995796)
    assert result.moves[-5].entry_velocity_mm_s == 100
    assert result.total_duration_s == pytest.approx(1.2)


@pytest.mark.parametrize('stop,wait', [('M400', 0), ('G4 P500', 0.5), ('M400 S2', 2), ('G4 S0', 0)])
def test_real_stops_and_waits(stop, wait):
    result = plan(f'G1 X100 F6000\n{stop}\nG1 X200')
    assert result.total_duration_s == pytest.approx(2.2 + wait)
    assert result.moves[0].exit_velocity_mm_s == result.moves[1].entry_velocity_mm_s == 0
    assert result.events[1].start_time_s == pytest.approx(1.1)
    assert result.events[1].duration_s == pytest.approx(wait)
    times = [result.moves[0].end_time_s, result.moves[1].start_time_s]
    if wait:
        times.append(result.moves[0].end_time_s + wait / 2)
    position, speed = sample_motion(result, times)
    np.testing.assert_allclose(position, [[100, 100, 0, 0]] * len(times))
    np.testing.assert_array_equal(speed, 0)


def test_nonblocking_events_preserve_order_and_continuity():
    text = ('G1 X50 F6000\n; comment\nM73 P25\nG91\nM83\nG21\nG1 F6000\n'
            'M204 S1000\nM106 S128\nM104 S210\nM140 S60\nG92 X0\nG1 X50')
    result = plan(text)
    assert result.total_duration_s == pytest.approx(1.1)
    assert len(result.events) == 13
    assert [event.command_index for event in result.events] == list(range(13))
    assert [event.source_line for event in result.events] == list(range(1, 14))
    assert result.moves[0].exit_velocity_mm_s == result.moves[1].entry_velocity_mm_s == 100
    for event in result.events[1:-1]:
        assert event.start_time_s == pytest.approx(0.55)
        assert event.end_time_s == pytest.approx(0.55)
    assert result.events[8].state_changes['fan']['duty'] == 128


def test_retiming_copies_timeline_events(monkeypatch):
    commands = parse_source(b'G1 X50 F6000\nM106 S100\nG1 X100')
    source = build_timeline(commands, context=ExecutionContext.known_origin())
    original = asdict(source)
    monkeypatch.setattr('motion_planner.build_timeline', lambda *args, **kwargs: source)
    result = plan_motion(commands)
    assert asdict(source) == original
    assert result.events[0] is not source.events[0]
    result.events[1].state_changes['fan']['duty'] = 42
    assert asdict(source) == original


def test_m204_acceleration_and_axis_clamping():
    result = plan('M204 S2000\nG1 X100 F6000\nM204 S500\nG1 X200')
    assert [move.effective_acceleration_mm_s2 for move in result.moves] == [2000, 500]
    assert result.moves[0].exit_velocity_mm_s == 100
    assert result.total_duration_s == pytest.approx(2.125)
    z_result = plan('M204 S99999\nG1 Z100 F6000')
    assert z_result.moves[0].effective_acceleration_mm_s2 == 500


def test_reversal_endpoints_and_integrated_signed_velocity():
    result = plan('G1 X100 F6000\nG1 X0')
    assert result.total_duration_s == pytest.approx(2.2)
    assert result.moves[0].exit_velocity_mm_s == result.moves[1].entry_velocity_mm_s == 0
    position, speed = sample_motion(result, [0, 1.1, 1.15, 2.2, 4])
    np.testing.assert_allclose(position[:, 0], [0, 100, 98.75, 0, 0], atol=1e-12)
    np.testing.assert_allclose(speed[:, 0], [0, 0, -50, 0, 0], atol=1e-10)
    for move, expected in zip(result.moves, ([100, 100, 0, 0], [-100, -100, 0, 0])):
        times = np.linspace(move.start_time_s, move.end_time_s, 11001)
        _, velocities = sample_motion(result, times)
        np.testing.assert_allclose(np.trapezoid(velocities, times, axis=0), expected, atol=1e-8)


def test_corner_and_extrusion_ratio_junction_caps():
    corner = plan('G1 X100 F6000\nG1 Y100')
    assert corner.moves[0].exit_velocity_mm_s == corner.moves[1].entry_velocity_mm_s == 9
    extrusion = plan('G1 X100 E10 F6000\nG1 X200 E30')
    assert extrusion.moves[0].exit_velocity_mm_s == extrusion.moves[1].entry_velocity_mm_s == 25
    z_corner = plan('G1 X100 F6000\nG1 Z100')
    assert z_corner.moves[0].exit_velocity_mm_s == 3


@pytest.mark.parametrize('text,peak,acceleration,duration', [
    ('M204 S50000\nG1 X1000 F60000', 500, 20000, 2.025),
    ('M204 S50000\nG1 Z100 F60000', 20, 500, 5.04),
    ('M204 S50000\nG1 E100 F60000', 30, 5000, 3.3393333333333333),
    ('M204 S50000\nG1 X100 E200 F60000', 15, 2500, 6.672666666666667),
])
def test_axis_and_e_caps(text, peak, acceleration, duration):
    result = plan(text)
    move, = result.moves
    assert move.peak_velocity_mm_s == pytest.approx(peak)
    assert move.effective_acceleration_mm_s2 == pytest.approx(acceleration)
    assert result.total_duration_s == pytest.approx(duration)


def test_mixed_xyz_e_uses_cartesian_length_and_signed_ratios():
    result = plan('M204 S50000\nG1 X3 Y4 Z12 E26 F60000')
    move, = result.moves
    assert move.distance_mm == 13  # Not sqrt(3² + 4² + 12² + 26²).
    np.testing.assert_allclose(move.motor_ratio, [7 / 13, -1 / 13, 12 / 13, 2])
    assert move.peak_velocity_mm_s == 15  # E, not Z, is the speed bottleneck.
    assert move.effective_acceleration_mm_s2 == pytest.approx(541.6666666666666)
    positions, _ = sample_motion(result, [result.total_duration_s])
    np.testing.assert_allclose(positions, [[7, -1, 12, 26]])


@pytest.mark.parametrize('coordinates,expected', [
    ('X10', [10, 10, 0, 0]), ('X-10', [-10, -10, 0, 0]),
    ('Y10', [10, -10, 0, 0]), ('Y-10', [-10, 10, 0, 0]),
    ('X10 Y10', [20, 0, 0, 0]), ('X10 Y-10', [0, 20, 0, 0]),
    ('X-10 Y10', [0, -20, 0, 0]), ('X-10 Y-10', [-20, 0, 0, 0]),
])
def test_corexy_signed_cardinals_and_diagonals(coordinates, expected):
    result = plan(f'G1 {coordinates} F600')
    position, velocity = sample_motion(result, [result.total_duration_s / 2, result.total_duration_s])
    np.testing.assert_allclose(position[0], np.asarray(expected) / 2)
    np.testing.assert_allclose(position[1], expected)
    np.testing.assert_array_equal(np.sign(velocity[0]), np.sign(expected))


def test_optional_belt_limits_are_not_cartesian_defaults():
    text = 'M204 S50000\nG1 X1000 Y1000 F60000'
    unlimited = plan(text)
    assert unlimited.moves[0].peak_velocity_mm_s == pytest.approx(707.1067811865476)
    assert unlimited.moves[0].effective_acceleration_mm_s2 == pytest.approx(28284.2712474619)
    limited = plan(text, config=PlannerConfig(max_velocity_ab_mm_s=(100, 200),
                                             max_acceleration_ab_mm_s2=(1000, 2000)))
    assert limited.moves[0].peak_velocity_mm_s == pytest.approx(70.71067811865476)
    assert limited.moves[0].effective_acceleration_mm_s2 == pytest.approx(707.1067811865476)
    _, speed = sample_motion(limited, [1])
    np.testing.assert_allclose(speed, [[100, 0, 0, 0]])


def test_belt_b_limit_and_configured_junction_jump():
    config = PlannerConfig(max_velocity_ab_mm_s=(200, 40),
                           max_acceleration_ab_mm_s2=(2000, 400),
                           junction_velocity_jump_xyz_mm_s=(4, 5, 1))
    diagonal = plan('G1 X100 Y-100 F60000', config=config)
    assert diagonal.moves[0].peak_velocity_mm_s == pytest.approx(28.2842712474619)
    assert diagonal.moves[0].effective_acceleration_mm_s2 == pytest.approx(282.842712474619)
    np.testing.assert_allclose(sample_motion(diagonal, [1])[1], [[0, 40, 0, 0]])
    corner = plan('G1 X100 F6000\nG1 Y100', config=config)
    assert corner.moves[0].exit_velocity_mm_s == 4


def test_inches_are_normalized_before_limits_and_planning():
    result = plan('G20\nM204 S100\nG1 X1 E0.1 F60')
    move, = result.moves
    assert move.distance_mm == 25.4
    assert move.requested_velocity_mm_s == pytest.approx(25.4)
    assert move.effective_acceleration_mm_s2 == 2540
    assert result.total_duration_s == pytest.approx(1.01)
    np.testing.assert_allclose(sample_motion(result, [2])[0], [[25.4, 25.4, 0, 2.54]])


def test_stop_then_reacceleration_with_changed_feed_and_no_ghost_velocity():
    result = plan('G1 X100 F6000\nM400\nG1 F3000\nG4 S1\nG1 X150')
    times = [result.moves[0].end_time_s, result.moves[0].end_time_s + 0.5,
             result.moves[1].start_time_s, result.moves[1].end_time_s]
    position, velocity = sample_motion(result, times)
    np.testing.assert_array_equal(position, [[100, 100, 0, 0]] * 3 + [[150, 150, 0, 0]])
    np.testing.assert_array_equal(velocity, 0)
    assert result.total_duration_s == pytest.approx(3.15)


def test_e_only_negative_motion_and_transitions():
    result = plan('G1 E-10 F600\nG1 E-20\nG1 X10 E-19')
    assert result.moves[0].distance_mm == 10
    assert result.moves[0].delta_xyz_mm == (0, 0, 0)
    assert result.moves[0].motor_ratio == (0, 0, 0, -1)
    assert result.moves[0].exit_velocity_mm_s == result.moves[1].entry_velocity_mm_s == 10
    assert result.moves[1].exit_velocity_mm_s == result.moves[2].entry_velocity_mm_s == 0
    position, velocity = sample_motion(result, [0.5, result.total_duration_s])
    np.testing.assert_allclose(position[0], [0, 0, 0, -4.95])
    np.testing.assert_allclose(velocity[0], [0, 0, 0, -10])
    np.testing.assert_allclose(position[-1], [10, 10, 0, -19])
    reversal = plan('G1 E-10 F600\nG1 E0')
    assert reversal.moves[0].exit_velocity_mm_s == 0


@pytest.mark.parametrize('text', [
    'G1 X1 F600', 'G21\nG90\nG1 X1 F600',
    'G21\nG90\nG92 X0\nG1 X1 F600',
])
def test_unknown_initial_state_is_not_inferred(text):
    with pytest.raises(ValueError, match='incomplete timeline'):
        plan_motion(parse_source(text.encode()))


@pytest.mark.parametrize('opcode', ['M201 X20000', 'M203 X500', 'M205 X9', 'M109 S200', 'G28', 'G2 X10 I5'])
def test_whole_file_refusal_even_after_valid_prefix(opcode):
    with pytest.raises(ValueError, match='incomplete timeline: Line 2'):
        plan(f'G1 X100 F6000\n{opcode}\nG1 X200')


def test_explicit_initial_state_and_g92_do_not_become_motor_displacement():
    context = ExecutionContext((100, 200, 5), 50, 'absolute', 'absolute', 'mm', 6000)
    result = plan('G1 X110 E51\nG92 X0 E0\nG1 X10 E1', context=context)
    assert result.moves[0].motor_start_mm == (0, 0, 0, 0)
    assert result.moves[1].motor_start_mm == (10, 10, 0, 1)
    position, _ = sample_motion(result, [result.total_duration_s])
    np.testing.assert_allclose(position, [[20, 20, 0, 2]])
    assert result.events[0].start_xyz_mm == (100, 200, 5)


def test_e_only_allows_unknown_xyz_and_xyz_only_allows_unknown_e():
    e = plan('G1 E-10 F600', context=ExecutionContext(initial_e_mm=0, e_mode='relative', units='mm'))
    xyz = plan('G1 X10 F600', context=ExecutionContext(initial_xyz_mm=(0, 0, 0), xyz_mode='relative', units='mm'))
    np.testing.assert_allclose(sample_motion(e, [2])[0], [[0, 0, 0, -10]])
    np.testing.assert_allclose(sample_motion(xyz, [2])[0], [[10, 10, 0, 0]])


@pytest.mark.parametrize('text,duration', [('', 0), ('; empty\nM106 S100', 0), ('G4 S2\nM400 P500', 2.5)])
def test_empty_and_wait_only(text, duration):
    result = plan_motion(parse_source(text.encode()))
    assert result.total_duration_s == duration
    assert result.moves == ()
    for values in sample_motion(result, [0, 1, 10]):
        np.testing.assert_array_equal(values, np.zeros((3, 4)))
    for values in sample_motion(result, []):
        assert values.shape == (0, 4)


def test_sampler_holds_order_endpoints_and_chunk_invariance():
    result = plan('G4 S1\nG1 X100 F6000\nG4 S2\nG1 X0\nG4 S1')
    stops = [result.moves[0].end_time_s, result.moves[1].end_time_s]
    times = np.array([10, 0, 1.05, 3, 4.15, *stops, result.total_duration_s])
    position, velocity = sample_motion(result, times)
    np.testing.assert_allclose(position[:, 0], [0, 0, 1.25, 100, 98.75, 100, 0, 0], atol=1e-11)
    np.testing.assert_allclose(velocity[:, 0], [0, 0, 50, 0, -50, 0, 0, 0], atol=1e-10)
    chunks = [sample_motion(result, times[i:i + 2]) for i in range(0, len(times), 2)]
    np.testing.assert_array_equal(np.concatenate([chunk[0] for chunk in chunks]), position)
    np.testing.assert_array_equal(np.concatenate([chunk[1] for chunk in chunks]), velocity)
    # A chunk entirely after a move (not containing its start) must still hold.
    np.testing.assert_array_equal(sample_motion(result, [3, 3.5])[0], [[100, 100, 0, 0]] * 2)
    np.testing.assert_array_equal(sample_motion(result, [3, 3.5])[1], 0)


@pytest.mark.parametrize('times', [[-1], [math.nan], [math.inf], [[0]], 0, ['bad']])
def test_sampler_invalid_times(times):
    with pytest.raises(ValueError, match='times_s'):
        sample_motion(plan(''), times)


@pytest.mark.parametrize('kwargs', [
    {'default_acceleration_mm_s2': 0}, {'default_acceleration_mm_s2': True},
    {'max_velocity_e_mm_s': '30'}, {'max_acceleration_e_mm_s2': math.inf},
    {'max_velocity_xyz_mm_s': (500, 500)}, {'max_velocity_xyz_mm_s': (500, math.nan, 20)},
    {'max_acceleration_xyz_mm_s2': (20000, -1, 500)},
    {'junction_velocity_jump_xyz_mm_s': None}, {'junction_velocity_jump_e_mm_s': 0},
    {'max_velocity_ab_mm_s': (100, False)}, {'max_acceleration_ab_mm_s2': 500},
])
def test_config_rejects_invalid_values(kwargs):
    with pytest.raises(ValueError):
        PlannerConfig(**kwargs)


def test_config_normalizes_lists_and_rejects_wrong_api_types():
    config = PlannerConfig(max_velocity_xyz_mm_s=[100, 200, 10], max_velocity_ab_mm_s=[300, 300])
    assert config.max_velocity_xyz_mm_s == (100, 200, 10)
    assert config.max_velocity_ab_mm_s == (300, 300)
    with pytest.raises(ValueError, match='config must be PlannerConfig'):
        plan_motion([], config={})
    with pytest.raises(ValueError, match='context must be ExecutionContext'):
        plan_motion([], context={})
