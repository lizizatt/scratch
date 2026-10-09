"""
CLI for melody-matching GCODE optimization.

Goal: take a print GCODE + target melodies → produce modified GCODE that
sounds like the melodies without disrupting the print. See MELODY_GCODE_OPTIMIZATION.md.
"""

import argparse
import hashlib
import json
import math
import sys
from dataclasses import asdict, fields
from pathlib import Path


def _load_json_object(path):
    def reject_constant(value):
        raise ValueError(f"Invalid JSON number: {value}")

    with Path(path).open(encoding="utf-8") as source:
        data = json.load(source, parse_constant=reject_constant)
    if not isinstance(data, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return data


def _load_timing(path):
    from models import TimingParams

    if path is None:
        return TimingParams()
    return TimingParams.from_dict(_load_json_object(path))


def _load_context(path):
    from motion_timeline import ExecutionContext

    data = _load_json_object(path)
    unknown = set(data) - {field.name for field in fields(ExecutionContext)}
    if unknown:
        raise ValueError("Unknown execution context fields: " + ", ".join(sorted(unknown)))

    def finite_number(value):
        return type(value) in (int, float) and math.isfinite(value)

    xyz = data.get("initial_xyz_mm")
    if xyz is not None:
        if not isinstance(xyz, list) or len(xyz) != 3 or not all(map(finite_number, xyz)):
            raise ValueError("initial_xyz_mm must be an array of three finite numbers")
        data["initial_xyz_mm"] = tuple(xyz)
    for key in ("initial_e_mm", "feedrate_mm_min"):
        if data.get(key) is not None and not finite_number(data[key]):
            raise ValueError(f"{key} must be a finite number")
    for key in ("units", "xyz_mode", "e_mode"):
        if data.get(key) is not None and not isinstance(data[key], str):
            raise ValueError(f"{key} must be a string or null")
    return ExecutionContext(**data)


def _protect_output(output, *inputs):
    if output is None:
        return
    output = Path(output)
    for source in inputs:
        if source is None:
            continue
        source = Path(source)
        if (output.resolve() == source.resolve()
                or (output.exists() and source.exists() and output.samefile(source))):
            raise ValueError(f"Output and input refer to the same file: {source}")


def _warn_legacy_assumptions():
    print(
        "Warning: legacy commands assume zero origin, mm units, and absolute XYZ/E; "
        "timing and feedrate-to-sound mapping are an uncalibrated heuristic, "
        "not firmware-accurate simulation.",
        file=sys.stderr,
    )


def cmd_timeline(args):
    """Emit a provenance-bearing offline report, including incomplete predictions."""
    from gcode_source import parse_source
    from motion_timeline import ExecutionContext, build_timeline

    input_path = Path(args.input)
    _protect_output(args.output, input_path, args.context, args.timing_params)
    raw = input_path.read_bytes()
    timing = _load_timing(args.timing_params)
    if args.context:
        context = _load_context(args.context)
    else:
        context = ExecutionContext.known_origin() if args.assume_origin else ExecutionContext()
    timeline = build_timeline(parse_source(raw), timing, context)
    counts = {status: sum(entry.status == status for entry in timeline.support_report)
              for status in ("modeled", "irrelevant", "unsupported")}
    timed_events = sum(event.end_time_s is not None for event in timeline.events)
    report = {
        "schema_version": 1,
        "source": {
            "path": str(input_path),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "size_bytes": len(raw),
        },
        "profile": {
            "label": "Uncalibrated commanded-motion approximation; not firmware accurate",
            "calibrated": False,
            "firmware_accurate": False,
            "timing_params": asdict(timing),
        },
        "coverage": {
            "source_records": len(timeline.support_report),
            **counts,
            "timed_events": timed_events,
            "untimed_events": len(timeline.events) - timed_events,
        },
        "timeline": asdict(timeline),
    }
    rendered = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.output:
        Path(args.output).write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    if not timeline.complete:
        print("Incomplete prediction: " + "; ".join(timeline.diagnostics), file=sys.stderr)
    return timeline.complete


def cmd_gcode(args):
    """GCODE → segments → notes → MIDI (for debugging / dry-run)."""
    _warn_legacy_assumptions()
    from gcode_analyzer import (
        GCodeParser,
        MovementAnalyzer,
        FrequencyAnalyzer,
        ChordDetector,
    )
    from midi_io import save_midi_notes

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: File not found: {input_path}", file=sys.stderr)
        return False

    output_path = Path(args.output) if args.output else input_path.with_suffix(".mid")
    _protect_output(output_path, input_path, args.timing_params, args.params)
    timing_params = _load_timing(args.timing_params)

    print(f"Parsing GCODE: {input_path}")
    parser = GCodeParser()
    commands = parser.parse_file(str(input_path))
    print(f"Parsed {len(commands)} commands")

    analyzer = MovementAnalyzer(commands)
    segments = analyzer.segment_movements(timing_params)
    print(f"Segments: {len(segments)}")

    freq_analyzer = FrequencyAnalyzer()
    if args.params:
        p = Path(args.params)
        if p.exists():
            with open(p) as f:
                d = json.load(f)
            freq_analyzer.min_feedrate = d.get("min_feedrate", freq_analyzer.min_feedrate)
            freq_analyzer.max_feedrate = d.get("max_feedrate", freq_analyzer.max_feedrate)
            freq_analyzer.min_freq = d.get("min_freq", freq_analyzer.min_freq)
            freq_analyzer.max_freq = d.get("max_freq", freq_analyzer.max_freq)

    if args.chords:
        notes = ChordDetector(freq_analyzer).detect_chords(segments)
    else:
        notes = []
        for seg in segments:
            n = freq_analyzer.analyze_segment(seg)
            if n and (n.end_time - n.start_time) >= args.min_duration:
                notes.append(n)
    notes = [n for n in notes if (n.end_time - n.start_time) >= args.min_duration]
    print(f"Notes: {len(notes)}")

    save_midi_notes(notes, str(output_path))
    print(f"MIDI: {output_path}")
    return True


def cmd_melody_optimize(args):
    """Optimize print GCODE to match target melodies (output = modified GCODE)."""
    _warn_legacy_assumptions()
    from models import TimingParams
    from gcode_analyzer import GCodeParser, MovementAnalyzer
    from melody_loader import load_melody
    from segment_notes import segments_to_notes
    from region_finder import find_regions
    from f_optimizer import optimize_region_feedrates
    from gcode_writer import write_gcode

    gcode_path = Path(args.gcode)
    if not gcode_path.exists():
        print(f"Error: GCODE not found: {gcode_path}", file=sys.stderr)
        return False
    _protect_output(args.output, gcode_path, *args.melodies)
    min_score = getattr(args, "min_score", 0.5)

    print(f"Parsing GCODE: {gcode_path}")
    parser = GCodeParser()
    commands = parser.parse_file(str(gcode_path))
    analyzer = MovementAnalyzer(commands)
    timing = TimingParams(default_acceleration=10000.0, time_scale=1.0)
    segments = analyzer.segment_movements(timing)
    print_notes = segments_to_notes(segments)
    print(f"Segments: {len(segments)}, notes: {len(print_notes)}")

    melodies = []
    for p in args.melodies:
        path = Path(p)
        if not path.exists():
            print(f"Warning: melody file not found: {path}")
            continue
        melodies.append(load_melody(path))
    if not melodies:
        print("Error: no melody files loaded")
        return False
    print(f"Loaded {len(melodies)} melodies")

    step = getattr(args, "step", 1)
    regions = find_regions(print_notes, melodies, min_score=min_score, step=step)
    print(f"Regions above threshold: {len(regions)}")

    segment_index_to_new_f = {}
    for start, melody_id, score in regions:
        target = melodies[melody_id]
        end = start + len(target)
        if end > len(segments):
            continue
        region_segments = segments[start:end]
        new_f_list = optimize_region_feedrates(region_segments, target)
        for i, f in enumerate(new_f_list):
            seg_i = start + i
            if seg_i not in segment_index_to_new_f:
                segment_index_to_new_f[seg_i] = f

    write_gcode(commands, segments, segment_index_to_new_f, args.output)
    print(f"Wrote {len(segment_index_to_new_f)} segment F updates to {args.output}")
    return True


def cmd_simulate(args):
    """GCODE → simulated audio WAV (for A/B testing original vs optimized by ear)."""
    _warn_legacy_assumptions()
    from models import TimingParams
    from gcode_analyzer import GCodeParser, MovementAnalyzer, FrequencyAnalyzer
    from audio_simulator import segments_to_wav

    gcode_path = Path(args.gcode)
    if not gcode_path.exists():
        print(f"Error: GCODE not found: {gcode_path}", file=sys.stderr)
        return False
    out_path = Path(args.output) if args.output else gcode_path.with_suffix(".wav")
    _protect_output(out_path, gcode_path, args.params)

    print(f"Parsing GCODE: {gcode_path}")
    parser = GCodeParser()
    commands = parser.parse_file(str(gcode_path))
    analyzer = MovementAnalyzer(commands)
    timing = TimingParams(default_acceleration=10000.0, time_scale=1.0)
    segments = analyzer.segment_movements(timing)
    print(f"Segments: {len(segments)}")

    freq = FrequencyAnalyzer()
    if getattr(args, "params", None):
        p = Path(args.params)
        if p.exists():
            with open(p) as f:
                d = json.load(f)
            freq.min_feedrate = d.get("min_feedrate", freq.min_feedrate)
            freq.max_feedrate = d.get("max_feedrate", freq.max_feedrate)
            freq.min_freq = d.get("min_freq", freq.min_freq)
            freq.max_freq = d.get("max_freq", freq.max_freq)

    max_duration = getattr(args, "max_duration", None)
    segments_to_wav(segments, str(out_path), freq_analyzer=freq, max_duration_sec=max_duration)
    print(f"WAV: {out_path}")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Melody-matching GCODE: nudge print GCODE so it sounds like target melodies.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
    timeline         Report offline motion timing and whole-file support coverage as JSON.
  gcode            Parse GCODE and emit MIDI (debug / dry-run).
  melody-optimize  Print GCODE + melodies → modified GCODE (match regions, adjust F).
  simulate         GCODE → simulated audio WAV (A/B original vs optimized by ear).
        """,
    )
    sub = parser.add_subparsers(dest="command")

    t = sub.add_parser("timeline", help="Offline motion timeline JSON (not firmware accurate)")
    t.add_argument("input", help="Input .gcode file")
    t.add_argument("-o", "--output", help="Output JSON file (default: stdout)")
    context = t.add_mutually_exclusive_group()
    context.add_argument("--assume-origin", action="store_true", help="Assume zero origin, mm, absolute XYZ/E")
    context.add_argument("--context", help="ExecutionContext JSON; omitted fields remain unknown")
    t.add_argument("--timing-params", help="Version 2 timing JSON with acceleration_units=mm/s^2")
    t.set_defaults(func=cmd_timeline)

    # gcode
    p = sub.add_parser("gcode", help="GCODE → MIDI (segments as notes)")
    p.add_argument("input", help="Input .gcode file")
    p.add_argument("-o", "--output", help="Output .mid file")
    p.add_argument("--chords", action="store_true", help="Enable chord detection")
    p.add_argument("--min-duration", type=float, default=0.01, help="Min note duration (s)")
    p.add_argument("--params", help="JSON: feedrate→freq mapping (min/max_feedrate, min/max_freq)")
    p.add_argument("--timing-params", help="Version 2 timing JSON with acceleration_units=mm/s^2")
    p.set_defaults(func=cmd_gcode)

    # melody-optimize
    q = sub.add_parser("melody-optimize", help="Print GCODE + melodies → modified GCODE")
    q.add_argument("gcode", help="Print GCODE file")
    q.add_argument("melodies", nargs="+", help="Target melody files (.mid or .json)")
    q.add_argument("-o", "--output", required=True, help="Output modified .gcode file")
    q.add_argument("--min-score", type=float, default=0.5, help="Min similarity to apply melody (0–1)")
    q.add_argument("--step", type=int, default=1, help="Sliding window step (use 10+ for large GCODE to speed up)")
    q.set_defaults(func=cmd_melody_optimize)

    # simulate (GCODE → WAV)
    r = sub.add_parser("simulate", help="GCODE → simulated audio WAV for A/B testing")
    r.add_argument("gcode", help="Input .gcode file")
    r.add_argument("-o", "--output", help="Output .wav file (default: input with .wav)")
    r.add_argument("--max-duration", type=float, default=None, metavar="SEC", help="Only first SEC seconds (saves memory on long prints)")
    r.add_argument("--params", help="JSON: feedrate→freq mapping (min/max_feedrate, min/max_freq)")
    r.set_defaults(func=cmd_simulate)

    args = parser.parse_args()
    if not getattr(args, "func", None):
        parser.print_help()
        return 1
    try:
        return 0 if args.func(args) else 1
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
