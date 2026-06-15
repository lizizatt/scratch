"""
Hit detection for TerminalHero.

Determines whether a player keypress at a given time hits, misses, or
is too early for the nearest eligible note in a lane.
"""

from __future__ import annotations

from game.engine.note import Note
from game.engine.scorer import HitQuality

# Timing windows (seconds)
PERFECT_WINDOW_S: float = 0.070   # ±70 ms
GOOD_WINDOW_S: float = 0.150      # ±150 ms


def _quality_for_delta(delta_s: float) -> HitQuality | None:
    """
    Map absolute time delta to a HitQuality.

    Returns None if the delta is outside the good window.
    """
    abs_delta = abs(delta_s)
    if abs_delta <= PERFECT_WINDOW_S:
        return HitQuality.PERFECT
    if abs_delta <= GOOD_WINDOW_S:
        return HitQuality.GOOD
    return None


class HitDetector:
    """
    Detects hits and misses for a list of notes.

    The detector owns no clock — callers pass the current chart time.
    Call `update(chart_time_s)` once per frame to mark passed notes as missed.
    Call `try_hit(lane, chart_time_s)` when the player presses a fret key.
    After a successful hit, `last_hit_note` holds the Note that was hit.
    """

    def __init__(self, notes: list[Note]) -> None:
        # Sort by time; group into per-lane queues for O(1) front access
        self._by_lane: dict[int, list[Note]] = {}
        for note in sorted(notes, key=lambda n: n.time_s):
            self._by_lane.setdefault(note.lane, []).append(note)

        # Pointer per lane (index of the next un-resolved note)
        self._head: dict[int, int] = {lane: 0 for lane in self._by_lane}

        # Set after every successful try_hit call
        self.last_hit_note: Note | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(self, chart_time_s: float) -> list[Note]:
        """
        Advance time and mark any notes that have passed the miss window.

        Returns the newly-missed notes (if any).
        """
        missed: list[Note] = []
        for lane, notes in self._by_lane.items():
            idx = self._head[lane]
            while idx < len(notes):
                note = notes[idx]
                if note.hit or note.missed:
                    idx += 1
                    continue
                # Note is past the good window and wasn't hit
                if chart_time_s > note.time_s + GOOD_WINDOW_S:
                    note.missed = True
                    missed.append(note)
                    idx += 1
                else:
                    break
            self._head[lane] = idx
        return missed

    def try_hit(self, lane: int, chart_time_s: float) -> HitQuality | None:
        """
        Attempt to hit the nearest upcoming note in `lane`.

        Returns the HitQuality if hit, or None if no hittable note found.
        For open notes (lane=5) pass lane=5.
        """
        notes = self._by_lane.get(lane)
        if notes is None:
            return None

        idx = self._head[lane]
        # Walk forward to find first not-yet-resolved note in window
        for i in range(idx, len(notes)):
            note = notes[i]
            if note.hit or note.missed:
                continue
            delta = chart_time_s - note.time_s
            # Too early even for the good window
            if delta < -GOOD_WINDOW_S:
                break
            quality = _quality_for_delta(delta)
            if quality is not None:
                note.hit = True
                self.last_hit_note = note
                self._head[lane] = i + 1
                return quality
        return None

    def remaining_notes(self) -> list[Note]:
        """All notes that haven't been hit or missed yet."""
        result = []
        for lane, notes in self._by_lane.items():
            for note in notes[self._head[lane]:]:
                if not note.hit and not note.missed:
                    result.append(note)
        return result

    def is_finished(self) -> bool:
        """True when all notes have been hit or missed."""
        return all(
            idx >= len(notes)
            for lane, notes in self._by_lane.items()
            for idx in [self._head[lane]]
        )
