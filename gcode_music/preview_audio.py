"""Offline GCODE -> complete motion plan -> uncalibrated WAV and JSON sidecar.

Standalone: python preview_audio.py INPUT -o WAV --assume-origin
Use --context JSON instead for a different explicit initial execution context.
This never connects to hardware, modifies GCODE, or establishes printer safety.
"""

import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import sys

from cli import _load_context
from gcode_source import parse_source
from motion_planner import PlannerConfig, plan_motion
from motion_timeline import ExecutionContext
from motor_audio import AudioProfile, audio_output_paths, protect_audio_paths, render_audio


def _source_info(path, raw):
    return {'path': str(path), 'sha256': hashlib.sha256(raw).hexdigest(), 'size_bytes': len(raw)}


def _reject_constant(value):
    raise ValueError(f'Nonfinite JSON number: {value}')


def preview_gcode(input_path, output_path, context=None, profile_path=None,
                  max_duration_sec=None, *, sample_rate=48000, chunk_size=8192,
                  motors=True, fans=True, stems_dir=None, report_path=None,
                  config: PlannerConfig | None = None) -> dict:
    """Render the FULL supported input, clipping only the resulting audio duration.

    context: ExecutionContext, a context JSON path, or None (unknown initial
    state, never an implicit origin). config: PlannerConfig or None. profile_path:
    strict schema-1 uncalibrated JSON or None. report_path defaults to the WAV
    path with suffix '.json'; returns the same JSON-ready provenance report.

    All WAV/report/stem destinations are checked pairwise against one another
    and input/profile/context files before writing (resolved paths + hardlinks).
    Unrelated existing outputs may be overwritten. Preflight is not an atomic
    multi-file transaction or protection against concurrent filesystem changes.
    """
    input_path, output_path = Path(input_path), Path(output_path)
    sidecar = Path(report_path) if report_path is not None else output_path.with_suffix('.json')
    context_path = Path(context) if isinstance(context, (str, Path)) else None
    paths = audio_output_paths(output_path, stems_dir)
    protect_audio_paths([*paths.values(), sidecar], [input_path, profile_path, context_path])
    if context_path is not None:
        context = _load_context(context_path)
    elif context is None:
        context = ExecutionContext()
    elif not isinstance(context, ExecutionContext):
        raise ValueError('context must be ExecutionContext, JSON path, or None')
    profile = AudioProfile()
    profile_source = None
    if profile_path is not None:
        raw_profile = Path(profile_path).read_bytes()
        profile = AudioProfile.from_dict(json.loads(raw_profile, parse_constant=_reject_constant))
        profile_source = _source_info(profile_path, raw_profile)
    raw = input_path.read_bytes()
    plan = plan_motion(parse_source(raw), context=context, config=config)
    report = render_audio(plan, output_path, profile, sample_rate=sample_rate,
                          max_duration_sec=max_duration_sec, chunk_size=chunk_size,
                          motors=motors, fans=fans, stems_dir=stems_dir)
    report.update({
        'source': _source_info(input_path, raw),
        'profile_source': profile_source,
        'context': asdict(context),
        'context_path': str(context_path) if context_path is not None else None,
        'planner_config': asdict(plan.config),
        'planner_label': plan.label,
        'planner_diagnostics': list(plan.diagnostics),
        'firmware_accurate': False,
        'report_path': str(sidecar),
        'render_options': {'sample_rate': sample_rate, 'chunk_size': chunk_size,
                           'max_duration_sec': max_duration_sec, 'motors': motors, 'fans': fans,
                           'stems_dir': str(stems_dir) if stems_dir is not None else None},
    })
    # Round-trip makes tuple-bearing dataclasses match the on-disk JSON contract.
    serialized = json.dumps(report, indent=2, allow_nan=False) + '\n'
    sidecar.parent.mkdir(parents=True, exist_ok=True)
    sidecar.write_text(serialized, encoding='utf-8')
    return json.loads(serialized)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Offline uncalibrated P1S-reference audio audition; no hardware.')
    parser.add_argument('input', help='Full supported GCODE input; unsupported suffixes are rejected')
    parser.add_argument('-o', '--output', required=True, help='Mono PCM16 WAV output')
    context = parser.add_mutually_exclusive_group(required=True)
    context.add_argument('--assume-origin', action='store_true', help='Assume zero XYZ/E, mm, absolute modes; NOT homing')
    context.add_argument('--context', help='ExecutionContext JSON with explicit initial assumptions')
    parser.add_argument('--profile', help='Schema-1 calibrated=false audio profile JSON')
    parser.add_argument('--max-duration', type=float, help='Positive seconds, applied after full planning')
    parser.add_argument('--no-fans', action='store_true', help='Mute illustrative fans without renormalizing motors')
    parser.add_argument('--no-motors', action='store_true', help='Fan-only audition')
    parser.add_argument('--stems-dir', help='Also write A/B/Z/E/fans/motors/mix.wav at identical master gain')
    parser.add_argument('--report', help='JSON report path (default: output with .json suffix)')
    parser.add_argument('--sample-rate', type=int, default=48000)
    parser.add_argument('--chunk-size', type=int, default=8192)
    args = parser.parse_args(argv)
    try:
        report = preview_gcode(
            args.input, args.output,
            context=ExecutionContext.known_origin() if args.assume_origin else args.context,
            profile_path=args.profile, max_duration_sec=args.max_duration,
            sample_rate=args.sample_rate, chunk_size=args.chunk_size,
            motors=not args.no_motors, fans=not args.no_fans,
            stems_dir=args.stems_dir, report_path=args.report,
        )
    except (ValueError, OSError) as exc:
        print(f'Audio preview failed: {exc}', file=sys.stderr)
        return 1
    print(f"Uncalibrated offline audition: {args.output} ({report['duration_sec']:.3f}s); "
          f"peak={report['peak']:.4f}, clipped_samples={report['clipped_samples']}; "
          f"report={report['report_path']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
