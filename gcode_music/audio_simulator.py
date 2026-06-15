"""
Simulate the audio that GCODE would produce when run on a printer.

Each movement segment becomes a tone: frequency from feedrate (via feedrate→frequency
mapping), duration from segment timing. Output is a WAV file so you can A/B compare
original vs optimized GCODE by ear.
"""

import math
import wave
from typing import List, Optional

import numpy as np


def segments_to_wav(
    segments: List,
    path_out: str,
    freq_analyzer: Optional[object] = None,
    sample_rate: int = 44100,
    amplitude: float = 0.3,
    fade_ms: float = 10.0,
    max_duration_sec: Optional[float] = None,
) -> None:
    """
    Render movement segments as a WAV: one tone per segment (frequency from F, duration from segment).

    Args:
        segments: List of MovementSegment (start_time, end_time, feedrate, ...).
        path_out: Output .wav path.
        freq_analyzer: Optional FrequencyAnalyzer for feedrate→frequency; default if None.
        sample_rate: WAV sample rate (Hz).
        amplitude: Peak amplitude 0–1 (before normalization).
        fade_ms: Fade in/out length in ms to avoid clicks.
        max_duration_sec: If set, only render segments starting before this time (saves memory on long prints).
    """
    if freq_analyzer is None:
        from gcode_analyzer import FrequencyAnalyzer
        freq_analyzer = FrequencyAnalyzer()

    fade_samples = max(1, int(sample_rate * (fade_ms / 1000.0)))
    # Precompute fade arrays once (was per-segment)
    fade_in = np.linspace(0, 1, fade_samples, dtype=np.float32)
    fade_out = np.linspace(1, 0, fade_samples, dtype=np.float32)

    total_duration = 0.0
    for seg in segments:
        if max_duration_sec is not None and seg.start_time >= max_duration_sec:
            break
        end = min(seg.end_time, max_duration_sec) if max_duration_sec else seg.end_time
        total_duration = max(total_duration, end)
    total_samples = int(math.ceil(total_duration * sample_rate))
    buf = np.zeros(total_samples, dtype=np.float32)  # float32 halves memory vs float64

    for seg in segments:
        if max_duration_sec is not None and seg.start_time >= max_duration_sec:
            break
        freq = freq_analyzer.feedrate_to_frequency(seg.feedrate)
        if freq <= 0:
            continue
        start = seg.start_time
        dur = seg.end_time - seg.start_time
        if max_duration_sec is not None and start + dur > max_duration_sec:
            dur = max_duration_sec - start
        if dur <= 0:
            continue
        start_samp = int(start * sample_rate)
        n_samp = int(dur * sample_rate)
        if n_samp <= 0:
            continue
        t = np.arange(n_samp, dtype=np.float32) / sample_rate
        tone = amplitude * np.sin(2.0 * math.pi * freq * t).astype(np.float32)
        if n_samp >= 2 * fade_samples:
            tone[:fade_samples] *= fade_in
            tone[-fade_samples:] *= fade_out
        else:
            tone *= np.hanning(n_samp).astype(np.float32)
        end_samp = min(start_samp + n_samp, total_samples)
        actual = end_samp - start_samp
        if actual > 0:
            buf[start_samp:end_samp] += tone[:actual]

    # Normalize to [-1, 1] then to 16-bit
    peak = float(np.abs(buf).max())
    if peak > 0:
        buf = buf / peak
    np.clip(buf, -1.0, 1.0, out=buf)
    samples_int16 = (buf * 32767).astype(np.int16)

    with wave.open(path_out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(samples_int16.tobytes())
