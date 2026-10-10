"""Offline commanded motion, not a stock-firmware or acoustic simulation.

XYZ and E modes are independent: G90/G91 do not override M82/M83 here.
This is a declared dialect approximation, not verified P1S firmware behavior.
Positions are commanded physical mm (not measured); G92 changes offsets only.
F is path mm/min, or E mm/min for extrusion-only moves. Coordinated E does
not add to Cartesian path length. No lookahead, limits, or compensation.
"""

import math
from dataclasses import dataclass, field

from gcode_source import GCodeCommand
from models import TimingParams, _is_finite_number


@dataclass
class ExecutionContext:
    """Explicit initial state; unspecified position/modes/units stay unknown.

    Initial physical and logical coordinates coincide (zero G92 offsets).
    E position/mode may be unknown for XYZ-only snippets, and vice versa.
    known_origin is an opt-in snippet assumption, never a homing operation.
    """
    initial_xyz_mm: tuple[float, float, float] | None = None
    initial_e_mm: float | None = None
    xyz_mode: str | None = None
    e_mode: str | None = None
    units: str | None = None
    feedrate_mm_min: float | None = None

    @classmethod
    def known_origin(cls) -> 'ExecutionContext':
        return cls((0.0, 0.0, 0.0), 0.0, 'absolute', 'absolute', 'mm')

    def __post_init__(self):
        if self.units is not None and (not isinstance(self.units, str) or self.units not in ('mm', 'inch')):
            raise ValueError('units must be mm, inch, or None')
        if any(mode is not None and (not isinstance(mode, str) or mode not in ('absolute', 'relative'))
               for mode in (self.xyz_mode, self.e_mode)):
            raise ValueError('modes must be absolute, relative, or None')
        if self.initial_xyz_mm is not None:
            if (not isinstance(self.initial_xyz_mm, (tuple, list)) or len(self.initial_xyz_mm) != 3
                    or not all(_is_finite_number(v) for v in self.initial_xyz_mm)):
                raise ValueError('initial_xyz_mm must contain three finite coordinates')
            self.initial_xyz_mm = tuple(self.initial_xyz_mm)
        if self.initial_e_mm is not None and not _is_finite_number(self.initial_e_mm):
            raise ValueError('initial_e_mm must be finite')
        if self.feedrate_mm_min is not None and (not _is_finite_number(self.feedrate_mm_min) or self.feedrate_mm_min <= 0):
            raise ValueError('feedrate_mm_min must be finite and positive')


@dataclass
class SupportEntry:
    command_index: int
    source_line: int
    opcode: str
    form: str
    status: str
    reason: str


@dataclass
class TimelineEvent:
    command_index: int
    source_line: int
    opcode: str
    kind: str
    start_time_s: float | None = None
    end_time_s: float | None = None
    duration_s: float | None = None
    duration_certainty: str = 'unknown'
    timestamp_certainty: str = 'unknown'
    start_xyz_mm: tuple[float, float, float] | None = None
    end_xyz_mm: tuple[float, float, float] | None = None
    delta_xyz_mm: tuple[float, float, float] | None = None
    start_e_mm: float | None = None
    end_e_mm: float | None = None
    delta_e_mm: float | None = None
    distance_xyz_mm: float | None = None
    feedrate_mm_min: float | None = None
    velocity_mm_s: float | None = None  # Requested path speed, not instantaneous speed.
    acceleration_mm_s2: float | None = None
    state_changes: dict = field(default_factory=dict)
    diagnostics: list[str] = field(default_factory=list)


@dataclass
class TimelineResult:
    events: list[TimelineEvent]
    support_report: list[SupportEntry]
    complete: bool
    total_duration_s: float | None
    known_prefix_duration_s: float
    diagnostics: list[str]
    timing_model: str
    context: ExecutionContext


def movement_duration(distance_mm: float, velocity_mm_s: float, acceleration_mm_s2: float) -> float:
    """Analytic rest-to-rest triangle/trapezoid, without planner lookahead."""
    if not _is_finite_number(distance_mm) or distance_mm < 0:
        raise ValueError('distance_mm must be finite and nonnegative')
    for name, value in (('velocity_mm_s', velocity_mm_s), ('acceleration_mm_s2', acceleration_mm_s2)):
        if not _is_finite_number(value) or value <= 0:
            raise ValueError(name + ' must be finite and positive')
    if math.sqrt(distance_mm) <= velocity_mm_s / math.sqrt(acceleration_mm_s2):
        return 2 * (math.sqrt(distance_mm) / math.sqrt(acceleration_mm_s2))
    return distance_mm / velocity_mm_s + velocity_mm_s / acceleration_mm_s2


def _finite(*values):
    if any(not math.isfinite(v) for v in values):
        raise ValueError('numeric range exceeded; prediction stopped')


