"""Audible contracts exercised through lossless source parsing and real planning."""

import hashlib
import wave

import numpy as np
import pytest

from gcode_source import parse_source
from motion_planner import PlannerConfig, plan_motion
from motion_timeline import ExecutionContext
from motor_audio import AudioProfile, render_audio


def planned(text, acceleration=1000):
    return plan_motion(parse_source(text.encode()), ExecutionContext.known_origin(),
                       PlannerConfig(default_acceleration_mm_s2=acceleration))


def pcm(path):
    with wave.open(str(path), 'rb') as source:
        assert (source.getnchannels(), source.getsampwidth()) == (1, 2)
        return np.frombuffer(source.readframes(source.getnframes()), dtype='<i2').copy(), source.getframerate()


def dominant(samples, rate):
    spectrum = abs(np.fft.rfft(samples * np.hanning(len(samples))))
    return np.fft.rfftfreq(len(samples), 1 / rate)[np.argmax(spectrum)]


def test_public_render_pure_x_pitch_and_report(tmp_path):
    path = tmp_path / 'tone.wav'
    result = render_audio(planned('G1 X100 F3000'), path,
                          AudioProfile(harmonic_weights=(1,), voice_gains=(1, 0, 0, 0)),
                          sample_rate=8000, fans=False)
    samples, rate = pcm(path)
    assert dominant(samples[2000:10000], rate) == pytest.approx(400, abs=1)
    assert result['frames'] == 16400
    assert result['duration_sec'] == pytest.approx(2.05)
    assert result['clipped_samples'] == 0
    assert result['profile']['calibrated'] is False
    assert result['sha256'] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert 0 < result['peak'] < 1


def test_fan_only_dwell_spins_up_down_and_aliases_default_to_p1(tmp_path):
    text = 'G4 S0.1\nM106 S255\nG4 S1\nM107 P1\nG4 S2'
    path = tmp_path / 'fan.wav'
    report = render_audio(planned(text), path, sample_rate=8000, motors=False)
    samples, _ = pcm(path)
    assert not np.any(samples[:800])
    rms = lambda a: np.sqrt(np.mean(a.astype(float) ** 2))
    assert rms(samples[6000:8000]) > 3 * rms(samples[800:1200])
    assert rms(samples[-2000:]) < rms(samples[6000:8000]) / 10
    assert report['peak'] > 0
    explicit = tmp_path / 'explicit.wav'
    render_audio(planned(text.replace('M106 S', 'M106 P1 S')), explicit,
                 sample_rate=8000, motors=False)
    assert path.read_bytes() == explicit.read_bytes()


def test_diagonal_has_one_stationary_belt_and_expected_pitch(tmp_path):
    output = tmp_path / 'diag.wav'
    render_audio(planned('G1 X100 Y100 F4242.640687119286'), output,
                 AudioProfile(harmonic_weights=(1,)), sample_rate=8000,
                 stems_dir=tmp_path / 'stems')
    a, rate = pcm(tmp_path / 'stems/A.wav')
    b, _ = pcm(tmp_path / 'stems/B.wav')
    assert dominant(a[2000:10000], rate) == pytest.approx(800, abs=1)
    assert not np.any(b)


def test_y_motion_does_not_cancel_ab_and_e_only_is_audible(tmp_path):
    for name, text in [('y', 'G1 Y100 F3000'), ('e', 'G1 E10 F600')]:
        path = tmp_path / (name + '.wav')
        render_audio(planned(text), path, sample_rate=8000, stems_dir=tmp_path / name)
        samples, _ = pcm(path)
        assert np.max(abs(samples.astype(int))) > 100
    for name in ('A', 'B', 'Z'):
        assert not np.any(pcm(tmp_path / 'e' / (name + '.wav'))[0])
    assert np.any(pcm(tmp_path / 'e/E.wav')[0])


def test_ramp_pitch_increases_and_stopped_motors_are_silent(tmp_path):
    path = tmp_path / 'ramp.wav'
    plan = planned('G1 X200 F6000\nG4 S0.5', acceleration=100)
    render_audio(plan, path, AudioProfile(harmonic_weights=(1,), voice_gains=(1, 0, 0, 0)),
                 sample_rate=8000, fans=False)
    samples, rate = pcm(path)
    assert dominant(samples[800:1600], rate) == pytest.approx(120, abs=20)
    assert dominant(samples[4800:5600], rate) == pytest.approx(520, abs=20)
    assert not np.any(samples[-4000:])


def test_reversal_has_same_pitch_magnitude_and_continuous_position_phase(tmp_path):
    path = tmp_path / 'reverse.wav'
    render_audio(planned('G1 X100 F3000\nG1 X0'), path,
                 AudioProfile(harmonic_weights=(1,), voice_gains=(1, 0, 0, 0)),
                 sample_rate=8000, fans=False)
    samples, rate = pcm(path)
    assert dominant(samples[2000:10000], rate) == pytest.approx(400, abs=1)
    assert dominant(samples[18400:26400], rate) == pytest.approx(400, abs=1)
    # Reversing the same geometric trajectory retraces the same signed phase.
    np.testing.assert_allclose(samples[1:16400], samples[32799:16400:-1], atol=1)


