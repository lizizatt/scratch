# Minimal Blowup and Induction-on-Scales Audit

**Date:** 2026-08-18  
**Disposition:** blocked; the route is already present implicitly, not a new
independent path.

## First lemma

A Kenig--Merle-style route would first need a minimal critical blowup object:
a singular solution minimizing a critical size, with a profile decomposition
that rules out vanishing and separated-bubble dichotomy, followed by an
almost-periodic-modulo-symmetry compactness statement.

## Audit

The KNSS record-point construction already supplies a nonzero mild ancient
profile. What it does not supply is minimality in a controlled critical class,
global backward $L^3$ bounds, or an almost-periodic orbit. The repository's
critical-profile iterations already tested tail transfer, orbit compactness,
and fixed backward-time selection. Separated bubbles show that bounded local
energy and bounded $L^3$ data do not imply global profile precompactness.

Trying to select a minimal object before proving a finite critical size is
circular: the missing critical bound is precisely what would make the
minimizing class nonempty and compact. The induction step would also require a
stability/perturbation theorem at the same critical endpoint that the current
source closure does not contain.

## Kill test and source gap

Use separated profiles $f_k=\phi+\psi(\cdot-R_ke_1)$ with $R_k\to\infty$:
critical size stays bounded while global compactness fails. This is not a
Navier-Stokes counterexample, but it defeats dichotomy-free compactness. No
primary source audited here supplies the required large-data minimal-element
construction for this endpoint.

**Result:** The minimal-blowup idea is already represented by KNSS plus ancient
profile analysis. It remains blocked at minimality, global critical compactness,
and perturbative stability; no duplicate claim is added.
