"""
Part 1: Load a melody from MIDI or JSON → list of (pitch, start_sec, duration_sec).

Melodies are the target spec for the optimizer; we use a minimal representation
so the rest of the pipeline doesn't depend on full Note/velocity/etc.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import List, Union


@dataclass
class MelodyNote:
    """Single note in a target melody: MIDI pitch and timing."""
    midi_note: int
    start_sec: float
    duration_sec: float

    @property
    def end_sec(self) -> float:
        return self.start_sec + self.duration_sec


def load_melody_from_midi(path: Union[str, Path]) -> List[MelodyNote]:
    """
    Load a melody from a MIDI file.
    Returns one MelodyNote per note-on/note-off pair (chords become one note per pitch).
    """
    from midi_io import load_midi_notes

    path = Path(path)
    notes = load_midi_notes(str(path))
    out: List[MelodyNote] = []
    for n in notes:
        if n.is_chord and n.chord_notes:
            # One MelodyNote per chord tone, same start/end
            dur = n.end_time - n.start_time
            for midi in n.chord_notes:
                out.append(MelodyNote(midi_note=midi, start_sec=n.start_time, duration_sec=dur))
        else:
            out.append(MelodyNote(
                midi_note=n.midi_note,
                start_sec=n.start_time,
                duration_sec=n.end_time - n.start_time,
            ))
    out.sort(key=lambda x: (x.start_sec, x.midi_note))
    return out


def load_melody_from_json(path: Union[str, Path]) -> List[MelodyNote]:
    """
    Load a melody from JSON: list of {"midi_note": int, "start_sec": float, "duration_sec": float}.
    """
    path = Path(path)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("JSON melody must be a list of note objects")
    return [
        MelodyNote(
            midi_note=item["midi_note"],
            start_sec=float(item["start_sec"]),
            duration_sec=float(item["duration_sec"]),
        )
        for item in data
    ]


def load_melody(path: Union[str, Path]) -> List[MelodyNote]:
    """Load melody from MIDI (.mid) or JSON (.json)."""
    path = Path(path)
    if path.suffix.lower() in (".mid", ".midi"):
        return load_melody_from_midi(path)
    if path.suffix.lower() == ".json":
        return load_melody_from_json(path)
    raise ValueError(f"Unknown melody format: {path.suffix} (use .mid or .json)")
