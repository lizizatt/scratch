# Melody‑matching GCODE optimization

**Goal:** Given a complex print GCODE and a set of short single-note melodies (each a few seconds), produce a **new GCODE file** by nudging segments of the print that already “kind of” match a melody so they **fully** match it, **without** disrupting the print (no collisions, stay in build volume, preserve print geometry).

So: **output = modified GCODE**, not MIDI. MIDI (or simple note lists) is just the **spec** for what the melody should sound like.

---

## 1. Problem formulation

**Inputs**
- **Print GCODE** – full job (many moves, layers, etc.).
- **Target melodies** – one or more short sequences of “single notes,” e.g. each note = (pitch or frequency, duration, optional loudness). A few seconds each. Could be MIDI, or a simple list of `(note_id, start_sec, duration_sec)`.

**Decision variables (what we’re allowed to change)**
- **Per segment (or per move):**  
  - **Feedrate F** – main lever for “pitch” (stepper frequency). Change F within a safe range so the segment’s tone matches the target note.  
  - **Optionally:** small **time scaling** (e.g. stretch/shrink segment duration by a few %) to align timing; or **splitting/merging** segments only where it doesn’t affect geometry.
- **What we do *not* change (hard constraints):**  
  - **Path geometry** – XY(Z) positions that define the print. We may allow *tiny* tolerance if the printer can tolerate it, but generally “nudge” = change F (and maybe timing), not move walls or layers.  
  - **Extrusion E** – do not change extrusion amounts; only change motion speed (F) so the sound matches.

**Objective**
- For each “melody region” we’ve assigned to a target melody:  
  - **Pitch match:** chosen feedrates produce stepper frequencies that match the target notes (via a fixed or tuned feedrate→frequency map).  
  - **Timing match:** segment start/end times align with target note start/duration (within some tolerance).  
- Aggregate: e.g. sum of (pitch error + timing error) over matched segments, or a correlation score between target melody and “sounded” melody.

**Constraints**
- **Build volume:** every (X, Y, Z) in the modified GCODE stays within the machine’s bounds.  
- **No collision / no hitting build plate:** e.g. Z ≥ 0 (or bed clearance); no moves that would drag the nozzle through existing geometry.  
- **Print integrity:**  
  - Layer heights and per-layer paths unchanged (or within tolerance).  
  - Extrusion unchanged; only F (and possibly timing) changed so that the *sound* matches, not the shape.

So we’re **not** moving the path; we’re **only** adjusting **feedrates (and possibly timing)** on segments that we’ve decided are “melody” segments, subject to safety and print constraints.

---

## 2. High-level procedure

1. **Parse print GCODE** → list of moves (and segments, if we merge consecutive same-F moves). For each segment we have: path (start/end XY(Z)), length, current F, duration (from current timing model).
2. **Load target melodies** → e.g. from MIDI or a simple format: list of (pitch, start_sec, duration_sec) per melody.
3. **Identify candidate regions in the print**  
   - Sliding window over the print’s timeline: for each window, get the sequence of “notes” (segment feedrates → frequencies, segment durations).  
   - Compare to each target melody (e.g. DTW or simple correlation of pitch + duration).  
   - Keep regions where similarity is above a threshold (“kind of resemble”).
4. **Formulate the optimization**  
   - **Variables:** for each segment in a chosen region, variable F (and optionally a small time-scale factor).  
   - **Objective:** match target melody (pitch + timing) for that region; sum over regions.  
   - **Constraints:**  
     - F in [F_min, F_max] per segment (and optionally per move type).  
     - No change to X,Y,Z,E (or only within a tiny tolerance).  
     - Build volume and collision constraints (if we ever allow position tweaks; for “F only” they’re automatically satisfied).
5. **Solve** – e.g. local search, gradient descent, or a small nonlinear solver. Output: per-segment (or per-move) F values (and any time scaling).
6. **Emit new GCODE** – same as original but with updated F (and delta-times if we changed timing). Write to a new file.

So the pipeline is: **GCODE + melodies → optimization → modified GCODE**. MIDI is only one way to represent the melodies.

---

