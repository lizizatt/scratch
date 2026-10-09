"""Approximate continuous linear motion for offline synthesis, not firmware.

The theoretical P1S reference limits are not measured or stock-verified planner
behavior, and do not validate GCODE safety. The profile reference is pinned at:
https://github.com/bambulab/BambuStudio/blob/da8b44ee34dd349f2ae0df3f1cbae366df482354/resources/profiles/BBL/machine/Bambu%20Lab%20P1S%200.4%20nozzle.json

Only the existing timeline dialect is accepted: M204 S changes requested
acceleration; dynamic M201/M203/M205 limits and other unsupported commands
remain errors. Classic velocity-jump junctions approximate corners; there is
no corner rounding, pressure advance, input shaping, step calibration, thermal
model, or stock motor-noise compensation.
"""

from bisect import bisect_right
from copy import deepcopy
from dataclasses import dataclass, fields
import math

import numpy as np

from gcode_source import GCodeCommand
from models import TimingParams, _is_finite_number
from motion_timeline import ExecutionContext, TimelineEvent, build_timeline


@dataclass(frozen=True)
class PlannerConfig:
    """Explicit mm, s, mm/s and mm/s² limits; tuples are ordered XYZ or AB.

    AB limits describe optional motor belt travel, not Cartesian axis limits.
    Junction limits bound the instantaneous signed XYZE velocity change, not
    the time derivative of acceleration (sometimes also called jerk).
    """

    default_acceleration_mm_s2: float = 10000.0
    max_velocity_xyz_mm_s: tuple[float, float, float] = (500.0, 500.0, 20.0)
    max_velocity_e_mm_s: float = 30.0
    max_acceleration_xyz_mm_s2: tuple[float, float, float] = (20000.0, 20000.0, 500.0)
    max_acceleration_e_mm_s2: float = 5000.0
    junction_velocity_jump_xyz_mm_s: tuple[float, float, float] = (9.0, 9.0, 3.0)
    junction_velocity_jump_e_mm_s: float = 2.5
    max_velocity_ab_mm_s: tuple[float, float] | None = None
    max_acceleration_ab_mm_s2: tuple[float, float] | None = None

    def __post_init__(self):
        for item in fields(self):
            value = getattr(self, item.name)
            optional = '_ab_' in item.name
            if optional and value is None:
                continue
            size = 2 if optional else (3 if '_xyz_' in item.name else None)
            if size is not None:
                if not isinstance(value, (tuple, list)) or len(value) != size:
                    raise ValueError(f'{item.name} must contain {size} positive finite numbers')
                values = value
            else:
                values = (value,)
            if any(not _is_finite_number(v) or v <= 0 for v in values):
                raise ValueError(f'{item.name} must contain only positive finite numbers')
            if size is not None:
                object.__setattr__(self, item.name, tuple(value))


@dataclass(frozen=True)
class MotionPhase:
    """Constant scalar acceleration; distance is relative to its move's start."""

    start_time_s: float
    end_time_s: float
    start_distance_mm: float
    start_velocity_mm_s: float
    acceleration_mm_s2: float

    @property
    def duration_s(self) -> float:
        return self.end_time_s - self.start_time_s


@dataclass(frozen=True)
class PlannedMove:
    source_line: int
    command_index: int
    start_time_s: float
    end_time_s: float
    distance_mm: float
    entry_velocity_mm_s: float
    exit_velocity_mm_s: float
    peak_velocity_mm_s: float
    requested_velocity_mm_s: float
    effective_acceleration_mm_s2: float
    delta_xyz_mm: tuple[float, float, float]
    delta_e_mm: float
    motor_start_mm: tuple[float, float, float, float]
    motor_ratio: tuple[float, float, float, float]
    phases: tuple[MotionPhase, ...]


@dataclass(frozen=True)
class MotionPlan:
    moves: tuple[PlannedMove, ...]
    events: list[TimelineEvent]
    total_duration_s: float
    config: PlannerConfig
    diagnostics: list[str]
    label: str = 'approximate theoretical P1S reference; not measured or stock verified'


@dataclass
class _MoveSpec:
    event: TimelineEvent
    distance: float
    ratio: tuple[float, float, float, float]
    motor_ratio: tuple[float, float, float, float]
    cap: float
    acceleration: float
    entry: float = 0.0
    exit: float = 0.0


def _finite(*values: float) -> None:
    if not all(math.isfinite(value) for value in values):
        raise ValueError('numeric range exceeded in motion planner')


def _bounded(value: float, ratios: tuple, limits: tuple) -> float:
    for ratio, limit in zip(ratios, limits):
        if ratio:
            value = min(value, limit / abs(ratio))
    return value


