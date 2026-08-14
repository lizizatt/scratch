# Frequency-Packing Iteration 002

**Status:** blocked; no regularity theorem claimed.

This iteration follows the first phase-space brainstorm. The time-frequency
measure from Iteration 001 does not see where in space a bad shell is active.
That is a serious gap because epsilon-regularity is a spacetime statement, not
a time-only statement.

## What survives

A useful route still has three separate gates:

$$
\text{flux estimate}
\longrightarrow
\text{phase-space good-scale lemma}
\longrightarrow
\text{continuation control}.
$$

The first exact triad refutes pointwise flux absorption, but it does not by
itself refute a packing statement that allows rare bad events.

The narrower flux-only bridge is now refuted: `FREQ-FLUX-CKN` fails for a
smooth periodic shear flow with zero nonlinear flux and zero pressure but
large scale-invariant cubic velocity. Any surviving phase-space defect must
control absolute velocity and pressure quantities in addition to bad-event
occupancy.

## Phase-space candidate

Let $Q$ be a dyadic spatial cube of side $r_Q$ and let $j$ be a frequency
shell. A localized bad event should compare a localized nonlinear flux with
localized dissipation, using a pressure decomposition that includes its harmonic
remainder:

$$
\left|\Pi_{Q,j}(t)\right|
>\theta\,\nu\,2^{2j}E_{Q,j}(t).
$$

The candidate measure is formally

$$
\mu_\theta(d x,dt,d\tau)
=\sum_{Q,j}\mathbf 1_{B_{Q,j}}(t)\,dt\,w(Q,j)\,\delta_{2^{-2j}}(d\tau)\,\delta_Q(dx).
$$

The weight $w(Q,j)$ is deliberately **unresolved**. It must be chosen so that
its Carleson norm is invariant under

$$
(x,t,u,p)\mapsto(\lambda x,\lambda^2t,\lambda u,\lambda^2p),
$$

and so that summing over the spatial cubes at one scale does not count the
same physical event once per overlapping decomposition. The tempting factor
$w(Q,j)=r_Q^{-1}$ is not accepted without a full dimensional calculation.

> **Claim FREQ-PHASESPACE (`blocked`).** There exists a scale-invariant
> choice of $w(Q,j)$ and a pressure-defect term for which a phase-space Carleson
> packing bound forces at least one epsilon-regular scale inside every
> sufficiently small parabolic cylinder.

The parent claim is split in the canonical ledger into four blocked
obligations: `FREQ-PHASESPACE-MEASURE` (a scale-invariant, non-overcounting
weight), `FREQ-PRESSURE-COMMUTATOR` (localized pressure and cutoff estimates),
`FREQ-PACKING-EPSILON` (the local packing-to-CKN bridge), and
`FREQ-PACKING-UNIFORM` (cutoff-uniform constants and a Galerkin-to-PDE
convergence hypothesis). No finite numerical run settles any of these
obligations.
This is stronger and more relevant than time-frequency packing, but also more
fragile: spatial localization introduces cutoff commutators and a harmonic
pressure component.

## Immediate objections

1. **Pressure:** localized pressure is not only a local Riesz transform. Splitting
   $p$ into near, far, and harmonic parts is required; the harmonic part can
   carry information from outside the cube.
2. **Overlap:** arbitrary dyadic cubes overlap across scales. A measure can
   overcount one concentration unless the packing family is organized as a tree
   of disjoint stopping cubes.
3. **Frequency leakage:** $\Delta_j$ is nonlocal in physical space. Localizing
   both $x$ and $\xi$ creates commutators; the badness definition must pay for
   them.
4. **Bridge gap:** even a valid phase-space packing estimate does not by itself
   imply $L^\infty_tL^3_x$. The good-scale conclusion must be proved separately
   using suitable local energy and pressure bounds.

## Cutoff-uniformity gate

Any computationally testable packing inequality must specify constants uniform
in Fourier cutoff and spatial partition, plus a convergence hypothesis linking
the finite Galerkin systems to a suitable Navier-Stokes solution. A
solution-dependent constant chosen separately for each finite cutoff is not a
universal inequality and cannot be falsified by observing growth across
cutoffs.

## Minimal next lemma

The next useful theorem-sized target is deliberately local:

> If a suitable solution on $Q_{2r}(z_0)$ has a scale-invariant phase-space
> packing bound with sufficiently small defect constant, and its localized
> pressure decomposition has controlled harmonic remainder, then one smaller
> cylinder $Q_r(z_0)$ satisfies the CKN epsilon criterion.

The packing bound, the pressure estimate, and the implication are all
`blocked`. This target is narrower than global regularity and can fail without
claiming anything about the Millennium problem.

## Probe design

A finite Galerkin experiment can test only the frequency part. A meaningful
probe should:

- use an active Fourier set closed under retained convolution outputs;
- evolve the exact projected ODE, not a fixed-mode RHS with hidden leakage;
- partition physical space only after reconstructing the finite trigonometric
  polynomial;
- measure localized flux, localized dissipation, pressure near/far/harmonic
  pieces, and cutoff commutators separately;
- refine both Fourier cutoff and spatial partition.

The implementation now has a closed integer Fourier-ball constructor, a
 classical RK4 step for the projected finite ODE, and 2pi-periodic-torus spatial
reconstruction with shell energy, nonlinear flux, and viscous dissipation
density. These are probe infrastructure only:
the tests verify exact small-ball membership, viscous single-mode
amplification, projection, reality, active-mode closure, discrete Parseval, and
modal/local flux and dissipation agreement, but do not compute the phase-space
measure, pressure split, cutoff-uniformity constant, or packing-to-epsilon
bridge.

The localized flux includes every retained convolution output in the selected
shell, including outputs whose velocity coefficient is currently zero. Grid
averages require a non-aliasing resolution for every frequency in the sampled
products; the tests use a 17-point grid for the $\pm8$ dissipation boundary.
Viscosity is required to be finite and non-negative.

A violation at finite cutoff falsifies that finite inequality. Passing the probe
is evidence about the chosen Galerkin systems, not a universal PDE result.

## Disposition

- Time-frequency packing alone: **insufficient for the epsilon bridge**.
- Naive fixed spatial weight: **unverified; do not use**.
- Phase-space packing with pressure-defect control: **blocked** on the four
   named obligations above.
- Local packing-to-epsilon lemma: **blocked**.
- Global critical continuation: **blocked at CRITICAL-BOUND**.