def classify_command(command: GCodeCommand) -> tuple[str, str, str]:
    """Return support status, event kind, reason for the exact opcode/form."""
    params = command.parameter_values()
    if command.source and (command.source.problems or command.source.numbered_or_checksummed):
        return 'unsupported', 'opaque', '; '.join(command.source.problems) or 'numbered/checksummed execution unsupported'
    if not command.command:
        return 'irrelevant', 'comment', 'non-executable source'
    if any(not math.isfinite(v) for v in params.values()):
        return 'unsupported', 'opaque', 'nonfinite parameter'
    if command.command in ('G0', 'G1') and set(params) <= set('XYZEF'):
        if 'F' in params and params['F'] <= 0:
            return 'unsupported', 'opaque', 'F must be positive'
        return 'modeled', 'move', 'linear commanded motion'
    if command.command in ('G20', 'G21', 'G90', 'G91', 'M82', 'M83') and not params:
        return 'modeled', 'state', 'units or independent XYZ/E mode'
    if command.command == 'G92' and params and set(params) <= set('XYZE'):
        return 'modeled', 'state', 'coordinate offset reset, no physical motion'
    if command.command in ('G4', 'M400'):
        if command.command == 'M400' and not params:
            return 'modeled', 'synchronization', 'queue drain; no added delay in rest-to-rest model'
        if set(params) in ({'P'}, {'S'}) and next(iter(params.values())) >= 0:
            kind = 'dwell' if command.command == 'G4' else 'wait'
            return 'modeled', kind, 'explicit wait: P milliseconds or S seconds (declared dialect)'
        return 'unsupported', 'unknown_wait', 'require one nonnegative P(ms) or S(s); mixed/other forms unsupported'
    if command.command in ('M109', 'M190', 'M0', 'M1'):
        return 'unsupported', 'unknown_wait', 'wait duration/state unknown'
    if command.command == 'M73' and set(params) <= {'P', 'R'} and all(v >= 0 for v in params.values()):
        return 'irrelevant', 'progress', 'progress metadata; no modeled delay'
    if command.command == 'M204' and set(params) == {'S'} and params['S'] > 0:
        return 'modeled', 'state', 'requested acceleration in current length units/s², no machine limits'
    if command.command in ('M104', 'M140') and set(params) == {'S'} and params['S'] >= 0:
        return 'modeled', 'temperature', 'nonblocking temperature target; thermal/acoustic effects unmodeled'
    if command.command in ('M106', 'M107'):
        allowed = {'P', 'S'} if command.command == 'M106' else {'P'}
        if (set(params) <= allowed and ('S' in params or command.command == 'M107')
                and 0 <= params.get('S', 0) <= 255
                and params.get('P', 0) >= 0 and float(params.get('P', 0)).is_integer()):
            return 'modeled', 'fan', 'commanded duty only; fan identity, dynamics and sound unmodeled'
    return 'unsupported', 'opaque', 'opcode or parameter form not modeled'


