"""Part 5: F-only optimizer tests."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from melody_loader import MelodyNote
from gcode_analyzer import MovementSegment, FrequencyAnalyzer
from f_optimizer import optimize_region_feedrates


def _make_segment(feedrate: float, distance: float = 20.0):
    return MovementSegment(
        start_time=0.0,
        end_time=distance / (feedrate / 60.0) if feedrate else 1.0,
        distance=distance,
        feedrate=feedrate,
        direction=(1.0, 0.0, 0.0),
        commands=[],
    )


def test_one_segment_one_note_closed_form():
    """Trivial region: one segment, one target note -> F such that feedrate_to_frequency(F) ≈ target freq."""
    freq = FrequencyAnalyzer()
    seg = _make_segment(1000.0)
    target = MelodyNote(midi_note=69, start_sec=0.0, duration_sec=0.5)  # A4 = 440 Hz
    new_f = optimize_region_feedrates([seg], [target], freq_analyzer=freq)
    assert len(new_f) == 1
    got_freq = freq.feedrate_to_frequency(new_f[0])
    assert abs(got_freq - 440.0) < 1.0  # 440 Hz for MIDI 69


def test_three_segments_three_notes():
    """Multiple segments: each F matches target pitch."""
    freq = FrequencyAnalyzer()
    segments = [_make_segment(500.0), _make_segment(1500.0), _make_segment(3000.0)]
    targets = [
        MelodyNote(60, 0.0, 0.5),
        MelodyNote(64, 0.5, 0.3),
        MelodyNote(69, 0.8, 0.4),
    ]
    new_f = optimize_region_feedrates(segments, targets, freq_analyzer=freq)
    assert len(new_f) == 3
    for i, (f, t) in enumerate(zip(new_f, targets)):
        expect_freq = freq.midi_to_frequency(t.midi_note)
        assert abs(freq.feedrate_to_frequency(f) - expect_freq) < 1.0


def test_clamp_to_f_min_f_max():
    """F is clamped to [f_min, f_max]."""
    freq = FrequencyAnalyzer()
    seg = _make_segment(1000.0)
    target_low = MelodyNote(0, 0.0, 0.5)   # very low -> would give low F
    target_high = MelodyNote(127, 0.0, 0.5) # very high -> would give high F
    new_f_low = optimize_region_feedrates([seg], [target_low], freq_analyzer=freq, f_min=200.0, f_max=5000.0)
    new_f_high = optimize_region_feedrates([seg], [target_high], freq_analyzer=freq, f_min=200.0, f_max=5000.0)
    assert new_f_low[0] >= 200.0 and new_f_low[0] <= 5000.0
    assert new_f_high[0] >= 200.0 and new_f_high[0] <= 5000.0
