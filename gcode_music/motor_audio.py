"""Streaming, uncalibrated offline ABZE audition; never a printer sound prediction.

Phase is deliberately SIGNED cumulative sampler displacement, not a reset per
move or a sampled-velocity integral. Reversals run phase backwards continuously;
audible frequency is abs(velocity) * assumed acoustic_cycles_per_mm. These are
acoustic cycles, NOT measured steps/mm. Fixed distinct AB phases/gains avoid
accidental identical-voice cancellation. No normalization is applied.
"""

from contextlib import ExitStack
from dataclasses import asdict, dataclass, fields
import hashlib
import math
from pathlib import Path
import wave

import numpy as np

from models import _is_finite_number
from motion_planner import MotionPlan, sample_motion


@dataclass(frozen=True)
class AudioProfile:
    """Schema 1 toy acoustics. Gains/weights are linear, never dB or measured SPL.

    Default master gain leaves headroom; user gains can deliberately clip and
    clipping is reported before PCM quantization. Fan frequencies are illustrative
    full-duty blade tones, not known P1S RPM. Fans start at zero in this model.
    """

    schema_version: int = 1
    calibrated: bool = False
    acoustic_cycles_per_mm: tuple[float, float, float, float] = (8.0, 8.0, 40.0, 8.0)
    harmonic_weights: tuple[float, ...] = (1.0, 0.32, 0.12, 0.06)
    voice_gains: tuple[float, float, float, float] = (0.65, 0.53, 0.35, 0.4)
    master_gain: float = 0.18
    amplitude_speed_mm_s: float = 4.0
    fan_level: float = 0.12
    fan_frequencies_hz: tuple[float, float, float] = (180.0, 125.0, 95.0)
    fan_time_constant_sec: float = 0.35
    fan_noise_mix: float = 0.55
    seed: int = 0

    def __post_init__(self):
        if type(self.schema_version) is not int or self.schema_version != 1:
            raise ValueError('AudioProfile requires schema_version=1')
        if self.calibrated is not False:
            raise ValueError('Only calibrated=false profiles are supported')
        vectors = {
            'acoustic_cycles_per_mm': (4, 1e6, True),
            'harmonic_weights': (None, 1.0, False),
            'voice_gains': (4, 4.0, False),
            'fan_frequencies_hz': (3, 20000.0, True),
        }
        for name, (size, upper, positive) in vectors.items():
            value = getattr(self, name)
            if (not isinstance(value, (tuple, list)) or not 1 <= len(value) <= 32
                    or (size is not None and len(value) != size)):
                raise ValueError(f'{name} has invalid length')
            for number in value:
                self._number(name, number, upper, positive)
            object.__setattr__(self, name, tuple(value))
        for name, upper, positive in (
            ('master_gain', 1.0, False), ('amplitude_speed_mm_s', 1e6, True),
            ('fan_level', 4.0, False), ('fan_time_constant_sec', 3600.0, True),
            ('fan_noise_mix', 1.0, False),
        ):
            self._number(name, getattr(self, name), upper, positive)
        if type(self.seed) is not int or not 0 <= self.seed <= 2**32 - 1:
            raise ValueError('seed must be an integer in [0, 2**32-1]')

    @staticmethod
    def _number(name, value, upper, positive):
        if (not _is_finite_number(value) or value < 0 or value > upper
                or (positive and value == 0)):
            bound = '(0' if positive else '[0'
            raise ValueError(f'{name} must be finite, non-boolean and in {bound}, {upper}]')

    @classmethod
    def from_dict(cls, data: dict) -> 'AudioProfile':
        """Require explicit version and uncalibrated status; reject extra metadata."""
        if not isinstance(data, dict):
            raise ValueError('Audio profile must be an object')
        unknown = data.keys() - {field.name for field in fields(cls)}
        if unknown:
            raise ValueError('Unknown audio profile fields: ' + ', '.join(sorted(map(str, unknown))))
        if 'schema_version' not in data or 'calibrated' not in data:
            raise ValueError('Require schema_version=1 and calibrated=false')
        return cls(**data)


STEM_NAMES = ('A', 'B', 'Z', 'E', 'fans', 'motors', 'mix')


def audio_output_paths(path, stems_dir=None) -> dict[str, Path]:
    """Enumerate every WAV destination before writes; stems have stable names."""
    result = {'output': Path(path)}
    if stems_dir is not None:
        result.update({name: Path(stems_dir) / (name + '.wav') for name in STEM_NAMES})
    return result


