"""
Pause menu overlay.

Renders a centred popup and returns one of three PauseChoice values.
"""

from __future__ import annotations

import curses
from enum import Enum, auto


class PauseChoice(Enum):
    RESUME = auto()
    RESTART = auto()
    EXIT_TO_SELECT = auto()


_OPTIONS: list[tuple[str, PauseChoice]] = [
    ("Resume", PauseChoice.RESUME),
    ("Restart Song", PauseChoice.RESTART),
    ("Exit to Song Select", PauseChoice.EXIT_TO_SELECT),
]

from game.screens.colors import (
    CP_PM_BOX      as _CP_BOX,
    CP_PM_SELECTED as _CP_SELECTED,
    CP_PM_TITLE    as _CP_TITLE,
)


def pause_menu(stdscr: "curses._CursesWindow") -> PauseChoice:
    """
    Render a pause overlay and return the player's choice.
    Blocks until a valid selection is made.
    """
    curses.curs_set(0)
    stdscr.keypad(True)

    selected = 0
    h, w = stdscr.getmaxyx()

    # Overlay dimensions
    box_h = len(_OPTIONS) + 4
    box_w = max(len(label) for label, _ in _OPTIONS) + 8
    box_y = max(0, (h - box_h) // 2)
    box_x = max(0, (w - box_w) // 2)

    while True:
        # Draw translucent overlay by re-drawing the box each frame
        # (curses doesn't support true transparency, so we just draw on top)
        stdscr.attron(curses.color_pair(_CP_BOX))
        try:
            stdscr.addstr(box_y, box_x, "┌" + "─" * (box_w - 2) + "┐")
            title = " PAUSED "
            title_x = box_x + (box_w - len(title)) // 2
            stdscr.addstr(box_y, title_x, title)
            for row in range(1, box_h - 1):
                stdscr.addstr(box_y + row, box_x, "│" + " " * (box_w - 2) + "│")
            stdscr.addstr(box_y + box_h - 1, box_x, "└" + "─" * (box_w - 2) + "┘")
        except curses.error:
            pass
        stdscr.attroff(curses.color_pair(_CP_BOX))

        for i, (label, _) in enumerate(_OPTIONS):
            row = box_y + 2 + i
            col = box_x + 3
            if i == selected:
                stdscr.attron(curses.color_pair(_CP_SELECTED) | curses.A_BOLD)
                stdscr.addstr(row, col, f" {label} ")
                stdscr.attroff(curses.color_pair(_CP_SELECTED) | curses.A_BOLD)
            else:
                stdscr.addstr(row, col, f" {label} ")

        stdscr.refresh()
        key = stdscr.getch()

        if key in (curses.KEY_UP, ord('k')):
            selected = (selected - 1) % len(_OPTIONS)
        elif key in (curses.KEY_DOWN, ord('j')):
            selected = (selected + 1) % len(_OPTIONS)
        elif key in (ord('\n'), ord('\r'), ord(' ')):
            return _OPTIONS[selected][1]
        elif key == 27:  # ESC = resume
            return PauseChoice.RESUME
