#!/usr/bin/env python3
"""Run tests without pytest (avoids plugin/env conflicts)."""
import sys
import tempfile
from pathlib import Path

# Run from gcode_music directory
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

def run():
    failed = []
    # test_gcode_analyzer
    from tests import test_gcode_analyzer
    for name in ["test_parse_minimal_gcode", "test_feedrate_to_frequency_bounds",
                 "test_frequency_to_midi_roundtrip", "test_segment_movements_minimal"]:
        try:
            getattr(test_gcode_analyzer, name)()
            print(f"  PASS {name}")
        except Exception as e:
            print(f"  FAIL {name}: {e}")
            failed.append(name)
    # test_parse_file_returns_commands needs tmp_path
    try:
        with tempfile.TemporaryDirectory() as d:
            class T:
                input = str(Path(d) / "minimal.gcode")
            Path(d).joinpath("minimal.gcode").write_text("G1 X0 Y0 F300\nG1 X10 Y0 F600\n")
            # tmp_path is the directory
            class TmpPath(Path):
                pass
            tmp_path = Path(d)
            test_gcode_analyzer.test_parse_file_returns_commands(tmp_path)
        print("  PASS test_parse_file_returns_commands")
    except Exception as e:
        print(f"  FAIL test_parse_file_returns_commands: {e}")
        failed.append("test_parse_file_returns_commands")

    # test_midi_io
    from tests import test_midi_io
    for name in ["test_ticks_per_second", "test_note_dataclass"]:
        try:
            getattr(test_midi_io, name)()
            print(f"  PASS {name}")
        except Exception as e:
            print(f"  FAIL {name}: {e}")
            failed.append(name)
    try:
        with tempfile.TemporaryDirectory() as d:
            test_midi_io.test_midi_roundtrip(Path(d))
        print("  PASS test_midi_roundtrip")
    except Exception as e:
        print(f"  FAIL test_midi_roundtrip: {e}")
        failed.append("test_midi_roundtrip")

    # test_cli_smoke (skip if no GCODE fixture)
    from tests import test_cli_smoke
    gcode_file = ROOT / "data" / "ground_truth" / "calibration.gcode"
    if not gcode_file.exists():
        gcode_file = ROOT / "data" / "Bench.gcode"
    if gcode_file.exists():
        try:
            run_cli = test_cli_smoke.run_cli()
            with tempfile.TemporaryDirectory() as d:
                out = Path(d) / "out.mid"
                code, _, err = run_cli("gcode", str(gcode_file), "-o", str(out), "--min-duration", "0.01")
                assert code == 0, err
                assert out.exists()
            print("  PASS test_gcode_command_produces_midi")
        except Exception as e:
            print(f"  FAIL test_gcode_command_produces_midi: {e}")
            failed.append("test_gcode_command_produces_midi")
        try:
            run_cli = test_cli_smoke.run_cli()
            with tempfile.TemporaryDirectory() as d:
                out = Path(d) / "out.mid"
                code, _, err = run_cli("gcode", str(gcode_file), "-o", str(out))
                assert code == 0, err
                import mido
                mid = mido.MidiFile(str(out))
                events = sum(1 for t in mid.tracks for m in t if m.type in ("note_on", "note_off"))
                assert events >= 2
                assert events < 500_000
            print("  PASS test_gcode_command_note_count_sanity")
        except Exception as e:
            print(f"  FAIL test_gcode_command_note_count_sanity: {e}")
            failed.append("test_gcode_command_note_count_sanity")
    else:
        print("  SKIP test_gcode_command_* (no calibration.gcode or Bench.gcode)")

    print()
    if failed:
        print(f"FAILED: {len(failed)} test(s) - {failed}")
        return 1
    print("All tests passed.")
    return 0

if __name__ == "__main__":
    sys.exit(run())
