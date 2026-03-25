"""
Gameplay screen — the main game loop.

Responsibilities:
  - Count-in (3, 2, 1)
  - Start audio playback
  - Each frame: read chart time, call hit_detector.update(), render highway
  - Handle fret keypresses (1-5) → try_hit → scorer
  - ESC → pause menu
  - Song end → return to caller with final Scorer

Highway layout (columns):
    Lane 0 → col 0
    Lane 1 → col 1
    ...etc, each lane gets equal width

Notes travel from top of screen downward to a fixed strikezone row near the bottom.
"""

from __future__ import annotations

import curses
import time
from typing import TYPE_CHECKING

from game.audio import AudioPlayer
from game.chart_parser import parse_chart
from game.engine.hit_detector import HitDetector
from game.engine.scorer import Scorer, HitQuality
from game.engine.sustain_tracker import SustainTracker
from game.screens.pause_menu import pause_menu, PauseChoice

if TYPE_CHECKING:
    from game.song_loader import SongInfo

# ---------------------------------------------------------------------------
# Colour pair IDs — globally unique values defined in colors.py
# ---------------------------------------------------------------------------
from game.screens.colors import (
    CP_GP_HEADER  as _CP_HEADER,
    CP_GP_LANE    as _CP_LANE,
    CP_GP_OPEN    as _CP_OPEN,
    CP_GP_STRIKE  as _CP_STRIKE,
    CP_GP_PERFECT as _CP_PERFECT,
    CP_GP_GOOD    as _CP_GOOD,
    CP_GP_MISS    as _CP_MISS,
    CP_GP_DIM     as _CP_DIM,
)

_FRET_KEYS = {
    ord('1'): 0, ord('2'): 1, ord('3'): 2, ord('4'): 3, ord('5'): 4,
}

# Scroll speed: seconds of notes visible above the strikezone
SCROLL_WINDOW_S: float = 1.0

# How many frames to flash the strikezone lane indicator (~300 ms at 60 fps)
FLASH_FRAMES = 18

# How many frames to show the centred judgment word (~500 ms at 60 fps)
JUDGMENT_FRAMES = 30

# How many rows above the strikezone to paint the lane glow
GLOW_ROWS = 3

# Strikezone row offset from bottom of screen
STRIKE_ROW_OFFSET = 4

NUM_LANES = 5


# ---------------------------------------------------------------------------
# Judgment display (centred popup text)
# ---------------------------------------------------------------------------

_JUDGMENT_TEXT: dict[HitQuality | None, str] = {
    HitQuality.PERFECT: "PERFECT!",
    HitQuality.GOOD:    "  GOOD  ",
    None:               "  MISS  ",
}

_JUDGMENT_COLOR: dict[HitQuality | None, int] = {
    HitQuality.PERFECT: _CP_PERFECT,
    HitQuality.GOOD:    _CP_GOOD,
    None:               _CP_MISS,
}


