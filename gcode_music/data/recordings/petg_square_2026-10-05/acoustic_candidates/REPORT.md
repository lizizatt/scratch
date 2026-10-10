# PETG acoustic candidates — fixed-offset diagnostics

**Exploratory only. No calibration, validation, default changes, or hardware actions.**

[Listen](index.html) · [Numerical JSON / hashes / profiles](report.json) · [Score plot](scores.svg)

## Frozen inputs and clocks

Original source: 157 moves, 31.082142345 s.
Recording: 57.066667 s, decoded mono 48000 Hz.
Recording seconds = local seconds + **12.15**, exactly **1215 hops / 583200 samples**.
The preserved analysis SHA256 is `d369b66d0fddb31208783ed8af31e80ace8381b352fa191159a4525cef0b215a`; it is checked against the original
manifest before the offset is read. Every original manifest artifact is checked.
The 8-cycle audition is byte-identical to the original baseline: `fbeaa6f1746e80a433eb76cf6950c5bf0437cd6e08a328174898762b7c7ebef2`.

## Decoded WAV playback copy

[Download decoded WAV playback copy](recording_playback.wav). The preview also links
the unchanged original AAC as a raw download; it is never an audio-player source.
Underlying AAC is still lossy; conversion cannot recover discarded detail.
This derived copy preserves the original end-trimmed file timeline with no new
trim, stretch, or normalization. Analysis continues to use the original f32 decode.

Conversion: Existing FFmpeg mono 48000 Hz f32le decode; promote to float64, numpy.rint(numpy.clip(samples, -1, 1) * 32767).astype(<i2); round nearest, ties to even; no gain normalization.
Format: mono 48000 Hz PCM16 WAV; **2739200 frames**,
57.066667 s.
Prequantization clipping count (decoded samples outside [-1, 1]):
**0**.
Playback SHA256: `3e2da3f366286e537217b6bf3e1fa3fc664ffd3b1f9f37626686030096dbfd89`.

## Acceleration-aware evidence

FFT windows: symmetric `numpy.hanning`, 4096 (85.333 ms) and 8192 (170.667 ms),
hop 480 (10 ms), local start 0. Only complete windows inside each named interval;
no padding, fractional shifts, or center-speed approximation. Bin frequencies
are selected inclusively from 100 through 2000 Hz (spacing 11.71875 / 5.859375 Hz).
Power = `abs(rfft(windowed_audio))**2`. Model weights = power / in-band frame sum.
Observed residual = `10*log10(power + 1e-20)` minus each frequency's regional time
median, then minus each frame's in-band median. Score = mean over valid frames of
sum over bins of model weight × observed residual. Positive/negative values are
arbitrary spectral contrast, not probabilities or fit errors.

Controls circularly roll model weights **and their validity mask** over all frame
positions inside the scored region, using 15 rounded equally spaced shifts from
ceil(10% of frames) through floor(90%). There is no randomization or region leakage.
Halves exclude windows straddling 16.77 s and retain bottom-region whitening.

| Window | Region | cycles/mm | Used/total frames | Actual dB | Control mean | Control max | Δ mean | Δ max |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 4096 | outer | 2.5 | 222/222 | +0.2943 | -0.6724 | +0.3309 | +0.9666 | -0.0366 |
| 4096 | bottom | 2.5 | 2838/2838 | +0.3591 | -0.6846 | -0.3849 | +1.0437 | +0.7440 |
| 4096 | bottom_early | 2.5 | 1415/1415 | +0.7840 | -0.0052 | +0.1606 | +0.7892 | +0.6234 |
| 4096 | bottom_late | 2.5 | 1415/1415 | -0.0597 | -1.3252 | -1.1396 | +1.2655 | +1.0799 |
| 4096 | outer | 5 | 222/222 | +0.0782 | -1.4478 | +0.7472 | +1.5260 | -0.6690 |
| 4096 | bottom | 5 | 2838/2838 | +2.3702 | -0.5731 | -0.1984 | +2.9433 | +2.5687 |
| 4096 | bottom_early | 5 | 1415/1415 | +1.7937 | -0.2231 | +0.2061 | +2.0168 | +1.5876 |
| 4096 | bottom_late | 5 | 1415/1415 | +2.9709 | -0.6651 | -0.2767 | +3.6360 | +3.2476 |
| 4096 | outer | 8 | 222/222 | -0.2743 | -0.5520 | +0.2602 | +0.2777 | -0.5345 |
| 4096 | bottom | 8 | 2838/2838 | -1.2168 | -0.5705 | -0.4112 | -0.6463 | -0.8056 |
| 4096 | bottom_early | 8 | 1415/1415 | -1.1376 | -0.5229 | -0.3070 | -0.6147 | -0.8306 |
| 4096 | bottom_late | 8 | 1415/1415 | -1.2949 | -0.5751 | -0.4161 | -0.7198 | -0.8788 |
| 8192 | outer | 2.5 | 213/213 | +1.7510 | +0.1046 | +1.4986 | +1.6463 | +0.2524 |
| 8192 | bottom | 2.5 | 2829/2829 | +0.0846 | -0.7393 | -0.6021 | +0.8239 | +0.6866 |
| 8192 | bottom_early | 2.5 | 1406/1406 | +0.7453 | +0.0325 | +0.1683 | +0.7128 | +0.5770 |
| 8192 | bottom_late | 2.5 | 1406/1406 | -0.5611 | -1.4848 | -1.2284 | +0.9237 | +0.6673 |
| 8192 | outer | 5 | 213/213 | +0.7038 | -0.8723 | +1.2646 | +1.5760 | -0.5608 |
| 8192 | bottom | 5 | 2829/2829 | +1.5252 | -0.6951 | -0.4653 | +2.2203 | +1.9904 |
| 8192 | bottom_early | 5 | 1406/1406 | +1.1481 | -0.4690 | -0.1861 | +1.6170 | +1.3342 |
| 8192 | bottom_late | 5 | 1406/1406 | +1.9222 | -0.6798 | -0.4786 | +2.6020 | +2.4008 |
| 8192 | outer | 8 | 213/213 | +0.1127 | -0.5447 | +0.5098 | +0.6574 | -0.3971 |
| 8192 | bottom | 8 | 2829/2829 | -0.9527 | -0.7193 | -0.5779 | -0.2334 | -0.3748 |
| 8192 | bottom_early | 8 | 1406/1406 | -1.0566 | -0.7912 | -0.6965 | -0.2653 | -0.3600 |
| 8192 | bottom_late | 8 | 1406/1406 | -0.8362 | -0.5852 | -0.3896 | -0.2510 | -0.4465 |

