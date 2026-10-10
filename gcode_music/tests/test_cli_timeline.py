"""Subprocess contracts for offline timeline reports and legacy CLI adapters."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent


def run_cli(*args):
    return subprocess.run(
        [sys.executable, str(ROOT / "cli.py"), *map(str, args)],
        cwd=ROOT, capture_output=True, text=True, timeout=120,
    )


def test_timeline_explicit_origin_json_and_source_preservation(tmp_path):
    source = tmp_path / "snippet.gcode"
    raw = b"; preserve bytes \xff\r\nG1 X10 F600\r\n"
    source.write_bytes(raw)
    timing = tmp_path / "timing.json"
    timing.write_text(json.dumps({
        "schema_version": 2, "acceleration_units": "mm/s^2",
        "default_acceleration": 100,
    }))

    proc = run_cli("timeline", source, "--assume-origin", "--timing-params", timing)

    assert proc.returncode == 0, proc.stderr
    report = json.loads(proc.stdout)
    assert report["timeline"]["complete"] is True
    assert report["timeline"]["total_duration_s"] == pytest.approx(1.1)
    assert report["timeline"]["context"]["initial_xyz_mm"] == [0, 0, 0]
    assert report["source"]["sha256"] == hashlib.sha256(raw).hexdigest()
    assert report["profile"]["calibrated"] is False
    assert report["profile"]["firmware_accurate"] is False
    assert "uncalibrated" in report["profile"]["label"].lower()
    assert report["coverage"]["modeled"] == 1
    assert report["coverage"]["irrelevant"] == 1
    assert source.read_bytes() == raw


@pytest.mark.parametrize("write_report", [False, True])
def test_unknown_default_writes_incomplete_report(tmp_path, write_report):
    source = tmp_path / "snippet.gcode"
    source.write_text("G1 X10 F600\nG1 X20\n")
    output = tmp_path / "report.json"
    proc = run_cli("timeline", source, *(["-o", output] if write_report else []))
    assert proc.returncode == 1, proc.stderr
    report = json.loads(output.read_text() if write_report else proc.stdout)
    if write_report:
        assert proc.stdout == ""
    timeline = report["timeline"]
    assert timeline["complete"] is False
    assert timeline["total_duration_s"] is None
    assert timeline["known_prefix_duration_s"] == 0
    assert all(value is None for value in timeline["context"].values())
    assert all(event["start_time_s"] is None for event in timeline["events"])
    assert report["coverage"]["modeled"] == 2
    assert report["coverage"]["timed_events"] == 0
    assert "Incomplete prediction" in proc.stderr


@pytest.mark.parametrize("stop", ["M109 S200", "M190 S60", "M622 J1"])
def test_unknown_operation_stops_times_but_not_support_coverage(tmp_path, stop):
    source = tmp_path / "snippet.gcode"
    raw = f"G1 X10 F600\n{stop}\nG1 X20\nM623\n; tail\n".encode()
    source.write_bytes(raw)
    output = tmp_path / "report.json"
    proc = run_cli("timeline", source, "--assume-origin", "-o", output)
    assert proc.returncode == 1, proc.stderr
    assert proc.stdout == ""
    report = json.loads(output.read_text())
    timeline = report["timeline"]
    assert not timeline["complete"]
    assert timeline["total_duration_s"] is None
    assert timeline["known_prefix_duration_s"] > 0
    assert len(timeline["support_report"]) == 5
    assert report["coverage"]["modeled"] == 2
    assert report["coverage"]["unsupported"] == 2
    for event in timeline["events"][1:]:
        for field in ("start_time_s", "end_time_s", "duration_s", "end_xyz_mm"):
            assert event[field] is None
    assert source.read_bytes() == raw


def test_context_supplies_nonzero_position_and_modal_feedrate(tmp_path):
    source = tmp_path / "snippet.gcode"
    source.write_text("G1 X20\n")
    context = tmp_path / "context.json"
    context.write_text(json.dumps({
        "initial_xyz_mm": [10, 0, 0], "xyz_mode": "absolute",
        "units": "mm", "feedrate_mm_min": 600,
    }))
    proc = run_cli("timeline", source, "--context", context)
    assert proc.returncode == 0, proc.stderr
    timeline = json.loads(proc.stdout)["timeline"]
    assert timeline["events"][0]["start_xyz_mm"] == [10, 0, 0]
    assert timeline["events"][0]["distance_xyz_mm"] == 10
    assert timeline["context"]["initial_e_mm"] is None
    proc = run_cli("timeline", source, "--context", context, "--assume-origin")
    assert proc.returncode != 0
    assert proc.stdout == ""
    assert "not allowed" in proc.stderr


@pytest.mark.parametrize("context_json", [
    "[]", "null", '{"unexpected": 0}', '{"initial_xyz_mm": true}',
    '{"initial_xyz_mm": [0, 0]}', '{"initial_xyz_mm": "000"}',
    '{"initial_xyz_mm": [false, 0, 0]}', '{"initial_xyz_mm": ["0", 0, 0]}',
    '{"initial_xyz_mm": [0, Infinity, 0]}', '{"initial_e_mm": true}',
    '{"initial_e_mm": "0"}', '{"initial_e_mm": NaN}',
    '{"feedrate_mm_min": false}', '{"feedrate_mm_min": 0}',
    '{"feedrate_mm_min": -1}', '{"feedrate_mm_min": "600"}',
    '{"feedrate_mm_min": 1e999}', '{"units": 1}', '{"xyz_mode": []}',
    '{"e_mode": "ABSOLUTE"}', '{"xyz_mode": true}',
])
def test_context_rejects_invalid_keys_types_and_numbers(tmp_path, context_json):
    source = tmp_path / "snippet.gcode"
    source.write_text("G4 S1\n")
    context = tmp_path / "context.json"
    context.write_text(context_json)
    output = tmp_path / "report.json"
    output.write_text("previous report")
    proc = run_cli("timeline", source, "--context", context, "-o", output)
    assert proc.returncode != 0
    assert proc.stdout == ""
    assert "Error:" in proc.stderr
    assert output.read_text() == "previous report"


@pytest.mark.parametrize("protected", ["source", "context", "timing"])
@pytest.mark.parametrize("alias", ["same", "resolved", "symlink", "hardlink"])
def test_timeline_rejects_output_aliases_before_writing(tmp_path, protected, alias):
    source = tmp_path / "snippet.gcode"
    source.write_text("G4 S1\n")
    context = tmp_path / "context.json"
    context.write_text("{}")
    timing = tmp_path / "timing.json"
    timing.write_text('{"schema_version": 2, "acceleration_units": "mm/s^2"}')
    target = {"source": source, "context": context, "timing": timing}[protected]
    original = target.read_bytes()
    output = target
    if alias == "resolved":
        (tmp_path / "child").mkdir()
        output = tmp_path / "child" / ".." / target.name
    elif alias in ("symlink", "hardlink"):
        output = tmp_path / "alias.json"
        if alias == "symlink":
            output.symlink_to(target)
        else:
            output.hardlink_to(target)
    proc = run_cli("timeline", source, "--context", context,
                   "--timing-params", timing, "-o", output)
    assert proc.returncode != 0
    assert proc.stdout == ""
    assert "same file" in proc.stderr.lower()
    assert target.read_bytes() == original