class _JudgmentDisplay:
    """Tracks the most recent hit/miss quality and how long to show it."""

    def __init__(self) -> None:
        self._quality: HitQuality | None = None
        self._frames: int = 0

    def trigger(self, quality: HitQuality | None) -> None:
        self._quality = quality
        self._frames = JUDGMENT_FRAMES

    def tick(self) -> None:
        if self._frames > 0:
            self._frames -= 1

    def render(self, stdscr: "curses._CursesWindow", row: int, width: int) -> None:
        """Draw the judgment word centred at the given row."""
        if self._frames <= 0:
            return
        text = _JUDGMENT_TEXT[self._quality]
        cp = _JUDGMENT_COLOR[self._quality]
        # Dim out in the last third of the display window
        fade_threshold = JUDGMENT_FRAMES // 3
        attr = curses.color_pair(cp) | curses.A_BOLD
        if self._frames <= fade_threshold:
            attr = curses.color_pair(cp)   # drop bold as it fades
        col = max(0, (width - len(text)) // 2)
        try:
            stdscr.addstr(row, col, text, attr)
        except curses.error:
            pass


# ---------------------------------------------------------------------------
# Testable layout helpers
# ---------------------------------------------------------------------------

def lane_col_range(lane: int, width: int, num_lanes: int = NUM_LANES) -> tuple[int, int]:
    """
    Return (start_col, end_col) for a lane given terminal width.
    Each lane gets an equal-width column.
    """
    lane_w = max(1, width // num_lanes)
    start = lane * lane_w
    end = start + lane_w if lane < num_lanes - 1 else width
    return start, end


def note_row(note_time_s: float, chart_time_s: float, strike_row: int,
             scroll_window_s: float = SCROLL_WINDOW_S) -> int:
    """
    Return the terminal row a note should be drawn at.

    Notes at chart_time_s == note_time_s are at strike_row.
    Notes in the future (not yet reached) are above (lower row index).
    Returns a row < 0 if too far in the future (don't render).
    Returns a row > strike_row if already past (also don't render after miss window).
    """
    dt = note_time_s - chart_time_s          # seconds until note hits strikezone
    frac = 1.0 - (dt / scroll_window_s)      # 0=top of highway, 1=strikezone
    return int(strike_row * frac)


# ---------------------------------------------------------------------------
# Count-in
# ---------------------------------------------------------------------------

def _count_in(stdscr: "curses._CursesWindow") -> None:
    """Display 3-2-1 countdown, one beat per second (real time)."""
    h, w = stdscr.getmaxyx()
    for digit in ('3', '2', '1'):
        stdscr.erase()
        try:
            stdscr.addstr(h // 2, w // 2 - 1, digit,
                          curses.color_pair(_CP_HEADER) | curses.A_BOLD)
        except curses.error:
            pass
        stdscr.refresh()
        time.sleep(1.0)


# ---------------------------------------------------------------------------
# Hit flash state
# ---------------------------------------------------------------------------

class _HitFlash:
    """Per-lane flash state (quality + remaining frames)."""

    def __init__(self) -> None:
        self._state: dict[int, tuple[HitQuality | None, int]] = {
            lane: (None, 0) for lane in range(NUM_LANES)
        }

    def trigger(self, lane: int, quality: HitQuality) -> None:
        self._state[lane] = (quality, FLASH_FRAMES)

    def trigger_miss(self, lane: int) -> None:
        self._state[lane] = (None, FLASH_FRAMES)

    def tick(self) -> None:
        for lane in self._state:
            q, frames = self._state[lane]
            if frames > 0:
                self._state[lane] = (q, frames - 1)

    def active(self, lane: int) -> tuple[HitQuality | None, int]:
        """Returns (quality_or_None, frames_remaining)."""
        return self._state[lane]


# ---------------------------------------------------------------------------
# Main gameplay function
# ---------------------------------------------------------------------------

def gameplay(stdscr: "curses._CursesWindow", song: "SongInfo",
             difficulty: str = 'ExpertSingle') -> Scorer:
    """
    Run the gameplay loop for a song.  Returns the Scorer on completion.
    """
    curses.curs_set(0)
    stdscr.keypad(True)
    stdscr.nodelay(True)          # non-blocking input

    player = AudioPlayer()        # created once; reused across restarts

    while True:                   # restart loop — avoids stack growth on repeat plays
        # Load chart and audio
        chart_data = parse_chart(song.chart_path, difficulty=difficulty)
        detector = HitDetector(chart_data.notes)
        scorer = Scorer()

        if song.audio_file:
            player.load(song.audio_file)

        # Count-in (blocking — use nodelay=False momentarily)
        stdscr.nodelay(False)
        _count_in(stdscr)
        stdscr.nodelay(True)

        # Start playback
        if song.audio_file:
            player.play(offset_s=chart_data.offset_s)

        flash = _HitFlash()
        judgment = _JudgmentDisplay()
        sustains = SustainTracker()

        last_wall_time = time.perf_counter()
        render_head = 0           # index into chart_data.notes; advances forward only
        restart_requested = False

        while True:               # game loop — one iteration per frame
            wall_time = time.perf_counter()
            frame_deadline = wall_time + 1 / 60
            dt_s = wall_time - last_wall_time
            last_wall_time = wall_time
            h, w = stdscr.getmaxyx()
            chart_time_s = player.get_pos_s()

            # --- Miss detection ---
            newly_missed = detector.update(chart_time_s)
            for note in newly_missed:
                scorer.record_hit(HitQuality.MISS)
                flash.trigger_miss(note.lane)
                judgment.trigger(None)   # None = miss

            # --- Input handling (must run before sustain update so key_seen stamps are fresh) ---
            while True:
                key = stdscr.getch()
                if key == -1:
                    break
                if key == 27:                       # ESC → pause
                    player.pause()
                    choice = pause_menu(stdscr)
                    if choice == PauseChoice.RESUME:
                        player.unpause()
                        # Reset last_wall_time so the first post-pause dt_s
                        # is not the entire pause duration (which would send
                        # a huge delta to sustain_tracker and other dt consumers).
                        last_wall_time = time.perf_counter()
                    elif choice == PauseChoice.RESTART:
                        player.stop()
                        restart_requested = True
                        break
                    else:
                        player.stop()
                        return scorer
                elif key in _FRET_KEYS:
                    lane = _FRET_KEYS[key]
                    sustains.key_seen(lane, wall_time)   # register hold
                    quality = detector.try_hit(lane, chart_time_s)
                    if quality is not None:
                        scorer.record_hit(quality)
                        flash.trigger(lane, quality)
                        judgment.trigger(quality)
                        if detector.last_hit_note and detector.last_hit_note.sustain_ticks > 0:
                            sustains.start(detector.last_hit_note, wall_time)

            if restart_requested:
                break

            # --- Sustain update (after input so key_seen timestamps are current) ---
            broken_lanes, _ = sustains.update(chart_time_s, wall_time, scorer, dt_s)

            # --- Rendering ---
            strike_row = h - STRIKE_ROW_OFFSET - 1
            highway_top = 2           # row index where highway starts (below header)

            stdscr.erase()

            # Header
            header = (
                f" {song.title[:w // 2]}  "
                f"Score: {scorer.score:,}  "
                f"Streak: {scorer.streak}x  "
                f"{scorer.multiplier}×"
            )[:w - 1]
            try:
                stdscr.addstr(0, 0, header, curses.color_pair(_CP_HEADER) | curses.A_BOLD)
            except curses.error:
                pass

            # Lane separators (dim vertical lines)
            for lane in range(1, NUM_LANES):
                col, _ = lane_col_range(lane, w)
                for row in range(highway_top, strike_row):
                    try:
                        stdscr.addch(row, col, '│', curses.color_pair(_CP_DIM))
                    except curses.error:
                        pass

            # Notes on highway
            visible_start_s = chart_time_s - 0.1        # a bit behind strikezone
            visible_end_s = chart_time_s + SCROLL_WINDOW_S

            # Advance render_head past notes that have scrolled fully off the back of the highway.
            while (render_head < len(chart_data.notes) and
                   chart_data.notes[render_head].time_s < visible_start_s):
                render_head += 1

            for note in chart_data.notes[render_head:]:
                if note.time_s > visible_end_s:
                    break
                if note.hit or note.missed:
                    continue

                row = note_row(note.time_s, chart_time_s, strike_row)
                if row < highway_top or row > strike_row + 1:
                    continue

                col_start, col_end = lane_col_range(note.lane, w)
                lane_w = col_end - col_start
                block = ('█' * lane_w)[:lane_w - 1]

                if note.is_open:
                    attr = curses.color_pair(_CP_OPEN) | curses.A_BOLD
                else:
                    attr = curses.color_pair(_CP_LANE[note.lane]) | curses.A_BOLD

                try:
                    stdscr.addstr(row, col_start, block, attr)
                except curses.error:
                    pass

                # Sustain tail (approaching, pre-hit) — wide coloured bar so it's unmissable
                if note.sustain_ticks > 0:
                    tail_end_s = note.sustain_end_s
                    tail_end_row = note_row(tail_end_s, chart_time_s, strike_row)
                    # Tail runs from just below the note head down to where the sustain ends
                    tail_start_row = max(highway_top, row + 1)
                    tail_end_row = max(tail_start_row, min(tail_end_row, strike_row))
                    tail_lane_w = max(1, lane_w // 2)            # half-width centred bar
                    tail_col = col_start + (lane_w - tail_lane_w) // 2
                    tail_attr = curses.color_pair(_CP_LANE[note.lane] if not note.is_open else _CP_OPEN)
                    for tr in range(tail_start_row, tail_end_row + 1):
                        try:
                            stdscr.addstr(tr, tail_col, '▓' * tail_lane_w, tail_attr)
                        except curses.error:
                            pass

            # Active sustain tails (post-hit, shrinking as time passes)
            for sustain in sustains.active_sustains():
                sn = sustain.note
                lane = sn.lane
                col_start, col_end = lane_col_range(lane, w)
                lane_w = col_end - col_start
                tail_lane_w = max(1, lane_w // 2)
                tail_col = col_start + (lane_w - tail_lane_w) // 2
                # Top of remaining tail = row where sustain_end_s would appear
                top_row = note_row(sn.sustain_end_s, chart_time_s, strike_row)
                top_row = max(highway_top, top_row)
                tail_color = curses.color_pair(_CP_LANE[lane] if not sn.is_open else _CP_OPEN) | curses.A_BOLD
                for tr in range(top_row, strike_row):
                    try:
                        stdscr.addstr(tr, tail_col, '█' * tail_lane_w, tail_color)
                    except curses.error:
                        pass
                # Bright full-width block at strikezone while held
                sc_start, sc_end = lane_col_range(lane, w)
                sc_w = sc_end - sc_start
                try:
                    stdscr.addstr(strike_row, sc_start,
                                  ('█' * sc_w)[:sc_w - 1],
                                  curses.color_pair(_CP_LANE[lane]) | curses.A_BOLD)
                except curses.error:
                    pass

            # Lane glow — rows just above the strikezone tinted on hit
            for lane in range(NUM_LANES):
                q, frames = flash.active(lane)
                if frames <= 0 or q is None:   # no glow on miss
                    continue
                col_start, col_end = lane_col_range(lane, w)
                lane_w = col_end - col_start
                glow_char = ' '
                glow_attr = curses.color_pair(_CP_LANE[lane]) | curses.A_REVERSE
                glow_start = max(highway_top, strike_row - GLOW_ROWS)
                # Intensity: full for first half of flash, dim for second half
                if frames < FLASH_FRAMES // 2:
                    glow_attr = curses.color_pair(_CP_LANE[lane])
                for gr in range(glow_start, strike_row):
                    try:
                        stdscr.addstr(gr, col_start,
                                      (glow_char * lane_w)[:lane_w - 1], glow_attr)
                    except curses.error:
                        pass

            # Strikezone
            for lane in range(NUM_LANES):
                col_start, col_end = lane_col_range(lane, w)
                lane_w = col_end - col_start
                q, frames = flash.active(lane)
                if frames > 0:
                    if q == HitQuality.PERFECT:
                        attr = curses.color_pair(_CP_PERFECT) | curses.A_BOLD
                        char = '▓'
                    elif q == HitQuality.GOOD:
                        attr = curses.color_pair(_CP_GOOD) | curses.A_BOLD
                        char = '▒'
                    else:
                        attr = curses.color_pair(_CP_MISS) | curses.A_BOLD
                        char = '░'
                else:
                    attr = curses.color_pair(_CP_LANE[lane])
                    char = '═'
                try:
                    stdscr.addstr(strike_row, col_start, (char * lane_w)[:lane_w - 1], attr)
                except curses.error:
                    pass

            # Centred judgment word (drawn after strikezone so it's on top)
            judgment_row = max(highway_top + 1, strike_row - GLOW_ROWS - 2)
            judgment.render(stdscr, judgment_row, w)

            # Fret labels
            label_row = strike_row + 1
            for lane in range(NUM_LANES):
                col_start, _ = lane_col_range(lane, w)
                try:
                    stdscr.addstr(label_row, col_start + 1, str(lane + 1),
                                  curses.color_pair(_CP_LANE[lane]) | curses.A_BOLD)
                except curses.error:
                    pass

            flash.tick()
            judgment.tick()
            stdscr.refresh()

            # Check song finished
            if detector.is_finished():
                player.stop()
                break

            # Also check if audio has finished naturally
            if song.audio_file and not player.is_playing and not player.is_paused:
                break

            # Deadline-based frame cap — sleep only the time remaining in the budget
            remaining = frame_deadline - time.perf_counter()
            if remaining > 0:
                time.sleep(remaining)

        # Inner game loop exited
        if not restart_requested:
            return scorer
        # restart_requested is True: outer restart loop continues
