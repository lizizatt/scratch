# PETG full-waveform harmonic comparison

Fixed hypotheses, not fitting. No calibration, defaults changes, or hardware actions.

AB rates: 2.5, 5, 8 cycles/mm. Full (1,.32,.12,.06), fundamental (1),
second (0,.32), upper (0,.32,.12,.06); applied to every ABZE voice.
ZE rates remain 40/8. Default voice gains and master gain 0.18 are unchanged.
All renders: 1491942 PCM16 frames, nominal plan 31.082142344541 s.
All three full renders reproduce archived WAV hashes; full8 reproduces the baseline.
Recording clock = local clock + 12.15 s; no refit, retiming or gain normalization.

## Method

Actual mixed waveform power, not summed independent powers. Symmetric Hann windows
4096/8192, hop480, complete windows, 100..2000 Hz inclusive. Observation uses the
original FFmpeg mono48k float32 decode. Per-bin regional time-median whitening,
then per-frame frequency-median subtraction; bottom halves inherit bottom whitening.
Linear-power unit-sum model weights score the residual, averaged equally across
nonzero-power frames. Fifteen circular controls shift weights and validity mask
within each scored region. JSON contains exact settings, all controls and provenance.

## Scores (arbitrary dB contrast)

| Profile | Window | Region | Used/total | Actual | Control mean | Control max | Actual−mean | Actual−max |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| full_2p5 | 4096 | outer | 222/222 | -0.0445 | -0.7087 | +0.9656 | +0.6642 | -1.0101 |
| full_2p5 | 4096 | bottom | 2838/2838 | +0.6674 | -0.5666 | -0.3817 | +1.2340 | +1.0492 |
| full_2p5 | 4096 | bottom_early | 1415/1415 | +0.9442 | +0.0476 | +0.2235 | +0.8966 | +0.7206 |
| full_2p5 | 4096 | bottom_late | 1415/1415 | +0.4027 | -1.0805 | -0.8641 | +1.4832 | +1.2668 |
| full_2p5 | 8192 | outer | 213/213 | +0.9944 | -0.0323 | +1.7599 | +1.0267 | -0.7655 |
| full_2p5 | 8192 | bottom | 2829/2829 | +0.3067 | -0.6999 | -0.5111 | +1.0065 | +0.8178 |
| full_2p5 | 8192 | bottom_early | 1406/1406 | +0.7413 | -0.1290 | +0.0084 | +0.8702 | +0.7328 |
| full_2p5 | 8192 | bottom_late | 1406/1406 | -0.1086 | -1.2161 | -1.0276 | +1.1075 | +0.9190 |
| fundamental_2p5 | 4096 | outer | 222/222 | +0.3286 | -0.6762 | +0.3762 | +1.0048 | -0.0476 |
| fundamental_2p5 | 4096 | bottom | 2838/2838 | +0.3542 | -0.6751 | -0.4070 | +1.0293 | +0.7612 |
| fundamental_2p5 | 4096 | bottom_early | 1415/1415 | +0.7724 | +0.0069 | +0.1728 | +0.7655 | +0.5996 |
| fundamental_2p5 | 4096 | bottom_late | 1415/1415 | -0.0567 | -1.3316 | -1.1429 | +1.2749 | +1.0862 |
| fundamental_2p5 | 8192 | outer | 213/213 | +1.7644 | +0.1040 | +1.5271 | +1.6605 | +0.2373 |
| fundamental_2p5 | 8192 | bottom | 2829/2829 | +0.1103 | -0.7329 | -0.5945 | +0.8431 | +0.7048 |
| fundamental_2p5 | 8192 | bottom_early | 1406/1406 | +0.7794 | +0.0367 | +0.1962 | +0.7427 | +0.5832 |
| fundamental_2p5 | 8192 | bottom_late | 1406/1406 | -0.5530 | -1.4864 | -1.2096 | +0.9335 | +0.6566 |
| second_2p5 | 4096 | outer | 222/222 | +0.1153 | -1.4442 | +0.7658 | +1.5596 | -0.6504 |
| second_2p5 | 4096 | bottom | 2838/2838 | +2.3408 | -0.5749 | -0.1881 | +2.9157 | +2.5289 |
| second_2p5 | 4096 | bottom_early | 1415/1415 | +1.7632 | -0.2403 | +0.1743 | +2.0035 | +1.5889 |
| second_2p5 | 4096 | bottom_late | 1415/1415 | +2.9436 | -0.6499 | -0.2818 | +3.5935 | +3.2254 |
| second_2p5 | 8192 | outer | 213/213 | +0.7005 | -0.8517 | +1.2804 | +1.5522 | -0.5799 |
| second_2p5 | 8192 | bottom | 2829/2829 | +1.5324 | -0.6963 | -0.4711 | +2.2287 | +2.0035 |
| second_2p5 | 8192 | bottom_early | 1406/1406 | +1.1631 | -0.4813 | -0.1984 | +1.6444 | +1.3615 |
| second_2p5 | 8192 | bottom_late | 1406/1406 | +1.9283 | -0.6724 | -0.4692 | +2.6007 | +2.3975 |
| upper_2p5 | 4096 | outer | 222/222 | +0.1170 | -1.2249 | +0.9331 | +1.3419 | -0.8161 |
| upper_2p5 | 4096 | bottom | 2838/2838 | +1.5574 | -0.5535 | -0.2724 | +2.1108 | +1.8298 |
| upper_2p5 | 4096 | bottom_early | 1415/1415 | +1.0685 | -0.2930 | +0.0324 | +1.3614 | +1.0361 |
| upper_2p5 | 4096 | bottom_late | 1415/1415 | +2.0671 | -0.6373 | -0.3984 | +2.7044 | +2.4655 |
| upper_2p5 | 8192 | outer | 213/213 | +0.6462 | -0.8329 | +1.3649 | +1.4791 | -0.7187 |
| upper_2p5 | 8192 | bottom | 2829/2829 | +0.9015 | -0.6922 | -0.4934 | +1.5937 | +1.3949 |
| upper_2p5 | 8192 | bottom_early | 1406/1406 | +0.5098 | -0.5548 | -0.2833 | +1.0646 | +0.7930 |
| upper_2p5 | 8192 | bottom_late | 1406/1406 | +1.3146 | -0.6549 | -0.5244 | +1.9696 | +1.8390 |
| full_5 | 4096 | outer | 222/222 | +0.4001 | -1.3432 | +0.7136 | +1.7434 | -0.3134 |
| full_5 | 4096 | bottom | 2838/2838 | +1.8185 | -0.5800 | -0.2225 | +2.3985 | +2.0410 |
| full_5 | 4096 | bottom_early | 1415/1415 | +1.2593 | -0.3319 | +0.0432 | +1.5912 | +1.2161 |
| full_5 | 4096 | bottom_late | 1415/1415 | +2.3962 | -0.5984 | -0.2650 | +2.9946 | +2.6612 |
| full_5 | 8192 | outer | 213/213 | +0.8717 | -0.9428 | +1.1729 | +1.8145 | -0.3012 |
| full_5 | 8192 | bottom | 2829/2829 | +1.1353 | -0.7104 | -0.5142 | +1.8457 | +1.6495 |
| full_5 | 8192 | bottom_early | 1406/1406 | +0.7528 | -0.5841 | -0.3374 | +1.3369 | +1.0902 |
| full_5 | 8192 | bottom_late | 1406/1406 | +1.5370 | -0.6294 | -0.4211 | +2.1664 | +1.9581 |
| fundamental_5 | 4096 | outer | 222/222 | +0.1000 | -1.4491 | +0.7634 | +1.5491 | -0.6634 |
| fundamental_5 | 4096 | bottom | 2838/2838 | +2.3398 | -0.5776 | -0.1908 | +2.9174 | +2.5306 |
| fundamental_5 | 4096 | bottom_early | 1415/1415 | +1.7542 | -0.2483 | +0.1612 | +2.0025 | +1.5931 |
| fundamental_5 | 4096 | bottom_late | 1415/1415 | +2.9514 | -0.6436 | -0.2529 | +3.5950 | +3.2043 |
| fundamental_5 | 8192 | outer | 213/213 | +0.7054 | -0.8540 | +1.2439 | +1.5594 | -0.5385 |
| fundamental_5 | 8192 | bottom | 2829/2829 | +1.5230 | -0.7001 | -0.4620 | +2.2231 | +1.9850 |
| fundamental_5 | 8192 | bottom_early | 1406/1406 | +1.1485 | -0.4954 | -0.1895 | +1.6439 | +1.3381 |
| fundamental_5 | 8192 | bottom_late | 1406/1406 | +1.9227 | -0.6706 | -0.4686 | +2.5932 | +2.3913 |
| second_5 | 4096 | outer | 222/222 | +0.2263 | -0.8303 | +0.4172 | +1.0566 | -0.1909 |
| second_5 | 4096 | bottom | 2838/2838 | -0.1982 | -0.6015 | -0.4224 | +0.4033 | +0.2242 |
| second_5 | 4096 | bottom_early | 1415/1415 | -0.5141 | -0.6655 | -0.4699 | +0.1514 | -0.0443 |
| second_5 | 4096 | bottom_late | 1415/1415 | +0.1228 | -0.5599 | -0.4644 | +0.6827 | +0.5872 |
| second_5 | 8192 | outer | 213/213 | +0.3847 | -1.2309 | +0.4587 | +1.6155 | -0.0740 |
| second_5 | 8192 | bottom | 2829/2829 | -0.4728 | -0.7286 | -0.6103 | +0.2558 | +0.1375 |
| second_5 | 8192 | bottom_early | 1406/1406 | -0.7496 | -0.8378 | -0.7556 | +0.0883 | +0.0060 |
| second_5 | 8192 | bottom_late | 1406/1406 | -0.1868 | -0.5887 | -0.4730 | +0.4019 | +0.2861 |
| upper_5 | 4096 | outer | 222/222 | +0.3311 | -0.8381 | +0.4306 | +1.1692 | -0.0996 |
| upper_5 | 4096 | bottom | 2838/2838 | -0.3592 | -0.6345 | -0.5252 | +0.2753 | +0.1660 |
| upper_5 | 4096 | bottom_early | 1415/1415 | -0.5783 | -0.7039 | -0.5409 | +0.1256 | -0.0374 |
| upper_5 | 4096 | bottom_late | 1415/1415 | -0.1375 | -0.5883 | -0.4932 | +0.4508 | +0.3557 |
| upper_5 | 8192 | outer | 213/213 | +0.4783 | -1.1690 | +0.6127 | +1.6473 | -0.1344 |
| upper_5 | 8192 | bottom | 2829/2829 | -0.6158 | -0.7476 | -0.6537 | +0.1318 | +0.0379 |
| upper_5 | 8192 | bottom_early | 1406/1406 | -0.8382 | -0.8591 | -0.7598 | +0.0209 | -0.0784 |
| upper_5 | 8192 | bottom_late | 1406/1406 | -0.3886 | -0.6125 | -0.5333 | +0.2239 | +0.1447 |
| full_8 | 4096 | outer | 222/222 | -0.1401 | -0.7295 | +0.4582 | +0.5894 | -0.5983 |
| full_8 | 4096 | bottom | 2838/2838 | -1.1705 | -0.6033 | -0.4575 | -0.5673 | -0.7130 |
| full_8 | 4096 | bottom_early | 1415/1415 | -1.0914 | -0.5855 | -0.4151 | -0.5059 | -0.6763 |
| full_8 | 4096 | bottom_late | 1415/1415 | -1.2515 | -0.6049 | -0.4631 | -0.6466 | -0.7884 |
| full_8 | 8192 | outer | 213/213 | -0.1918 | -0.8102 | +0.5501 | +0.6184 | -0.7419 |
| full_8 | 8192 | bottom | 2829/2829 | -1.0076 | -0.7326 | -0.6076 | -0.2750 | -0.4000 |
| full_8 | 8192 | bottom_early | 1406/1406 | -1.1303 | -0.8155 | -0.7250 | -0.3148 | -0.4053 |
| full_8 | 8192 | bottom_late | 1406/1406 | -0.8779 | -0.6138 | -0.4114 | -0.2641 | -0.4666 |
| fundamental_8 | 4096 | outer | 222/222 | -0.3703 | -0.5367 | +0.2468 | +0.1664 | -0.6171 |
| fundamental_8 | 4096 | bottom | 2838/2838 | -1.2242 | -0.5646 | -0.3813 | -0.6596 | -0.8429 |
| fundamental_8 | 4096 | bottom_early | 1415/1415 | -1.1579 | -0.5321 | -0.3217 | -0.6257 | -0.8362 |
| fundamental_8 | 4096 | bottom_late | 1415/1415 | -1.2912 | -0.5694 | -0.4102 | -0.7218 | -0.8810 |
| fundamental_8 | 8192 | outer | 213/213 | +0.0394 | -0.5333 | +0.4380 | +0.5727 | -0.3986 |
| fundamental_8 | 8192 | bottom | 2829/2829 | -0.9602 | -0.7153 | -0.5659 | -0.2449 | -0.3943 |
| fundamental_8 | 8192 | bottom_early | 1406/1406 | -1.0664 | -0.7918 | -0.7048 | -0.2746 | -0.3617 |
| fundamental_8 | 8192 | bottom_late | 1406/1406 | -0.8435 | -0.5864 | -0.3748 | -0.2571 | -0.4688 |
| second_8 | 4096 | outer | 222/222 | -0.7551 | -0.8288 | -0.4049 | +0.0737 | -0.3501 |
| second_8 | 4096 | bottom | 2838/2838 | -0.7567 | -0.7130 | -0.6242 | -0.0436 | -0.1325 |
| second_8 | 4096 | bottom_early | 1415/1415 | -0.6790 | -0.8429 | -0.7042 | +0.1639 | +0.0252 |
| second_8 | 4096 | bottom_late | 1415/1415 | -0.8337 | -0.7009 | -0.6202 | -0.1328 | -0.2136 |
| second_8 | 8192 | outer | 213/213 | -1.2529 | -1.1476 | -0.6279 | -0.1053 | -0.6250 |
| second_8 | 8192 | bottom | 2829/2829 | -1.0320 | -0.7724 | -0.7108 | -0.2596 | -0.3212 |
| second_8 | 8192 | bottom_early | 1406/1406 | -1.0704 | -0.9444 | -0.8728 | -0.1261 | -0.1977 |
| second_8 | 8192 | bottom_late | 1406/1406 | -0.9920 | -0.6734 | -0.5598 | -0.3186 | -0.4322 |
| upper_8 | 4096 | outer | 222/222 | -0.7732 | -0.8405 | -0.3430 | +0.0672 | -0.4303 |
| upper_8 | 4096 | bottom | 2838/2838 | -0.8672 | -0.7395 | -0.6588 | -0.1278 | -0.2084 |
| upper_8 | 4096 | bottom_early | 1415/1415 | -0.8054 | -0.8502 | -0.7591 | +0.0448 | -0.0463 |
| upper_8 | 4096 | bottom_late | 1415/1415 | -0.9314 | -0.7166 | -0.6172 | -0.2147 | -0.3141 |
| upper_8 | 8192 | outer | 213/213 | -1.2246 | -1.1179 | -0.7514 | -0.1067 | -0.4732 |
| upper_8 | 8192 | bottom | 2829/2829 | -1.0750 | -0.7775 | -0.7284 | -0.2975 | -0.3466 |
| upper_8 | 8192 | bottom_early | 1406/1406 | -1.1053 | -0.9371 | -0.8601 | -0.1682 | -0.2452 |
| upper_8 | 8192 | bottom_late | 1406/1406 | -1.0477 | -0.6871 | -0.5799 | -0.3606 | -0.4679 |

