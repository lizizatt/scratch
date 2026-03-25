import pytest
from game.engine.note import Note


def make_note(**kwargs):
    defaults = dict(tick=0, lane=0, sustain_ticks=0, time_s=0.0)
    defaults.update(kwargs)
    return Note(**defaults)


class TestNoteBasics:
    def test_fret_number_lanes_0_to_4(self):
        for lane in range(5):
            n = make_note(lane=lane)
            assert n.fret_number() == lane + 1

    def test_fret_number_open_is_none(self):
        n = make_note(lane=5)
        assert n.fret_number() is None

    def test_is_open_true_for_lane_5(self):
        assert make_note(lane=5).is_open is True

    def test_is_open_false_for_fret_lanes(self):
        for lane in range(5):
            assert make_note(lane=lane).is_open is False

    def test_defaults_not_hit_not_missed(self):
        n = make_note()
        assert n.hit is False
        assert n.missed is False

    def test_defaults_not_hopo_not_tap(self):
        n = make_note()
        assert n.is_hopo is False
        assert n.is_tap is False

    def test_sustain_end_defaults_to_time_s(self):
        n = make_note(time_s=1.5)
        assert n.sustain_end_s == 1.5

    def test_set_sustain_end(self):
        n = make_note(time_s=1.0)
        n.sustain_end_s = 2.5   # plain field assignment (no helper needed)
        assert n.sustain_end_s == 2.5

    def test_hit_and_missed_are_mutable(self):
        n = make_note()
        n.hit = True
        n.missed = True
        assert n.hit is True
        assert n.missed is True

    def test_equality_ignores_hit_and_missed(self):
        a = make_note(tick=100, lane=2, sustain_ticks=0, time_s=1.0)
        b = make_note(tick=100, lane=2, sustain_ticks=0, time_s=1.0)
        b.hit = True
        assert a == b
