"""Tests for game.chart_parser."""

import textwrap
import pytest
from pathlib import Path

from game.chart_parser import (
    parse_chart,
    ticks_to_seconds,
    _parse_raw_sections,
    _parse_sync_track,
    _BpmEvent,
    ChartData,
)
from game.engine.note import Note


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TRACK_DIR = Path(__file__).parent.parent / "Tracks"
# Sort so the result is deterministic regardless of filesystem ordering.
_real_charts = sorted(TRACK_DIR.glob("*/notes.chart"))
REAL_CHART = _real_charts[0] if _real_charts else None

MINIMAL_CHART = textwrap.dedent("""\
    [Song]
    {
      Resolution = 192
      Offset = 0
      MusicStream = "song.ogg"
    }
    [SyncTrack]
    {
      0 = TS 4
      0 = B 120000
    }
    [Events]
    {
    }
    [ExpertSingle]
    {
      0 = N 0 0
      0 = N 6 0
      192 = N 1 96
      384 = N 5 0
      576 = N 2 0
      576 = N 7 0
    }
""")


def write_tmp_chart(tmp_path, content=MINIMAL_CHART):
    p = tmp_path / "notes.chart"
    p.write_text(content)
    return p


# ---------------------------------------------------------------------------
# Section parser
# ---------------------------------------------------------------------------

class TestRawSectionParser:
    def test_recognises_song_section(self):
        sections = _parse_raw_sections(MINIMAL_CHART)
        assert 'Song' in sections

    def test_recognises_sync_track(self):
        sections = _parse_raw_sections(MINIMAL_CHART)
        assert 'SyncTrack' in sections

    def test_recognises_expert_single(self):
        sections = _parse_raw_sections(MINIMAL_CHART)
        assert 'ExpertSingle' in sections

    def test_song_section_contains_resolution(self):
        sections = _parse_raw_sections(MINIMAL_CHART)
        assert any('Resolution' in line for line in sections['Song'])

    def test_does_not_include_braces(self):
        sections = _parse_raw_sections(MINIMAL_CHART)
        for lines in sections.values():
            for line in lines:
                assert '{' not in line and '}' not in line


# ---------------------------------------------------------------------------
# ticks_to_seconds
# ---------------------------------------------------------------------------

class TestTicksToSeconds:
    def test_zero_tick_is_zero(self):
        bpms = [_BpmEvent(tick=0, bpm=120.0)]
        assert ticks_to_seconds(0, 192, bpms) == pytest.approx(0.0)

    def test_one_beat_at_120bpm(self):
        bpms = [_BpmEvent(tick=0, bpm=120.0)]
        # 192 ticks = 1 beat = 0.5 s at 120 bpm
        assert ticks_to_seconds(192, 192, bpms) == pytest.approx(0.5)

    def test_two_beats_at_120bpm(self):
        bpms = [_BpmEvent(tick=0, bpm=120.0)]
        assert ticks_to_seconds(384, 192, bpms) == pytest.approx(1.0)

    def test_tempo_change(self):
        # First half at 120 bpm (0.5 s per beat), second half at 60 bpm (1.0 s per beat)
        bpms = [
            _BpmEvent(tick=0, bpm=120.0),
            _BpmEvent(tick=192, bpm=60.0),
        ]
        # tick 0..191 at 120 bpm = 0.5 s, then 192 more ticks at 60 bpm = 1.0 s
        assert ticks_to_seconds(384, 192, bpms) == pytest.approx(1.5)

    def test_empty_bpm_list_returns_zero(self):
        assert ticks_to_seconds(999, 192, []) == 0.0


# ---------------------------------------------------------------------------
# parse_chart (minimal chart)
# ---------------------------------------------------------------------------