## Fixed background influence

Top regional time-median power bins, Hz, descending power; adjacent bins need not
be separate peaks. Full linear spectra are in JSON. The stationary-template model
repeats each regional spectrum over frames: actual−mean and actual−max are zero
by construction. This is NOT proof that real resonances have been removed.

| Window | Region | Strongest stationary bins (Hz) |
|---:|---|---|
| 4096 | outer | 128.91, 117.19, 140.62, 246.09, 257.81, 105.47, 187.50, 175.78 |
| 4096 | bottom | 328.12, 339.84, 128.91, 117.19, 164.06, 351.56, 140.62, 175.78 |
| 4096 | bottom_early | 328.12, 339.84, 128.91, 117.19, 164.06, 140.62, 187.50, 316.41 |
| 4096 | bottom_late | 339.84, 328.12, 117.19, 128.91, 351.56, 164.06, 175.78, 140.62 |
| 8192 | outer | 123.05, 128.91, 117.19, 251.95, 246.09, 134.77, 187.50, 257.81 |
| 8192 | bottom | 333.98, 328.12, 339.84, 123.05, 128.91, 134.77, 164.06, 117.19 |
| 8192 | bottom_early | 333.98, 328.12, 128.91, 123.05, 134.77, 164.06, 117.19, 158.20 |
| 8192 | bottom_late | 333.98, 339.84, 123.05, 345.70, 128.91, 351.56, 328.12, 117.19 |

