# Next recording: orientation check on a normal print

Prepared 2026-10-09. **Ready for a human-run measurement, not for edited musical GCODE.**

## Why this test

The [full-harmonic comparison](log/petg_harmonics/REPORT.md) still gives the
5-cycle full profile higher spectral contrast than 2.5 on the existing infill.
However, 2.5's second harmonic and 5's fundamental produce almost identical
contrast. A synthetic known-rate example also shows that contrast ranking can
choose the wrong rate. Neither result establishes a physical motor fundamental.

The first square's axis-aligned edges drive both CoreXY coordinates at equal
speed magnitude. In the model, 45-degree edges instead alternate between a
moving A coordinate and a moving B coordinate; the other is stationary during
each straight edge. At equal toolhead speed, the moving belt-coordinate speed
is sqrt(2) times the axis-aligned magnitude. Corners and connecting travels are
not single-coordinate intervals. The actual sliced toolpaths must be checked.

The next question is whether the candidate frequency trajectories generalize
to these new directions, rather than just matching one recording's resonances.
**Rotation does not break the exact 2.5-h2 / 5-h1 frequency ambiguity.** It can
help separate motor contributions and test generalization; identifying the
fundamental may still require more evidence.

## What to print and record

1. Reuse the small, single-layer concentric PETG square project that already
   printed successfully. Use the stock P1S profile and the same known-good
   material, temperatures, speed and acceleration settings.
2. Make two ordinary, separately sliced jobs: one at the original orientation,
   one with the object rotated **45 degrees around Z** in Bambu Studio. Keep
   both centered in the same area of the plate. Check the preview: long edges
   should really be axis-aligned versus diagonal, with concentric fill retained.
   Do not increase speed to chase a pitch. Keep Standard/100% mode.
3. Review and run them normally. Keep normal startup/calibration, cooling and
   protections enabled. This test does not require disabling noise compensation,
   manual service moves, firmware changes, or sending any simulation fixture.
4. Keep the phone on a fixed support **outside** the printer, not touching it,
   with the door and top closed. Keep microphone position, orientation and
   recording settings identical for both jobs. This differs from the first
   wedged-phone capture, so absolute loudness cannot be compared across setups.
5. Start recording before the print and stop after it finishes. Preserve the
   original file without edits, normalization or silence removal. Prefer
   lossless/fixed-gain recording if available; otherwise the same Voice Memos
   settings are acceptable with processing/gain marked unknown. Skip Silence
   and enhancement should be off where those options exist.
6. If practical, use a continuous video with audio that shows the first object
   move, the border-to-fill transition and the final object move. Those provide
   independently observed timing landmarks. A separate unsynchronized video
   does not automatically provide timestamps on the audio clock.

Two short prints give an orientation comparison under one microphone setup.
An extra unchanged repeat is useful for variability but optional. If only one
print is convenient, start with the 45-degree version; it is a new-condition
check, not a controlled orientation comparison against the old microphone setup.

## What to send back

- Original recordings, with which orientation each used.
- The **sliced GCODE 3MF and project 3MF for each job**, not just a screenshot.
- Firmware and Bambu Studio versions; nozzle/material/plate; AMS used or not;
  speed mode; any changed settings; known calibration state (unknown is fine).
- A photo or description of the phone placement and recording settings.
- Whether both prints completed normally; any observed interruptions or defects.

## Offline evaluation, decided before collection

- Preserve raw inputs and hashes. Inspect actual sliced directions, feeds and
  state before selecting a supported print-body scope. Do not silently skip
  unsupported startup or invent a full-file simulation.
- Keep the 2.5/5/8 candidates, harmonic weights, gains and diagnostic parameters
  fixed for the first evaluation. Use complete recordings as evaluation units,
  not adjacent windows called independent tests.
- Prefer video/audio landmarks for a single clock offset. If an audio-envelope
  fit is necessary, report its search and uncertainty; never time-warp to hide
  motion error. Define source-linked regions without selecting high-score audio.
- Check moving spectral tracks against predicted A/B trajectories, residuals,
  both FFT sizes and shifted controls. Separate persistent-frequency background
  from moving components descriptively; do not claim source separation.
- Report whether 2.5's lower track and odd harmonics have visible support, while
  allowing a weak/missing fundamental. No contrast threshold alone selects a
  physical rate; absence in one noisy recording is not proof of absence.
- Keep the initial evaluation before any tuning. If these recordings are later
  used to fit a profile, they become development data and another untouched
  recording is needed for validation. Defaults remain uncalibrated meanwhile.

Human review and execution remain required. No printer jobs have been generated,
uploaded or run by this comparison.