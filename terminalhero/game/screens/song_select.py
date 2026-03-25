"""
Song select screen.

Renders a scrollable list of songs and returns the chosen SongInfo
(or None if the user quit).
"""

from __future__ import annotations

import curses
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from game.song_loader import SongInfo

# Colour pair IDs — globally unique values defined in colors.py
from game.screens.colors import (
    CP_SS_TITLE    as _CP_TITLE,
    CP_SS_SELECTED as _CP_SELECTED,
    CP_SS_FOOTER   as _CP_FOOTER,
    CP_SS_DIM      as _CP_DIM,
)

_STAR = '★'
_EMPTY_STAR = '☆'


def _difficulty_stars(diff: int) -> str:
    diff = max(0, min(6, diff))
    filled = round(diff / 6 * 5)
    return _STAR * filled + _EMPTY_STAR * (5 - filled)


def _format_duration(ms: int) -> str:
    total_s = ms // 1000
    m, s = divmod(total_s, 60)
    return f"{m}:{s:02d}"


# ---------------------------------------------------------------------------
# Testable logic helpers (no curses dependency)
# ---------------------------------------------------------------------------

def compute_scroll(selected: int, visible_rows: int, total: int) -> int:
    """
    Return the scroll offset so the selected item stays in view.

    Always keeps the selected item visible, centring it when possible.
    """
    if total <= visible_rows:
        return 0
    # Try to centre selected
    offset = selected - visible_rows // 2
    return max(0, min(offset, total - visible_rows))


def visible_slice(songs: list, selected: int, visible_rows: int) -> tuple[list, int]:
    """
    Return (visible_songs, selected_index_within_slice).
    """
    offset = compute_scroll(selected, visible_rows, len(songs))
    sliced = songs[offset: offset + visible_rows]
    return sliced, selected - offset


# ---------------------------------------------------------------------------
# Curses renderer
# ---------------------------------------------------------------------------

# Canonical ordering for display (most→least common)
_DIFFICULTY_ORDER = [
    'ExpertSingle', 'HardSingle', 'MediumSingle', 'EasySingle',
    'ExpertDouble', 'HardDouble', 'MediumDouble', 'EasyDouble',
]

# Human-readable labels for each chart-section key
_DIFFICULTY_LABELS: dict[str, str] = {
    'ExpertSingle': 'Expert',
    'HardSingle':   'Hard',
    'MediumSingle': 'Medium',
    'EasySingle':   'Easy',
    'ExpertDouble': 'Expert (Co-op)',
    'HardDouble':   'Hard (Co-op)',
    'MediumDouble': 'Medium (Co-op)',
    'EasyDouble':   'Easy (Co-op)',
}


def _format_difficulty(key: str) -> str:
    """Return a human-readable label for a chart-section difficulty key."""
    return _DIFFICULTY_LABELS.get(key, key)


def _sort_difficulties(keys: list[str]) -> list[str]:
    """Sort difficulty keys in canonical order; unknown keys go at the end."""
    known = [k for k in _DIFFICULTY_ORDER if k in keys]
    unknown = sorted(k for k in keys if k not in _DIFFICULTY_ORDER)
    return known + unknown


_SONG_FOOTER = " ↑↓ Navigate   Enter/Space Select   Q Quit "
_DIFF_FOOTER = " ↑↓ Navigate   Enter/Space Select   Esc/Q Back "


