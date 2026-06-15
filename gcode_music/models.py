"""
Shared data types for the GCODE music pipeline.

Single source of truth for Note (unified across GCODE and audio)
and for parameter dataclasses used by tuning/calibration.
"""

from dataclasses import dataclass, field
from typing import List, Tuple


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
    """Parameters for timing calculation (acceleration, scale, offset)."""
    default_acceleration: float = 10000.0  # mm/min²
    max_acceleration: float = 20000.0  # mm/min²
    time_scale: float = 1.0
    time_offset: float = 0.0
    accel_distance_threshold: float = 5.0  # mm
