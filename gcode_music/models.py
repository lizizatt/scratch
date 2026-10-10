"""
Shared data types for the GCODE music pipeline.

Single source of truth for Note (unified across GCODE and audio)
and for parameter dataclasses used by tuning/calibration.
"""

from dataclasses import dataclass, field, fields
from typing import List, Tuple
import math


def _is_finite_number(value) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


@dataclass
class Note:
    """Unified note type used end-to-end (GCODE and audio pipelines)."""
    start_time: float
    end_time: float
    frequency: float
    midi_note: int
    velocity: int
    confidence: float = 1.0  # Used by audio analysis (stepper vs fan)
    is_chord: bool = False
    chord_notes: Tuple[int, ...] = ()  # When is_chord, multiple MIDI notes


@dataclass
class GCodeParams:
    """Parameters for GCODE-to-MIDI conversion (feedrate → frequency mapping)."""
    min_feedrate: float = 100.0
    max_feedrate: float = 10000.0
    min_freq: float = 50.0
    max_freq: float = 2000.0
    velocity: int = 80


@dataclass
class TimingParams:
    """Uncalibrated rest-to-rest approximation, not a machine-limit profile.

    None at the timeline API selects these defaults. Select constant_speed
    explicitly to disable acceleration. time_scale applies only to motion;
    explicit waits retain their stated seconds. time_offset shifts timestamps.
    Old unused limit/threshold settings are rejected, not silently honored.
    """
    default_acceleration: float = 10000.0  # mm/s²
    max_acceleration: float | None = None
    time_scale: float = 1.0
    time_offset: float = 0.0
    accel_distance_threshold: float | None = None
    mode: str = 'rest_to_rest'
    schema_version: int = 2
    acceleration_units: str = 'mm/s^2'

    def __post_init__(self):
        if (type(self.schema_version) is not int or self.schema_version != 2
                or not isinstance(self.acceleration_units, str) or self.acceleration_units != 'mm/s^2'):
            raise ValueError('TimingParams requires schema_version=2 and acceleration_units=mm/s^2')
        if self.max_acceleration is not None or self.accel_distance_threshold is not None:
            raise ValueError('max_acceleration and accel_distance_threshold are unsupported')
        if not isinstance(self.mode, str) or self.mode not in ('rest_to_rest', 'constant_speed'):
            raise ValueError('mode must be rest_to_rest or constant_speed')
        for name in ('default_acceleration', 'time_scale'):
            value = getattr(self, name)
            if not _is_finite_number(value) or value <= 0:
                raise ValueError(name + ' must be finite and positive')
        if not _is_finite_number(self.time_offset):
            raise ValueError('time_offset must be finite')

    @classmethod
    def from_dict(cls, data: dict) -> 'TimingParams':
        """Reject unversioned legacy JSON; refit old scales after fixing units."""
        if not isinstance(data, dict):
            raise ValueError('Timing configuration must be a dict')
        unknown = data.keys() - {f.name for f in fields(cls)}
        if unknown:
            raise ValueError('Unknown timing configuration fields: ' + ', '.join(sorted(map(str, unknown))))
        if data.get('schema_version') != 2 or data.get('acceleration_units') != 'mm/s^2':
            raise ValueError('Legacy timing config: require schema_version=2 and acceleration_units=mm/s^2; refit old scales')
        return cls(**data)