def difficulty_select(
    stdscr: "curses._CursesWindow",
    song: "SongInfo",
) -> "str | None":
    """
    Show a difficulty picker for *song*.

    Returns the chosen difficulty key (e.g. ``'ExpertSingle'``) or ``None``
    if the player pressed Escape/Q to go back to song select.
    """
    difficulties = _sort_difficulties(song.available_difficulties)
    if not difficulties:
        return None

    # Default selection: Expert if present, else first available
    if 'ExpertSingle' in difficulties:
        selected = difficulties.index('ExpertSingle')
    else:
        selected = 0

    curses.curs_set(0)
    stdscr.keypad(True)

    while True:
        stdscr.erase()
        h, w = stdscr.getmaxyx()

        # Header — song title centred
        header = f" {song.display_name} "
        stdscr.attron(curses.color_pair(_CP_TITLE) | curses.A_BOLD)
        stdscr.addstr(0, max(0, (w - len(header)) // 2), header[:w])
        stdscr.attroff(curses.color_pair(_CP_TITLE) | curses.A_BOLD)

        # Sub-header
        sub = "Select Difficulty"
        stdscr.attron(curses.color_pair(_CP_DIM))
        stdscr.addstr(1, max(0, (w - len(sub)) // 2), sub[:w])
        stdscr.attroff(curses.color_pair(_CP_DIM))

        # Difficulty list — centred block
        list_top = 3
        for i, key in enumerate(difficulties):
            row = list_top + i
            if row >= h - 2:
                break
            label = f"  {_format_difficulty(key)}  "
            col = max(0, (w - len(label)) // 2)
            if i == selected:
                stdscr.attron(curses.color_pair(_CP_SELECTED) | curses.A_BOLD)
                stdscr.addstr(row, col, label[:w])
                stdscr.attroff(curses.color_pair(_CP_SELECTED) | curses.A_BOLD)
            else:
                stdscr.attron(curses.color_pair(_CP_DIM))
                stdscr.addstr(row, col, label[:w])
                stdscr.attroff(curses.color_pair(_CP_DIM))

        # Footer
        footer_row = h - 1
        stdscr.attron(curses.color_pair(_CP_FOOTER))
        stdscr.addstr(footer_row, 0, _DIFF_FOOTER[: w - 1].ljust(w - 1))
        stdscr.attroff(curses.color_pair(_CP_FOOTER))

        stdscr.refresh()

        key = stdscr.getch()

        if key in (curses.KEY_UP, ord('k')):
            selected = (selected - 1) % len(difficulties)
        elif key in (curses.KEY_DOWN, ord('j')):
            selected = (selected + 1) % len(difficulties)
        elif key in (ord('\n'), ord('\r'), ord(' ')):
            return difficulties[selected]
        elif key in (ord('q'), ord('Q'), 27):   # ESC or Q → back
            return None


def song_select(stdscr: "curses._CursesWindow", songs: list["SongInfo"]) -> "SongInfo | None":
    """
    Display the song select screen.  Returns the chosen SongInfo or None.
    """
    if not songs:
        stdscr.clear()
        stdscr.addstr(0, 0, "No songs found in Tracks/. Press any key to quit.")
        stdscr.getch()
        return None

    curses.curs_set(0)
    stdscr.keypad(True)

    selected = 0

    while True:
        stdscr.erase()
        h, w = stdscr.getmaxyx()

        # Header
        header = " TerminalHero "
        stdscr.attron(curses.color_pair(_CP_TITLE) | curses.A_BOLD)
        stdscr.addstr(0, max(0, (w - len(header)) // 2), header[:w])
        stdscr.attroff(curses.color_pair(_CP_TITLE) | curses.A_BOLD)

        # List area: rows 2 .. h-3
        list_top = 2
        list_bottom = h - 3
        visible_rows = max(1, list_bottom - list_top)

        visible, sel_in_view = visible_slice(songs, selected, visible_rows)

        for i, song in enumerate(visible):
            row = list_top + i
            if row >= h - 2:
                break
            is_sel = i == sel_in_view
            diff_str = _difficulty_stars(song.difficulty)
            dur_str = _format_duration(song.song_length_ms)
            line = f" {song.display_name:<{w - 20}} {diff_str} {dur_str} "
            line = line[:w]

            if is_sel:
                stdscr.attron(curses.color_pair(_CP_SELECTED) | curses.A_BOLD)
                stdscr.addstr(row, 0, line.ljust(w - 1))
                stdscr.attroff(curses.color_pair(_CP_SELECTED) | curses.A_BOLD)
            else:
                stdscr.attron(curses.color_pair(_CP_DIM))
                stdscr.addstr(row, 0, line[:w - 1])
                stdscr.attroff(curses.color_pair(_CP_DIM))

        # Footer
        footer_row = h - 1
        stdscr.attron(curses.color_pair(_CP_FOOTER))
        stdscr.addstr(footer_row, 0, _SONG_FOOTER[: w - 1].ljust(w - 1))
        stdscr.attroff(curses.color_pair(_CP_FOOTER))

        stdscr.refresh()

        key = stdscr.getch()

        if key in (curses.KEY_UP, ord('k')):
            selected = (selected - 1) % len(songs)
        elif key in (curses.KEY_DOWN, ord('j')):
            selected = (selected + 1) % len(songs)
        elif key in (ord('\n'), ord('\r'), ord(' ')):
            return songs[selected]
        elif key in (ord('q'), ord('Q'), 27):   # 27 = ESC
            return None
