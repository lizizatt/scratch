"""Smoke tests: CLI gcode and melody-optimize commands."""
import json
import sys
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
# Prefer calibration GCODE; fallback to Bench.gcode
GCODE_FILE = ROOT / "data" / "ground_truth" / "calibration.gcode"
if not GCODE_FILE.exists():
    GCODE_FILE = ROOT / "data" / "Bench.gcode"


@pytest.fixture(scope="module")
def run_cli():
    """Run cli.py from gcode_music directory."""
    def _run(*args):
        # Python 3.6: use stdout/stderr PIPE and universal_newlines (no capture_output/text)
        proc = subprocess.run(
            [sys.executable, str(ROOT / "cli.py")] + list(args),
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            timeout=120,
        )
        return proc.returncode, proc.stdout, proc.stderr
    return _run


@pytest.mark.skipif(not GCODE_FILE.exists(), reason="No calibration.gcode or Bench.gcode")
def test_gcode_command_produces_midi(run_cli, tmp_path):
    """cli gcode ... -o out.mid exits 0 and creates a non-empty MIDI file."""
    out_mid = tmp_path / "out.mid"
    code, out, err = run_cli("gcode", str(GCODE_FILE), "-o", str(out_mid), "--min-duration", "0.01")
    assert code == 0, f"stdout: {out}\nstderr: {err}"
    assert out_mid.exists(), f"Expected {out_mid} to exist. stderr: {err}"
    assert out_mid.stat().st_size > 0, "MIDI file should be non-empty"


@pytest.mark.skipif(not GCODE_FILE.exists(), reason="No calibration.gcode or Bench.gcode")
def test_gcode_command_note_count_sanity(run_cli, tmp_path):
    """GCODE pipeline produces a plausible number of notes."""
    out_mid = tmp_path / "out.mid"
    code, out, err = run_cli("gcode", str(GCODE_FILE), "-o", str(out_mid))
    assert code == 0, err
    import mido
    mid = mido.MidiFile(str(out_mid))
    note_events = sum(1 for track in mid.tracks for msg in track if msg.type in ("note_on", "note_off"))
    assert note_events >= 2, "Expected at least one note on+off"
    # Sanity: not millions of events (would indicate a bug)
    assert note_events < 500_000, "Note count suspiciously high"


@pytest.mark.skipif(not GCODE_FILE.exists(), reason="No calibration.gcode or Bench.gcode")
def test_melody_optimize_smoke(run_cli, tmp_path):
    """melody-optimize: output exists, same move count, some F values changed."""
    # Build a melody that matches the start of the print (so we get at least one region)
    sys.path.insert(0, str(ROOT))
    from gcode_analyzer import GCodeParser, MovementAnalyzer
    from models import TimingParams
    from segment_notes import segments_to_notes

    parser = GCodeParser()
    parser.parse_file(str(GCODE_FILE))
    analyzer = MovementAnalyzer(parser.commands)
    timing = TimingParams(default_acceleration=10000.0, time_scale=1.0)
    segments = analyzer.segment_movements(timing)
    print_notes = segments_to_notes(segments)
    if len(print_notes) < 2:
        pytest.skip("Need at least 2 segments")
    # Melody with pitches shifted so optimizer will output different F (same duration)
    melody = [
        {"midi_note": min(127, n.midi_note + 2), "start_sec": n.start_sec, "duration_sec": n.duration_sec}
        for n in print_notes[:3]
    ]
    melody_path = tmp_path / "melody.json"
    melody_path.write_text(json.dumps(melody), encoding="utf-8")
    out_gcode = tmp_path / "out.gcode"

    code, out, err = run_cli(
        "melody-optimize", str(GCODE_FILE), str(melody_path), "-o", str(out_gcode), "--min-score", "0.3"
    )
    assert code == 0, f"stdout: {out}\nstderr: {err}"
    assert out_gcode.exists(), f"Expected {out_gcode}. stderr: {err}"
    assert out_gcode.stat().st_size > 0, "Output GCODE should be non-empty"

    # Parse output and original; command count should match
    orig_parser = GCodeParser()
    orig_parser.parse_file(str(GCODE_FILE))
    out_parser = GCodeParser()
    out_parser.parse_file(str(out_gcode))
    assert len(out_parser.commands) == len(orig_parser.commands), "Move count should be unchanged"

    # We matched a region and rewrote F to higher pitch -> at least one F should differ
    orig_f = [c.f for c in orig_parser.commands if c.f is not None]
    out_f = [c.f for c in out_parser.commands if c.f is not None]
    assert orig_f != out_f, "Expected some F change when region matches a different-pitch melody"
