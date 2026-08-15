# Research Outcome

**Date:** 2026-08-14
**Mathematical status:** `blocked`
**Millennium problem status:** unsolved

## Result

This project does not contain a proof or counterexample resolving the
three-dimensional incompressible Navier-Stokes Millennium problem. Six
adversarial review rounds plus one administrative rebaseline produced valid corrections to the literature record,
mathematical claims, and audit tooling. No round produced a candidate proof
whose dependency closure was settled.

The shortest positive route remains

$$
\sup_{0<t<T_*}\|u(t)\|_{L^3(\mathbb R^3)}<\infty
\quad\Longrightarrow_{\mathrm{ESS}}\quad
  \mathrm{no\ singularity\ at\ }T_*.
$$

The missing implication is canonical claim `CRITICAL-BOUND`: prove the boxed
critical estimate for every Fefferman-admissible smooth datum if its maximal
smooth lifespan has a finite endpoint. The energy inequality does not supply
it; its interpolation line remains supercritical.

## Work Completed

- Established a self-contained research folder with scoped agent instructions,
  a canonical machine-readable claim graph, proof/counterexample artifacts,
  and an adversarial review protocol.
- Completed six literature tracks: official formulation and foundations,
  conditional regularity, partial regularity, nonuniqueness and obstructions,
  blowup strategies, and validated computation.
- Verified exact theorem scopes where primary text was available and marked
  inaccessible theorem bodies `blocked` rather than filling them from memory.
- Developed and attacked critical-flux, shell-cascade, compact-ancient-orbit,
  and fault-tolerant-systems analogy routes.
- Implemented an exact finite Fourier-mode evaluator. Its tests prove a
  periodic high-high-to-low triad refutes universal instantaneous critical-flux
  absorption.
- Added a closed Fourier-ball constructor and RK4 integrator for finite
  projected ODE probes, with tests for exact small-ball membership, viscous
  amplification, projection, reality, and active-mode closure. These remain
  computational infrastructure, not a regularity argument.
- Added 2pi-periodic-torus spatial reconstruction and shell energy-density sampling,
  checked against discrete Parseval. This supplies a spatial observable for
  future probes but does not provide pressure localization or an epsilon
  regularity estimate.
- Added localized shell nonlinear-flux and viscous-dissipation densities,
  whose grid averages match the existing modal observables. These still omit
  pressure decomposition and do not establish a phase-space packing estimate.
  The probe now includes zero-padding invariance, a non-aliasing grid boundary,
  and non-negative-viscosity validation.
- Rejected the distributed-systems transfer after amplitude scaling and an
  explicit triadic partition counterexample.
- Determined that compact $L^3$ ancient-orbit rigidity was already implied by
  Albritton-Barker's stronger sequence-$L^3$ Liouville theorem.
- Recorded the adversarial rounds through the current phase-space rebaseline,
  an always-validated hash manifest,
  and content-addressed claim snapshots from schema v2 onward.
- Rounds 18-25 produced solid narrow disproofs of naive cube charging,
  local-only harmonic-pressure control, automatic matched-scale commutator
  smallness, the CLMS suitability transfer, finite-probe-to-PDE uniformity,
  and the occupancy-only packing-to-CKN bridge. The broader claims remain
  blocked.
- A fresh critical-profile iteration found no proof or admissible counterexample.
  The exact gap is global backward $L^3$ boundedness and pressure/mildness
  control for the ancient profile needed by the Liouville theorem.
- Three modalities were each tested for three iterations: scale-adapted tail
  transfer, dynamically recentered orbit compactness, and fixed backward-time
  selection. Each yielded a conditional sufficient lemma plus an estimate-level
  obstruction, but none closed the Navier--Stokes-specific implication.

## Candidate Dispositions

| Route | Disposition | First decisive issue |
|---|---|---|
| Universal critical-flux absorption on $\mathbb T^3$ | `refuted` | Exact high-high-to-low influx grows like $A^2$ while low-mode dissipation stays fixed. |
| Flux-only packing-to-CKN bridge | `refuted` | A smooth periodic shear has zero nonlinear flux and pressure but arbitrarily large scale-invariant cubic velocity. |
| Shell-time diagonal blowup inference | `refuted` | Values at shell-dependent times do not imply one-time $H^1$ divergence. |
| Compact centered $L^3$ ancient orbit | `proved`, not new | Albritton-Barker Theorem 1.2 is stronger in the mild ancient class. |
| Fault-tolerant quorum shell band | `refuted` | Amplitude scaling and a triad crossing an empty band. |
| Exact synchronized cascade | `blocked` | No derived phase-locking, sign-definite transfer, or persistence estimate for the exact operator. |
| Critical $L^3$ a priori bound | `blocked` | This is the central open estimate. |
| Critical ancient-profile bridge | `blocked` | Rescaling gives local ancient limits, not the backward $L^3$ sequence required by Liouville rigidity. |
| Naive $r_Q^{-1}$ cube measure | `refuted` | A matched binary stopping tree charges one scale-invariant unit per generation. |
| Local-only harmonic pressure control | `refuted` | A remote divergence-free packet creates a nonzero harmonic pressure tail locally. |
| Matched-scale commutator smallness | `refuted` | Rescaling keeps the commutator ratio fixed and nonzero. |
| CLMS-to-suitability transfer | `refuted` | Energy bounds do not supply the required Hardy-BMO pairing. |
| Finite-Galerkin zero-flux transfer | `refuted` | Zero flux does not supply compactness, suitability, or CKN control. |
| Occupancy-only packing-to-CKN bridge | `refuted` | Exact shear flow has zero defect but arbitrarily large CKN cubic quantity. |

## Verification

The final internal state passes:

```text
python -m ns_millennium.ledger artifacts/claims.json
python -m unittest discover -s tests -v
```

The suite contains 34 ledger regressions plus 15 exact Fourier/Galerkin tests
(49 total).
Editor diagnostics report no errors.

The phase-space route is explicitly blocked on four named measure,
pressure/commutator, packing-to-epsilon, and cutoff-uniformity obligations. No
convergence claim is made for the finite RK4 probe or for the research program
as a whole.

Rounds 18-25 are recorded in
[`GAUNTLET_ROUNDS_018_025.md`](docs/research/GAUNTLET_ROUNDS_018_025.md).
The nine profile attacks are recorded in
[`CRITICAL_PROFILE_ITERATION_002_003.md`](docs/research/CRITICAL_PROFILE_ITERATION_002_003.md).

## Limits

- The preferred Sonnet 5, Opus 4.8, and GPT-5.6 subagent models were not
  available. Nearby named agents either lacked filesystem tools or did not
  expose their runtime model identity; those runs receive no model-rotation
  credit.
- Local files cannot authenticate human or model identity without an external
  signed trust root.
- The project is untracked in the parent Git repository. Hash chaining detects
  edits only while the files remain present; durable history requires an
  explicitly authorized commit.
- Numerical and finite-mode checks refute universal statements but do not prove
  universal regularity.

The honest stopping condition is a genuine mathematical blocker, not internal
convergence: no proof was found, and `CLAY-A` remains `blocked` in
`artifacts/claims.json`.
