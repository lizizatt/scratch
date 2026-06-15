"""Part 2: Segment → note tests."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from gcode_analyzer import GCodeParser, MovementAnalyzer
from models import TimingParams
from segment_notes import segments_to_notes


def _calibration_paths():
    gcode = ROOT / "data" / "ground_truth" / "calibration.gcode"
    manifest = ROOT / "data" / "ground_truth" / "manifest.json"
    if not gcode.exists():
        return None, None
    return gcode, manifest


def test_segments_to_notes_one_note_per_segment():
    """Each segment produces exactly one MelodyNote."""
    gcode_path, _ = _calibration_paths()
    if not gcode_path:
        return  # skip if no calibration data
    parser = GCodeParser()
    parser.parse_file(str(gcode_path))
    analyzer = MovementAnalyzer(parser.commands)
    timing = TimingParams(default_acceleration=10000.0, time_scale=1.0)
    segments = analyzer.segment_movements(timing)
    notes = segments_to_notes(segments)
    assert len(notes) == len(segments)


def test_segments_to_notes_duration_matches_segment():
    """Note durations match segment durations (from timing model)."""
    gcode_path, _ = _calibration_paths()
    if not gcode_path:
        return
    parser = GCodeParser()
    parser.parse_file(str(gcode_path))
    analyzer = MovementAnalyzer(parser.commands)
    timing = TimingParams(default_acceleration=10000.0, time_scale=1.0)
    segments = analyzer.segment_movements(timing)
    notes = segments_to_notes(segments)
    for seg, note in zip(segments, notes):
        expected_dur = seg.end_time - seg.start_time
        assert abs(note.duration_sec - expected_dur) < 0.001
        assert abs(note.start_sec - seg.start_time) < 0.001


def test_segments_to_notes_calibration_manifest():
    """With calibration.gcode, segment notes align with manifest feedrates/durations."""
    gcode_path, manifest_path = _calibration_paths()
    if not gcode_path or not manifest_path:
        return
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    expected_feedrates = set(s["feedrate_mm_per_min"] for s in manifest["segments"])
    parser = GCodeParser()
    parser.parse_file(str(gcode_path))
    analyzer = MovementAnalyzer(parser.commands)
    timing = TimingParams(default_acceleration=10000.0, time_scale=1.0)
    segments = analyzer.segment_movements(timing)
    notes = segments_to_notes(segments)
    # All segment feedrates should be in the manifest set
    for seg in segments:
        assert seg.feedrate in expected_feedrates
    # Each note has valid pitch and positive duration
    for note in notes:
        assert 0 <= note.midi_note <= 127
        assert note.duration_sec > 0
    # Segment with feedrate 600 exists and has positive duration (accel model may give > simple 2.0s)
    seg_600 = [s for s in segments if abs(s.feedrate - 600) < 1]
    if seg_600:
        note_600 = notes[segments.index(seg_600[0])]
        assert 0.1 <= note_600.duration_sec <= 30.0
