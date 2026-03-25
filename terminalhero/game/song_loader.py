"""
Scan the Tracks/ directory for valid song folders and return song metadata.

A valid song folder contains at minimum:
  - notes.chart
  - song.ini   (for display metadata)

Audio file is discovered by scanning for .opus / .ogg / .mp3 in order.

Archives (.zip, .tar.gz) found in the Tracks/ directory are automatically
extracted if they contain a single top-level folder with valid track data
(i.e. notes.chart present). The archive is removed after a successful
extraction. If the destination folder already exists extraction is skipped.
"""

from __future__ import annotations

import configparser
import logging
import tarfile
import zipfile
from dataclasses import dataclass
from pathlib import Path

from game.chart_parser import DIFFICULTY_SECTIONS

logger = logging.getLogger(__name__)

AUDIO_EXTENSIONS = ('.opus', '.ogg', '.mp3', '.wav')


# ---------------------------------------------------------------------------
# Archive extraction helpers
# ---------------------------------------------------------------------------

def _zip_top_level_dir(zf: zipfile.ZipFile) -> str | None:
    """
    Return the single top-level directory name found in *zf*, or None if the
    archive has zero or more than one top-level entry.
    """
    tops: set[str] = set()
    for name in zf.namelist():
        top = name.split('/')[0]
        if top:
            tops.add(top)
    return tops.pop() if len(tops) == 1 else None


def _tar_top_level_dir(tf: tarfile.TarFile) -> str | None:
    """
    Return the single top-level directory name found in *tf*, or None if the
    archive has zero or more than one top-level entry.
    """
    tops: set[str] = set()
    for member in tf.getmembers():
        top = member.name.split('/')[0]
        if top:
            tops.add(top)
    return tops.pop() if len(tops) == 1 else None


def _try_extract_archive(archive_path: Path, tracks_dir: Path) -> bool:
    """
    Attempt to extract *archive_path* into *tracks_dir*.

    Rules:
    - The archive must contain exactly one top-level directory.
    - That directory must contain a ``notes.chart`` file (valid track data).
    - If the destination folder already exists in *tracks_dir*, skip extraction
      to avoid clobbering an existing track.
    - On success the archive file is deleted.

    Returns True if extraction succeeded, False otherwise.
    """
    name_lower = archive_path.name.lower()
    try:
        if name_lower.endswith('.zip'):
            with zipfile.ZipFile(archive_path, 'r') as zf:
                top = _zip_top_level_dir(zf)
                if top is None:
                    logger.warning("Archive %s has multiple top-level entries — skipping", archive_path.name)
                    return False
                # Validate: notes.chart must exist inside the top-level folder
                chart_entry = f"{top}/notes.chart"
                if chart_entry not in zf.namelist():
                    logger.warning("Archive %s/%s has no notes.chart — skipping", archive_path.name, top)
                    return False
                dest = tracks_dir / top
                if dest.exists():
                    logger.info("Archive %s: destination %s already exists — skipping", archive_path.name, top)
                    return False
                zf.extractall(tracks_dir)

        elif name_lower.endswith('.tar.gz') or name_lower.endswith('.tgz'):
            with tarfile.open(archive_path, 'r:gz') as tf:
                top = _tar_top_level_dir(tf)
                if top is None:
                    logger.warning("Archive %s has multiple top-level entries — skipping", archive_path.name)
                    return False
                chart_entry = f"{top}/notes.chart"
                member_names = [m.name for m in tf.getmembers()]
                if chart_entry not in member_names:
                    logger.warning("Archive %s/%s has no notes.chart — skipping", archive_path.name, top)
                    return False
                dest = tracks_dir / top
                if dest.exists():
                    logger.info("Archive %s: destination %s already exists — skipping", archive_path.name, top)
                    return False
                tf.extractall(tracks_dir)

        else:
            return False

    except (zipfile.BadZipFile, tarfile.TarError, OSError) as exc:
        logger.warning("Failed to read archive %s: %s", archive_path.name, exc)
        return False

    logger.info("Extracted archive %s → %s/%s", archive_path.name, tracks_dir, top)
    try:
        archive_path.unlink()
    except OSError as exc:
        logger.warning("Could not remove archive %s after extraction: %s", archive_path.name, exc)
    return True


