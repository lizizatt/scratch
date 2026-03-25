"""
Results screen shown after a song ends.

Displays score breakdown and grade; waits for a keypress before returning.
"""

from __future__ import annotations

import curses
from game.engine.scorer import Scorer

from game.screens.colors import (
    CP_RS_GRADE  as _CP_GRADE,
    CP_RS_LABEL  as _CP_LABEL,
    CP_RS_VALUE  as _CP_VALUE,
    CP_RS_FOOTER as _CP_FOOTER,
)

_GRADE_COLORS = {
    'S': curses.COLOR_YELLOW,
    'A': curses.COLOR_GREEN,
    'B': curses.COLOR_CYAN,
    'C': curses.COLOR_WHITE,
    'F': curses.COLOR_RED,
}


def results_screen(stdscr: "curses._CursesWindow", scorer: Scorer, song_title: str) -> None:
    """
    Display the results screen and block until any key is pressed.
    """
    grade = scorer.grade
    # Re-initialize only the grade pair — its color depends on the song result.
    curses.init_pair(_CP_GRADE, _GRADE_COLORS.get(grade, curses.COLOR_WHITE), -1)
    curses.curs_set(0)
    stdscr.keypad(True)

    stdscr.erase()
    h, w = stdscr.getmaxyx()

    def centre(row: int, text: str, attr: int = 0) -> None:
        col = max(0, (w - len(text)) // 2)
        try:
            stdscr.addstr(row, col, text[:w], attr)
        except curses.error:
            pass

    start_row = max(2, h // 2 - 8)

    centre(start_row, "── RESULTS ──", curses.color_pair(_CP_LABEL) | curses.A_BOLD)
    centre(start_row + 1, song_title)

    # Grade (large)
    centre(start_row + 3, grade,
           curses.color_pair(_CP_GRADE) | curses.A_BOLD)

    rows = [
        ("Score",    f"{scorer.score:,}"),
        ("Perfect",  str(scorer.perfect_count)),
        ("Good",     str(scorer.good_count)),
        ("Miss",     str(scorer.miss_count)),
        ("Max Streak", str(scorer.max_streak)),
        ("Hit %",    f"{scorer.hit_percent:.1f}%"),
    ]

    for i, (label, value) in enumerate(rows):
        r = start_row + 5 + i
        col = max(0, w // 2 - 12)
        try:
            stdscr.addstr(r, col,
                          f"{label:<14}", curses.color_pair(_CP_LABEL))
            stdscr.addstr(r, col + 14,
                          value, curses.color_pair(_CP_VALUE) | curses.A_BOLD)
        except curses.error:
            pass

    footer = " Press any key to return to song select "
    centre(h - 2, footer, curses.color_pair(_CP_FOOTER))

    stdscr.refresh()
    stdscr.getch()