def protect_audio_paths(outputs, inputs=()) -> None:
    """Reject aliases (including hardlinks), directory/file conflicts, and nesting.

    Preflight only: this is not protection against concurrent filesystem changes.
    Existing unrelated output files may be overwritten.
    """
    outputs = [Path(path) for path in outputs]
    inputs = [Path(path) for path in inputs if path is not None]
    for i, output in enumerate(outputs):
        if output.exists() and not output.is_file():
            raise ValueError(f'Output is not a regular file: {output}')
        for parent in output.parents:
            if parent.exists() and not parent.is_dir():
                raise ValueError(f'Output parent is not a directory: {parent}')
        resolved = output.resolve()
        for other in [*inputs, *outputs[:i]]:
            target = other.resolve()
            if (resolved == target or resolved in target.parents or target in resolved.parents
                    or (output.exists() and other.exists() and output.samefile(other))):
                raise ValueError(f'Audio path alias or conflict: {output} and {other}')


def _taper(frequency, sample_rate):
    # Unity below 75% Nyquist; a raised cosine reaches zero at 95% Nyquist.
    fraction = np.clip((frequency / (sample_rate / 2) - 0.75) / 0.20, 0, 1)
    return 0.5 * (1 + np.cos(np.pi * fraction))


def _motor_chunk(plan, times, profile, sample_rate):
    displacement, velocity = sample_motion(plan, times)
    speed = np.abs(velocity)
    frequency = speed * profile.acoustic_cycles_per_mm
    phase = np.remainder(displacement * profile.acoustic_cycles_per_mm
                         + (0.0, 0.173, 0.317, 0.461), 1.0)
    voices = np.zeros_like(displacement)
    for harmonic, weight in enumerate(profile.harmonic_weights, 1):
        voices += (weight * _taper(frequency * harmonic, sample_rate)
                   * np.sin(2 * np.pi * harmonic * phase))
    amplitude = speed / (speed + profile.amplitude_speed_mm_s)
    return voices * amplitude * profile.voice_gains


class _FanBed:
    """Analytic first-order duty response, with one independent RNG per source.

    Knots store (time, target, current level, integrated level). Evaluating the
    analytic integral at absolute sample times avoids chunk-dependent phase or
    filter accumulation. Noise is bounded uniform white noise, not a recording.
    """

    def __init__(self, plan, profile):
        self.profile = profile
        self.rngs = [np.random.default_rng(np.random.SeedSequence([profile.seed, i]))
                     for i in (1, 2, 3)]
        knots = [[(0.0, 0.0, 0.0, 0.0)] for _ in range(3)]
        tau = profile.fan_time_constant_sec
        for event in plan.events:
            if event.kind != 'fan':
                continue
            fan = event.state_changes['fan']
            index = 1 if fan['index'] == 'default' else fan['index']
            if type(index) is not int or index not in (1, 2, 3):
                raise ValueError(f"Unsupported illustrative fan index {fan['index']!r} at line {event.source_line}")
            time = event.start_time_s
            source = knots[index - 1]
            previous, target, level, integral = source[-1]
            dt = time - previous
            decay = math.exp(-dt / tau)
            integral += target * dt + (level - target) * tau * -math.expm1(-dt / tau)
            level = target + (level - target) * decay
            source.append((time, fan['duty'] / 255, level, integral))
        self.knots = [np.asarray(source) for source in knots]

    def sample(self, times, sample_rate):
        result = np.zeros(len(times))
        profile = self.profile
        tau = profile.fan_time_constant_sec
        for i, knots in enumerate(self.knots):
            rows = knots[np.searchsorted(knots[:, 0], times, side='right') - 1]
            dt = times - rows[:, 0]
            target, initial, integral = rows[:, 1], rows[:, 2], rows[:, 3]
            level = target + (initial - target) * np.exp(-dt / tau)
            travel = integral + target * dt + (initial - target) * tau * -np.expm1(-dt / tau)
            base = profile.fan_frequencies_hz[i]
            phase = np.remainder(base * travel + (i + 1) * 0.137, 1)
            tone = np.sin(2 * np.pi * phase) * _taper(base * level, sample_rate)
            noise = self.rngs[i].uniform(-1.0, 1.0, len(times))
            result += (profile.fan_level * level
                       * ((1 - profile.fan_noise_mix) * tone + profile.fan_noise_mix * noise))
        return result