class TestParseChartMinimal:
    @pytest.fixture(autouse=True)
    def chart(self, tmp_path):
        p = write_tmp_chart(tmp_path)
        self.data = parse_chart(p)

    def test_resolution(self):
        assert self.data.resolution == 192

    def test_offset(self):
        assert self.data.offset_s == pytest.approx(0.0)

    def test_music_stream(self):
        assert self.data.music_stream == 'song.ogg'

    def test_bpm_events_present(self):
        assert len(self.data.bpm_events) >= 1
        assert self.data.bpm_events[0].bpm == pytest.approx(120.0)

    def test_note_count(self):
        # lanes 0, 1, 2 = 3 fret notes + 1 open note (lane 5 flag alone) = 4 total
        assert len(self.data.notes) == 4

    def test_lane_values(self):
        lanes = [n.lane for n in self.data.notes]
        assert sorted(lanes) == [0, 1, 2, 5]

    def test_force_hopo_applied(self):
        # lane 0 note at tick 0 has a lane-6 flag at same tick
        note_0 = next(n for n in self.data.notes if n.tick == 0 and n.lane == 0)
        assert note_0.is_hopo is True

    def test_tap_applied(self):
        # lane 2 note at tick 576 has a lane-7 flag at same tick
        note_tap = next(n for n in self.data.notes if n.tick == 576 and n.lane == 2)
        assert note_tap.is_tap is True

    def test_open_note_emitted_for_lone_lane5_flag(self):
        open_notes = [n for n in self.data.notes if n.is_open]
        assert len(open_notes) == 1
        assert open_notes[0].tick == 384

    def test_sustain_on_lane1_note(self):
        note = next(n for n in self.data.notes if n.lane == 1)
        assert note.sustain_ticks == 96
        assert note.sustain_end_s > note.time_s

    def test_notes_sorted_by_tick(self):
        ticks = [n.tick for n in self.data.notes]
        assert ticks == sorted(ticks)

    def test_time_s_positive_or_zero(self):
        for n in self.data.notes:
            assert n.time_s >= 0.0

    def test_time_increases_with_tick(self):
        # Since all notes are at different ticks and BPM is constant,
        # time_s should increase strictly with tick
        non_open = [n for n in self.data.notes if not n.is_open]
        for a, b in zip(non_open, non_open[1:]):
            if a.tick < b.tick:
                assert a.time_s < b.time_s


# ---------------------------------------------------------------------------
# parse_chart — real chart smoke test
# ---------------------------------------------------------------------------

@pytest.mark.skipif(REAL_CHART is None, reason="No tracks found")
class TestParseChartReal:
    @pytest.fixture(autouse=True)
    def chart(self):
        self.data = parse_chart(REAL_CHART)

    def test_resolution_is_192(self):
        assert self.data.resolution == 192

    def test_has_many_notes(self):
        assert len(self.data.notes) > 100

    def test_no_lane_6_or_7_notes(self):
        for n in self.data.notes:
            assert n.lane not in (6, 7), f"Modifier lane {n.lane} leaked into notes"

    def test_all_notes_have_valid_lanes(self):
        for n in self.data.notes:
            assert 0 <= n.lane <= 5

    def test_notes_sorted_and_times_non_decreasing(self):
        for a, b in zip(self.data.notes, self.data.notes[1:]):
            assert a.tick <= b.tick
            assert a.time_s <= b.time_s + 1e-9

    def test_bpm_events_match_known_count(self):
        # This specific chart has 10 BPM events (verified by parser output)
        assert len(self.data.bpm_events) == 10

    def test_first_bpm_is_182(self):
        assert self.data.bpm_events[0].bpm == pytest.approx(182.0)

    def test_star_power_phrases_present(self):
        assert len(self.data.star_power) > 0

    def test_song_length_roughly_correct(self):
        # song_length in song.ini is 234698 ms ≈ 234.7 s
        last_note_time = max(n.time_s for n in self.data.notes)
        assert 200 < last_note_time < 240, f"Last note at {last_note_time:.1f}s seems wrong"
