"""Tests for GCODE → audio simulation (WAV)."""
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from gcode_analyzer import GCodeParser, MovementAnalyzer
from models import TimingParams
from audio_simulator import segments_to_wav


def test_simulate_produces_valid_wav(tmp_path):
    """Simulate calibration.gcode → WAV exists, valid header, non-zero frames."""
    gcode_path = ROOT / "data" / "ground_truth" / "calibration.gcode"
    if not gcode_path.exists():
        return
    parser = GCodeParser()
    parser.parse_file(str(gcode_path))
    analyzer = MovementAnalyzer(parser.commands)
    timing = TimingParams(default_acceleration=10000.0, time_scale=1.0)
    segments = analyzer.segment_movements(timing)
    wav_path = tmp_path / "out.wav"
    segments_to_wav(segments, str(wav_path))
    assert wav_path.exists()
    assert wav_path.stat().st_size > 0
    with wave.open(str(wav_path), "rb") as w:
        assert w.getnchannels() == 1
        assert w.getsampwidth() == 2
        assert w.getframerate() == 44100
        n = w.getnframes()
        assert n > 0
