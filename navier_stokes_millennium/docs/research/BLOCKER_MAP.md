# Navier--Stokes Route Blocker Map

**Date:** 2026-08-19
**Scope:** all functional, frequency, profile, geometric, computational, and
regularity routes currently represented in the repository and the first five
queue items audited after the functional inventory.

## Executive summary

The routes are not failing for one literally identical reason, but their first
failures cluster into eight recurring gates:

1. **Critical homogeneity:** the available energy is too weak at the record
   scale, or a proposed functional has the wrong scaling.
2. **Nonlinear transfer:** quadratic Navier--Stokes dynamics create cubic flux;
   exact high-high-to-low interactions defeat recipient-scale dissipation.
3. **Pressure/nonlocality:** localization creates near pressure circularity or
   far-field/harmonic tails; projecting pressure away does not control the
   resulting nonlocal term.
4. **Coercivity/sign:** signed quantities can cancel transfer but lose
   positivity; positive quantities retain sign-indefinite transfer.
5. **Fixed-profile time:** spacetime or good-time estimates do not control the
   prescribed KNSS slices $t_k+M_k^{-2}s_j$.
6. **Compactness/tail:** local ancient convergence does not give global
   $L^3$ control, tightness, minimality, or exclusion of separated bubbles.
7. **Geometry does not control amplitude:** set size, vorticity alignment, and
   filament shape do not by themselves bound local amplitude.
8. **Continuum certification:** finite-mode, numerical, or formal certificates
   lack cutoff-uniform constants and a passage to the whole-space PDE.

The single central target remains
`LOCAL-L2-ANTI-CONCENTRATION`. If it were proved, the existing
`LOCAL-L3-RECORD-CENTERS` reduction and Albritton--Barker rigidity would rule
out a finite endpoint. No current route derives it from finite-energy data.

## Recurring blockers

### B1. Critical homogeneity and energy loss

The global energy class controls quadratic quantities, but under
$u_\lambda(x,t)=\lambda u(\lambda x,\lambda^2t)$,

$$
\|u_\lambda\|_2^2=\lambda^{-1}\|u\|_2^2.
$$

At record scale $\ell_k=M_k^{-1}$, the target contains
$M_k\int_{B_{\rho_k}}|u|^2$. Finite energy supplies an $O(M_k)$ loss rather
than a uniform bound. Functionals with the wrong power fail before their
PDE identity can matter.

**Routes hit:** global energy/Serrin, higher-derivative windows, resolvent
parameter choices, windowed essential-supremum energy, singular-set geometry.

### B2. Cubic transport and triadic transfer

The nonlinearity $B(u,u)$ is quadratic in the state, so energy evolution sees
cubic transfer. A high-high-to-low triad can feed a low mode while its recipient
dissipation stays fixed. Uniform amplitude scaling makes cubic flux grow like
$A^3$; differentiating a cubic flux completion produces degree-four terms.

**Routes hit:** Fourier flux, shell cascades, polynomial Galerkin candidates,
wavelet flux completion, modulation/Gabor windows, helicity combinations,
kinetic-enstrophy, monotonicity candidates.

**Status:** exact finite-mode stress tests refute universal absorption claims,
but do not refute every possible higher-order cancellation.

### B3. Pressure and nonlocal tails

The local energy identity contains pressure at the cutoff boundary. Near-field
Calderón--Zygmund control is as strong as the cubic quantity being sought;
far-field pressure is harmonic/nonlocal and only receives a supercritical
finite-energy bound. Leray or Biot--Savart notation relocates pressure into a
nonlocal operator; it does not make the tail coercive.

**Routes hit:** local energy/CKN, Bogovskii, pressure moments, Riesz/Biot--Savart,
resolvent pairings, local helicity, Carleman weights, phase-space pressure
corrections.

For instantaneous pressure moments, B3 is the first failure: differentiating a
pressure moment requires uncontrolled $p_t$ and creates the $|u||p|^2$ pairing.
B4 is the secondary sign/coercivity issue, not a replacement for the pressure
derivative obstruction.

