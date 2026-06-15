"""Part 3: Window similarity tests."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from melody_loader import MelodyNote
from window_similarity import window_similarity


def test_identical_sequences_score_one():
    notes = [
        MelodyNote(60, 0.0, 0.5),
        MelodyNote(64, 0.5, 0.3),
    ]
    assert window_similarity(notes, notes) == 1.0


def test_wrong_pitch_lower_score():
    print_notes = [MelodyNote(60, 0.0, 0.5), MelodyNote(64, 0.5, 0.3)]
    target = [MelodyNote(60, 0.0, 0.5), MelodyNote(64, 0.5, 0.3)]
    assert window_similarity(print_notes, target) == 1.0
    target_wrong = [MelodyNote(60, 0.0, 0.5), MelodyNote(72, 0.5, 0.3)]  # different second pitch
    score = window_similarity(print_notes, target_wrong)
    assert score < 1.0
    assert score >= 0.0


def test_wrong_duration_lower_score():
    print_notes = [MelodyNote(60, 0.0, 0.5), MelodyNote(64, 0.5, 0.3)]
    target = [MelodyNote(60, 0.0, 0.5), MelodyNote(64, 0.5, 0.3)]
    assert window_similarity(print_notes, target) == 1.0
    target_long = [MelodyNote(60, 0.0, 0.5), MelodyNote(64, 0.5, 1.0)]  # second note 1.0s vs 0.3s
    score = window_similarity(print_notes, target_long)
    assert score < 1.0
    assert score >= 0.0


def test_empty_window_zero():
    assert window_similarity([], [MelodyNote(60, 0.0, 0.5)]) == 0.0
    assert window_similarity([MelodyNote(60, 0.0, 0.5)], []) == 0.0
    assert window_similarity([], []) == 0.0


def test_length_mismatch_compares_prefix():
    short = [MelodyNote(60, 0.0, 0.5)]
    long_target = [MelodyNote(60, 0.0, 0.5), MelodyNote(64, 0.5, 0.3)]
    assert window_similarity(short, long_target) == 1.0  # first note identical
    short_wrong = [MelodyNote(72, 0.0, 0.5)]
    assert window_similarity(short_wrong, long_target) < 1.0
