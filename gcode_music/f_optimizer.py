"""
Part 5: F-only optimizer for one region.

Input: list of segments in one region, target melody notes.
Output: new F per segment to match target pitches (and optionally durations).
Constraints: F in [F_min, F_max].
"""

from typing import List, Optional

from melody_loader import MelodyNote


def optimize_region_feedrates(
    segments: List,
    target_notes: List[MelodyNote],
    freq_analyzer: Optional[object] = None,
    f_min: float = 100.0,
    f_max: float = 10000.0,
) -> List[float]:
    """
    Compute new feedrates for each segment to match target melody pitches.

    One segment -> one target note (by index). If target_notes is shorter,
    remaining segments keep their original F. If segments is shorter, only
    that many F values are returned.

    Returns:
        List of new feedrate values (one per segment), clamped to [f_min, f_max].
    """
    if freq_analyzer is None:
        from gcode_analyzer import FrequencyAnalyzer
        freq_analyzer = FrequencyAnalyzer()

    result: List[float] = []
    for i, seg in enumerate(segments):
        if i >= len(target_notes):
            result.append(seg.feedrate)
            continue
        target_midi = target_notes[i].midi_note
        target_freq = freq_analyzer.midi_to_frequency(target_midi)
        f_new = freq_analyzer.frequency_to_feedrate(target_freq)
        f_new = max(f_min, min(f_max, f_new))
        result.append(f_new)
    return result
