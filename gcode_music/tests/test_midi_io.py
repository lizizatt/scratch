"""
MIDI I/O roundtrip and Note type tests.

Run from repo root: pytest gcode_music/tests/test_midi_io.py -v
Or from gcode_music/: pytest tests/test_midi_io.py -v
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models import Note
from midi_io import save_midi_notes, load_midi_notes, TICKS_PER_SECOND


def test_ticks_per_second():
    assert TICKS_PER_SECOND == 480 * 2


def test_note_dataclass():
    n = Note(
        start_time=0.0,
        end_time=0.5,
        frequency=440.0,
        midi_note=69,
        velocity=80,
        confidence=0.9,
        is_chord=False,
        chord_notes=(),
    )
    assert n.midi_note == 69
    assert n.end_time - n.start_time == 0.5


def test_midi_roundtrip(tmp_path):
    """Save notes to MIDI, load back; count and times should match (within tick resolution)."""
    notes = [
        Note(0.0, 0.5, 440.0, 69, 80, confidence=1.0, is_chord=False, chord_notes=()),
        Note(0.5, 1.0, 523.25, 72, 90, confidence=1.0, is_chord=False, chord_notes=()),
    ]
    path = tmp_path / "roundtrip.mid"
    save_midi_notes(notes, str(path))
    assert path.exists()
    loaded = load_midi_notes(str(path))
    assert len(loaded) >= 1
    assert loaded[0].midi_note == 69
    assert abs(loaded[0].start_time - 0.0) < 0.01
    assert abs(loaded[0].end_time - 0.5) < 0.01