def test_collinear_split_and_chunk_equivalence(tmp_path):
    texts = ['G1 X100 E10 F6000', '\n'.join(f'G1 X{x} E{x / 10} F6000' for x in range(1, 101))]
    outputs = []
    for i, text in enumerate(texts):
        path = tmp_path / f'{i}.wav'
        render_audio(planned(text), path, sample_rate=8000, chunk_size=97 if i else 8192)
        outputs.append(pcm(path)[0])
    np.testing.assert_allclose(*outputs, atol=1)


def test_seeded_noise_chunks_and_source_toggles_preserve_other_stems(tmp_path):
    plan = planned('M106 S128\nM106 P2 S200\nG1 X70 F3000\nM106 P3 S255\n'
                   'G4 S0.2\nM107\nG1 Y20 F1200\nM107 P2\nG4 S0.4')
    reports = []
    for name, chunk, motors, fans in [('all', 8192, True, True), ('chunk', 137, True, True),
                                      ('fan_only', 333, False, True), ('motor_only', 73, True, False)]:
        reports.append(render_audio(plan, tmp_path / (name + '.wav'), sample_rate=8000,
                                    chunk_size=chunk, motors=motors, fans=fans, stems_dir=tmp_path / name))
    assert (tmp_path / 'all.wav').read_bytes() == (tmp_path / 'chunk.wav').read_bytes()
    for name in ('A', 'B', 'Z', 'E', 'motors'):
        assert (tmp_path / 'all' / (name + '.wav')).read_bytes() == (tmp_path / 'motor_only' / (name + '.wav')).read_bytes()
    assert (tmp_path / 'all/fans.wav').read_bytes() == (tmp_path / 'fan_only/fans.wav').read_bytes()
    assert (tmp_path / 'all/mix.wav').read_bytes() == (tmp_path / 'all.wav').read_bytes()
    assert all(report['clipped_samples'] == 0 for report in reports)
    mix = pcm(tmp_path / 'all.wav')[0].astype(int)
    motor = pcm(tmp_path / 'all/motors.wav')[0].astype(int)
    fan = pcm(tmp_path / 'all/fans.wav')[0].astype(int)
    np.testing.assert_allclose(mix, motor + fan, atol=1)


def test_harmonics_above_nyquist_are_suppressed(tmp_path):
    path = tmp_path / 'bandlimited.wav'
    # Fundamental 800 Hz remains; 1600+ Hz harmonics are above 1 kHz Nyquist.
    render_audio(planned('G1 X100 F6000'), path,
                 AudioProfile(harmonic_weights=(1, 1, 1, 1), voice_gains=(1, 0, 0, 0)),
                 sample_rate=2000, fans=False)
    samples, _ = pcm(path)
    spectrum = abs(np.fft.rfft(samples[200:1800]))
    assert spectrum[320] < spectrum[640] / 100  # No 1600 -> 400 Hz folded harmonic.


def test_peak_clipping_count_and_fixed_gain(tmp_path):
    plan = planned('G1 X100 F3000')
    loud = AudioProfile(harmonic_weights=(1,), voice_gains=(4, 0, 0, 0), master_gain=1)
    path = tmp_path / 'loud.wav'
    report = render_audio(plan, path, loud, sample_rate=8000, fans=False)
    samples, _ = pcm(path)
    assert report['peak'] > 3
    assert report['clipped_samples'] == np.count_nonzero(abs(samples.astype(int)) == 32767)
    assert report['clipped_samples'] > 5000
    low = tmp_path / 'low.wav'
    high = tmp_path / 'high.wav'
    render_audio(plan, low, AudioProfile(master_gain=0.1), sample_rate=8000)
    render_audio(plan, high, AudioProfile(master_gain=0.2), sample_rate=8000)
    np.testing.assert_allclose(pcm(high)[0].astype(int), pcm(low)[0].astype(int) * 2, atol=1)


def test_empty_wait_and_duration_truncation(tmp_path):
    for name, text, frames in [('empty', '', 0), ('wait', 'G4 S0.5', 4000)]:
        path = tmp_path / (name + '.wav')
        report = render_audio(planned(text), path, sample_rate=8000)
        assert len(pcm(path)[0]) == frames
        assert report['peak'] == report['clipped_samples'] == 0
        assert not np.any(pcm(path)[0])
    path = tmp_path / 'clipped.wav'
    report = render_audio(planned('G1 X100 F3000'), path, sample_rate=8000, max_duration_sec=0.12345)
    assert len(pcm(path)[0]) == 987
    assert report['truncated']


