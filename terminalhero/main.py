#!/usr/bin/env python3
"""
TerminalHero — entry point.

Usage:  python main.py [--tracks TRACKS_DIR]
"""

from __future__ import annotations

import argparse
import curses
import sys
from pathlib import Path

from game.song_loader import load_songs, SongInfo
from game.screens.colors import init_all_colors
from game.screens.song_select import song_select, difficulty_select
from game.screens.gameplay import gameplay
from game.screens.results import results_screen

DEFAULT_TRACKS = Path(__file__).parent / "Tracks"


def _run(stdscr: "curses._CursesWindow", tracks_dir: Path) -> None:
    init_all_colors()
    songs = load_songs(tracks_dir)

    while True:
        chosen: SongInfo | None = song_select(stdscr, songs)
        if chosen is None:
            return

        difficulty: str | None = difficulty_select(stdscr, chosen)
        if difficulty is None:
            continue   # back to song select

        scorer = gameplay(stdscr, chosen, difficulty=difficulty)
        results_screen(stdscr, scorer, song_title=chosen.title)


def main() -> None:
    parser = argparse.ArgumentParser(description="TerminalHero")
    parser.add_argument(
        "--tracks",
        type=Path,
        default=DEFAULT_TRACKS,
        help="Path to the Tracks directory (default: ./Tracks)",
    )
    args = parser.parse_args()

    if not args.tracks.is_dir():
        print(f"Error: Tracks directory not found: {args.tracks}", file=sys.stderr)
        sys.exit(1)

    try:
        curses.wrapper(_run, args.tracks)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
