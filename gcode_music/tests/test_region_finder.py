"""Part 4: Region finder tests."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from melody_loader import MelodyNote
from region_finder import find_regions
from gcode_analyzer import GCodeParser, MovementAnalyzer
from models import TimingParams
from segment_notes import segments_to_notes


def test_find_regions_exact_slice():
    """Using a slice of print notes as target should find that region with score 1.0."""
    notes = [
        MelodyNote(60, 0.0, 0.5),
        MelodyNote(62, 0.5, 0.3),
        MelodyNote(64, 0.8, 0.4),
        MelodyNote(65, 1.2, 0.2),
    ]
    melody = notes[1:4]  # 3 notes
    regions = find_regions(notes, [melody], min_score=0.5, step=1)
    assert any(r[0] == 1 and r[1] == 0 and r[2] == 1.0 for r in regions)
    assert regions[0][2] == 1.0


def test_find_regions_calibration_gcode(tmp_path):
    """Integration: calibration.gcode + a short melody that matches a slice -> region above threshold."""
    gcode_path = ROOT / "data" / "ground_truth" / "calibration.gcode"
    if not gcode_path.exists():
        return
    parser = GCodeParser()
    parser.parse_file(str(gcode_path))
    analyzer = MovementAnalyzer(parser.commands)
    timing = TimingParams(default_acceleration=10000.0, time_scale=1.0)
    segments = analyzer.segment_movements(timing)
    print_notes = segments_to_notes(segments)
    if len(print_notes) < 3:
        return
    # Target = first 3 notes of the print; we should find start=0 with high score
    melody = print_notes[:3]
    regions = find_regions(print_notes, [melody], min_score=0.3, step=1)
    assert len(regions) >= 1
    assert regions[0][0] == 0 and regions[0][1] == 0
    assert regions[0][2] >= 0.3
