# Functional Ansatz Inventory

**Date:** 2026-08-19
**Purpose:** exhaustive search queue for critical/coercive/fixed-time
Navier--Stokes functionals.

This inventory is exhaustive only within the declared axes below. It is not a
claim that every mathematical expression has been enumerated. A class is
considered distinct only if it changes the state variable, localization
operator, time operator, algebraic structure, or proof objective.

## Search axes

### State variable

1. Velocity $u$.
2. Vorticity $\omega=\nabla\times u$.
3. Strain/skew matrices $S=(\nabla u+\nabla u^T)/2$ and
   $\Omega=(\nabla u-\nabla u^T)/2$.
4. Pressure $p$ or the pressure-free Leray-projected equation.
5. Flow map $X$ and deformation gradient $\nabla_aX$.
6. Fourier, wavelet, shell, or modulation coefficients.
7. Semigroup/resolvent variables such as $e^{-tA}u$ or $(\lambda+A)^{-s}u$.
8. Singular-set geometry, capacities, or defect measures.
9. Stochastic/ensemble variables.
10. Residuals and finite-mode certificate variables.

### Localization operator

1. Physical cutoff or ball.
2. Gaussian/backward heat kernel.
3. Fourier/Littlewood--Paley shell.
4. Wavelet/phase-space cube.
5. Nonlocal Riesz/Biot--Savart kernel.
6. Lagrangian tube or flow-map pullback.
7. Adaptive multiscale partition.
8. Global/domain spectral projector.

### Algebraic structure

1. Quadratic energy.
2. Homogeneous finite-degree polynomial.
3. Mixed polynomial hierarchy.
4. $L^p$, Lorentz, Besov, Triebel--Lizorkin, modulation, Morrey, or BMO norm.
5. Signed invariant such as helicity.
6. Entropy/logarithmic/exponential functional.
7. Ratio or quotient functional.
8. Supremum/Carleson functional.
9. Variational minimum or SOS certificate.
10. Infinite convergent series/hierarchy.

### Time operator

1. Instantaneous derivative.
2. Sliding time window.
3. Convolution against a heat/semigroup kernel.
4. Backward-time weight.
5. Lagrangian path integral.
6. Mellin/Laplace transform.
7. Time-frequency Carleson measure.
8. Ensemble expectation.

### Proof objective

1. Lyapunov inequality.
2. Monotonicity across spatial scales.
3. Coercive dissipation estimate.
4. Fixed-time local anti-concentration.
5. Flux/Carleson packing.
6. Compactness/minimal-element construction.
7. Rigidity/Liouville reduction.
8. Certified finite-mode or continuum limit.

## Already tried or represented

| Family | Current disposition | First obstruction or note |
|---|---|---|
| Global kinetic energy | established/proved foundation | Supercritical under 3D scaling; only quadratic energy/dissipation available. |
| Local weighted kinetic energy | blocked | Cubic transport and nonlocal pressure boundary flux. |
| Kinetic plus enstrophy | blocked | Interior stretching can be absorbed conditionally; annular tail remains uncontrolled. |
| Higher-derivative enstrophy | blocked | Incorrect homogeneity or an unclosed derivative/pressure hierarchy. |
| Instantaneous pressure moments | blocked | Differentiation requires nonlocal $p_t$ and creates uncontrolled pairings. |
| Windowed/local-energy functionals | blocked | Good-time or spacetime control does not reach fixed profile slices. |
| Bogovskii/solenoidal localization | blocked | Time-dependent correction restores pressure flux. |
| Backward heat-kernel/Carleman weights | blocked/refuted as direct routes | Weight-gradient transport remains critical; terminal/tail hypotheses are missing. |
| Fourier shell and Littlewood--Paley flux | refuted/blocked | High-high-to-low transfer, matched commutators, pressure defects, and packing bridges. |
| Besov/paraproduct | blocked | Repeats matched-scale commutator and fixed-time/pressure obstructions. |
| Wavelet phase-space plus packet flux | blocked | Flux differentiation creates quartic terms; expanding-ball normalization restates the target. |
| Finite-degree polynomial Galerkin | scoped no-go | Quadratic generator raises degree; exact triad defeats the declared dissipation pattern. |
| Carleson/frequency packing | conjectured/blocked | Non-overcounting measure and packing-to-epsilon bridge unresolved. |
| Vorticity direction/filament geometry | refuted/blocked | Geometry does not supply fixed-slice amplitude control. |
| Singular-set measure/capacity geometry | blocked | Set size does not control velocity amplitude or pressure. |
| Type I/self-similar rates | refuted/blocked | Type I does not bound local critical mass; self-similar tangent implication is missing. |
| Ancient profiles/minimal blowup | blocked/partially established | KNSS profile exists, but minimality, global critical compactness, and backward bounds are missing. |
| Liouville/backward uniqueness | established/proved auxiliary | Rigidity applies after the missing critical bound; it does not derive it. |
| Finite-mode/RK4/SOS-adjacent computation | partial/blocked | Finite-mode certificates lack cutoff-uniform continuum bridges. |
| Cross-field monotonicity analogies | blocked | No Navier--Stokes functional with the required sign and pressure control found. |

