"""Tests for game.song_loader."""

import pytest
from pathlib import Path

from game.song_loader import (
    load_songs,
    _build_song_info,
    _discover_audio,
    _detect_difficulties,
    SongInfo,
)

TRACK_DIR = Path(__file__).parent.parent / "Tracks"


# ---------------------------------------------------------------------------
# Fixtures — synthetic track folders
# ---------------------------------------------------------------------------

def make_track(
    tmp_path,
    name="Test Song",
    has_chart=True,
    has_ini=True,
    audio_ext='.opus',
    ini_content=None,
    chart_sections=('ExpertSingle',),
):
    folder = tmp_path / name
    folder.mkdir()

    if has_chart:
        sections_text = "\n".join(
            f"[{s}]\n{{\n  0 = N 0 0\n}}" for s in chart_sections
        )
        (folder / 'notes.chart').write_text(
            f"[Song]\n{{\n  Resolution = 192\n  Offset = 0\n}}\n"
            f"[SyncTrack]\n{{\n  0 = B 120000\n}}\n"
            + sections_text
        )

    if has_ini:
        content = ini_content or (
            "[song]\n"
            "name = Test Song\n"
            "artist = Test Artist\n"
            "album = Test Album\n"
            "genre = Rock\n"
            "year = 2024\n"
            "charter = SomeCharter\n"
            "song_length = 180000\n"
            "diff_guitar = 3\n"
            "loading_phrase = Hello world\n"
        )
        (folder / 'song.ini').write_text(content)

    if audio_ext:
        (folder / f'song{audio_ext}').write_bytes(b'dummy')

    return folder


# ---------------------------------------------------------------------------
# _discover_audio
# ---------------------------------------------------------------------------

class TestDiscoverAudio:
    def test_finds_opus(self, tmp_path):
        folder = tmp_path / "s"
        folder.mkdir()
        (folder / "song.opus").write_bytes(b'x')
        result = _discover_audio(folder)
        assert result is not None
        assert result.suffix == '.opus'

    def test_finds_ogg_when_no_opus(self, tmp_path):
        folder = tmp_path / "s"
        folder.mkdir()
        (folder / "song.ogg").write_bytes(b'x')
        assert _discover_audio(folder).suffix == '.ogg'

    def test_opus_preferred_over_ogg(self, tmp_path):
        folder = tmp_path / "s"
        folder.mkdir()
        (folder / "song.ogg").write_bytes(b'x')
        (folder / "song.opus").write_bytes(b'x')
        assert _discover_audio(folder).suffix == '.opus'

    def test_returns_none_when_empty(self, tmp_path):
        folder = tmp_path / "s"
        folder.mkdir()
        assert _discover_audio(folder) is None


# ---------------------------------------------------------------------------
# _detect_difficulties
# ---------------------------------------------------------------------------

class TestDetectDifficulties:
    def test_detects_expert(self, tmp_path):
        folder = make_track(tmp_path, chart_sections=('ExpertSingle',))
        diffs = _detect_difficulties(folder / 'notes.chart')
        assert 'ExpertSingle' in diffs

    def test_detects_multiple(self, tmp_path):
        folder = make_track(tmp_path, chart_sections=('ExpertSingle', 'HardSingle'))
        diffs = _detect_difficulties(folder / 'notes.chart')
        assert 'ExpertSingle' in diffs
        assert 'HardSingle' in diffs

    def test_missing_chart_returns_empty(self, tmp_path):
        assert _detect_difficulties(tmp_path / 'nonexistent.chart') == []


# ---------------------------------------------------------------------------
# _build_song_info
# ---------------------------------------------------------------------------

