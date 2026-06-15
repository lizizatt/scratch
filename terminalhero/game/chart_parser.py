"""
Parse Clone Hero .chart files into Note objects.

Format overview
---------------
Sections are delimited by:
    [SectionName]
    {
      <tick> = <type> <args...>
    }

No library handles this format; we parse it line-by-line.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple

from game.engine.note import Note


# ---------------------------------------------------------------------------
# Internal raw event types
# ---------------------------------------------------------------------------

class _BpmEvent(NamedTuple):
    tick: int
    bpm: float          # beats per minute (already divided by 1000)


class _NoteEvent(NamedTuple):
    tick: int
    lane: int
    sustain_ticks: int


class _FlagEvent(NamedTuple):
    """Lane 5 (open), 6 (force-HOPO), 7 (tap) modifier events."""
    tick: int
    lane: int           # 5, 6, or 7


class _StarPowerEvent(NamedTuple):
    tick: int
    length_ticks: int


# ---------------------------------------------------------------------------
# Public result type
# ---------------------------------------------------------------------------

@dataclass
class ChartData:
    resolution: int                     # ticks per beat
    offset_s: float                     # audio start offset (seconds)
    music_stream: str                   # filename hint from [Song]
    bpm_events: list[_BpmEvent]
    notes: list[Note]
    star_power: list[_StarPowerEvent]   # star power phrase ranges


# ---------------------------------------------------------------------------
# Tick → second conversion
# ---------------------------------------------------------------------------

def ticks_to_seconds(tick: int, resolution: int, bpm_events: list[_BpmEvent]) -> float:
    """Convert a chart tick to an absolute time in seconds via the tempo map."""
    if not bpm_events:
        return 0.0

    elapsed = 0.0
    prev_tick = 0
    prev_bpm = bpm_events[0].bpm

    for event in bpm_events[1:]:
        if event.tick >= tick:
            break
        delta_ticks = event.tick - prev_tick
        elapsed += (delta_ticks / resolution) * (60.0 / prev_bpm)
        prev_tick = event.tick
        prev_bpm = event.bpm

    # Remaining ticks after last tempo event
    delta_ticks = tick - prev_tick
    elapsed += (delta_ticks / resolution) * (60.0 / prev_bpm)
    return elapsed


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

_SECTION_RE = re.compile(r'^\[(\w+)\]$')
_DATA_RE = re.compile(r'^\s*(\d+)\s*=\s*(.+)$')


def _parse_raw_sections(text: str) -> dict[str, list[str]]:
    """
    Return a dict mapping section name → list of raw value strings
    (the lines inside the braces, stripped).
    """
    sections: dict[str, list[str]] = {}
    current: str | None = None
    inside: bool = False

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        m = _SECTION_RE.match(line)
        if m:
            current = m.group(1)
            sections.setdefault(current, [])
            continue

        if line == '{':
            inside = True
            continue

        if line == '}':
            inside = False
            current = None
            continue

        if inside and current is not None:
            sections[current].append(line)

    return sections


def _parse_song_section(lines: list[str]) -> dict[str, str]:
    """Return key→value pairs from [Song], stripping outer quotes."""
    result: dict[str, str] = {}
    for line in lines:
        if '=' not in line:
            continue
        key, _, val = line.partition('=')
        key = key.strip()
        val = val.strip().strip('"')
        result[key] = val
    return result


def _parse_sync_track(lines: list[str]) -> list[_BpmEvent]:
    events: list[_BpmEvent] = []
    for line in lines:
        m = _DATA_RE.match(line)
        if not m:
            continue
        tick = int(m.group(1))
        rest = m.group(2).strip()
        if rest.startswith('B '):
            bpm_raw = int(rest[2:])
            events.append(_BpmEvent(tick=tick, bpm=bpm_raw / 1000.0))
    events.sort(key=lambda e: e.tick)
    return events


def _parse_note_track(lines: list[str]) -> tuple[list[_NoteEvent], list[_FlagEvent], list[_StarPowerEvent]]:
    """
    Parse an [XxxSingle] section.

    Returns:
        notes      - lane 0-4 note events
        flags      - lane 5 (open), 6 (force-HOPO), 7 (tap) modifiers
        star_power - S 2 phrase events
    """
    notes: list[_NoteEvent] = []
    flags: list[_FlagEvent] = []
    star_power: list[_StarPowerEvent] = []

    for line in lines:
        m = _DATA_RE.match(line)
        if not m:
            continue
        tick = int(m.group(1))
        rest = m.group(2).strip()

        if rest.startswith('N '):
            parts = rest[2:].split()
            if len(parts) < 2:
                continue
            lane, sustain = int(parts[0]), int(parts[1])
            if lane in (0, 1, 2, 3, 4):
                notes.append(_NoteEvent(tick=tick, lane=lane, sustain_ticks=sustain))
            elif lane in (5, 6, 7):
                flags.append(_FlagEvent(tick=tick, lane=lane))

        elif rest.startswith('S 2 '):
            length = int(rest[4:].strip())
            star_power.append(_StarPowerEvent(tick=tick, length_ticks=length))

    return notes, flags, star_power


def _apply_flags(
    raw_notes: list[_NoteEvent],
    flags: list[_FlagEvent],
    resolution: int,
    bpm_events: list[_BpmEvent],
) -> list[Note]:
    """
    Merge modifier flags into Note objects.

    Flags at the same tick as a note modify that note.
    Lane 5 flag at a tick with no fret note = open note.
    """
    # Build per-tick lookups
    flag_map: dict[int, set[int]] = {}
    for f in flags:
        flag_map.setdefault(f.tick, set()).add(f.lane)

    # Open notes come in as lane-5 _FlagEvent since they share the N prefix
    # but we need to check: is there a lane-5 flag at a tick with no lane-0..4 note?
    # Actually we already separated them in _parse_note_track: lane 5 goes to flags.
    note_ticks: set[int] = {n.tick for n in raw_notes}

    # Emit open notes for lone lane-5 flags.
    # NOTE: a lane-5 flag at the *same* tick as a lane-0–4 note is treated as
    # a HOPO/tap modifier only — the open note is silently dropped.  Clone Hero
    # allows open+fret combos in some charts; handle here if that ever matters.
    open_notes: list[_NoteEvent] = []
    for tick, lanes in flag_map.items():
        if 5 in lanes and tick not in note_ticks:
            open_notes.append(_NoteEvent(tick=tick, lane=5, sustain_ticks=0))

    all_raw = sorted(raw_notes + open_notes, key=lambda n: (n.tick, n.lane))

    result: list[Note] = []
    for rn in all_raw:
        tick_flags = flag_map.get(rn.tick, set())
        time_s = ticks_to_seconds(rn.tick, resolution, bpm_events)
        note = Note(
            tick=rn.tick,
            lane=rn.lane,
            sustain_ticks=rn.sustain_ticks,
            time_s=time_s,
            is_hopo=(6 in tick_flags),
            is_tap=(7 in tick_flags),
        )
        if rn.sustain_ticks > 0:
            end_s = ticks_to_seconds(rn.tick + rn.sustain_ticks, resolution, bpm_events)
            note.sustain_end_s = end_s
        result.append(note)

    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

DIFFICULTY_SECTIONS = ('ExpertSingle', 'HardSingle', 'MediumSingle', 'EasySingle')


def parse_chart(path: str | Path, difficulty: str = 'ExpertSingle') -> ChartData:
    """
    Parse a notes.chart file and return a ChartData object.

    Args:
        path:       Path to the notes.chart file.
        difficulty: Section name to parse for notes (default: ExpertSingle).
    """
    text = Path(path).read_text(encoding='utf-8', errors='replace')
    sections = _parse_raw_sections(text)

    # [Song] metadata
    song_meta = _parse_song_section(sections.get('Song', []))
    resolution = int(song_meta.get('Resolution', '192'))
    offset_s = float(song_meta.get('Offset', '0'))
    music_stream = song_meta.get('MusicStream', '')

    # [SyncTrack]
    bpm_events = _parse_sync_track(sections.get('SyncTrack', []))
    if not bpm_events:
        bpm_events = [_BpmEvent(tick=0, bpm=120.0)]

    # Note track
    track_lines = sections.get(difficulty, [])
    raw_notes, flags, star_power = _parse_note_track(track_lines)
    notes = _apply_flags(raw_notes, flags, resolution, bpm_events)

    return ChartData(
        resolution=resolution,
        offset_s=offset_s,
        music_stream=music_stream,
        bpm_events=bpm_events,
        notes=notes,
        star_power=star_power,
    )