## Interpretation limits

AB h2 at2.5 and h1 at5 share frequency trajectories, but not phases, gains or ZE
content. A spectral preference does not identify the physical fundamental. Compare
the full profiles and ablations across both windows/halves before choosing another
real test; these same-capture checks do not establish a winning physical model.

- Fixed hypothesis comparison, NOT fitting or calibration. No defaults or source modules changed; no hardware actions.
- Rates 2.5 and 5 were chosen after examining this capture. The +12.15 s offset was previously selected on this same recording, not independently measured. No held-out capture.
- No retiming, time stretch, duration truncation, or waveform gain normalization. Same master gain and default ABZE voice gains for every render. Ablations are quieter at this shared fixed gain, not loudness matched.
- Weights ablate harmonics on ALL ABZE voices. ZE base rates remain 40/8 cycles/mm; their harmonic content changes with each ablation.
- AB h2 at 2.5 shares frequency trajectories with AB h1 at 5. Harmonic phase offsets, amplitudes, coherent voice interference, and ZE trajectories differ. This is not waveform identity or physical fundamental identification.
- The model spectrum is power of the actual coherent ABZE PCM16 mixture, not a sum of independent voice powers. Signed displacement phase includes acceleration and reversals throughout every window.
- Scores are arbitrary dB spectral contrasts, not error, likelihood, significance, calibrated SPL, or evidence of a physical source identity. The 15 circular controls are dependent descriptive alignment checks, not independent trials.
- Only linear spectral weights are normalized within each model frame over 100..2000 Hz. This does not normalize audio gain. Zero-power frames are excluded; any nonzero leakage in quiet frames still receives a unit-sum weight.
- Regional per-bin time-median and per-frame frequency-median subtraction reduce stationary/broadband influence but do not isolate motors or remove real resonances, AGC, leakage, or correlated motion.
- Background tables describe regional time-median linear power and the eight strongest stationary bins (adjacent bins can be one peak). No bin is assigned to a physical component.
- Stationary-template negative controls repeat that regional median spectrum over all frames. Their aligned-minus-control contrast is zero by construction, not proof that real resonances have been removed.
- Outer has few frames and its own whitening. Both bottom halves inherit bottom whitening; only complete windows inside each half are scored and circular controls stay within that half.
- Observation is the original FFmpeg mono 48 kHz float32 AAC decode, not the archived quantized playback WAV. Models are PCM16 / 32767. AAC/phone processing and synthesis quantization differ.
- Fans omitted from synthesis are not assumed physically off. P3 S180 preceded this scope; hotend/board state, enclosure resonances and noise compensation are unknown. Phone/hatch contact may couple vibration; AGC is unknown.
- Standard 100%, complete square, end trims only and Skip Silence off are user reports. Rough timing landmarks supplied after alignment are not independent validation. Planner boundary and firmware behavior remain approximate.
- Historical source hashes may differ from current modules. Reproduction is checked using plan duration/frame count and all three archived full-render WAV hashes.
- In a nonperiodic accelerating synthetic full2.5 mixture plus a strong fixed tone, the 4096-sample aligned score recovers full2.5 among full profiles but actual-minus-control-mean favors full5. Contrast ranking is not guaranteed rate recovery; no scoring parameters were tuned to change this result.
- Preflight and post-generation preservation checks are not a lock against concurrent filesystem changes. Do not modify inputs or destinations while generating.
