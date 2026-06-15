"""Tests for game.engine.sustain_tracker."""

import pytest
from game.engine.note import Note
from game.engine.scorer import Scorer
from game.engine.sustain_tracker import SustainTracker, SUSTAIN_PTS_PER_SEC, KEY_RELEASE_S


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_note(lane=0, time_s=1.0, sustain_ticks=192, sustain_end_s=2.0):
    return Note(tick=0, lane=lane, sustain_ticks=sustain_ticks, time_s=time_s,
                sustain_end_s=sustain_end_s)


def make_scorer():
    return Scorer()


def make_tracker():
    return SustainTracker()


def tick(tracker, chart_time_s, wall_time, scorer, dt_s=1/60):
    """Convenience wrapper — mirrors one game loop iteration."""
    return tracker.update(chart_time_s, wall_time, scorer, dt_s)


# ---------------------------------------------------------------------------
# start()
# ---------------------------------------------------------------------------

class TestStart:
    def test_no_sustain_for_zero_sustain_ticks(self):
        tr = make_tracker()
        note = Note(tick=0, lane=0, sustain_ticks=0, time_s=1.0)
        tr.start(note, wall_time=0.0)
        assert not tr.is_sustaining(0)

    def test_sustain_started_for_nonzero_sustain(self):
        tr = make_tracker()
        note = make_note(lane=0)
        tr.start(note, wall_time=0.0)
        assert tr.is_sustaining(0)

    def test_overwrites_existing_sustain(self):
        tr = make_tracker()
        n1 = make_note(lane=0, sustain_end_s=2.0)
        n2 = make_note(lane=0, sustain_end_s=5.0)
        tr.start(n1, wall_time=0.0)
        tr.start(n2, wall_time=0.0)
        sustains = tr.active_sustains()
        assert len(sustains) == 1
        assert sustains[0].note is n2

    def test_independent_lanes(self):
        tr = make_tracker()
        tr.start(make_note(lane=0), wall_time=0.0)
        tr.start(make_note(lane=1), wall_time=0.0)
        assert tr.is_sustaining(0)
        assert tr.is_sustaining(1)


# ---------------------------------------------------------------------------
# key_seen / key release detection
# ---------------------------------------------------------------------------

class TestKeyRelease:
    def test_sustain_continues_while_key_seen(self):
        tr = make_tracker()
        note = make_note(lane=0, time_s=0.0, sustain_end_s=10.0)
        s = make_scorer()
        tr.start(note, wall_time=0.0)

        # Advance time, keep seeing the key
        wall = 0.0
        for _ in range(5):
            wall += 1 / 60
            tr.key_seen(0, wall)
            broken, completed = tick(tr, chart_time_s=0.5, wall_time=wall, scorer=s)
            assert broken == []

    def test_sustain_breaks_when_key_not_seen(self):
        tr = make_tracker()
        note = make_note(lane=0, time_s=0.0, sustain_end_s=10.0)
        s = make_scorer()
        tr.start(note, wall_time=0.0)

        # Don't call key_seen — after KEY_RELEASE_S the sustain should break
        wall = KEY_RELEASE_S + 0.01
        broken, completed = tick(tr, chart_time_s=0.5, wall_time=wall, scorer=s)
        assert 0 in broken

    def test_broken_sustain_removed_from_active(self):
        tr = make_tracker()
        note = make_note(lane=0, time_s=0.0, sustain_end_s=10.0)
        s = make_scorer()
        tr.start(note, wall_time=0.0)
        wall = KEY_RELEASE_S + 0.01
        tick(tr, chart_time_s=0.5, wall_time=wall, scorer=s)
        assert not tr.is_sustaining(0)

    def test_release_on_one_lane_does_not_affect_other(self):
        tr = make_tracker()
        tr.start(make_note(lane=0, sustain_end_s=10.0), wall_time=0.0)
        tr.start(make_note(lane=1, sustain_end_s=10.0), wall_time=0.0)
        s = make_scorer()
        # Only keep lane 1 held
        wall = KEY_RELEASE_S + 0.01
        tr.key_seen(1, wall)
        broken, _ = tick(tr, chart_time_s=0.5, wall_time=wall, scorer=s)
        assert 0 in broken
        assert 1 not in broken
        assert tr.is_sustaining(1)


# ---------------------------------------------------------------------------
# Trickle scoring
# ---------------------------------------------------------------------------

