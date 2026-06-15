"""Part 1: Melody loader tests."""
import sys
import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from melody_loader import MelodyNote, load_melody_from_midi, load_melody_from_json, load_melody


def test_melody_note_end_sec():
    n = MelodyNote(midi_note=60, start_sec=1.0, duration_sec=0.5)
    assert n.end_sec == 1.5


def test_load_melody_from_json(tmp_path):
    path = tmp_path / "melody.json"
    path.write_text(json.dumps([
        {"midi_note": 60, "start_sec": 0.0, "duration_sec": 0.5},
        {"midi_note": 64, "start_sec": 0.5, "duration_sec": 0.3},
    ]))
    notes = load_melody_from_json(path)
    assert len(notes) == 2
    assert notes[0].midi_note == 60 and notes[0].start_sec == 0.0 and notes[0].duration_sec == 0.5
    assert notes[1].midi_note == 64 and notes[1].start_sec == 0.5 and notes[1].duration_sec == 0.3


def test_load_melody_from_midi(tmp_path):
    from models import Note
    from midi_io import save_midi_notes

    notes = [
        Note(0.0, 0.5, 261.6, 60, 80, is_chord=False, chord_notes=()),
        Note(0.5, 1.0, 329.6, 64, 80, is_chord=False, chord_notes=()),
    ]
    mid_path = tmp_path / "melody.mid"
    save_midi_notes(notes, str(mid_path))
    loaded = load_melody_from_midi(mid_path)
    assert len(loaded) >= 2
    assert loaded[0].midi_note == 60
    assert abs(loaded[0].start_sec - 0.0) < 0.02
    assert abs(loaded[0].duration_sec - 0.5) < 0.02


def test_load_melody_dispatches(tmp_path):
    j = tmp_path / "m.json"
    j.write_text('[{"midi_note": 60, "start_sec": 0, "duration_sec": 0.2}]')
    assert len(load_melody(j)) == 1
    from models import Note
    from midi_io import save_midi_notes
    m = tmp_path / "m.mid"
    save_midi_notes([Note(0, 0.2, 440, 69, 80, is_chord=False, chord_notes=())], str(m))
    assert len(load_melody(m)) >= 1
