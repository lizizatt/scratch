"""
Tests for the pure (non-curses) logic helpers in the screen modules.
No curses window is created.
"""

import pytest
from game.screens.song_select import compute_scroll, visible_slice, _difficulty_stars, _format_duration
from game.screens.gameplay import (
    lane_col_range, note_row, SCROLL_WINDOW_S, NUM_LANES,
    FLASH_FRAMES, JUDGMENT_FRAMES,
    _HitFlash, _JudgmentDisplay,
)
from game.engine.scorer import HitQuality


# ---------------------------------------------------------------------------
# song_select helpers
# ---------------------------------------------------------------------------

class TestComputeScroll:
    def test_no_scroll_when_all_fit(self):
        assert compute_scroll(selected=0, visible_rows=10, total=5) == 0

    def test_no_scroll_at_top(self):
        assert compute_scroll(selected=0, visible_rows=5, total=20) == 0

    def test_scrolls_to_keep_selected_visible(self):
        # selected=15, visible=5 → offset centres around 15: 15-2=13
        offset = compute_scroll(selected=15, visible_rows=5, total=20)
        assert offset <= 15
        assert offset + 5 > 15

    def test_never_exceeds_max_offset(self):
        # total=20, visible=5 → max offset = 15
        offset = compute_scroll(selected=19, visible_rows=5, total=20)
        assert offset == 15

    def test_never_negative(self):
        assert compute_scroll(selected=0, visible_rows=10, total=10) >= 0


class TestVisibleSlice:
    def make_songs(self, n):
        return [f"song_{i}" for i in range(n)]

    def test_returns_all_when_fewer_than_visible(self):
        songs = self.make_songs(3)
        sliced, sel = visible_slice(songs, 0, 10)
        assert sliced == songs
        assert sel == 0

    def test_selected_index_within_slice_is_correct(self):
        songs = self.make_songs(20)
        sliced, sel_in_view = visible_slice(songs, 15, 5)
        assert sliced[sel_in_view] == songs[15]

    def test_slice_length_capped_at_visible_rows(self):
        songs = self.make_songs(100)
        sliced, _ = visible_slice(songs, 50, 10)
        assert len(sliced) == 10


class TestDifficultyStars:
    def test_zero_difficulty_is_all_empty(self):
        s = _difficulty_stars(0)
        assert '★' not in s

    def test_six_difficulty_is_all_filled(self):
        s = _difficulty_stars(6)
        assert '☆' not in s

    def test_total_length_is_5(self):
        for d in range(7):
            assert len(_difficulty_stars(d)) == 5

    def test_clamps_above_6(self):
        assert _difficulty_stars(99) == _difficulty_stars(6)

    def test_clamps_below_0(self):
        assert _difficulty_stars(-1) == _difficulty_stars(0)


class TestFormatDuration:
    def test_zero(self):
        assert _format_duration(0) == "0:00"

    def test_90_seconds(self):
        assert _format_duration(90_000) == "1:30"

    def test_3_minutes_45_seconds(self):
        assert _format_duration(225_000) == "3:45"

    def test_pads_seconds(self):
        assert _format_duration(61_000) == "1:01"


# ---------------------------------------------------------------------------
# gameplay layout helpers
# ---------------------------------------------------------------------------

class TestLaneColRange:
    def test_lane_0_starts_at_0(self):
        start, end = lane_col_range(0, width=100)
        assert start == 0

    def test_lanes_cover_full_width(self):
        width = 100
        _, last_end = lane_col_range(NUM_LANES - 1, width)
        assert last_end == width

    def test_lanes_are_contiguous(self):
        width = 100
        prev_end = 0
        for lane in range(NUM_LANES):
            start, end = lane_col_range(lane, width)
            assert start == prev_end
            prev_end = end

    def test_lane_width_roughly_equal(self):
        width = 100
        widths = [lane_col_range(l, width)[1] - lane_col_range(l, width)[0]
                  for l in range(NUM_LANES)]
        assert max(widths) - min(widths) <= 1   # may differ by 1 due to integer division

    def test_single_pixel_width(self):
        start, end = lane_col_range(0, width=5)
        assert end > start