def _validate_render(plan, profile, sample_rate, max_duration_sec, chunk_size, motors, fans):
    if not isinstance(plan, MotionPlan):
        raise ValueError('plan must be a complete MotionPlan from plan_motion')
    if not isinstance(profile, AudioProfile):
        raise ValueError('profile must be AudioProfile or None')
    profile.__post_init__()
    if type(sample_rate) is not int or not 1 <= sample_rate <= 384000:
        raise ValueError('sample_rate must be an integer in [1, 384000]')
    if type(chunk_size) is not int or chunk_size <= 0:
        raise ValueError('chunk_size must be a positive integer')
    if type(motors) is not bool or type(fans) is not bool:
        raise ValueError('motors and fans must be booleans')
    duration = plan.total_duration_s
    if not _is_finite_number(duration) or duration < 0:
        raise ValueError('plan duration must be finite and nonnegative')
    if max_duration_sec is not None:
        if not _is_finite_number(max_duration_sec) or max_duration_sec <= 0:
            raise ValueError('max_duration_sec must be finite and positive')
        duration = min(duration, max_duration_sec)
    count = duration * sample_rate
    if not math.isfinite(count) or count > (2**32 - 37) // 2:
        raise ValueError('PCM16 RIFF duration exceeds 4 GiB WAV limit; use max_duration_sec')
    nearest = round(count)
    return nearest if abs(count - nearest) < 1e-7 else math.floor(count)


def render_audio(plan, path, profile=None, sample_rate=48000, max_duration_sec=None,
                 chunk_size=8192, motors=True, fans=True, stems_dir=None) -> dict:
    """Write mono PCM16 WAV in bounded chunks and return a JSON-ready report.

    Frames are floor(min(plan duration, max duration) * rate), snapping only
    sub-1e-7-frame arithmetic error. No tail is appended. Optional A/B/Z/E,
    fans, motors and mix stems ALL use the same fixed master gain. Disabled
    sources produce silent stems. peak/clipped_samples describe pre-quantized
    samples (abs > 1 clips); sha256 hashes each entire finalized WAV.
    truncated means the requested duration limit is below the plan duration,
    even if the difference is smaller than a single sample frame.
    """
    profile = AudioProfile() if profile is None else profile
    frames = _validate_render(plan, profile, sample_rate, max_duration_sec, chunk_size, motors, fans)
    fan_bed = _FanBed(plan, profile)  # Validate the full fan schedule, even when muted/truncated.
    paths = audio_output_paths(path, stems_dir)
    protect_audio_paths(paths.values())
    stats = {name: {'path': str(dest), 'peak': 0.0, 'clipped_samples': 0}
             for name, dest in paths.items()}
    with ExitStack() as stack:
        writers = {}
        for name, dest in paths.items():
            dest.parent.mkdir(parents=True, exist_ok=True)
            writer = stack.enter_context(wave.open(str(dest), 'wb'))
            writer.setparams((1, 2, sample_rate, frames, 'NONE', 'not compressed'))
            writer.writeframesraw(b'')  # Even an empty plan needs a complete header.
            writers[name] = writer
        for start in range(0, frames, chunk_size):
            times = np.arange(start, min(frames, start + chunk_size), dtype=np.float64) / sample_rate
            voices = (_motor_chunk(plan, times, profile, sample_rate) if motors
                      else np.zeros((len(times), 4)))
            fan_audio = fan_bed.sample(times, sample_rate) if fans else np.zeros(len(times))
            motor_sum = voices.sum(axis=1)
            mixed = motor_sum + fan_audio
            sources = dict(zip(STEM_NAMES[:4], voices.T))
            sources.update(fans=fan_audio, motors=motor_sum, mix=mixed, output=mixed)
            for name, writer in writers.items():
                samples = sources[name] * profile.master_gain
                stats[name]['peak'] = max(stats[name]['peak'], float(np.max(np.abs(samples))))
                stats[name]['clipped_samples'] += int(np.count_nonzero(np.abs(samples) > 1))
                quantized = np.rint(np.clip(samples, -1, 1) * 32767).astype('<i2')
                writer.writeframesraw(quantized.tobytes())
    for name, dest in paths.items():
        with dest.open('rb') as source:
            stats[name]['sha256'] = hashlib.file_digest(source, 'sha256').hexdigest()
    return {
        'schema_version': 1, **stats['output'], 'frames': frames,
        'sample_rate': sample_rate, 'duration_sec': frames / sample_rate,
        'planned_duration_sec': plan.total_duration_s,
        'truncated': max_duration_sec is not None and max_duration_sec < plan.total_duration_s,
        'profile': asdict(profile), 'motors': motors, 'fans': fans,
        'stems': {name: info for name, info in stats.items() if name != 'output'},
        'assumptions': [
            'Offline uncalibrated audition, not actual stock P1S music or GCODE safety validation.',
            'Acoustic cycles/mm are assumed, not physical measured steps/mm.',
            'Signed cumulative displacement phase; magnitude of motor velocity sets pitch.',
            'Fixed gain across all files; no per-file normalization or measured SPL.',
            'All fans initially zero. Default M106/M107 aliases P1 only in this illustrative model.',
            'P1/P2/P3 have toy duty-to-frequency and noise responses; physical mapping and RPM unknown.',
            'No hotend/board fan, temperature acoustics, resonances, or stock noise compensation modeled.',
        ],
    }
