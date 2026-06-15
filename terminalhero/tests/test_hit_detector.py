"""Tests for game.engine.hit_detector."""

import pytest
from game.engine.note import Note
from game.engine.hit_detector import (
    HitDetector,
    PERFECT_WINDOW_S,
    GOOD_WINDOW_S,
    _quality_for_delta,
)
from game.engine.scorer import HitQuality


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_note(tick=0, lane=0, time_s=1.0, sustain_ticks=0):
    return Note(tick=tick, lane=lane, sustain_ticks=sustain_ticks, time_s=time_s)


def detector_with(*notes):
    return HitDetector(list(notes))


# ---------------------------------------------------------------------------
# _quality_for_delta
# ---------------------------------------------------------------------------

class TestQualityForDelta:
    def test_exact_hit_is_perfect(self):
        assert _quality_for_delta(0.0) == HitQuality.PERFECT

    def test_within_perfect_window(self):
        assert _quality_for_delta(PERFECT_WINDOW_S) == HitQuality.PERFECT
        assert _quality_for_delta(-PERFECT_WINDOW_S) == HitQuality.PERFECT

    def test_between_windows_is_good(self):
        mid = (PERFECT_WINDOW_S + GOOD_WINDOW_S) / 2
        assert _quality_for_delta(mid) == HitQuality.GOOD
        assert _quality_for_delta(-mid) == HitQuality.GOOD

    def test_at_good_boundary_is_good(self):
        assert _quality_for_delta(GOOD_WINDOW_S) == HitQuality.GOOD

    def test_just_outside_good_is_none(self):
        assert _quality_for_delta(GOOD_WINDOW_S + 0.001) is None
        assert _quality_for_delta(-(GOOD_WINDOW_S + 0.001)) is None


# ---------------------------------------------------------------------------
# try_hit
# ---------------------------------------------------------------------------

class TestTryHit:
    def test_hit_exact_time_returns_perfect(self):
        d = detector_with(make_note(lane=0, time_s=1.0))
        result = d.try_hit(lane=0, chart_time_s=1.0)
        assert result == HitQuality.PERFECT

    def test_hit_within_perfect_window_early(self):
        # Use a value clearly inside the window, not exactly on the float boundary
        d = detector_with(make_note(lane=0, time_s=1.0))
        result = d.try_hit(lane=0, chart_time_s=1.0 - PERFECT_WINDOW_S * 0.5)
        assert result == HitQuality.PERFECT

    def test_hit_within_perfect_window_late(self):
        # Use a value clearly inside the window, not exactly on the float boundary
        d = detector_with(make_note(lane=0, time_s=1.0))
        result = d.try_hit(lane=0, chart_time_s=1.0 + PERFECT_WINDOW_S * 0.5)
        assert result == HitQuality.PERFECT

    def test_hit_within_good_window_returns_good(self):
        d = detector_with(make_note(lane=0, time_s=1.0))
        late = 1.0 + (PERFECT_WINDOW_S + GOOD_WINDOW_S) / 2
        result = d.try_hit(lane=0, chart_time_s=late)
        assert result == HitQuality.GOOD

    def test_too_early_returns_none(self):
        d = detector_with(make_note(lane=0, time_s=1.0))
        result = d.try_hit(lane=0, chart_time_s=1.0 - GOOD_WINDOW_S - 0.1)
        assert result is None

    def test_too_late_returns_none(self):
        d = detector_with(make_note(lane=0, time_s=1.0))
        result = d.try_hit(lane=0, chart_time_s=1.0 + GOOD_WINDOW_S + 0.1)
        assert result is None

    def test_wrong_lane_returns_none(self):
        d = detector_with(make_note(lane=0, time_s=1.0))
        result = d.try_hit(lane=1, chart_time_s=1.0)
        assert result is None

    def test_note_marked_hit_after_successful_hit(self):
        note = make_note(lane=0, time_s=1.0)
        d = detector_with(note)
        d.try_hit(lane=0, chart_time_s=1.0)
        assert note.hit is True

    def test_same_note_cannot_be_hit_twice(self):
        note = make_note(lane=0, time_s=1.0)
        d = detector_with(note)
        d.try_hit(lane=0, chart_time_s=1.0)
        result = d.try_hit(lane=0, chart_time_s=1.0)
        assert result is None

    def test_second_note_in_lane_hittable_after_first(self):
        n1 = make_note(lane=0, time_s=1.0)
        n2 = make_note(lane=0, time_s=2.0)
        d = detector_with(n1, n2)
        d.try_hit(lane=0, chart_time_s=1.0)   # hit n1
        result = d.try_hit(lane=0, chart_time_s=2.0)  # hit n2
        assert result == HitQuality.PERFECT

    def test_independent_lanes(self):
        n0 = make_note(lane=0, time_s=1.0)
        n1 = make_note(lane=1, time_s=1.0)
        d = detector_with(n0, n1)
        assert d.try_hit(lane=0, chart_time_s=1.0) == HitQuality.PERFECT
        assert d.try_hit(lane=1, chart_time_s=1.0) == HitQuality.PERFECT

    def test_empty_lane_returns_none(self):
        d = HitDetector([])
        assert d.try_hit(lane=0, chart_time_s=0.0) is None


