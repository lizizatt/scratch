# Listening observations

## PETG square — 2026-10-06

Source comparison: [acoustic candidates](data/recordings/petg_square_2026-10-05/acoustic_candidates/index.html), using the preserved PETG-square recording and 2.5/5/8 acoustic-cycles-per-mm A/B auditions.

- User feedback: **“2.5 actually sounds closest.”**
- Interpretation: subjective preference for resemblance to the recording, not a measured motor rate, calibrated profile, or blind/held-out evaluation. No timestamp or particular sound component was specified.
- Keep 2.5 as the listener-preferred experimental candidate. Defaults, candidate files, the original recording, and the archived 8-cycle baseline remain unchanged.
- The existing numerical diagnostic favored 5, but scored an A-only fundamental signal while listening used full A/B/Z/E voices and harmonics. Those are different comparisons.
- Hypothesis, not conclusion: a stronger component at 5 cycles/mm could be a harmonic of a 2.5-cycle fundamental. The full-voice 2.5 audition already contains a second harmonic at 5; source attribution and enclosure/phone response remain uncertain.
- Next check: compare complete harmonic spectra for both candidate rates at the same frozen timing, separating fundamental/harmonic weights from background and resonance energy. Do not tune timing or promote a default merely to reproduce this preference.

These notes live outside the preserved recording bundle so adding feedback does not change its archived provenance or artifact hashes.

## Full-harmonic follow-up — 2026-10-09

The [new comparison](log/petg_harmonics/REPORT.md) evaluates the actual mixed
ABZE waveform for each rate with full, fundamental-only, second-only and
upper-harmonic profiles. No weights were fitted, and timing/gains stayed fixed.

Bottom-region actual-minus-control-mean contrast at 4096/8192 samples:

| Profile | 4096 | 8192 |
| --- | ---: | ---: |
| Full 2.5 | +1.2340 | +1.0065 |
| Full 5 | +2.3985 | +1.8457 |
| Full 8 | -0.5673 | -0.2750 |
| Second-only 2.5 | +2.9157 | +2.2287 |
| Fundamental-only 5 | +2.9174 | +2.2231 |

These are arbitrary dB spectral contrasts, not calibrated errors or significance.
Full 5 also leads the bottom halves, but no full profile exceeds the outer-wall
control maximum. The near-equal second-2.5/fundamental-5 scores preserve the
harmonic ambiguity; their waveforms are not identical. Harmonic ablations affect
all four voices, while Z/E base rates stay fixed.

A known-rate synthetic full-2.5 signal plus a strong fixed tone supplies a
counterexample: its aligned score recovers 2.5, but 4096-sample contrast ranking
favors 5. Thus numerical preference does not override the user's listening
observation or establish a physical fundamental. Stationary-template controls
give zero contrast by construction, not evidence that real resonances are gone.

All three full auditions reproduce archived hashes. The entire recording bundle
and defaults remain unchanged. The new [listening page](log/petg_harmonics/index.html)
includes two quieter harmonic ablations at shared gain; no new user listening
judgment has been collected. Next: the independent normal-print orientation
check in [NEXT_RECORDING.md](NEXT_RECORDING.md), not more fitting on this capture.