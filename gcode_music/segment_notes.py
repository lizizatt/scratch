"""
Part 2: From GCODE segments (with timing), produce a sequence of (pitch, duration)
as MelodyNote so we can compare print "notes" to target melodies.

Uses feedrate→frequency→MIDI from gcode_analyzer.
"""

from typing import List, Optional

from melody_loader import MelodyNote


def segments_to_notes(
    segments: List,
    freq_analyzer: Optional[object] = None,
) -> List[MelodyNote]:
    """
    Map each movement segment to one MelodyNote: pitch from feedrate, timing from segment.

    Args:
        segments: List of MovementSegment (start_time, end_time, feedrate, ...).
        freq_analyzer: Optional FrequencyAnalyzer for feedrate→frequency→MIDI.
                      If None, uses default FrequencyAnalyzer().

    Returns:
        One MelodyNote per segment: midi_note, start_sec, duration_sec.
    """
    if freq_analyzer is None:
        from gcode_analyzer import FrequencyAnalyzer
        freq_analyzer = FrequencyAnalyzer()

    notes: List[MelodyNote] = []
    for seg in segments:
        freq = freq_analyzer.feedrate_to_frequency(seg.feedrate)
        midi = freq_analyzer.frequency_to_midi(freq)
        start = seg.start_time
        duration = seg.end_time - seg.start_time
        notes.append(MelodyNote(midi_note=midi, start_sec=start, duration_sec=duration))
    return notes
