"""
Part 4: Sliding window over print timeline; for each window compute similarity
to each melody; return best-matching regions (start segment index, melody id, score).
"""

from typing import List, Tuple

from melody_loader import MelodyNote
from window_similarity import window_similarity


def find_regions(
    print_notes: List[MelodyNote],
    melodies: List[List[MelodyNote]],
    min_score: float = 0.5,
    step: int = 1,
) -> List[Tuple[int, int, float]]:
    """
    Slide a window over print_notes and compare to each melody.

    Args:
        print_notes: Notes from the print (one per segment).
        melodies: List of target melodies; each melody is a list of MelodyNote.
        min_score: Only return regions with similarity >= this (0..1).
        step: Slide window by this many segments (1 = every position).

    Returns:
        List of (start_segment_index, melody_id, score), sorted by score descending.
    """
    results: List[Tuple[int, int, float]] = []
    for melody_id, melody in enumerate(melodies):
        n = len(melody)
        if n == 0:
            continue
        for start in range(0, len(print_notes) - n + 1, step):
            window = print_notes[start : start + n]
            score = window_similarity(window, melody)
            if score >= min_score:
                results.append((start, melody_id, score))
    results.sort(key=lambda x: -x[2])  # descending by score
    return results
