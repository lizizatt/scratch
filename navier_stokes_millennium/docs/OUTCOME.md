# Research Outcome

**Date:** 2026-08-18
**Mathematical status:** `blocked`
**Millennium problem status:** unsolved

## Result

This project does not contain a proof or counterexample resolving the
three-dimensional incompressible Navier-Stokes Millennium problem. Thirty-five
adversarial gauntlet rounds have been recorded, spanning literature
synthesis, exact finite-mode computation, frequency/phase-space packing,
critical-profile compactness, and a proved conditional continuation
criterion. No round produced a candidate proof whose dependency closure was
settled.

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

The most significant refinement of that route is the proved conditional
theorem `LOCAL-L3-CONTINUATION` (see [`docs/proofs/LOCAL_L3_CONTINUATION.md`](proofs/LOCAL_L3_CONTINUATION.md)):
replacing the global bound above with a *local, fixed-radius* $L^3$ bound
uniform over all spatial centers near a finite endpoint is already sufficient,
via KNSS record-point rescaling and Albritton-Barker rigidity, to rule out
that endpoint. Two natural derivation routes for that local bound (energy plus
Serrin interpolation, and CKN singular-set smallness) have since been
rigorously ruled out at the estimate level. The genuinely open step is now a
single, sharply stated local anti-concentration estimate rather than the
original diffuse global bound.

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
  and the occupancy-only packing-to-CKN bridge. `FREQ-PHASESPACE` remains
  `blocked` and `FREQ-PACKING` remains `conjectured`; neither was upgraded.
- A fresh critical-profile iteration found no proof or admissible counterexample.
  The exact gap is global backward $L^3$ boundedness and pressure/mildness
  control for the ancient profile needed by the Liouville theorem.
- Three modalities were each tested for three iterations: scale-adapted tail
  transfer, dynamically recentered orbit compactness, and fixed backward-time
  selection. Each yielded a conditional sufficient lemma plus an estimate-level
  obstruction, but none closed the Navier--Stokes-specific implication.
- Proved `LOCAL-L3-CONTINUATION`: a fixed-radius local $L^3$ bound uniform over
  all spatial centers near a finite endpoint yields a bounded ancient profile
  by KNSS rescaling and contradicts Albritton--Barker rigidity. The new open
  estimate is deriving that local bound from smooth finite-energy data.
- Attacked `LOCAL-L3-BOUND-DERIVATION` from four independent directions:
  vorticity-direction coherence and a direct Carleman/backward-uniqueness
  adaptation were each ruled out or left blocked at the same missing tail
  information, and a Type I plus self-similar exclusion route was refuted.
  One genuine narrowing was found: a strictly weaker record-center-only
  hypothesis still suffices for continuation, recorded as `conjectured`
  pending independent adversarial verification.
- Proved `LOCAL-L3-RECORD-CENTERS` after independent adversarial review: the
  record-center-only hypothesis is genuinely weaker than $M_R$ and the
  continuation argument goes through unchanged, but the review also confirmed
  the narrowing gives no derivational shortcut, so `LOCAL-L3-BOUND-DERIVATION`
  remains `blocked`.

## Candidate Dispositions

Rows below cite the canonical claim ID in `artifacts/claims.json` where one
exists. "Exact synchronized cascade" was never formalized into a ledger claim
(no derived operator or estimate to check) and is recorded narratively only,
per round 1's findings.

