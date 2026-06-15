"""
Single place for MIDI read/write. All note I/O goes through this module.
"""

from pathlib import Path
from typing import List

from models import Note

try:
    import mido
except ImportError:
    mido = None

TICKS_PER_SECOND = 480 * 2  # 120 BPM = 2 beats per second


def load_midi_notes(path: str) -> List[Note]:
    """
    Load a MIDI file and return a list of Note (one per note-on/note-off pair).
    Simultaneous note_ons are merged into a single Note with is_chord=True.
    """
    if mido is None:
        raise RuntimeError("mido is required for MIDI I/O. Install with: pip install mido")
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)
    mid = mido.MidiFile(str(path))
    notes: List[Note] = []
    active: dict = {}  # midi_note -> (start_time_sec, velocity)
    ticks_per_second = TICKS_PER_SECOND
    current_time = 0.0
    for track in mid.tracks:
        track_time = 0.0
        for msg in track:
            track_time += msg.time / ticks_per_second
            if msg.type == "note_on" and msg.velocity > 0:
                active[msg.note] = (track_time, msg.velocity)
            elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
                if msg.note in active:
                    start_time, velocity = active[msg.note]
                    duration = track_time - start_time
                    freq = 440.0 * (2.0 ** ((msg.note - 69) / 12.0))
                    notes.append(Note(
                        start_time=start_time,
                        end_time=start_time + duration,
                        frequency=freq,
                        midi_note=msg.note,
                        velocity=velocity,
                        confidence=0.7,
                        is_chord=False,
                        chord_notes=(),
                    ))
                    del active[msg.note]
    # Merge simultaneous notes into chords (same start_time within 1ms)
    notes.sort(key=lambda n: (n.start_time, n.midi_note))
    merged: List[Note] = []
    i = 0
    while i < len(notes):
        n = notes[i]
        chunk = [n]
        j = i + 1
        while j < len(notes) and abs(notes[j].start_time - n.start_time) < 0.001:
            chunk.append(notes[j])
            j += 1
        if len(chunk) >= 2:
            first = chunk[0]
            merged.append(Note(
                start_time=first.start_time,
                end_time=max(c.end_time for c in chunk),
                frequency=first.frequency,
                midi_note=first.midi_note,
                velocity=first.velocity,
                confidence=first.confidence,
                is_chord=True,
                chord_notes=tuple(c.midi_note for c in chunk),
            ))
        else:
            merged.append(n)
        i = j
    return merged


def save_midi_notes(notes: List[Note], path: str) -> None:
    """
    Write a list of Note to a MIDI file.
    Chord notes are emitted as simultaneous note_on/note_off.
    """
    if mido is None:
        raise RuntimeError("mido is required for MIDI I/O. Install with: pip install mido")
    mid = mido.MidiFile()
    track = mido.MidiTrack()
    mid.tracks.append(track)
    sorted_notes = sorted(notes, key=lambda n: n.start_time)
    current_time = 0
    ticks_per_second = TICKS_PER_SECOND
    for note in sorted_notes:
        start_ticks = int(note.start_time * ticks_per_second)
        end_ticks = max(start_ticks, int(note.end_time * ticks_per_second))
        delta_start = start_ticks - current_time
        if delta_start < 0:
            delta_start = 0
        if note.is_chord and note.chord_notes:
            for midi_note in note.chord_notes:
                track.append(mido.Message("note_on", channel=0, note=midi_note,
                    velocity=note.velocity, time=delta_start))
                delta_start = 0
            duration_ticks = max(0, end_ticks - start_ticks)
            for k, midi_note in enumerate(note.chord_notes):
                track.append(mido.Message("note_off", channel=0, note=midi_note, velocity=0,
                    time=duration_ticks if k == len(note.chord_notes) - 1 else 0))
        else:
            track.append(mido.Message("note_on", channel=0, note=note.midi_note,
                velocity=note.velocity, time=delta_start))
            duration_ticks = max(0, end_ticks - start_ticks)
            track.append(mido.Message("note_off", channel=0, note=note.midi_note, velocity=0, time=duration_ticks))
        current_time = end_ticks
    mid.save(path)