@pytest.mark.parametrize('kwargs', [
    {'sample_rate': True}, {'sample_rate': -1}, {'chunk_size': 0}, {'chunk_size': True},
    {'max_duration_sec': 0}, {'max_duration_sec': -1}, {'max_duration_sec': float('nan')},
    {'max_duration_sec': float('inf')}, {'max_duration_sec': True}, {'motors': 1}, {'profile': {}},
])
def test_bad_render_config_preserves_destination(tmp_path, kwargs):
    path = tmp_path / 'existing.wav'
    path.write_bytes(b'keep me')
    with pytest.raises(ValueError):
        render_audio(planned('G4 S1'), path, **kwargs)
    assert path.read_bytes() == b'keep me'


@pytest.mark.parametrize('data', [
    {}, {'schema_version': True, 'calibrated': False}, {'schema_version': 1, 'calibrated': True},
    {'schema_version': 1, 'calibrated': 0},
    {'schema_version': 1, 'calibrated': False, 'measured': True},
    {'schema_version': 1, 'calibrated': False, 'acoustic_cycles_per_mm': [8, 8, True, 8]},
    {'schema_version': 1, 'calibrated': False, 'harmonic_weights': []},
    {'schema_version': 1, 'calibrated': False, 'master_gain': -1},
    {'schema_version': 1, 'calibrated': False, 'fan_level': float('nan')},
    {'schema_version': 1, 'calibrated': False, 'seed': True},
])
def test_profile_strict_validation(data):
    with pytest.raises(ValueError):
        AudioProfile.from_dict(data)


def test_unknown_fan_index_rejected_even_when_disabled_or_clipped(tmp_path):
    path = tmp_path / 'existing.wav'
    path.write_bytes(b'keep')
    for fans in (False, True):
        with pytest.raises(ValueError, match='fan index'):
            render_audio(planned('G4 S1\nM106 P9 S200'), path, fans=fans, max_duration_sec=0.1)
    assert path.read_bytes() == b'keep'


def test_renderer_checks_stem_collisions_before_any_write(tmp_path):
    existing = tmp_path / 'A.wav'
    existing.write_bytes(b'keep')
    with pytest.raises(ValueError, match='alias'):
        render_audio(planned('G4 S1'), existing, stems_dir=tmp_path)
    assert existing.read_bytes() == b'keep'
    assert not (tmp_path / 'B.wav').exists()


def test_truncated_samples_match_full_render_and_near_end_is_reported(tmp_path):
    plan = planned('M106 S200\nG1 X100 F3000\nG1 Y10')
    full, short = tmp_path / 'full.wav', tmp_path / 'short.wav'
    render_audio(plan, full, sample_rate=8000)
    render_audio(plan, short, sample_rate=8000, max_duration_sec=0.251, chunk_size=31)
    np.testing.assert_array_equal(pcm(full)[0][:2008], pcm(short)[0])
    report = render_audio(plan, short, sample_rate=8000,
                          max_duration_sec=plan.total_duration_s - 0.5 / 8000)
    assert report['truncated'] is True


def test_audio_sampler_only_receives_bounded_chunks(tmp_path, monkeypatch):
    import motor_audio
    real_sampler = motor_audio.sample_motion
    calls = []

    def bounded_sampler(plan, times):
        calls.append(len(times))
        assert len(times) <= 71
        return real_sampler(plan, times)

    monkeypatch.setattr(motor_audio, 'sample_motion', bounded_sampler)
    render_audio(planned('G1 X10 F600\nM106 S100\nG4 S1'), tmp_path / 'chunks.wav',
                 sample_rate=8000, chunk_size=71)
    assert len(calls) > 200


def test_empty_stems_and_zero_frame_fraction_are_valid_wavs(tmp_path):
    report = render_audio(planned(''), tmp_path / 'empty.wav', stems_dir=tmp_path / 'stems')
    assert report['frames'] == 0
    for name, info in report['stems'].items():
        assert len(pcm(tmp_path / 'stems' / (name + '.wav'))[0]) == 0
        assert info['peak'] == info['clipped_samples'] == 0
    tiny = render_audio(planned('G4 S1'), tmp_path / 'tiny.wav', max_duration_sec=1e-8)
    assert tiny['frames'] == 0


def test_different_seed_changes_only_fans(tmp_path):
    plan = planned('M106 S200\nG1 X10 F600')
    for seed in (1, 2):
        render_audio(plan, tmp_path / f'{seed}.wav', AudioProfile(seed=seed),
                     sample_rate=8000, stems_dir=tmp_path / str(seed))
    assert (tmp_path / '1/fans.wav').read_bytes() != (tmp_path / '2/fans.wav').read_bytes()
    assert (tmp_path / '1/motors.wav').read_bytes() == (tmp_path / '2/motors.wav').read_bytes()


def test_wav_size_limit_rejects_before_opening(tmp_path):
    path = tmp_path / 'existing.wav'
    path.write_bytes(b'keep')
    with pytest.raises(ValueError, match='RIFF'):
        render_audio(planned('G4 S1000000000'), path)
    assert path.read_bytes() == b'keep'
