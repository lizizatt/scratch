"""
GCODE Music Analyzer

Analyzes GCODE files to identify musical tones and chords produced by printer movements.
Outputs a MIDI file with timestamps aligned to GCODE execution.
"""

import re
import math
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from collections import defaultdict

from models import Note


def _movement_time_with_accel(
    distance: float,
    feedrate: float,
    acceleration: float,
    time_scale: float = 1.0,
) -> float:
    """Movement time with trapezoidal velocity profile; returns seconds * time_scale."""
    feedrate_mms = feedrate / 60.0
    acc_mms2 = acceleration / 3600.0
    t_accel = feedrate_mms / acc_mms2 if acc_mms2 > 0 else 0
    d_accel = 0.5 * acc_mms2 * t_accel * t_accel
    if distance <= 2 * d_accel:
        t_total = 2 * math.sqrt(distance / acc_mms2) if acc_mms2 > 0 else 0
    else:
        d_coast = distance - 2 * d_accel
        t_total = 2 * t_accel + d_coast / feedrate_mms
    return t_total * time_scale


@dataclass
class GCodeCommand:
    """Represents a parsed GCODE command"""
    line_num: int
    command: str  # G0, G1, M300, etc.
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    e: Optional[float] = None  # Extruder
    f: Optional[float] = None  # Feedrate (speed)
    raw_line: str = ""


@dataclass
class MovementSegment:
    """Represents a continuous movement segment"""
    start_time: float
    end_time: float
    distance: float
    feedrate: float
    direction: Tuple[float, float, float]  # Normalized direction vector
    commands: List[GCodeCommand]


class GCodeParser:
    """Parses GCODE files and extracts movement commands"""
    
    def __init__(self):
        self.current_pos = {'x': 0.0, 'y': 0.0, 'z': 0.0, 'e': 0.0}
        self.current_feedrate = None
        self.commands: List[GCodeCommand] = []
        
    def parse_file(self, filepath: str) -> List[GCodeCommand]:
        """Parse a GCODE file and return list of commands"""
        self.commands = []
        self.current_pos = {'x': 0.0, 'y': 0.0, 'z': 0.0, 'e': 0.0}
        self.current_feedrate = None
        
        with open(filepath, 'r') as f:
            for line_num, line in enumerate(f, 1):
                cmd = self._parse_line(line.strip(), line_num)
                if cmd:
                    self.commands.append(cmd)
                    self._update_position(cmd)
        
        return self.commands
    
    def _parse_line(self, line: str, line_num: int) -> Optional[GCodeCommand]:
        """Parse a single GCODE line"""
        # Remove comments
        line = line.split(';')[0].strip()
        if not line:
            return None
        
        # Skip non-command lines
        if not line.startswith('G') and not line.startswith('M'):
            return None
        
        # Extract command (G0, G1, M300, etc.)
        cmd_match = re.match(r'([GM]\d+)', line)
        if not cmd_match:
            return None
        
        command = cmd_match.group(1)
        cmd = GCodeCommand(line_num=line_num, command=command, raw_line=line)
        
        # Extract parameters
        for param in ['X', 'Y', 'Z', 'E', 'F']:
            match = re.search(rf'{param}([+-]?\d+\.?\d*)', line)
            if match:
                value = float(match.group(1))
                setattr(cmd, param.lower(), value)
        
        return cmd
    
    def _update_position(self, cmd: GCodeCommand):
        """Update current position based on command"""
        if cmd.x is not None:
            self.current_pos['x'] = cmd.x
        if cmd.y is not None:
            self.current_pos['y'] = cmd.y
        if cmd.z is not None:
            self.current_pos['z'] = cmd.z
        if cmd.e is not None:
            self.current_pos['e'] = cmd.e
        if cmd.f is not None:
            self.current_feedrate = cmd.f


