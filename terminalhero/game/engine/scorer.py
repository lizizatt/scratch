"""
Scoring logic for TerminalHero.

Tracks score, streak, multiplier, and note result counts.
Completely stateless with respect to time — the game loop calls record_hit/
record_miss and reads state back.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto


class HitQuality(Enum):
    PERFECT = auto()
    GOOD = auto()
    MISS = auto()


# Points awarded per hit quality (before multiplier)
BASE_POINTS: dict[HitQuality, int] = {
    HitQuality.PERFECT: 100,
    HitQuality.GOOD: 50,
    HitQuality.MISS: 0,
}

# Multiplier thresholds: streak of N → multiplier value
# min(4, 1 + streak // 10)
MAX_MULTIPLIER = 4


@dataclass
class Scorer:
    """Mutable scoring state for a single song run."""

    score: int = 0
    streak: int = 0
    max_streak: int = 0
    perfect_count: int = 0
    good_count: int = 0
    miss_count: int = 0

    @property
    def multiplier(self) -> int:
        return min(MAX_MULTIPLIER, 1 + self.streak // 10)

    @property
    def total_notes(self) -> int:
        return self.perfect_count + self.good_count + self.miss_count

    @property
    def hit_count(self) -> int:
        return self.perfect_count + self.good_count

    @property
    def hit_percent(self) -> float:
        if self.total_notes == 0:
            return 0.0
        return self.hit_count / self.total_notes * 100.0

    @property
    def grade(self) -> str:
        """Letter grade based on hit percentage."""
        pct = self.hit_percent
        if pct >= 95:
            return 'S'
        if pct >= 80:
            return 'A'
        if pct >= 65:
            return 'B'
        if pct >= 50:
            return 'C'
        return 'F'

    def record_hit(self, quality: HitQuality) -> int:
        """
        Record a hit result.  Returns the points awarded this note.
        """
        points = BASE_POINTS[quality] * self.multiplier

        if quality == HitQuality.PERFECT:
            self.perfect_count += 1
            self.streak += 1
        elif quality == HitQuality.GOOD:
            self.good_count += 1
            self.streak += 1
        elif quality == HitQuality.MISS:
            self.miss_count += 1
            self.streak = 0

        self.score += points
        if self.streak > self.max_streak:
            self.max_streak = self.streak

        return points

    def reset(self) -> None:
        """Reset all state (e.g. on song restart)."""
        self.score = 0
        self.streak = 0
        self.max_streak = 0
        self.perfect_count = 0
        self.good_count = 0
        self.miss_count = 0