class TestBuildSongInfo:
    def test_returns_none_without_chart(self, tmp_path):
        folder = make_track(tmp_path, has_chart=False)
        assert _build_song_info(folder) is None

    def test_returns_song_info_with_chart(self, tmp_path):
        folder = make_track(tmp_path)
        info = _build_song_info(folder)
        assert isinstance(info, SongInfo)

    def test_reads_title_from_ini(self, tmp_path):
        folder = make_track(tmp_path)
        info = _build_song_info(folder)
        assert info.title == "Test Song"

    def test_reads_artist_from_ini(self, tmp_path):
        folder = make_track(tmp_path)
        info = _build_song_info(folder)
        assert info.artist == "Test Artist"

    def test_reads_difficulty(self, tmp_path):
        folder = make_track(tmp_path)
        info = _build_song_info(folder)
        assert info.difficulty == 3

    def test_reads_song_length_ms(self, tmp_path):
        folder = make_track(tmp_path)
        info = _build_song_info(folder)
        assert info.song_length_ms == 180000

    def test_audio_file_populated(self, tmp_path):
        folder = make_track(tmp_path)
        info = _build_song_info(folder)
        assert info.audio_file is not None
        assert info.audio_file.exists()

    def test_audio_file_none_when_absent(self, tmp_path):
        folder = make_track(tmp_path, audio_ext=None)
        info = _build_song_info(folder)
        assert info.audio_file is None

    def test_display_name(self, tmp_path):
        folder = make_track(tmp_path)
        info = _build_song_info(folder)
        assert info.display_name == "Test Artist – Test Song"

    def test_fallback_title_is_folder_name(self, tmp_path):
        folder = make_track(tmp_path, has_ini=False, name="My Track Folder")
        info = _build_song_info(folder)
        assert info.title == "My Track Folder"

    def test_available_difficulties_populated(self, tmp_path):
        folder = make_track(tmp_path, chart_sections=('ExpertSingle', 'HardSingle'))
        info = _build_song_info(folder)
        assert 'ExpertSingle' in info.available_difficulties

    def test_chart_path_property(self, tmp_path):
        folder = make_track(tmp_path)
        info = _build_song_info(folder)
        assert info.chart_path == folder / 'notes.chart'


# ---------------------------------------------------------------------------
# load_songs
# ---------------------------------------------------------------------------

class TestLoadSongs:
    def test_empty_dir_returns_empty(self, tmp_path):
        assert load_songs(tmp_path) == []

    def test_missing_dir_returns_empty(self, tmp_path):
        assert load_songs(tmp_path / "nonexistent") == []

    def test_skips_folder_without_chart(self, tmp_path):
        make_track(tmp_path, name="NoChart", has_chart=False)
        assert load_songs(tmp_path) == []

    def test_returns_one_song(self, tmp_path):
        make_track(tmp_path, name="Song A")
        songs = load_songs(tmp_path)
        assert len(songs) == 1

    def test_returns_multiple_songs(self, tmp_path):
        make_track(tmp_path, name="Song A")
        make_track(tmp_path, name="Song B")
        songs = load_songs(tmp_path)
        assert len(songs) == 2

    def test_sorted_by_artist_then_title(self, tmp_path):
        make_track(tmp_path, name="Z Song", ini_content=(
            "[song]\nname = Z Song\nartist = Beta Artist\nsong_length = 0\ndiff_guitar = 0\n"
        ))
        make_track(tmp_path, name="A Song", ini_content=(
            "[song]\nname = A Song\nartist = Alpha Artist\nsong_length = 0\ndiff_guitar = 0\n"
        ))
        songs = load_songs(tmp_path)
        assert songs[0].artist == "Alpha Artist"
        assert songs[1].artist == "Beta Artist"

    def test_all_items_are_song_info(self, tmp_path):
        make_track(tmp_path, name="Song X")
        songs = load_songs(tmp_path)
        assert all(isinstance(s, SongInfo) for s in songs)


# ---------------------------------------------------------------------------
# Real tracks smoke test
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not TRACK_DIR.is_dir(), reason="No Tracks directory found")
class TestRealTracks:
    def test_loads_at_least_one_song(self):
        songs = load_songs(TRACK_DIR)
        assert len(songs) >= 1

    def test_first_song_has_title(self):
        songs = load_songs(TRACK_DIR)
        assert songs[0].title

    def test_first_song_has_artist(self):
        songs = load_songs(TRACK_DIR)
        assert songs[0].artist

    def test_first_song_has_audio_file(self):
        songs = load_songs(TRACK_DIR)
        info = songs[0]
        assert info.audio_file is not None, "Expected an audio file; found none"
        assert info.audio_file.exists()

    def test_first_song_has_expert_difficulty(self):
        songs = load_songs(TRACK_DIR)
        assert 'ExpertSingle' in songs[0].available_difficulties

    def test_real_song_title(self):
        songs = load_songs(TRACK_DIR)
        assert "Innocence" in songs[0].title

    def test_real_song_artist(self):
        songs = load_songs(TRACK_DIR)
        assert "Husky" in songs[0].artist
