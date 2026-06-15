from dataclasses import dataclass, field


@dataclass
class Note:
    """A single note event parsed from a .chart file."""
    tick: int
    lane: int           # 0-4 = frets 1-5, 5 = open note
    sustain_ticks: int
    time_s: float       # pre-computed absolute time in seconds
    is_hopo: bool = False
    is_tap: bool = False
    hit: bool = field(default=False, compare=False, repr=False)
    missed: bool = field(default=False, compare=False, repr=False)
    sustain_end_s: float = field(default=0.0, compare=False, repr=False)

    def __post_init__(self) -> None:
        # Default sustain_end_s to time_s for notes without a sustain tail.
        # chart_parser sets it explicitly for sustained notes.
        if self.sustain_end_s == 0.0:
            self.sustain_end_s = self.time_s

    @property
    def is_open(self) -> bool:
        return self.lane == 5

    def fret_number(self) -> int | None:
        """1-based fret number, or None for open notes."""
        if self.is_open:
            return None
        return self.lane + 1