def _spec(event: TimelineEvent, config: PlannerConfig) -> _MoveSpec:
    xyz = event.delta_xyz_mm or (0.0, 0.0, 0.0)
    de = event.delta_e_mm or 0.0
    distance = math.hypot(*xyz) or abs(de)
    ratio = (*[v / distance for v in xyz], de / distance)
    x, y, z, e = ratio
    motor_ratio = (x + y, x - y, z, e)
    cap = _bounded(event.velocity_mm_s, ratio,
                   (*config.max_velocity_xyz_mm_s, config.max_velocity_e_mm_s))
    acceleration = _bounded(event.acceleration_mm_s2, ratio,
                            (*config.max_acceleration_xyz_mm_s2, config.max_acceleration_e_mm_s2))
    if config.max_velocity_ab_mm_s is not None:
        cap = _bounded(cap, motor_ratio[:2], config.max_velocity_ab_mm_s)
    if config.max_acceleration_ab_mm_s2 is not None:
        acceleration = _bounded(acceleration, motor_ratio[:2], config.max_acceleration_ab_mm_s2)
    _finite(distance, *ratio, *motor_ratio, cap, acceleration)
    if cap <= 0 or acceleration <= 0:
        raise ValueError('motion limits below representable positive range')
    return _MoveSpec(event, distance, ratio, motor_ratio, cap, acceleration)


def _junction(left: _MoveSpec, right: _MoveSpec, config: PlannerConfig) -> float:
    left_xyz = any(left.ratio[:3])
    right_xyz = any(right.ratio[:3])
    if left_xyz != right_xyz:
        return 0.0  # Cartesian / E-only transitions use different scalar paths.
    dot = (sum(a * b for a, b in zip(left.ratio[:3], right.ratio[:3]))
           if left_xyz else left.ratio[3] * right.ratio[3])
    if dot <= -1.0 + 1e-12:
        return 0.0
    jumps = tuple(b - a for a, b in zip(left.ratio, right.ratio))
    return _bounded(min(left.cap, right.cap), jumps,
                    (*config.junction_velocity_jump_xyz_mm_s, config.junction_velocity_jump_e_mm_s))


def _lookahead(run: list[_MoveSpec], config: PlannerConfig) -> None:
    if not run:
        return
    speeds = [0.0] + [_junction(a, b, config) for a, b in zip(run, run[1:])] + [0.0]
    for i, move in enumerate(run):
        speeds[i + 1] = min(speeds[i + 1], math.sqrt(speeds[i] ** 2 + 2 * move.acceleration * move.distance))
    for i in range(len(run) - 1, -1, -1):
        move = run[i]
        speeds[i] = min(speeds[i], math.sqrt(speeds[i + 1] ** 2 + 2 * move.acceleration * move.distance))
    for i, move in enumerate(run):
        move.entry, move.exit = speeds[i:i + 2]


def _make_move(spec: _MoveSpec, clock: float, motor_start: tuple) -> PlannedMove:
    a, u, w, length = spec.acceleration, spec.entry, spec.exit, spec.distance
    peak = min(spec.cap, math.sqrt(a * length + (u * u + w * w) / 2))
    # Reachability can leave a few ulps of disagreement at a boundary.
    peak = max(peak, u, w)
    if peak - max(u, w) <= 8 * math.ulp(peak):
        peak = max(u, w)
    accel_distance = max(0.0, (peak - u) * (peak + u) / (2 * a))
    decel_distance = max(0.0, (peak - w) * (peak + w) / (2 * a))
    cruise_distance = max(0.0, length - accel_distance - decel_distance)
    # Short ramp fragments inherit rounding from the much larger v²/a scale.
    distance_tolerance = 32 * math.ulp(max(length, (peak / a) * peak))
    if accel_distance + decel_distance > 0 and cruise_distance <= distance_tolerance:
        cruise_distance = 0.0  # A triangle's rounding residual is not a cruise phase.
    pieces = (((peak - u) / a, u, a, accel_distance),
              (cruise_distance / peak, peak, 0.0, cruise_distance),
              ((peak - w) / a, peak, -a, decel_distance))
    phases = []
    start = clock
    distance = 0.0
    for duration, velocity, acceleration, travel in pieces:
        _finite(duration, clock + duration, travel)
        if duration > 0:
            if clock + duration == clock:
                if travel > distance_tolerance:
                    raise ValueError('motion phase duration below timestamp precision')
            else:
                phases.append(MotionPhase(clock, clock + duration, distance, velocity, acceleration))
                clock += duration
        distance += travel
    if not phases:
        raise ValueError('motion duration below timestamp precision')
    event = spec.event
    return PlannedMove(event.source_line, event.command_index, start, clock, length,
                       u, w, peak, event.velocity_mm_s, a,
                       event.delta_xyz_mm or (0.0, 0.0, 0.0), event.delta_e_mm or 0.0,
                       motor_start, spec.motor_ratio, tuple(phases))


def _motor_end(move: PlannedMove) -> tuple[float, float, float, float]:
    x, y, z = move.delta_xyz_mm
    return tuple(start + delta for start, delta in
                 zip(move.motor_start_mm, (x + y, x - y, z, move.delta_e_mm)))