# ---------------------------------------------------------------------------
# update (miss detection)
# ---------------------------------------------------------------------------

class TestUpdate:
    def test_note_not_missed_before_window(self):
        note = make_note(lane=0, time_s=1.0)
        d = detector_with(note)
        d.update(1.0)           # exactly at note time — still hittable
        assert note.missed is False

    def test_note_missed_after_good_window(self):
        note = make_note(lane=0, time_s=1.0)
        d = detector_with(note)
        d.update(1.0 + GOOD_WINDOW_S + 0.001)
        assert note.missed is True

    def test_missed_notes_returned(self):
        note = make_note(lane=0, time_s=1.0)
        d = detector_with(note)
        missed = d.update(2.0)
        assert note in missed

    def test_already_hit_note_not_returned_as_missed(self):
        note = make_note(lane=0, time_s=1.0)
        d = detector_with(note)
        d.try_hit(lane=0, chart_time_s=1.0)
        missed = d.update(2.0)
        assert note not in missed

    def test_multiple_misses_in_one_update(self):
        n1 = make_note(lane=0, time_s=0.5)
        n2 = make_note(lane=0, time_s=0.6)
        d = detector_with(n1, n2)
        missed = d.update(5.0)
        assert len(missed) == 2

    def test_update_with_no_missed_notes_returns_empty(self):
        note = make_note(lane=0, time_s=10.0)
        d = detector_with(note)
        assert d.update(0.0) == []


# ---------------------------------------------------------------------------
# remaining_notes / is_finished
# ---------------------------------------------------------------------------

class TestRemaining:
    def test_all_notes_remain_initially(self):
        notes = [make_note(lane=0, time_s=1.0), make_note(lane=1, time_s=2.0)]
        d = HitDetector(notes)
        assert len(d.remaining_notes()) == 2

    def test_hit_note_removed_from_remaining(self):
        note = make_note(lane=0, time_s=1.0)
        d = detector_with(note)
        d.try_hit(lane=0, chart_time_s=1.0)
        assert note not in d.remaining_notes()

    def test_missed_note_removed_from_remaining(self):
        note = make_note(lane=0, time_s=1.0)
        d = detector_with(note)
        d.update(5.0)
        assert note not in d.remaining_notes()

    def test_not_finished_when_notes_remain(self):
        d = detector_with(make_note(lane=0, time_s=1.0))
        assert not d.is_finished()

    def test_finished_when_all_hit(self):
        note = make_note(lane=0, time_s=1.0)
        d = detector_with(note)
        d.try_hit(lane=0, chart_time_s=1.0)
        assert d.is_finished()

    def test_finished_when_all_missed(self):
        note = make_note(lane=0, time_s=1.0)
        d = detector_with(note)
        d.update(5.0)
        assert d.is_finished()

    def test_not_finished_with_empty_detector(self):
        # Edge case: no notes → considered finished
        d = HitDetector([])
        assert d.is_finished()
