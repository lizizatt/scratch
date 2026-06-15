"""
CLI for melody-matching GCODE optimization.

Goal: take a print GCODE + target melodies → produce modified GCODE that
sounds like the melodies without disrupting the print. See MELODY_GCODE_OPTIMIZATION.md.
"""

import argparse
import sys
from pathlib import Path


def cmd_gcode(args):
    """GCODE → segments → notes → MIDI (for debugging / dry-run)."""
    from gcode_analyzer import (
        GCodeParser,
        MovementAnalyzer,
        FrequencyAnalyzer,
        ChordDetector,
    )
    from midi_io import save_midi_notes

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: File not found: {input_path}")
        return False

    output_path = Path(args.output) if args.output else input_path.with_suffix(".mid")

    print(f"Parsing GCODE: {input_path}")
    parser = GCodeParser()
    commands = parser.parse_file(str(input_path))
    print(f"Parsed {len(commands)} commands")

    analyzer = MovementAnalyzer(commands)
    timing_params = None
    if args.timing_params:
        import json
        from models import TimingParams
        p = Path(args.timing_params)
        if p.exists():
            with open(p) as f:
                d = json.load(f)
            timing_params = TimingParams(
                time_scale=d.get("time_scale", 1.0),
                time_offset=d.get("time_offset", 0.0),
                default_acceleration=d.get("default_acceleration", 10000.0),
                max_acceleration=d.get("max_acceleration", 20000.0),
                accel_distance_threshold=d.get("accel_distance_threshold", 5.0),
            )
    segments = analyzer.segment_movements(timing_params)
    print(f"Segments: {len(segments)}")

    freq_analyzer = FrequencyAnalyzer()
    if args.params:
        import json
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
    from models import TimingParams
    from gcode_analyzer import GCodeParser, MovementAnalyzer
    from melody_loader import load_melody
    from segment_notes import segments_to_notes
    from region_finder import find_regions
    from f_optimizer import optimize_region_feedrates
    from gcode_writer import write_gcode

    gcode_path = Path(args.gcode)
    if not gcode_path.exists():
        print(f"Error: GCODE not found: {gcode_path}")
        return False
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
    from models import TimingParams
    from gcode_analyzer import GCodeParser, MovementAnalyzer, FrequencyAnalyzer
    from audio_simulator import segments_to_wav

    gcode_path = Path(args.gcode)
    if not gcode_path.exists():
        print(f"Error: GCODE not found: {gcode_path}")
        return False
    out_path = Path(args.output) if args.output else gcode_path.with_suffix(".wav")

    print(f"Parsing GCODE: {gcode_path}")
    parser = GCodeParser()
    commands = parser.parse_file(str(gcode_path))
    analyzer = MovementAnalyzer(commands)
    timing = TimingParams(default_acceleration=10000.0, time_scale=1.0)
    segments = analyzer.segment_movements(timing)
    print(f"Segments: {len(segments)}")

    freq = FrequencyAnalyzer()
    if getattr(args, "params", None):
        import json
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
  gcode            Parse GCODE and emit MIDI (debug / dry-run).
  melody-optimize  Print GCODE + melodies → modified GCODE (match regions, adjust F).
  simulate         GCODE → simulated audio WAV (A/B original vs optimized by ear).
        """,
    )
    sub = parser.add_subparsers(dest="command")

    # gcode
    p = sub.add_parser("gcode", help="GCODE → MIDI (segments as notes)")
    p.add_argument("input", help="Input .gcode file")
    p.add_argument("-o", "--output", help="Output .mid file")
    p.add_argument("--chords", action="store_true", help="Enable chord detection")
    p.add_argument("--min-duration", type=float, default=0.01, help="Min note duration (s)")
    p.add_argument("--params", help="JSON: feedrate→freq mapping (min/max_feedrate, min/max_freq)")
    p.add_argument("--timing-params", help="JSON: time_scale, time_offset, acceleration")
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
        print("\nInterrupted")
        return 1
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