### B4. Loss of sign or coercivity

A positive functional must control absolute concentration, but then nonlinear
transfer is sign-indefinite. A signed functional can cancel transfer but no
longer controls the size of the field. For helicity, positive helical energies
retain transfer; the signed difference is noncoercive.

**Routes hit:** helicity/helical signs, signed enstrophy, entropy/monotonicity,
flux-only defects, pressure moments, all finite-degree polynomial candidates
whose leading nonlinear form is not sign-definite.

### B5. Fixed-profile-time quantifiers

The target is a bound at fixed $s_j$ chosen before $k\to\infty$:

$$
\sup_j\limsup_k M_k\int_{B_{\rho_k}(a_k)}
 |u(x,t_k+M_k^{-2}s_j)|^2\,dx<\infty.
$$

Averaging over physical time produces $k$-dependent good times, often sent to
$s=-\infty$ after rescaling. Smoothness at each $k$ gives no uniform rescaled-time
modulus. This blocks conversion of window, semigroup, enstrophy, Carleson, and
energy estimates into the slices needed by the ancient-profile theorem.

**Routes hit:** local CKN energy, Bogovskii, semigroup/Duhamel, modulation,
kinetic-enstrophy, higher-derivative windows, Carleman, vorticity enstrophy,
ancient-profile time selection.

This is a separate quantifier gate from spatial or scale failure: a route may
control a time average and still fail because the estimate is unavailable at
the prescribed slices $s_j$. When both failures occur, B5 is listed as an
independent transfer gate rather than the explanation for the earlier failure.

### B6. Compactness, escape, and minimality

KNSS gives a nonzero ancient profile with local convergence. It does not give a
backward $L^3$-bounded sequence, global tail tightness, almost-periodicity, or a
minimal element. Separated bubbles can remain bounded locally while preventing
global $L^3$ compactness.

**Routes hit:** minimal blowup/induction on scales, critical tail transfer,
ancient-orbit compactness, Liouville/profile bridges, Carleman rigidity.

### B7. Geometry does not control amplitude

CKN measure-zero information, vorticity direction, curvature, helicity
cancellation, and filament straightness constrain where or how structures sit,
but not their absolute amplitude at one selected time. Concentrated tubes and
single-point stress tests preserve benign geometry while local critical mass
still grows.

**Routes hit:** CKN singular-set geometry, capacity/porosity/Minkowski geometry,
vorticity coherence, filament geometry, helicity, strain/eigenvalue proposals.

### B8. Finite-mode and numerical continuum gaps

Finite Fourier tests can refute a universal inequality, but a surviving finite
certificate would still need constants uniform in cutoff, pressure control,
compactness, and a whole-space limit. RK4, SOS, interval, adaptive, and learned
surrogates do not automatically quantify the infinite-dimensional continuum.

**Routes hit:** Galerkin zero-flux, polynomial degree search, SOS certificates,
RK4 probes, interval/numerical certification, adaptive multiscale proposals.

The exact triad is a narrow successful disproof tool, not a universal PDE
certificate. RK4, shell-density, and finite-Galerkin infrastructure remains
partial because no cutoff-uniform whole-space continuum bridge exists.

## Route matrix