Outer = 0..2.3 s (tiny diagnostic); bottom = 2.54..31 s; early/late split = 16.77 s.
No candidate is promoted to a calibrated profile, regardless of ranking.

## Limitations and provenance

- All results are diagnostic, uncalibrated, and unvalidated. No defaults changed.
- Rates 2.5 and 5 were selected after looking at this same capture; 8 is the original baseline. No held-out dataset or significance/p-value claim.
- The offset was previously selected by an envelope search on this capture. It is now frozen at +12.15 s; it is not an independently measured start. No retiming, refitting, new trim, time stretch, or gain normalization. Only the derived playback copy is quantized to PCM16; analysis still uses the decoded float32 audio.
- The 15 circular controls reuse each region; they are descriptive alignment checks, not independent trials. Early/late halves reuse the same recording and fixed rates.
- The diagnostic is single A voice, fundamental only, from render_audio/sample_motion signed displacement, including acceleration and corners across the entire Hann window. It is an idealized motor-driven chirp, not a physical step model or a physical source identification.
- Observed AAC is decoded by FFmpeg to mono 48 kHz float32; diagnostic WAVs are synthesized PCM16 decoded by wave and divided by 32767. Quantization, lossy compression, and real capture processing differ.
- The browser uses a decoded WAV playback copy, not the original AAC. The original m4a remains unchanged and available as a raw download. Underlying AAC is still lossy; conversion cannot recover discarded detail.
- Each model frame uses nonnegative linear spectral power normalized over 100..2000 Hz bins. Zero-inband-power frames are excluded, but any nonzero leakage is included and can dominate a normalized quiet frame.
- Per-frequency time-median whitening suppresses stationary tones, then per-frame frequency-median subtraction reduces broadband modulation. Neither removes every DC/leakage, frame-background, AGC, resonance, or correlated-motion confound.
- A synthetic stationary-tone check failed the stronger assumption of near-zero raw contrast: symmetric-Hann sidelobe power varies with tone phase, especially in quiet bins. Raw scores differed by candidate despite no moving source. Aligned-minus-control contrast stayed small and below control maxima in that test; this does not establish universal null rejection.
- Scores are arbitrary dB spectral contrast, not error, likelihood, calibrated SPL, or goodness-of-fit. A higher score alone does not identify a fundamental; 2.5/5 harmonic ambiguity remains.
- Outer-wall statistics use their own regional whitening and very little data. Bottom halves inherit bottom whitening; only complete windows inside each half are scored and controls never cross half boundaries.
- Auditions use full default harmonics/ABZE voices except the stated AB rate, with the same master gain and weights across files and no per-file normalization. They are NOT loudness matched to the recording.
- Fans are omitted from synthesis, NOT assumed physically off. Sourced P3 S180 precedes this region; hotend/board state is unknown. Real fans, enclosure resonances, and noise compensation are not identified.
- User reports complete square, Standard 100%, only end trims, Voice Memos Skip Silence off, phone wedged via top hatch otherwise closed. AGC/enhancement is unknown; hatch contact can couple vibration.
- Rough recording landmarks ~12/~15/~43 s were supplied after the fit and are not independent held-out timing evidence. Planner boundary state and firmware behavior remain approximate.

## Reproduce

From the project root, with the existing environment (NumPy and FFmpeg):
`python -B scripts/compare_petg_acoustics.py --bundle data/recordings/petg_square_2026-10-05`
uses this new subfolder by default. `--output` can specify a separate directory.
The original bundle cannot be an output. Input/output and output/output hardlinks,
symlinks and nesting conflicts are refused before opening output files.
Concurrent filesystem changes are unsupported; inputs and source modules are
rechecked before publication and preserved inputs afterward.

Candidate WAVs, the derived recording_playback.wav, and this report/preview/plot
are retained and included in output protection and artifact hashes. No new FFmpeg
installation is needed; the playback copy uses the existing decoded audio.
Single-voice WAVs
are temporary diagnostic scratch, not audition files. Current module hashes and
historical baseline module hashes are recorded separately; they need not match.
STFT FFT batches are capped at 128 windows; no full spectrograms are dumped to JSON.