class MovementAnalyzer:
    """Analyzes movements to identify potential musical patterns"""
    
    def __init__(self, commands: List[GCodeCommand]):
        self.commands = commands
        self.segments: List[MovementSegment] = []
        
    def segment_movements(self, timing_params=None) -> List[MovementSegment]:
        """
        Group commands into continuous movement segments
        
        Args:
            timing_params: Optional TimingParams for acceleration modeling.
                          If None, uses simple time calculation (distance/feedrate).
        """
        from models import TimingParams
        if timing_params is None:
            timing_params = TimingParams()
        use_acceleration = timing_params is not None

        segments = []
        current_segment = None
        current_time = timing_params.time_offset
        current_pos = {'x': 0.0, 'y': 0.0, 'z': 0.0}
        current_feedrate = None
        
        for cmd in self.commands:
            if cmd.command not in ['G0', 'G1']:
                # Non-movement command - end current segment
                if current_segment:
                    current_segment.end_time = current_time
                    segments.append(current_segment)
                    current_segment = None
                continue
            
            # Calculate movement
            dx = (cmd.x or current_pos['x']) - current_pos['x']
            dy = (cmd.y or current_pos['y']) - current_pos['y']
            dz = (cmd.z or current_pos['z']) - current_pos['z']
            
            # Update position
            if cmd.x is not None:
                current_pos['x'] = cmd.x
            if cmd.y is not None:
                current_pos['y'] = cmd.y
            if cmd.z is not None:
                current_pos['z'] = cmd.z
            
            distance = math.sqrt(dx*dx + dy*dy + dz*dz)
            
            if distance == 0:
                continue
            
            # Get feedrate
            feedrate = cmd.f or current_feedrate
            if feedrate is None:
                continue
            
            if cmd.f is not None:
                current_feedrate = cmd.f
            
            # Calculate time for this movement
            if use_acceleration:
                duration = _movement_time_with_accel(
                    distance, feedrate,
                    timing_params.default_acceleration,
                    timing_params.time_scale,
                )
            else:
                # Simple calculation: time = distance / feedrate
                # feedrate is in mm/min, so duration in seconds = (distance mm) / (feedrate mm/min) * 60
                duration = (distance / feedrate) * 60.0 if feedrate > 0 else 0.0
            
            # Normalize direction
            direction = (dx/distance, dy/distance, dz/distance)
            
            # Check if this continues the current segment
            if (current_segment and 
                abs(feedrate - current_segment.feedrate) < 0.1 and
                self._similar_direction(current_segment.direction, direction)):
                # Continue segment
                current_segment.distance += distance
                current_segment.end_time = current_time + duration
                current_segment.commands.append(cmd)
            else:
                # Start new segment
                if current_segment:
                    segments.append(current_segment)
                
                current_segment = MovementSegment(
                    start_time=current_time,
                    end_time=current_time + duration,
                    distance=distance,
                    feedrate=feedrate,
                    direction=direction,
                    commands=[cmd]
                )
            
            current_time += duration
        
        if current_segment:
            segments.append(current_segment)
        
        self.segments = segments
        return segments
    
    def _similar_direction(self, dir1: Tuple[float, float, float], 
                          dir2: Tuple[float, float, float], 
                          threshold: float = 0.9) -> bool:
        """Check if two direction vectors are similar"""
        dot_product = dir1[0]*dir2[0] + dir1[1]*dir2[1] + dir1[2]*dir2[2]
        return dot_product > threshold


class FrequencyAnalyzer:
    """Converts movement patterns into musical frequencies"""
    
    # Typical stepper motor frequencies for music
    # Stepper motors can produce audible frequencies roughly in the range 20-20000 Hz
    # But for music, we're typically interested in 50-5000 Hz range
    
    def __init__(self):
        # Relationship between feedrate and frequency
        # This is printer-specific and may need calibration
        # For now, we'll use a heuristic: faster movements = higher frequencies
        self.min_feedrate = 100.0  # mm/min
        self.max_feedrate = 10000.0  # mm/min
        self.min_freq = 50.0  # Hz
        self.max_freq = 2000.0  # Hz
        
    def feedrate_to_frequency(self, feedrate: float) -> float:
        """Convert feedrate to approximate frequency"""
        # Map feedrate to frequency range
        normalized = (feedrate - self.min_feedrate) / (self.max_feedrate - self.min_feedrate)
        normalized = max(0.0, min(1.0, normalized))
        frequency = self.min_freq + normalized * (self.max_freq - self.min_freq)
        return frequency

    def frequency_to_feedrate(self, frequency: float) -> float:
        """Inverse of feedrate_to_frequency; clamps to [min_feedrate, max_feedrate]."""
        span = self.max_freq - self.min_freq
        if span <= 0:
            return (self.min_feedrate + self.max_feedrate) / 2.0
        normalized = (frequency - self.min_freq) / span
        normalized = max(0.0, min(1.0, normalized))
        f = self.min_feedrate + normalized * (self.max_feedrate - self.min_feedrate)
        return max(self.min_feedrate, min(self.max_feedrate, f))

    def frequency_to_midi(self, frequency: float) -> int:
        """Convert frequency to MIDI note number"""
        # MIDI note = 69 + 12 * log2(frequency / 440.0)
        if frequency <= 0:
            return 0
        midi_note = round(69 + 12 * math.log2(frequency / 440.0))
        return max(0, min(127, midi_note))

    def midi_to_frequency(self, midi_note: int) -> float:
        """Convert MIDI note number to frequency in Hz (A4 = 440)."""
        if midi_note <= 0:
            return self.min_freq
        return 440.0 * (2.0 ** ((midi_note - 69) / 12.0))
    
    def analyze_segment(self, segment: MovementSegment) -> Optional[Note]:
        """Analyze a movement segment and return a musical note if detected"""
        frequency = self.feedrate_to_frequency(segment.feedrate)
        midi_note = self.frequency_to_midi(frequency)
        if midi_note == 0:
            return None
        return Note(
            start_time=segment.start_time,
            end_time=segment.end_time,
            frequency=frequency,
            midi_note=midi_note,
            velocity=80,
            is_chord=False,
            chord_notes=(),
        )