| Route family | Current status | First stopping point | Main blocker(s) |
|---|---|---|---|
| Global energy and Serrin interpolation | refuted | Energy-to-local-$L^3$ inference has a checked concentrating counterexample | B1 |
| Local energy / CKN singular-set geometry | refuted | Set-size information does not imply local critical mass | B7 |
| Local energy / CKN along record centers | blocked | Near pressure is circular; far tail is supercritical | B3, B5 |
| Bogovskii/solenoidal localization | blocked | Time-dependent correction restores pressure flux | B3, B5 |
| Kinetic plus enstrophy | blocked | Interior stretching can absorb conditionally; annular tail cannot | B2, B3, B5 |
| Higher derivative enstrophy | blocked | Scaling mismatch or derivative/pressure hierarchy | B1, B3 |
| Instantaneous pressure moments | blocked | $p_t$ and $|u||p|^2$ are uncontrolled | B3, B4 |
| Fourier shell/flux absorption | refuted | Exact high-high-to-low triad | B2 |
| Frequency Carleson/phase-space packing | blocked | `FREQ-PACKING` is underspecified; occupancy-only packing does not imply a regular scale | B2, B3, B7 |
| Exact finite-Fourier/Galerkin probes | partial: narrow disproofs | Exact triads refute selected inequalities; continuum bridge is absent | B2, B8 |
| Besov/paraproduct | blocked | Matched commutator and fixed-time high-frequency gap | B2, B5 |
| Wavelet phase-space | blocked | Quartic flux derivative and $\rho/\ell$ restates target | B2, B5 |
| Modulation/Gabor | blocked | Donor/receiver windows split across triad | B2, B5 |
| Semigroup/Duhamel | blocked | Matching parameter escapes as $r_k^{-2}$; commutator remains | B2, B5 |
| Resolvent/Mellin | blocked | Spectral parameter escape and sign-indefinite pairing | B1, B2, B5 |
| Riesz/Biot--Savart | blocked | Critical $L^3$ rewritten nonlocally; kernel tails remain | B3, B5 |
| Helicity/helical signs | blocked | Positive signs retain transfer; signed difference loses coercivity | B2, B4, B5 |
| Vorticity-direction coherence | refuted | Coherence alone does not control local $L^3$; full CF is non-modular | B7 |
| Vorticity filament geometry | blocked | Curvature/helicity/stretching hypotheses are not supplied at fixed slices | B5, B7 |
| Type I rate alone | refuted | Type I rate does not bound local $L^3$ | B1 |
| Type I plus self-similar tangent | blocked | Type-I-to-self-similar implication is missing and circular | B6 |
| Strain/eigenvalue invariants | untried | Needs sign-definite stretching depletion | B2, B4, B7 |
| Infinite shell hierarchy | untried | No one-way transfer or cutoff-uniform bound | B2, B8 |
| SOS/semidefinite certificates | partial/untried | Galerkin certificate lacks continuum bridge | B2, B8 |
| Variational extremal | untried | Concentrating minimizing sequences lose compactness | B1, B6 |
| Monotonicity/entropy | blocked | No candidate sign-definite critical identity | B2, B3, B4 |
| Lagrangian flow-map | untried/partial | Flow distortion does not retain Eulerian local mass | B5, B6 |
| Adaptive multiscale | untried | Moving cutoff creates a new uncontrolled time derivative | B5, B8 |
| Stochastic/ensemble | outside deterministic problem | Ensemble bounds do not imply every trajectory | B5 |
| Residual/learned numerical functionals | outside proof closure | False positives, aliasing, and continuum error | B8 |

## What has actually been ruled out

The project has not proved that no functional exists. It has ruled out or
blocked specific subclasses and bridges:

- universal recipient-scale flux absorption;
- flux-only or occupancy-only packing-to-CKN implications;
- energy-to-Serrin and CKN-measure-to-local-$L^3$ implications;
- direct Bogovskii pressure removal;
- the first four local functional designs;
- the first wavelet/Gabor, semigroup, resolvent, Riesz, and helical candidates;
- the declared finite-degree Galerkin polynomial pattern.

The common endpoint is not “all mathematics fails.” It is:

> no current route supplies a scale-critical, coercive estimate at the prescribed
> fixed KNSS profile times while also controlling pressure/nonlocal tails and
> absolute local amplitude.

## Next use

For every new proposal, identify the first blocker it changes. If it changes
none of B1--B8, it is probably a renamed route and should not receive a new
claim. If it changes one, state the new lemma that supplies that missing gate
before investing in implementation.