class TestNoteRow:
    def test_note_at_chart_time_is_at_strike_row(self):
        row = note_row(note_time_s=1.0, chart_time_s=1.0, strike_row=20)
        assert row == 20

    def test_note_in_future_is_above_strike(self):
        row = note_row(note_time_s=2.0, chart_time_s=1.0, strike_row=20)
        assert row < 20

    def test_note_at_top_of_window(self):
        row = note_row(note_time_s=1.0 + SCROLL_WINDOW_S, chart_time_s=1.0, strike_row=20)
        assert row == 0

    def test_note_past_strikezone_is_below(self):
        row = note_row(note_time_s=0.5, chart_time_s=1.0, strike_row=20)
        assert row > 20

    def test_note_halfway_is_halfway(self):
        row = note_row(note_time_s=1.0 + SCROLL_WINDOW_S / 2, chart_time_s=1.0, strike_row=20)
        assert row == pytest.approx(10, abs=1)


# ---------------------------------------------------------------------------
# _HitFlash
# ---------------------------------------------------------------------------

class TestHitFlash:
    def test_inactive_by_default(self):
        f = _HitFlash()
        for lane in range(NUM_LANES):
            q, frames = f.active(lane)
            assert frames == 0

    def test_trigger_sets_frames(self):
        f = _HitFlash()
        f.trigger(lane=0, quality=HitQuality.PERFECT)
        _, frames = f.active(0)
        assert frames == FLASH_FRAMES

    def test_trigger_sets_quality(self):
        f = _HitFlash()
        f.trigger(lane=2, quality=HitQuality.GOOD)
        q, _ = f.active(2)
        assert q == HitQuality.GOOD

    def test_trigger_miss_sets_none_quality(self):
        f = _HitFlash()
        f.trigger_miss(lane=1)
        q, frames = f.active(1)
        assert q is None
        assert frames == FLASH_FRAMES

    def test_tick_decrements_frames(self):
        f = _HitFlash()
        f.trigger(lane=0, quality=HitQuality.PERFECT)
        f.tick()
        _, frames = f.active(0)
        assert frames == FLASH_FRAMES - 1

    def test_frames_reach_zero_after_enough_ticks(self):
        f = _HitFlash()
        f.trigger(lane=0, quality=HitQuality.PERFECT)
        for _ in range(FLASH_FRAMES):
            f.tick()
        _, frames = f.active(0)
        assert frames == 0

    def test_independent_lanes(self):
        f = _HitFlash()
        f.trigger(lane=0, quality=HitQuality.PERFECT)
        _, frames_1 = f.active(1)
        assert frames_1 == 0


# ---------------------------------------------------------------------------
# _JudgmentDisplay
# ---------------------------------------------------------------------------

class TestJudgmentDisplay:
    def test_inactive_by_default(self):
        j = _JudgmentDisplay()
        # frames = 0; render should be a no-op (no exception)
        assert j._frames == 0

    def test_trigger_perfect_sets_frames(self):
        j = _JudgmentDisplay()
        j.trigger(HitQuality.PERFECT)
        assert j._frames == JUDGMENT_FRAMES

    def test_trigger_miss_sets_none_quality(self):
        j = _JudgmentDisplay()
        j.trigger(None)
        assert j._quality is None
        assert j._frames == JUDGMENT_FRAMES

    def test_tick_decrements(self):
        j = _JudgmentDisplay()
        j.trigger(HitQuality.GOOD)
        j.tick()
        assert j._frames == JUDGMENT_FRAMES - 1

    def test_expires_after_judgment_frames_ticks(self):
        j = _JudgmentDisplay()
        j.trigger(HitQuality.PERFECT)
        for _ in range(JUDGMENT_FRAMES):
            j.tick()
        assert j._frames == 0

    def test_newer_trigger_overwrites_older(self):
        j = _JudgmentDisplay()
        j.trigger(HitQuality.PERFECT)
        for _ in range(5):
            j.tick()
        j.trigger(HitQuality.GOOD)
        assert j._quality == HitQuality.GOOD
        assert j._frames == JUDGMENT_FRAMES

    def test_judgment_lasts_longer_than_flash(self):
        assert JUDGMENT_FRAMES > FLASH_FRAMES