class TestTrickleScoring:
    def test_trickle_points_awarded_while_held(self):
        tr = make_tracker()
        note = make_note(lane=0, time_s=0.0, sustain_end_s=10.0)
        s = make_scorer()
        tr.start(note, wall_time=0.0)
        dt = 1.0   # 1 second frame (exaggerated for easy math)
        tr.key_seen(0, 0.05)
        tick(tr, chart_time_s=0.5, wall_time=0.05, scorer=s, dt_s=dt)
        expected = int(SUSTAIN_PTS_PER_SEC * dt * 1)  # multiplier=1
        assert s.score == expected

    def test_no_trickle_points_when_not_held(self):
        tr = make_tracker()
        note = make_note(lane=0, time_s=0.0, sustain_end_s=10.0)
        s = make_scorer()
        tr.start(note, wall_time=0.0)
        wall = KEY_RELEASE_S + 0.01  # key released
        tick(tr, chart_time_s=0.5, wall_time=wall, scorer=s, dt_s=1.0)
        assert s.score == 0

    def test_trickle_respects_multiplier(self):
        tr = make_tracker()
        note = make_note(lane=0, time_s=0.0, sustain_end_s=10.0)
        s = make_scorer()
        s.streak = 10   # multiplier = 2
        tr.start(note, wall_time=0.0)
        tr.key_seen(0, 0.05)
        dt = 1.0
        tick(tr, chart_time_s=0.5, wall_time=0.05, scorer=s, dt_s=dt)
        expected = int(SUSTAIN_PTS_PER_SEC * dt * 2)
        assert s.score == expected

    def test_trickle_accumulates_across_frames(self):
        tr = make_tracker()
        note = make_note(lane=0, time_s=0.0, sustain_end_s=10.0)
        s = make_scorer()
        tr.start(note, wall_time=0.0)
        dt = 0.1
        for i in range(5):
            wall = (i + 1) * dt
            tr.key_seen(0, wall)
            tick(tr, chart_time_s=wall, wall_time=wall, scorer=s, dt_s=dt)
        assert s.score > 0


# ---------------------------------------------------------------------------
# Natural completion
# ---------------------------------------------------------------------------

class TestCompletion:
    def test_sustain_completes_at_end_time(self):
        tr = make_tracker()
        note = make_note(lane=0, time_s=0.0, sustain_end_s=2.0)
        s = make_scorer()
        tr.start(note, wall_time=0.0)
        tr.key_seen(0, 2.0)
        _, completed = tick(tr, chart_time_s=2.0, wall_time=2.0, scorer=s)
        assert 0 in completed

    def test_completed_sustain_removed_from_active(self):
        tr = make_tracker()
        note = make_note(lane=0, time_s=0.0, sustain_end_s=2.0)
        s = make_scorer()
        tr.start(note, wall_time=0.0)
        tr.key_seen(0, 2.0)
        tick(tr, chart_time_s=2.0, wall_time=2.0, scorer=s)
        assert not tr.is_sustaining(0)

    def test_no_trickle_after_completion(self):
        tr = make_tracker()
        note = make_note(lane=0, time_s=0.0, sustain_end_s=2.0)
        s = make_scorer()
        tr.start(note, wall_time=0.0)
        tr.key_seen(0, 2.0)
        tick(tr, chart_time_s=2.0, wall_time=2.0, scorer=s)
        score_at_completion = s.score
        tr.key_seen(0, 2.1)
        tick(tr, chart_time_s=2.1, wall_time=2.1, scorer=s)
        assert s.score == score_at_completion


# ---------------------------------------------------------------------------
# clear()
# ---------------------------------------------------------------------------

class TestClear:
    def test_clear_removes_all_sustains(self):
        tr = make_tracker()
        tr.start(make_note(lane=0), wall_time=0.0)
        tr.start(make_note(lane=1), wall_time=0.0)
        tr.clear()
        assert tr.active_sustains() == []

    def test_clear_resets_key_seen(self):
        tr = make_tracker()
        tr.start(make_note(lane=0), wall_time=0.0)
        tr.key_seen(0, 5.0)
        tr.clear()
        # After clear + start again, last_seen should be fresh
        tr.start(make_note(lane=0, sustain_end_s=10.0), wall_time=0.0)
        # Key not seen since clear — with wall_time=KEY_RELEASE_S+0.01 it should break
        s = make_scorer()
        broken, _ = tick(tr, chart_time_s=0.5,
                         wall_time=KEY_RELEASE_S + 0.01, scorer=s)
        assert 0 in broken
