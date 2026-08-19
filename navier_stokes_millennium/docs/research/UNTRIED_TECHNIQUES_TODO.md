# Untried Technique Burn-Down

**Date:** 2026-08-18
**Scope:** five technique families identified after round 042.
**Rule:** each item gets one bounded, falsifiable audit. A blocked result is
useful output; it is not a failed project result.

- [x] **Besov/paraproduct analysis** — test whether critical Littlewood-Paley
  estimates provide a non-circular flux bound from finite energy.
- [x] **Minimal blowup / induction on scales** — test whether a minimal critical
  element can be constructed without assuming the missing critical bound.
- [x] **Vorticity filament geometry** — test whether stretching, curvature, or
  helicity yields a scale-critical anti-concentration estimate beyond direction
  coherence.
- [x] **Monotonicity / entropy functionals** — test whether a scale-critical
  monotone quantity can control concentration across parabolic scales.
- [x] **Quantitative singular-set geometry** — test whether capacity, porosity,
  or Minkowski content upgrades CKN smallness into local $L^2$ or $L^3$ control.

## Results

- **Besov/paraproduct:** `blocked`; the route reproduces the matched-scale
  commutator, pressure, and fixed-time slicing obstructions already recorded.
- **Minimal blowup:** `blocked`; KNSS already supplies the partial profile step,
  but minimality, global critical compactness, and perturbative stability are
  unavailable.
- **Vorticity geometry:** `blocked`; fixed-slice $L^{3/2}$ vorticity control or
  equivalent geometric hypotheses are not supplied by finite energy.
- **Monotonicity/entropy:** `blocked`; no candidate critical coercive functional
  or source-backed monotonicity identity was found.
- **Singular-set geometry:** `blocked`; quantitative set size alone does not
  control amplitude, pressure, or fixed-time local mass.

Detailed records:
`UNTRIED_BESOV_PARAPRODUCT_AUDIT.md`,
`UNTRIED_MINIMAL_BLOWUP_AUDIT.md`,
`UNTRIED_VORTICITY_GEOMETRY_AUDIT.md`,
`UNTRIED_MONOTONICITY_ENTROPY_AUDIT.md`, and
`UNTRIED_SINGULAR_GEOMETRY_AUDIT.md`.

Each completed item must record: the exact first lemma, dependencies, scaling
check, kill test, disposition, and primary-source gaps. Results belong in
separate research notes and the gauntlet chain; no item may be marked proved
from analogy, numerical evidence, or agent agreement.
