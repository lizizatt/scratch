"""
Globally unique curses color pair IDs for all TerminalHero screens.

All four screens share a single process-global curses color pair table.
Assigning unique IDs here prevents screens from clobbering each other's
pairs when _init_colors() is called on screen entry.

Call ``init_all_colors()`` once at startup (inside curses.wrapper) before
showing any screen.
"""

from __future__ import annotations

import curses

# ---------------------------------------------------------------------------
# Gameplay screen (pairs 1–12)
# ---------------------------------------------------------------------------
CP_GP_HEADER  = 1
CP_GP_LANE    = [2, 3, 4, 5, 6]   # one per fret lane 0–4
CP_GP_OPEN    = 7
CP_GP_STRIKE  = 8
CP_GP_PERFECT = 9
CP_GP_GOOD    = 10
CP_GP_MISS    = 11
CP_GP_DIM     = 12

# ---------------------------------------------------------------------------
# Song select screen (pairs 13–16)
# ---------------------------------------------------------------------------
CP_SS_TITLE    = 13
CP_SS_SELECTED = 14
CP_SS_FOOTER   = 15
CP_SS_DIM      = 16

# ---------------------------------------------------------------------------
# Pause menu (pairs 17–19)
# ---------------------------------------------------------------------------
CP_PM_BOX      = 17
CP_PM_SELECTED = 18
CP_PM_TITLE    = 19

# ---------------------------------------------------------------------------
# Results screen (pairs 20–23)
# ---------------------------------------------------------------------------
# CP_RS_GRADE (20) is re-initialized each time with the grade-appropriate
# foreground color; the other three are static.
CP_RS_GRADE  = 20
CP_RS_LABEL  = 21
CP_RS_VALUE  = 22
CP_RS_FOOTER = 23

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
_LANE_COLORS = [
    curses.COLOR_GREEN,
    curses.COLOR_RED,
    curses.COLOR_YELLOW,
    curses.COLOR_BLUE,
    curses.COLOR_MAGENTA,
]


def init_all_colors() -> None:
    """
    Initialise every color pair used by the game.

    Must be called after ``curses.initscr()`` / inside ``curses.wrapper``.
    The results screen re-initialises CP_RS_GRADE itself (grade-dependent color).
    """
    curses.start_color()
    curses.use_default_colors()

    # Gameplay
    curses.init_pair(CP_GP_HEADER,  curses.COLOR_CYAN,  -1)
    for i, color in enumerate(_LANE_COLORS):
        curses.init_pair(CP_GP_LANE[i], color, -1)
    curses.init_pair(CP_GP_OPEN,    curses.COLOR_WHITE,  -1)
    curses.init_pair(CP_GP_STRIKE,  curses.COLOR_WHITE,  -1)
    curses.init_pair(CP_GP_PERFECT, curses.COLOR_YELLOW, -1)
    curses.init_pair(CP_GP_GOOD,    curses.COLOR_CYAN,   -1)
    curses.init_pair(CP_GP_MISS,    curses.COLOR_RED,    -1)
    curses.init_pair(CP_GP_DIM,     curses.COLOR_WHITE,  -1)

    # Song select
    curses.init_pair(CP_SS_TITLE,    curses.COLOR_CYAN,  -1)
    curses.init_pair(CP_SS_SELECTED, curses.COLOR_BLACK, curses.COLOR_WHITE)
    curses.init_pair(CP_SS_FOOTER,   curses.COLOR_YELLOW, -1)
    curses.init_pair(CP_SS_DIM,      curses.COLOR_WHITE,  -1)

    # Pause menu
    curses.init_pair(CP_PM_BOX,      curses.COLOR_CYAN,  -1)
    curses.init_pair(CP_PM_SELECTED, curses.COLOR_BLACK, curses.COLOR_WHITE)
    curses.init_pair(CP_PM_TITLE,    curses.COLOR_YELLOW, -1)

    # Results (static pairs; grade pair initialised dynamically in results.py)
    curses.init_pair(CP_RS_GRADE,  curses.COLOR_WHITE,  -1)   # overwritten per run
    curses.init_pair(CP_RS_LABEL,  curses.COLOR_CYAN,   -1)
    curses.init_pair(CP_RS_VALUE,  curses.COLOR_WHITE,  -1)
    curses.init_pair(CP_RS_FOOTER, curses.COLOR_YELLOW, -1)