## 3. Why “MIDI as output” was the wrong tree

- Our current pipeline focuses on **GCODE → MIDI** and **tuning so that MIDI matches a reference**. That’s useful for *analysis* and *listening*, but the **deliverable** you want is **GCODE that, when run, sounds like the melody**.
- So the right “output” is **GCODE**, and the role of “melody” (whether MIDI or not) is to **define the target** for an optimization that **adjusts GCODE** (mainly F, and possibly timing), not to be the product itself.

---

## 4. What we already have that still helps

- **GCODE parsing and segmentation** – we have moves and segments; we can associate each with a feedrate and duration.  
- **Feedrate ↔ frequency mapping** – we have a (tunable) model: changing F changes the “note” we hear. So the **objective** (match pitch) is “set F so that feedrate_to_frequency(F) ≈ target_note_frequency.”  
- **Timing model** – we have segment durations (with or without acceleration). So we can align “segment i duration” to “target note i duration” in the optimization.  
- **Melody as MIDI** – fine as input: “target melody” = list of (pitch, start, duration). We don’t need to *output* MIDI; we only need to *read* the target from MIDI (or from a simple JSON/list).

---

## 5. Suggested next steps (implementation)

1. **Melody spec format** – Decide on a minimal representation (e.g. “list of (frequency_hz or midi_note, duration_sec)” per melody). Add a small loader from MIDI → that format.  
2. **Segment ↔ “note” mapping** – For a given window of the print timeline, map segments to a sequence of (pitch, duration). Use existing feedrate→frequency and segment duration.  
3. **Similarity / matching** – Implement “how much does this window of the print resemble this melody?” (e.g. pitch + duration similarity). Use that to **select** which regions to optimize.  
4. **Optimization (F only, no geometry change)** – For one region: variables = F per segment; objective = match target pitches and durations; constraints = F_min ≤ F ≤ F_max. Solve and write updated F back into the move list.  
5. **GCODE writer** – Given the original GCODE and the new F (and optionally time scaling), emit a new .gcode file with the same structure but updated F (and, if needed, adjusted deltas).

That gives you a script: **print.gcode + melodies (e.g. MIDI) → optimized_print.gcode**, with constraints so the print isn’t disrupted and the machine stays in bounds.

---

## 6. Small parts (individually testable)

Break the work into pieces you can implement and test in isolation.

| Part | What it does | How to test |
|------|----------------|-------------|
| **1. Melody loader** | Load a melody from MIDI (or JSON) → list of `(pitch, start_sec, duration_sec)`. | Unit test: given a small .mid, assert note count and approximate times/pitches. |
| **2. Segment → “note”** | From GCODE segments (with timing), produce a sequence of (pitch, duration) using feedrate→frequency. | Unit test: given calibration.gcode + manifest, assert segment count and that each segment maps to one “note” with expected duration. |
| **3. Window similarity** | For a window of print “notes” and a target melody, return a similarity score (pitch + duration). | Unit test: identical sequences → score 1; wrong pitch → lower score; wrong duration → lower score. |
| **4. Region finder** | Sliding window over print timeline; for each window compute similarity to each melody; return best-matching regions (start segment index, melody id, score). | Integration test: run on calibration.gcode + one short melody MIDI; assert at least one region with score above threshold. |
| **5. F-only optimizer (one region)** | Input: list of segments in one region, target melody notes. Output: new F per segment to minimize pitch + duration error. Constraints: F in [F_min, F_max]. | Unit test: trivial region (one segment, one target note) → closed-form F; assert feedrate_to_frequency(F) ≈ target. |
| **6. GCODE writer** | Input: original GCODE (or list of moves), new F per move/segment. Output: new .gcode file with only F (and comments) changed. | Unit test: roundtrip – parse GCODE, change one F, write, parse again; assert only that move’s F changed. |
| **7. End-to-end** | Wire 1–6: load GCODE, load melodies, find regions, optimize each region, write new GCODE. | Smoke test: calibration.gcode + calibration melody → output.gcode exists and has same move count, some F values different. |

Implement in order 1 → 2 → … → 7. Each part has a clear input/output and test so you can land one piece at a time.
