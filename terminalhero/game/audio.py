"""
Audio playback wrapper for TerminalHero.

Uses pygame.mixer for playback.  Exposes a simple interface so the rest of
the game doesn't need to know about pygame details.

pygame.mixer.music.get_pos() returns milliseconds elapsed since playback
started (or -1 if not playing). We convert to seconds and offset by any
pause time so callers always get a monotonic "chart time" in seconds.
"""

from __future__ import annotations

import time
from pathlib import Path

import pygame


class AudioPlayer:
    """
    Wraps pygame.mixer.music for .opus/.ogg/.mp3 playback.

    Usage
    -----
        player = AudioPlayer()
        player.load('song.opus')
        player.play()
        pos = player.get_pos_s()   # seconds since start
        player.pause()
        player.unpause()
        player.stop()
    """

    def __init__(self) -> None:
        if not pygame.get_init():
            pygame.init()
        if not pygame.mixer.get_init():
            pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=512)

        self._loaded: bool = False
        self._playing: bool = False
        self._paused: bool = False
        self._start_wall: float = 0.0      # wall-clock time when play() was called
        self._pause_wall: float = 0.0      # wall-clock time when pause() was called
        self._paused_accum: float = 0.0    # total seconds spent paused

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def load(self, path: str | Path) -> None:
        """Load an audio file.  Must be called before play()."""
        pygame.mixer.music.load(str(path))
        self._loaded = True
        self._reset_timers()

    def play(self, offset_s: float = 0.0) -> None:
        """
        Start playback.

        Args:
            offset_s: Start position in seconds.  pygame passes this to
                      Mix_PlayMusic as a seek offset, which works correctly
                      for .ogg and .opus files.
        """
        if not self._loaded:
            raise RuntimeError("No audio loaded; call load() first.")
        self._reset_timers()
        pygame.mixer.music.play(start=offset_s)
        self._start_wall = time.perf_counter()
        self._playing = True
        self._paused = False

    def pause(self) -> None:
        """Pause playback. No-op if already paused or not playing."""
        if self._playing and not self._paused:
            pygame.mixer.music.pause()
            self._pause_wall = time.perf_counter()
            self._paused = True

    def unpause(self) -> None:
        """Resume playback after a pause."""
        if self._playing and self._paused:
            # Capture the resume time BEFORE calling unpause() so that any
            # latency inside pygame (buffer refill, device reconnect, etc.)
            # is not incorrectly charged to _paused_accum.  If it were after,
            # _paused_accum would be too large and get_pos_s() would return a
            # value behind the actual audio position (audio sounds ahead of notes).
            resume_wall = time.perf_counter()
            pygame.mixer.music.unpause()
            self._paused_accum += resume_wall - self._pause_wall
            self._paused = False

    def stop(self) -> None:
        """Stop playback and reset state."""
        pygame.mixer.music.stop()
        self._playing = False
        self._paused = False
        self._reset_timers()

    def get_pos_s(self) -> float:
        """
        Return the current chart time in seconds (wall-clock based).

        Returns 0.0 if not playing.  Continues to return the last position
        while paused (does not advance).
        """
        if not self._playing:
            return 0.0
        elapsed = time.perf_counter() - self._start_wall - self._paused_accum
        if self._paused:
            # Don't advance while paused
            elapsed = self._pause_wall - self._start_wall - self._paused_accum
        return max(0.0, elapsed)

    @property
    def is_playing(self) -> bool:
        return self._playing and not self._paused

    @property
    def is_paused(self) -> bool:
        return self._playing and self._paused

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _reset_timers(self) -> None:
        self._start_wall = 0.0
        self._pause_wall = 0.0
        self._paused_accum = 0.0

    def __del__(self) -> None:
        try:
            pygame.mixer.music.stop()
        except Exception:
            pass