class ChordDetector:
    """Detects chords by analyzing simultaneous movements"""
    
    def __init__(self, frequency_analyzer: FrequencyAnalyzer):
        self.freq_analyzer = frequency_analyzer
        
    def detect_chords(self, segments: List[MovementSegment],
                     time_window: float = 0.05,
                     min_overlap_ratio: float = 0.3) -> List[Note]:
        """
        Detect chords by finding overlapping segments
        
        Args:
            time_window: Maximum time gap to consider segments as potentially simultaneous
            min_overlap_ratio: Minimum ratio of overlap required to consider as chord
        """
        notes = []
        
        # Sort segments by start time
        sorted_segments = sorted(segments, key=lambda s: s.start_time)
        
        i = 0
        while i < len(sorted_segments):
            segment = sorted_segments[i]
            
            # Find all segments that actually overlap with this one (not just sequential)
            overlapping = []
            segment_duration = segment.end_time - segment.start_time
            
            for j in range(i, len(sorted_segments)):
                other = sorted_segments[j]
                
                # Check for actual overlap (not just sequential)
                overlap_start = max(segment.start_time, other.start_time)
                overlap_end = min(segment.end_time, other.end_time)
                
                if overlap_end > overlap_start:
                    # They overlap
                    overlap_duration = overlap_end - overlap_start
                    min_duration = min(segment_duration, other.end_time - other.start_time)
                    
                    # Require significant overlap
                    if overlap_duration >= min_duration * min_overlap_ratio:
                        overlapping.append(other)
                elif other.start_time <= segment.end_time + time_window:
                    # Close in time but not overlapping - check if they're truly simultaneous
                    # by checking if they start close together
                    time_gap = other.start_time - segment.start_time
                    if time_gap <= time_window and other.end_time > segment.start_time:
                        overlapping.append(other)
                else:
                    # Too far away, stop searching
                    break
            
            if len(overlapping) > 1:
                # Potential chord - analyze frequencies
                frequencies = []
                for seg in overlapping:
                    freq = self.freq_analyzer.feedrate_to_frequency(seg.feedrate)
                    midi = self.freq_analyzer.frequency_to_midi(freq)
                    if midi > 0:
                        frequencies.append((freq, midi))
                
                # Remove duplicate MIDI notes (same note in chord)
                unique_midi_notes = list(dict.fromkeys([m for _, m in frequencies]))
                
                if len(unique_midi_notes) >= 2:
                    start_time = min(s.start_time for s in overlapping)
                    end_time = max(s.end_time for s in overlapping)
                    notes.append(Note(
                        start_time=start_time,
                        end_time=end_time,
                        frequency=frequencies[0][0],
                        midi_note=unique_midi_notes[0],
                        velocity=80,
                        is_chord=True,
                        chord_notes=tuple(unique_midi_notes),
                    ))
                    # Skip all overlapping segments
                    i += len(overlapping)
                    continue
            
            # Single note
            note = self.freq_analyzer.analyze_segment(segment)
            if note:
                notes.append(note)
            
            i += 1
        
        return notes


def main():
    """Main entry point for testing"""
    print("GCODE Music Analyzer")
    print("This module provides classes for analyzing GCODE files for musical content.")
    print("\nUsage:")
    print("  from gcode_analyzer import GCodeParser, MovementAnalyzer, ChordDetector")
    print("  parser = GCodeParser()")
    print("  commands = parser.parse_file('input.gcode')")
    print("  analyzer = MovementAnalyzer(commands)")
    print("  segments = analyzer.segment_movements()")


if __name__ == "__main__":
    main()