| Route | Disposition | First decisive issue |
|---|---|---|
| Universal critical-flux absorption on $\mathbb T^3$ (`UNIVERSAL-FLUX-ABSORPTION`) | `refuted` | Exact high-high-to-low influx grows like $A^2$ while low-mode dissipation stays fixed. |
| Flux-only packing-to-CKN bridge (`FREQ-FLUX-CKN`) | `refuted` | A smooth periodic shear has zero nonlinear flux and pressure but arbitrarily large scale-invariant cubic velocity. |
| Shell-time diagonal blowup inference (`CASCADE-DIAGONAL-SUFFICIENCY`) | `refuted` | Values at shell-dependent times do not imply one-time $H^1$ divergence. |
| Compact centered $L^3$ ancient orbit (`COMPACT-L3-ORBIT`) | `proved` | Already implied by Albritton-Barker Theorem 1.2 in the mild ancient class; not a new result. |
| Fault-tolerant quorum shell band (`FTDS-PDE-1`) | `refuted` | Amplitude scaling and a triad crossing an empty band. |
| Exact synchronized cascade (no ledger claim) | `blocked`, narrative only | No derived phase-locking, sign-definite transfer, or persistence estimate for the exact operator. |
| Critical $L^3$ a priori bound (`CRITICAL-BOUND`) | `blocked` | This is the central open estimate. |
| Critical ancient-profile bridge (`CRITICAL-PROFILE-GAP`) | `blocked` | Rescaling gives local ancient limits, not the backward $L^3$ sequence required by Liouville rigidity. |
| Uniform local $L^3$ continuation criterion (`LOCAL-L3-CONTINUATION`) | `proved` | KNSS record-point rescaling plus local control yields a globally $L^3$-bounded ancient profile; deriving the local control remains open. |
| Deriving the local $L^3$ bound from finite-energy data (`LOCAL-L3-BOUND-DERIVATION`) | `blocked` | No known technique currently supplies this estimate; see the two refuted routes below. |
| Local $L^3$ bound from energy/Serrin interpolation (`LOCAL-L3-FROM-ENERGY`) | `refuted` | A self-similar concentrating field has $m_R\in L^{4/3}_t$ but $m_R\to\infty$ pointwise as $t\uparrow T$. |
| Local $L^3$ bound from CKN singular-set smallness (`LOCAL-L3-FROM-CKN`) | `refuted` | A single-point-singularity field has zero-measure singular set yet unbounded local $L^3$ mass at that point. |
| Local $L^3$ bound from vorticity-direction coherence (`LOCAL-L3-FROM-VORTICITY-COHERENCE`) | `refuted` | Genuine Constantin-Fefferman coherence already proves regularity directly, and coherence does not survive record-point rescaling. |
| Local $L^3$ bound from Carleman/backward-uniqueness adaptation (`LOCAL-L3-FROM-CARLEMAN`) | `blocked` | Requires a terminal zero trace and additional tail control not supplied by finite energy. |
| Local $L^3$ bound from Type I rate plus self-similar exclusion (`LOCAL-L3-FROM-TYPE-I`) | `refuted` | The Type I rate alone lets local $L^3$ mass diverge, and Type I to self-similar tangent is unproven (`BUP-003`). |
| Weaker record-center-only local $L^3$ hypothesis (`LOCAL-L3-RECORD-CENTERS`) | `proved` | Genuinely weaker than $M_R$ over all centers, verified by independent review, but still not derivable from finite energy alone. |
| Naive $r_Q^{-1}$ cube measure (`FREQ-NAIVE-MEASURE`) | `refuted` | A matched binary stopping tree charges one scale-invariant unit per generation. |
| Local-only harmonic pressure control (`FREQ-PRESSURE-LOCAL`) | `refuted` | A remote divergence-free packet creates a nonzero harmonic pressure tail locally. |
| Matched-scale commutator smallness (`FREQ-MATCHED-COMMUTATOR`) | `refuted` | Rescaling keeps the commutator ratio fixed and nonzero. |
| CLMS-to-suitability transfer (`PR-CLMS-TRANSFER`) | `refuted` | Energy bounds do not supply the required Hardy-BMO pairing. |
| Finite-Galerkin zero-flux transfer (`FREQ-GALERKIN-UNIFORM`) | `refuted` | Zero flux does not supply compactness, suitability, or CKN control. |
| Occupancy-only packing-to-CKN bridge (`FREQ-PACKING-EPSILON-COMPARABLE`) | `refuted` | Exact shear flow has zero defect but arbitrarily large CKN cubic quantity. |

## Verification

The final internal state passes:

```text
python -m ns_millennium.ledger artifacts/claims.json
python -m unittest discover -s tests -v
```

The suite contains 36 ledger regressions plus 15 exact Fourier/Galerkin tests
(51 total).
Editor diagnostics report no errors.

The phase-space route is explicitly blocked on four named measure,
pressure/commutator, packing-to-epsilon, and cutoff-uniformity obligations. No
convergence claim is made for the finite RK4 probe or for the research program
as a whole.

Rounds 18-25 are recorded in
[`GAUNTLET_ROUNDS_018_025.md`](research/GAUNTLET_ROUNDS_018_025.md).
The nine profile attacks are recorded in
[`CRITICAL_PROFILE_ITERATION_002_003.md`](research/CRITICAL_PROFILE_ITERATION_002_003.md).
Rounds 26-31 (the critical-profile gap, the three transfer modalities, the
proved local continuation criterion, and the two refuted derivation routes
for its hypothesis) are recorded individually under
[`artifacts/gauntlet/`](../artifacts/gauntlet/), with full immutable
claim snapshots and hash chaining back to round 1.

## Limits

- The preferred Sonnet 5, Opus 4.8, and GPT-5.6 subagent models were not
  available. Nearby named agents either lacked filesystem tools or did not
  expose their runtime model identity; those runs receive no model-rotation
  credit.
- Local files cannot authenticate human or model identity without an external
  signed trust root.
- This project is tracked in the parent Git repository and is pushed to a
  remote; hash chaining and version control jointly detect edits.
- Numerical and finite-mode checks refute universal statements but do not prove
  universal regularity.

The honest stopping condition is a genuine mathematical blocker, not internal
convergence: no proof was found, and `CLAY-A` remains `blocked` in
`artifacts/claims.json`.
