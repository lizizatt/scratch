"""Tests for game.engine.scorer."""

import pytest
from game.engine.scorer import Scorer, HitQuality, MAX_MULTIPLIER


def make_scorer() -> Scorer:
    return Scorer()


class TestMultiplier:
    def test_starts_at_1(self):
        s = make_scorer()
        assert s.multiplier == 1

    def test_still_1_at_streak_9(self):
        s = make_scorer()
        s.streak = 9
        assert s.multiplier == 1

    def test_becomes_2_at_streak_10(self):
        s = make_scorer()
        s.streak = 10
        assert s.multiplier == 2

    def test_becomes_3_at_streak_20(self):
        s = make_scorer()
        s.streak = 20
        assert s.multiplier == 3

    def test_becomes_4_at_streak_30(self):
        s = make_scorer()
        s.streak = 30
        assert s.multiplier == 4

    def test_caps_at_4_beyond_streak_40(self):
        s = make_scorer()
        s.streak = 999
        assert s.multiplier == MAX_MULTIPLIER


class TestRecordHit:
    def test_perfect_adds_100_points(self):
        s = make_scorer()
        pts = s.record_hit(HitQuality.PERFECT)
        assert pts == 100
        assert s.score == 100

    def test_good_adds_50_points(self):
        s = make_scorer()
        pts = s.record_hit(HitQuality.GOOD)
        assert pts == 50
        assert s.score == 50

    def test_miss_adds_0_points(self):
        s = make_scorer()
        pts = s.record_hit(HitQuality.MISS)
        assert pts == 0
        assert s.score == 0

    def test_perfect_increments_streak(self):
        s = make_scorer()
        s.record_hit(HitQuality.PERFECT)
        assert s.streak == 1

    def test_good_increments_streak(self):
        s = make_scorer()
        s.record_hit(HitQuality.GOOD)
        assert s.streak == 1

    def test_miss_resets_streak(self):
        s = make_scorer()
        s.streak = 15
        s.record_hit(HitQuality.MISS)
        assert s.streak == 0

    def test_multiplier_applied_to_points(self):
        s = make_scorer()
        s.streak = 10           # multiplier = 2
        pts = s.record_hit(HitQuality.PERFECT)
        assert pts == 200       # 100 * 2

    def test_multiplier_applied_after_streak_incremented(self):
        # At streak=9 multiplier=1; hitting PERFECT makes streak=10 but
        # the multiplier used is the one BEFORE incrementing (i.e. still 1).
        s = make_scorer()
        s.streak = 9
        pts = s.record_hit(HitQuality.PERFECT)
        assert pts == 100       # multiplier was 1 when we entered record_hit

    def test_perfect_increments_perfect_count(self):
        s = make_scorer()
        s.record_hit(HitQuality.PERFECT)
        assert s.perfect_count == 1
        assert s.good_count == 0
        assert s.miss_count == 0

    def test_good_increments_good_count(self):
        s = make_scorer()
        s.record_hit(HitQuality.GOOD)
        assert s.good_count == 1

    def test_miss_increments_miss_count(self):
        s = make_scorer()
        s.record_hit(HitQuality.MISS)
        assert s.miss_count == 1

    def test_max_streak_tracked(self):
        s = make_scorer()
        for _ in range(5):
            s.record_hit(HitQuality.PERFECT)
        s.record_hit(HitQuality.MISS)
        assert s.max_streak == 5

    def test_max_streak_not_decremented_by_miss(self):
        s = make_scorer()
        for _ in range(8):
            s.record_hit(HitQuality.PERFECT)
        s.record_hit(HitQuality.MISS)
        for _ in range(3):
            s.record_hit(HitQuality.PERFECT)
        assert s.max_streak == 8


class TestCounts:
    def test_total_notes_sums_all(self):
        s = make_scorer()
        s.record_hit(HitQuality.PERFECT)
        s.record_hit(HitQuality.GOOD)
        s.record_hit(HitQuality.MISS)
        assert s.total_notes == 3

    def test_hit_count_excludes_miss(self):
        s = make_scorer()
        s.record_hit(HitQuality.PERFECT)
        s.record_hit(HitQuality.MISS)
        assert s.hit_count == 1

    def test_hit_percent_all_perfect(self):
        s = make_scorer()
        for _ in range(10):
            s.record_hit(HitQuality.PERFECT)
        assert s.hit_percent == pytest.approx(100.0)

    def test_hit_percent_half_miss(self):
        s = make_scorer()
        for _ in range(5):
            s.record_hit(HitQuality.PERFECT)
        for _ in range(5):
            s.record_hit(HitQuality.MISS)
        assert s.hit_percent == pytest.approx(50.0)

    def test_hit_percent_zero_when_no_notes(self):
        s = make_scorer()
        assert s.hit_percent == pytest.approx(0.0)


class TestGrade:
    @pytest.mark.parametrize("hits,total,expected", [
        (100, 100, 'S'),   # 100%
        (95,  100, 'S'),   # 95% → S
        (94,  100, 'A'),   # 94% → A
        (80,  100, 'A'),   # 80% → A
        (79,  100, 'B'),   # 79% → B
        (65,  100, 'B'),   # 65% → B
        (64,  100, 'C'),   # 64% → C
        (50,  100, 'C'),   # 50% → C
        (49,  100, 'F'),   # 49% → F
        (0,   100, 'F'),   # 0%  → F
    ])
    def test_grade_boundaries(self, hits, total, expected):
        s = make_scorer()
        s.perfect_count = hits
        s.miss_count = total - hits
        assert s.grade == expected


class TestReset:
    def test_reset_clears_score(self):
        s = make_scorer()
        s.record_hit(HitQuality.PERFECT)
        s.reset()
        assert s.score == 0

    def test_reset_clears_streak(self):
        s = make_scorer()
        s.streak = 99
        s.reset()
        assert s.streak == 0

    def test_reset_clears_counts(self):
        s = make_scorer()
        s.record_hit(HitQuality.PERFECT)
        s.record_hit(HitQuality.MISS)
        s.reset()
        assert s.perfect_count == 0
        assert s.miss_count == 0

    def test_reset_clears_max_streak(self):
        s = make_scorer()
        s.max_streak = 50
        s.reset()
        assert s.max_streak == 0
