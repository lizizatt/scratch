"""Part 6: GCODE writer tests."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from gcode_analyzer import GCodeParser, MovementAnalyzer
from gcode_writer import write_gcode
from models import TimingParams


def _get_commands_and_segments(gcode_path):
    parser = GCodeParser()
    parser.parse_file(str(gcode_path))
    analyzer = MovementAnalyzer(parser.commands)
    timing = TimingParams(default_acceleration=10000.0, time_scale=1.0)
    segments = analyzer.segment_movements(timing)
    return parser.commands, segments


def test_roundtrip_one_f_changed(tmp_path):
    """Parse GCODE, change one segment's F, write, parse again; only that F changed."""
    gcode_path = ROOT / "data" / "ground_truth" / "calibration.gcode"
    if not gcode_path.exists():
        gcode_path = ROOT / "data" / "Bench.gcode"
    if not gcode_path.exists():
        return
    commands, segments = _get_commands_and_segments(gcode_path)
    if len(segments) < 2:
        return
    original_feedrates = [s.feedrate for s in segments]
    new_f = 999.0
    segment_index_to_new_f = {1: new_f}
    out_path = tmp_path / "out.gcode"
    write_gcode(commands, segments, segment_index_to_new_f, str(out_path))
    cmd2, seg2 = _get_commands_and_segments(out_path)
    for i, seg in enumerate(seg2):
        if i == 1:
            assert abs(seg.feedrate - new_f) < 0.01
        else:
            assert abs(seg.feedrate - original_feedrates[i]) < 0.01


def test_replace_f_in_line():
    """Helper replaces or adds F in a line."""
    from gcode_writer import _replace_f_in_line
    assert "F300.00" in _replace_f_in_line("G1 X50 Y50 Z10 F300", 300)
    assert "F999.00" in _replace_f_in_line("G1 X50 Y50 Z10 F300", 999)
    assert "F100.00" in _replace_f_in_line("G1 X50 Y50 Z10", 100)