## Untried or only partially tried queue

Each row is a separate audit target. The first test must state an exact
functional, compute scaling, derive the first generator term, and run the
listed kill test before any implementation grows around it.

| Priority | Functional class | Prototype | First obligation | Kill test |
|---:|---|---|---|---|
| 1 | Semigroup/Duhamel | $\int_0^\infty e^{-\lambda s}\|e^{-\nu sA}u(t)\|_3^3\,ds$ with critical normalization | Commute semigroup with nonlinear Duhamel term and obtain a fixed-time bound | Exact shear and finite triad; check heat damping cannot hide nonlinear growth. |
| 2 | Resolvent/fractional spectral | $\|(\lambda+A)^{-s}A^{1/2}u\|_2^2$ or a Mellin family | Choose $s$ and spectral weight with exact NS homogeneity; derive pressure-projected evolution | Single Fourier mode, high-high-to-low triad, and cutoff-uniform resolvent remainder. |
| 3 | Modulation spaces | $\|u\|_{M^{p,q}_s}$ or a localized Gabor coefficient Carleson norm | Prove a product/transport estimate at a critical index from energy-class data | Concentrated wave packet and phase-aligned packets with bounded energy. |
| 4 | Riesz/Biot--Savart | $\|\nabla(-\Delta)^{-1}\omega\|_3$ or nonlocal vorticity energy | Derive a nonlocal evolution inequality without reintroducing pressure tails | Remote packet plus local observation; concentrated vortex tube. |
| 5 | Helicity/helical signs | $\int u\cdot\omega$ or separate positive/negative helical energies | Find a coercive relation controlling both helical signs, not merely signed helicity | Zero-helicity shear, Beltrami field, and transverse triad. |
| 6 | Strain/eigenvalue invariants | $\int |S|^{3/2}$, eigenvalue ratios, or invariants of $S,\Omega$ | Derive a scale-critical stretching inequality with a sign or depletion factor | Planar shear, rotating flow, and concentrated vortex tube. |
| 7 | Lagrangian flow-map | Deformation-gradient or trajectory-weighted critical norm | Control flow-map distortion uniformly while retaining Eulerian local concentration control | Exact shear/Beltrami paths and trajectory crossing/dispersion examples. |
| 8 | Infinite polynomial hierarchy | $V=V_2+V_4+V_6+\cdots$ with coefficient recursion | Prove positivity, convergence, termwise differentiation, and uniform tail control | Triad amplitude asymptotics; test whether degree recursion diverges. |
| 9 | SOS/semidefinite certificates | $V$ and $-\mathcal LV-cD+C$ as sums of squares on Galerkin space | Compute certificates for increasing cutoffs and bound coefficient growth | Exact triad, cutoff growth, and continuum-limit remainder. |
| 10 | Infinite shell/cascade hierarchy | Weighted $\ell^2/\ell^p$ shell energy with nonlinear transfer correction | Prove a cutoff-uniform weighted hierarchy with no hidden one-way cascade assumption | Two/three-mode transfer, moving shell packet, and high-high-to-low jump. |
| 11 | Adaptive multiscale | Solution-dependent wavelet tree or moving cutoff functional | Control cutoff motion and prove refinement-independent constants | Narrow time spike that moves the adaptive tree; smooth shear. |
| 12 | Residual/optimization functional | PDE residual plus critical norm penalty | Relate small residual to a true solution estimate uniformly in resolution | Aliasing, unresolved pressure, and exact finite-mode false positives. |
| 13 | Stochastic/ensemble | Expected critical norm or randomized perturbation functional | Explain how an ensemble bound implies a deterministic trajectory bound | Rare-event concentration: bounded expectation with unbounded sample path. |
| 14 | Asymptotic/matched-scale | Inner/outer expansion with a renormalized defect functional | Prove expansion remainder uniformly at the singular scale | Non-self-similar profile and logarithmic correction. |
| 15 | Variational extremal | Minimize a critical defect over fields with fixed local concentration | Establish existence, Euler--Lagrange equation, and rule out minimizing concentration | Concentrating minimizing sequence and loss of compactness. |
| 16 | Flow-map/entropy hybrid | Entropy of deformation plus nonlocal vorticity penalty | Derive a monotone or almost-monotone identity with pressure cancellation | Shear, Beltrami, and translated remote packet. |

## Per-item protocol

For each queue item:

1. Freeze one explicit functional and its admissible data class.
2. State its exact NS scaling and the desired target implication.
3. Derive the first formal evolution term or variational equation.
4. Run constant/shear, triad, concentration, pressure-tail, and fixed-time tests.
5. Ask an independent subagent to challenge the result.
6. Classify as `proved`, `conjectured`, `blocked`, or `refuted`.
7. Record the note and a gauntlet round before starting the next item.
8. Never count a finite-mode or numerical success as a continuum proof.

## What “exhaustive” means here

This matrix closes the Cartesian design axes listed above, not mathematics as a
whole. A new proposal must identify which axis it changes. If it does not
change state variable, localization, algebraic structure, time operator, or
proof objective, it is a variant of an existing row and should be tested under
that row rather than given a new name.