def build_timeline(commands: list[GCodeCommand], timing_params: TimingParams | None = None,
                   context: ExecutionContext | None = None) -> TimelineResult:
    """Build a JSON/asdict-ready timeline; stop at the first unknown operation.

    Every input record remains represented after a stop, with null times and
    no downstream positions. Support classification still covers the full file.
    A known timestamp means known *under this model*, not firmware-accurate.
    """
    timing = timing_params if timing_params is not None else TimingParams()
    timing.__post_init__()
    context = context if context is not None else ExecutionContext()
    context.__post_init__()
    xyz = context.initial_xyz_mm
    e_pos = context.initial_e_mm
    xyz_mode, e_mode, units = context.xyz_mode, context.e_mode, context.units
    xyz_offset = (0.0, 0.0, 0.0)
    e_offset = 0.0
    feedrate = context.feedrate_mm_min
    acceleration = timing.default_acceleration
    clock = timing.time_offset
    elapsed = 0.0
    stopped = False
    events, support, diagnostics = [], [], []

    for index, command in enumerate(commands):
        p = command.parameter_values()
        status, kind, reason = classify_command(command)
        support.append(SupportEntry(index, command.line_num, command.command,
                                    command.command + (' ' + ' '.join(sorted(p)) if p else ''), status, reason))
        event = TimelineEvent(index, command.line_num, command.command, kind)
        events.append(event)
        if stopped:
            event.diagnostics.append('Not evaluated after earlier unknown state/time')
            continue
        if status == 'unsupported':
            event.diagnostics.append(reason)
            diagnostics.append(f'Line {command.line_num}: {reason}')
            stopped = True
            continue
        try:
            duration = 0.0
            event.duration_certainty = 'known'
            op = command.command
            if op in ('G20', 'G21'):
                units = 'inch' if op == 'G20' else 'mm'
                event.state_changes['units'] = units
            elif op in ('G90', 'G91'):
                xyz_mode = 'absolute' if op == 'G90' else 'relative'
                event.state_changes['xyz_mode'] = xyz_mode
            elif op in ('M82', 'M83'):
                e_mode = 'absolute' if op == 'M82' else 'relative'
                event.state_changes['e_mode'] = e_mode
            elif op == 'G92':
                if units is None:
                    raise ValueError('unresolved initial units for G92')
                factor = 25.4 if units == 'inch' else 1.0
                if any(axis in p for axis in 'XYZ'):
                    if xyz is None:
                        raise ValueError('G92 cannot establish unknown physical XYZ position')
                    xyz_offset = tuple(xyz[i] - p[axis] * factor if axis in p else xyz_offset[i]
                                       for i, axis in enumerate('XYZ'))
                    _finite(*xyz_offset)
                    event.state_changes['xyz_offset_mm'] = xyz_offset
                if 'E' in p:
                    if e_pos is None:
                        raise ValueError('G92 cannot establish unknown physical E position')
                    e_offset = e_pos - p['E'] * factor
                    _finite(e_offset)
                    event.state_changes['e_offset_mm'] = e_offset
            elif kind in ('dwell', 'wait'):
                duration = p['P'] / 1000 if 'P' in p else p['S']
            elif kind == 'fan':
                event.state_changes['fan'] = {'index': int(p['P']) if 'P' in p else 'default',
                                              'duty': p['S'] if op == 'M106' else 0}
                event.diagnostics.append(reason)
            elif kind == 'temperature':
                event.state_changes['temperature_target_c'] = {'heater': 'bed' if op == 'M140' else 'hotend',
                                                               'target': p['S']}
                event.diagnostics.append(reason)
            elif op == 'M204':
                if units is None:
                    raise ValueError('unresolved units for acceleration')
                acceleration = p['S'] * (25.4 if units == 'inch' else 1.0)
                _finite(acceleration)
                event.state_changes['acceleration_mm_s2'] = acceleration
            if kind == 'move':
                if units is None and p:
                    raise ValueError('unresolved initial units')
                factor = 25.4 if units == 'inch' else 1.0
                if 'F' in p:
                    feedrate = p['F'] * factor
                    _finite(feedrate)
                    event.state_changes['feedrate_mm_min'] = feedrate
                xyz_words = any(axis in p for axis in 'XYZ')
                e_word = 'E' in p
                if xyz_words and (xyz is None or xyz_mode is None):
                    raise ValueError('unresolved initial XYZ position/mode')
                if e_word and (e_pos is None or e_mode is None):
                    raise ValueError('unresolved initial E position/mode')
                end_xyz = xyz
                if xyz_words:
                    end_xyz = tuple((p[axis] * factor + (xyz[i] if xyz_mode == 'relative' else xyz_offset[i]))
                                    if axis in p else xyz[i] for i, axis in enumerate('XYZ'))
                end_e = e_pos
                if e_word:
                    end_e = p['E'] * factor + (e_pos if e_mode == 'relative' else e_offset)
                delta = tuple(b - a for a, b in zip(xyz, end_xyz)) if xyz is not None else None
                de = end_e - e_pos if e_pos is not None else None
                if end_xyz is not None:
                    _finite(*end_xyz, *delta)
                if end_e is not None:
                    _finite(end_e, de)
                distance = math.hypot(*delta) if delta is not None else 0.0
                path_length = distance if distance else abs(de or 0)
                _finite(path_length)
                event.start_xyz_mm, event.end_xyz_mm, event.delta_xyz_mm = xyz, end_xyz, delta
                event.start_e_mm, event.end_e_mm, event.delta_e_mm = e_pos, end_e, de
                event.distance_xyz_mm = distance
                if path_length:
                    if feedrate is None:
                        raise ValueError('unresolved modal feedrate')
                    if feedrate / 60 <= 0:
                        raise ValueError('feedrate below representable velocity')
                    event.feedrate_mm_min = feedrate
                    event.velocity_mm_s = feedrate / 60
                    event.acceleration_mm_s2 = acceleration if timing.mode == 'rest_to_rest' else None
                    duration = (movement_duration(path_length, feedrate / 60, acceleration)
                                if timing.mode == 'rest_to_rest' else path_length / (feedrate / 60)) * timing.time_scale
                    event.duration_certainty = 'model'
                    event.kind = 'move' if distance else ('retraction' if de < 0 else 'extrusion')
                else:
                    event.kind = 'state'
                xyz, e_pos = end_xyz, end_e
            _finite(duration, elapsed + duration, clock + duration)
            event.start_time_s = clock
            event.duration_s = duration
            elapsed += duration
            clock += duration
            event.end_time_s = clock
            event.timestamp_certainty = 'model'
        except ValueError as exc:
            # Do not expose partially computed state, especially nonfinite values.
            events[-1] = TimelineEvent(index, command.line_num, command.command, kind,
                                       diagnostics=[str(exc)])
            diagnostics.append(f'Line {command.line_num}: {exc}')
            stopped = True
    prefix = elapsed
    return TimelineResult(events, support, not stopped, None if stopped else prefix, prefix,
                          diagnostics, timing.mode, context)
