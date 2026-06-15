"""
Sustain tracking for TerminalHero.

Handles the lifecycle of a held note after the initial hit:
  - Knows which lanes currently have an active sustain
  - Awards trickle score points per second while held
  - Detects key release (via decay, since curses has no key-up events)
  - Detects natural completion when chart time passes sustain_end_s
  - Breaks the sustain early if the key is released

Key-hold detection
------------------
curses fires repeated key-down events when a key is held (OS key repeat, ~30 Hz).
We record the wall-clock time of the most recent sighting for each fret lane.
If that timestamp is older than KEY_RELEASE_S seconds, we treat the key as released.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from game.engine.note import Note
from game.engine.scorer import Scorer

# Points awarded per second of sustain held (before multiplier)
SUSTAIN_PTS_PER_SEC: float = 25.0

# If a fret key hasn't been seen for this long, consider it released.
# Must exceed the OS key-repeat initial delay (~300-500 ms on most systems).
KEY_RELEASE_S: float = 0.6


@dataclass
class _ActiveSustain:
    note: Note
    lane: int
    broken: bool = False
    completed: bool = False


class SustainTracker:
    """
    Tracks active sustains and awards trickle points while keys are held.

    Usage (each frame in the game loop)
    ------------------------------------
        # When a sustained note is hit:
        tracker.start(note)

        # After reading all keypresses this frame:
        tracker.update_key_seen(lane, wall_time)   # for each held fret

        # Once per frame:
        broken, completed = tracker.update(chart_time_s, wall_time, scorer)
    """

    def __init__(self) -> None:
        # lane → active sustain
        self._active: dict[int, _ActiveSustain] = {}
        # lane → wall-clock time of last key sighting
        self._last_seen: dict[int, float] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self, note: Note, wall_time: float) -> None:
        """
        Begin tracking a sustain for note.lane.
        Overwrites any existing sustain on that lane.
        """
        if note.sustain_ticks == 0:
            return
        self._active[note.lane] = _ActiveSustain(note=note, lane=note.lane)
        self._last_seen[note.lane] = wall_time

    def key_seen(self, lane: int, wall_time: float) -> None:
        """Call each frame for every fret key that is currently pressed."""
        self._last_seen[lane] = wall_time

    def update(
        self,
        chart_time_s: float,
        wall_time: float,
        scorer: Scorer,
        dt_s: float,
    ) -> tuple[list[int], list[int]]:
        """
        Advance all active sustains by one frame.

        Args:
            chart_time_s: Current song position in seconds.
            wall_time:    Current wall-clock time (perf_counter).
            scorer:       Scorer to award trickle points to.
            dt_s:         Elapsed time since last frame (seconds).

        Returns:
            (broken_lanes, completed_lanes)
              broken_lanes   — lanes where sustain ended early (key released)
              completed_lanes — lanes where sustain reached its natural end
        """
        broken: list[int] = []
        completed: list[int] = []
        done_lanes: list[int] = []

        for lane, sustain in self._active.items():
            if sustain.broken or sustain.completed:
                done_lanes.append(lane)
                continue

            last = self._last_seen.get(lane, 0.0)
            key_held = (wall_time - last) < KEY_RELEASE_S

            # Natural completion
            if chart_time_s >= sustain.note.sustain_end_s:
                if key_held:
                    pts = int(SUSTAIN_PTS_PER_SEC * dt_s * scorer.multiplier)
                    scorer.score += pts
                sustain.completed = True
                completed.append(lane)
                done_lanes.append(lane)
                continue

            # Key released early — break sustain
            if not key_held:
                sustain.broken = True
                broken.append(lane)
                done_lanes.append(lane)
                continue

            # Still held — award trickle points
            pts = int(SUSTAIN_PTS_PER_SEC * dt_s * scorer.multiplier)
            scorer.score += pts

        for lane in done_lanes:
            self._active.pop(lane, None)

        return broken, completed

    def active_sustains(self) -> list[_ActiveSustain]:
        """Return all currently active (not broken/completed) sustains."""
        return list(self._active.values())

    def is_sustaining(self, lane: int) -> bool:
        return lane in self._active

    def clear(self) -> None:
        """Reset all state (e.g. on restart)."""
        self._active.clear()
        self._last_seen.clear()