def plan_motion(commands: list[GCodeCommand], context: ExecutionContext | None = None,
                config: PlannerConfig | None = None) -> MotionPlan:
    """Plan the entire supported input or raise ValueError, never a known prefix.

    No initial state is inferred. Nonblocking state/fan/temperature events are
    placed at the preceding motion boundary in source order without stopping
    lookahead. Dwell, wait and synchronization events drain motion first.
    Motor coordinates are cumulative displacement from simulation start:
    A = delta X + delta Y, B = delta X - delta Y, Z = delta Z, E = delta E.
    """
    config = config if config is not None else PlannerConfig()
    if not isinstance(config, PlannerConfig):
        raise ValueError('config must be PlannerConfig or None')
    config.__post_init__()
    if context is not None and not isinstance(context, ExecutionContext):
        raise ValueError('context must be ExecutionContext or None')
    timeline = build_timeline(commands, TimingParams(
        mode='rest_to_rest', default_acceleration=config.default_acceleration_mm_s2), context=context)
    if not timeline.complete:
        raise ValueError('Cannot plan incomplete timeline: ' + '; '.join(timeline.diagnostics))
    events = deepcopy(timeline.events)
    specs = {}
    run = []
    for event in events:
        if event.kind in ('move', 'extrusion', 'retraction'):
            spec = _spec(event, config)
            specs[event.command_index] = spec
            run.append(spec)
        elif event.kind in ('dwell', 'wait', 'synchronization'):
            _lookahead(run, config)
            run = []
    _lookahead(run, config)

    clock = 0.0
    motor_position = (0.0, 0.0, 0.0, 0.0)
    moves = []
    for event in events:
        event.start_time_s = clock
        if event.command_index in specs:
            move = _make_move(specs[event.command_index], clock, motor_position)
            moves.append(move)
            clock = move.end_time_s
            motor_position = _motor_end(move)
            _finite(*motor_position)
            event.duration_certainty = 'model'
        else:
            clock += event.duration_s
        _finite(clock)
        event.end_time_s = clock
        event.duration_s = clock - event.start_time_s
        event.timestamp_certainty = 'model'
    diagnostics = list(timeline.diagnostics) + [
        'Approximate theoretical P1S reference, not measured/stock-verified; not GCODE safety validation.',
        'Classic axis velocity-jump junction approximation; no firmware compensation or steps/mm assumed.',
        'Dynamic M201/M203/M205 and all other unsupported timeline commands are rejected; M204 S is honored.',
        'Nonblocking events retain source order at motion boundaries; E-only/Cartesian transitions stop.',
    ]
    return MotionPlan(tuple(moves), events, clock, config, diagnostics)


def sample_motion(plan: MotionPlan, times_s) -> tuple[np.ndarray, np.ndarray]:
    """Return (displacement_mm, velocity_mm_s), each shape (n, 4), channels ABZE.

    Times must be a finite nonnegative 1-D sequence, in any order. Motion uses
    half-open phase intervals: an exact stop endpoint has zero velocity unless
    another move starts there. Dwells and times beyond the plan hold position.
    Memory scales with supplied times only; call with audio-sized chunks, not
    the whole print. Binary searches skip moves outside the supplied interval.
    """
    try:
        times = np.asarray(times_s, dtype=float)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError('times_s must be a finite nonnegative 1-D sequence') from exc
    if times.ndim != 1 or not np.all(np.isfinite(times)) or np.any(times < 0):
        raise ValueError('times_s must be a finite nonnegative 1-D sequence')
    order = np.argsort(times, kind='stable')
    times = times[order]
    displacement = np.zeros((len(times), 4))
    velocity = np.zeros_like(displacement)
    if len(times) and plan.moves:
        first = max(0, bisect_right(plan.moves, times[0], key=lambda move: move.start_time_s) - 1)
        first_move = plan.moves[first]
        displacement[:] = (first_move.motor_start_mm if times[0] < first_move.end_time_s
                           else _motor_end(first_move))
        for i in range(first, len(plan.moves)):
            move = plan.moves[i]
            if move.start_time_s > times[-1]:
                break
            ratio = np.asarray(move.motor_ratio)
            for phase in move.phases:
                lo, hi = np.searchsorted(times, (phase.start_time_s, phase.end_time_s))
                if lo == hi:
                    continue
                dt = times[lo:hi] - phase.start_time_s
                distance = phase.start_distance_mm + dt * (phase.start_velocity_mm_s + 0.5 * phase.acceleration_mm_s2 * dt)
                distance = np.clip(distance, 0.0, move.distance_mm)
                speed = np.maximum(0.0, phase.start_velocity_mm_s + phase.acceleration_mm_s2 * dt)
                displacement[lo:hi] = move.motor_start_mm + distance[:, None] * ratio
                velocity[lo:hi] = speed[:, None] * ratio
            lo = np.searchsorted(times, move.end_time_s)
            hi = (np.searchsorted(times, plan.moves[i + 1].start_time_s)
                  if i + 1 < len(plan.moves) else len(times))
            displacement[lo:hi] = _motor_end(move)
    unsorted_displacement = np.empty_like(displacement)
    unsorted_velocity = np.empty_like(velocity)
    unsorted_displacement[order] = displacement
    unsorted_velocity[order] = velocity
    return unsorted_displacement, unsorted_velocity
