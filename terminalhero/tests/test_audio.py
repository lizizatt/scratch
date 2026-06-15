"""
Tests for game.audio.AudioPlayer.

pygame.mixer is mocked out entirely so tests run without hardware/audio.
time.perf_counter is patched so we can simulate elapsed time instantly.
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock, patch, call
import pytest

# Patch pygame before the module is imported so we never touch real hardware.
pygame_mock = MagicMock()
pygame_mock.get_init.return_value = True
pygame_mock.mixer.get_init.return_value = True
pygame_mock.mixer.music = MagicMock()

import sys
sys.modules.setdefault('pygame', pygame_mock)

from game.audio import AudioPlayer  # noqa: E402 (must come after sys.modules patch)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class FakeClock:
    """
    A controllable stand-in for time.perf_counter.

    Usage:
        clock = FakeClock(start=0.0)
        with patch('game.audio.time') as t:
            t.perf_counter.side_effect = clock
            clock.advance(5.0)
    """
    def __init__(self, start: float = 0.0) -> None:
        self._t = start

    def __call__(self) -> float:
        return self._t

    def advance(self, seconds: float) -> None:
        self._t += seconds

    def set(self, t: float) -> None:
        self._t = t


@pytest.fixture()
def clock():
    return FakeClock()


@pytest.fixture()
def player(clock):
    """AudioPlayer with pygame and perf_counter mocked, clock at t=0."""
    pygame_mock.mixer.music.reset_mock()
    with patch('game.audio.time') as t:
        t.perf_counter.side_effect = clock
        p = AudioPlayer()
        p.load('fake.opus')
        yield p, clock


# ---------------------------------------------------------------------------
# Initial state
# ---------------------------------------------------------------------------

class TestInitialState:
    def test_not_playing_on_creation(self, clock):
        with patch('game.audio.time') as t:
            t.perf_counter.side_effect = clock
            p = AudioPlayer()
            assert not p.is_playing

    def test_not_paused_on_creation(self, clock):
        with patch('game.audio.time') as t:
            t.perf_counter.side_effect = clock
            p = AudioPlayer()
            assert not p.is_paused

    def test_get_pos_s_zero_before_play(self, clock):
        with patch('game.audio.time') as t:
            t.perf_counter.side_effect = clock
            p = AudioPlayer()
            assert p.get_pos_s() == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# load()
# ---------------------------------------------------------------------------

class TestLoad:
    def test_load_calls_mixer_load(self, player):
        p, _ = player
        pygame_mock.mixer.music.load.assert_called_once_with('fake.opus')

    def test_load_accepts_pathlib_path(self, clock):
        from pathlib import Path
        with patch('game.audio.time') as t:
            t.perf_counter.side_effect = clock
            p = AudioPlayer()
            p.load(Path('fake.opus'))
            pygame_mock.mixer.music.load.assert_called_with('fake.opus')


# ---------------------------------------------------------------------------
# play()
# ---------------------------------------------------------------------------

class TestPlay:
    def test_play_calls_mixer_play(self, player):
        p, clock = player
        pygame_mock.mixer.music.reset_mock()
        p.play()
        pygame_mock.mixer.music.play.assert_called_once()

    def test_is_playing_after_play(self, player):
        p, clock = player
        p.play()
        assert p.is_playing

    def test_not_paused_after_play(self, player):
        p, clock = player
        p.play()
        assert not p.is_paused

    def test_pos_is_zero_immediately_after_play(self, player):
        p, clock = player
        p.play()
        assert p.get_pos_s() == pytest.approx(0.0)

    def test_pos_advances_with_time(self, player):
        p, clock = player
        p.play()
        clock.advance(3.5)
        assert p.get_pos_s() == pytest.approx(3.5)

    def test_play_without_load_raises(self, clock):
        with patch('game.audio.time') as t:
            t.perf_counter.side_effect = clock
            p = AudioPlayer()
            with pytest.raises(RuntimeError):
                p.play()

    def test_replay_resets_position(self, player):
        p, clock = player
        p.play()
        clock.advance(10.0)
        # restart
        p.play()
        assert p.get_pos_s() == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# pause() / unpause()
# ---------------------------------------------------------------------------

class TestPauseUnpause:
    def test_is_paused_after_pause(self, player):
        p, clock = player
        p.play()
        clock.advance(1.0)
        p.pause()
        assert p.is_paused

    def test_is_not_playing_while_paused(self, player):
        p, clock = player
        p.play()
        p.pause()
        assert not p.is_playing

    def test_pos_does_not_advance_while_paused(self, player):
        p, clock = player
        p.play()
        clock.advance(2.0)
        p.pause()
        pos_at_pause = p.get_pos_s()
        clock.advance(99.0)   # simulate a long pause
        assert p.get_pos_s() == pytest.approx(pos_at_pause)

    def test_pos_continues_after_unpause(self, player):
        p, clock = player
        p.play()
        clock.advance(2.0)   # 2 s of playback
        p.pause()
        clock.advance(5.0)   # 5 s paused (should not count)
        p.unpause()
        clock.advance(1.0)   # 1 s more playback
        assert p.get_pos_s() == pytest.approx(3.0)

    def test_double_pause_is_noop(self, player):
        p, clock = player
        p.play()
        clock.advance(1.0)
        p.pause()
        clock.advance(2.0)
        p.pause()            # second pause should not reset pause_wall
        clock.advance(3.0)
        p.unpause()
        p.get_pos_s()        # should not raise

    def test_unpause_resumes_is_playing(self, player):
        p, clock = player
        p.play()
        p.pause()
        p.unpause()
        assert p.is_playing
        assert not p.is_paused

    def test_pause_calls_mixer_pause(self, player):
        p, clock = player
        p.play()
        pygame_mock.mixer.music.reset_mock()
        p.pause()
        pygame_mock.mixer.music.pause.assert_called_once()

    def test_unpause_calls_mixer_unpause(self, player):
        p, clock = player
        p.play()
        p.pause()
        pygame_mock.mixer.music.reset_mock()
        p.unpause()
        pygame_mock.mixer.music.unpause.assert_called_once()

    def test_multiple_pause_unpause_cycles(self, player):
        p, clock = player
        p.play()
        clock.advance(1.0)   # t=1 playing
        p.pause()
        clock.advance(10.0)  # t=11 paused
        p.unpause()
        clock.advance(2.0)   # t=13 playing → chart pos = 3
        p.pause()
        clock.advance(10.0)  # t=23 paused
        p.unpause()
        clock.advance(0.5)   # t=23.5 playing → chart pos = 3.5
        assert p.get_pos_s() == pytest.approx(3.5)


# ---------------------------------------------------------------------------
# stop()
# ---------------------------------------------------------------------------

class TestStop:
    def test_stop_calls_mixer_stop(self, player):
        p, clock = player
        p.play()
        pygame_mock.mixer.music.reset_mock()
        p.stop()
        pygame_mock.mixer.music.stop.assert_called_once()

    def test_not_playing_after_stop(self, player):
        p, clock = player
        p.play()
        p.stop()
        assert not p.is_playing

    def test_pos_is_zero_after_stop(self, player):
        p, clock = player
        p.play()
        clock.advance(5.0)
        p.stop()
        assert p.get_pos_s() == pytest.approx(0.0)

    def test_stop_while_paused(self, player):
        p, clock = player
        p.play()
        clock.advance(2.0)
        p.pause()
        p.stop()
        assert not p.is_playing
        assert not p.is_paused
