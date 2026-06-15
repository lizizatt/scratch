"""
Part 3: Score how much a window of print "notes" resembles a target melody.

Returns a similarity in [0, 1]: pitch match + duration match per note, averaged.
"""

from typing import List

from melody_loader import MelodyNote


def _pitch_score(print_midi: int, target_midi: int, semitone_tolerance: float = 12.0) -> float:
    """1.0 if same pitch; decays with semitone distance, 0 at semitone_tolerance."""
    diff = abs(print_midi - target_midi)
    if diff >= semitone_tolerance:
        return 0.0
    return 1.0 - (diff / semitone_tolerance)


def _duration_score(print_dur: float, target_dur: float, ratio_tolerance: float = 2.0) -> float:
    """1.0 if same duration; decays when ratio print/target is far from 1."""
    if target_dur <= 0:
        return 1.0 if print_dur <= 0 else 0.0
    ratio = print_dur / target_dur
    if ratio <= 0:
        return 0.0
    # ratio 1.0 -> 1; ratio 0.5 or 2.0 -> lower
    dev = abs(ratio - 1.0)
    if dev >= ratio_tolerance - 1.0:  # e.g. ratio 2.0 -> dev 1.0 -> score 0
        return 0.0
    return 1.0 - (dev / (ratio_tolerance - 1.0))


def window_similarity(
    print_notes: List[MelodyNote],
    target_notes: List[MelodyNote],
    semitone_tolerance: float = 12.0,
    duration_ratio_tolerance: float = 2.0,
) -> float:
    """
    Compare a window of print notes to a target melody. Returns a score in [0, 1].

    Compares the first min(len(print_notes), len(target_notes)) notes element-wise.
    Per-note score = (pitch_score + duration_score) / 2; result = average over compared notes.
    If there are no notes to compare, returns 0.0.
    """
    n = min(len(print_notes), len(target_notes))
    if n == 0:
        return 0.0
    total = 0.0
    for i in range(n):
        p, t = print_notes[i], target_notes[i]
        pitch = _pitch_score(p.midi_note, t.midi_note, semitone_tolerance)
        dur = _duration_score(p.duration_sec, t.duration_sec, duration_ratio_tolerance)
        total += (pitch + dur) / 2.0
    return total / n
