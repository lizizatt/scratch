"""
Unit tests for GCODE parsing and frequency mapping.

Run from repo root: pytest gcode_music/tests/test_gcode_analyzer.py -v
Or from gcode_music/: pytest tests/test_gcode_analyzer.py -v
"""
import sys
import math
from pathlib import Path

# Allow importing gcode_music modules when run from repo root or from gcode_music
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from gcode_analyzer import (
    GCodeParser,
    GCodeCommand,
    MovementAnalyzer,
    MovementSegment,
    FrequencyAnalyzer,
)


# --- Parser ---

def test_parse_minimal_gcode():
    """Parser produces expected commands from minimal GCODE."""
    parser = GCodeParser()
    gcode = [
        "G1 X10 Y0 F600",
        "G1 X20 Y10 F1200",
    ]
    commands = []
    for i, line in enumerate(gcode):
        cmd = parser._parse_line(line.strip(), i + 1)
        if cmd:
            commands.append(cmd)
            parser._update_position(cmd)
    assert len(commands) == 2
    assert commands[0].command == "G1"
    assert commands[0].x == 10 and commands[0].y == 0 and commands[0].f == 600
    assert commands[1].x == 20 and commands[1].y == 10 and commands[1].f == 1200


def test_parse_file_returns_commands(tmp_path):
    """parse_file returns list of GCodeCommand."""
    gcode_file = tmp_path / "minimal.gcode"
    gcode_file.write_text("G1 X0 Y0 F300\nG1 X10 Y0 F600\n")
    parser = GCodeParser()
    commands = parser.parse_file(str(gcode_file))
    assert len(commands) == 2
    assert all(isinstance(c, GCodeCommand) for c in commands)


# --- Frequency mapping ---

def test_feedrate_to_frequency_bounds():
    """feedrate_to_frequency maps min/max feedrate to min/max freq and clamps."""
    fa = FrequencyAnalyzer()
    fa.min_feedrate = 100.0
    fa.max_feedrate = 10000.0
    fa.min_freq = 50.0
    fa.max_freq = 2000.0
    assert fa.feedrate_to_frequency(100.0) == 50.0
    assert fa.feedrate_to_frequency(10000.0) == 2000.0
    assert fa.feedrate_to_frequency(5050.0) == 1025.0  # midpoint
    # Clamp below/above range
    assert fa.feedrate_to_frequency(0) == 50.0
    assert fa.feedrate_to_frequency(20000) == 2000.0


def test_frequency_to_midi_roundtrip():
    """frequency_to_midi maps 440 Hz to 69 (A4) and stays in 0-127."""
    fa = FrequencyAnalyzer()
    assert fa.frequency_to_midi(440.0) == 69
    assert fa.frequency_to_midi(220.0) == 57
    assert fa.frequency_to_midi(880.0) == 81
    assert 0 <= fa.frequency_to_midi(20.0) <= 127
    assert 0 <= fa.frequency_to_midi(20000.0) <= 127
    assert fa.frequency_to_midi(0) == 0
    assert fa.frequency_to_midi(-1) == 0


# --- Movement segmentation ---

def test_segment_movements_minimal():
    """segment_movements on two moves produces one or two segments with valid times."""
    parser = GCodeParser()
    commands = [
        GCodeCommand(1, "G1", x=0, y=0, f=600, raw_line="G1 X0 Y0 F600"),
        GCodeCommand(2, "G1", x=10, y=0, f=600, raw_line="G1 X10 Y0 F600"),
    ]
    analyzer = MovementAnalyzer(commands)
    segments = analyzer.segment_movements(timing_params=None)
    assert len(segments) >= 1
    for seg in segments:
        assert isinstance(seg, MovementSegment)
        assert seg.start_time <= seg.end_time
        assert seg.distance >= 0
        assert seg.feedrate > 0