def _expand_archives(tracks_dir: Path) -> None:
    """
    Scan *tracks_dir* for .zip / .tar.gz archives and extract any that contain
    a single top-level folder with valid track data.
    """
    for entry in list(tracks_dir.iterdir()):
        if entry.is_file():
            name_lower = entry.name.lower()
            if name_lower.endswith('.zip') or name_lower.endswith('.tar.gz') or name_lower.endswith('.tgz'):
                _try_extract_archive(entry, tracks_dir)


@dataclass
class SongInfo:
    """Metadata for one song, ready for display in the song select screen."""
    folder: Path
    title: str
    artist: str
    album: str
    genre: str
    year: str
    charter: str
    difficulty: int         # 0-6, from diff_guitar (or diff_band fallback)
    song_length_ms: int
    loading_phrase: str
    audio_file: Path | None
    available_difficulties: list[str]   # e.g. ['ExpertSingle', 'HardSingle']

    @property
    def display_name(self) -> str:
        return f"{self.artist} – {self.title}"

    @property
    def chart_path(self) -> Path:
        return self.folder / 'notes.chart'


def _discover_audio(folder: Path) -> Path | None:
    """Return the first audio file found in the folder, preferring .opus."""
    for ext in AUDIO_EXTENSIONS:
        matches = list(folder.glob(f'*{ext}'))
        if matches:
            return matches[0]
    return None


def _parse_song_ini(folder: Path) -> dict[str, str]:
    """
    Parse song.ini, returning a flat dict of lowercase key→value strings.
    Handles missing file gracefully.
    """
    ini_path = folder / 'song.ini'
    if not ini_path.exists():
        return {}

    cp = configparser.ConfigParser(strict=False)
    cp.read(ini_path, encoding='utf-8')

    # Song.ini uses [song] (lowercase)
    section = None
    for candidate in ('song', 'Song', 'SONG'):
        if cp.has_section(candidate):
            section = candidate
            break

    if section is None:
        return {}

    return dict(cp[section])


def _detect_difficulties(chart_path: Path) -> list[str]:
    """
    Quick scan of notes.chart for which difficulty sections exist.
    Avoids a full parse; just looks for section header lines.
    """
    if not chart_path.exists():
        return []
    text = chart_path.read_text(encoding='utf-8', errors='replace')
    found = []
    for diff in DIFFICULTY_SECTIONS:
        if f'[{diff}]' in text:
            found.append(diff)
    return found


def _build_song_info(folder: Path) -> SongInfo | None:
    """Build a SongInfo from a candidate track folder, or return None if invalid."""
    chart_path = folder / 'notes.chart'
    if not chart_path.exists():
        return None

    meta = _parse_song_ini(folder)

    title = meta.get('name', folder.name)
    artist = meta.get('artist', 'Unknown Artist')
    album = meta.get('album', '')
    genre = meta.get('genre', '')
    charter = meta.get('charter', '')
    loading_phrase = meta.get('loading_phrase', '')

    # Year: song.ini stores a plain year; notes.chart stores ", 2020" — ini wins
    year = meta.get('year', '')

    # Difficulty: prefer diff_guitar, fall back to diff_band
    try:
        difficulty = int(meta.get('diff_guitar', meta.get('diff_band', '0')))
    except ValueError:
        difficulty = 0

    try:
        song_length_ms = int(meta.get('song_length', '0'))
    except ValueError:
        song_length_ms = 0

    audio_file = _discover_audio(folder)
    available_difficulties = _detect_difficulties(chart_path)

    return SongInfo(
        folder=folder,
        title=title,
        artist=artist,
        album=album,
        genre=genre,
        year=year,
        charter=charter,
        difficulty=difficulty,
        song_length_ms=song_length_ms,
        loading_phrase=loading_phrase,
        audio_file=audio_file,
        available_difficulties=available_difficulties,
    )


def load_songs(tracks_dir: str | Path) -> list[SongInfo]:
    """
    Scan tracks_dir for song folders and return a sorted list of SongInfo.

    Sorted by artist then title (case-insensitive).
    Folders without a notes.chart are silently skipped.
    """
    tracks = Path(tracks_dir)
    if not tracks.is_dir():
        return []

    _expand_archives(tracks)

    songs: list[SongInfo] = []
    for folder in tracks.iterdir():
        if not folder.is_dir():
            continue
        info = _build_song_info(folder)
        if info is not None:
            songs.append(info)

    songs.sort(key=lambda s: (s.artist.lower(), s.title.lower()))
    return songs
