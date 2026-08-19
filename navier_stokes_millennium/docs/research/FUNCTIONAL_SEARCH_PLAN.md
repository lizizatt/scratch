# Polynomial Functional Search Plan

**Date:** 2026-08-19
**Status:** finite-mode search plan completed; finite-mode results are not PDE
proofs.

## Objective

Systematically test whether a finite-degree, scale-aware polynomial functional
for projected Navier--Stokes dynamics can provide a coercive critical estimate.
The target is not to search all imaginable functionals. It is to close one
explicit class and state exactly what remains outside it.

## Search class

On a finite divergence-free Galerkin mode set, write

$$
\dot z=-\nu A z-B(z,z).
$$

Search real polynomial candidates

$$
V(z)=V_2(z)+V_4(z)+\cdots+V_{2D}(z),
$$

where each $V_{2m}$ is homogeneous of degree $2m$, nonnegative on the mode
space, and its coefficients are invariant under conjugate reality symmetry.
The candidate may include cross-mode terms, but not hidden time dependence or
coefficients chosen after seeing a trajectory.

The finite-mode certificate being tested is

$$
\mathcal L V(z)
:=DV(z)[-\nu Az-B(z,z)]
\leq -c\,D(z)+C,
$$

where $D$ is a declared nonnegative polynomial dissipation functional and the
constants are uniform over amplitude and the selected mode cutoff. A positive
finite-mode certificate is only a candidate for a PDE argument: the continuum
limit, cutoff-uniform constants, pressure projection, and critical-space
coercivity must still be proved separately.

## Iterations

### Iteration 1: formal specification

Freeze the search class, generator, degree bookkeeping, and failure statuses.
Deliverable: this document.

### Iteration 2: generator degree audit

Implement exact degree propagation for $V_{2m}$ under the linear and quadratic
parts of the Galerkin generator. Deliverable: a small library and unit tests
showing that the nonlinear derivative of a degree-$d$ term has degree $d+1$.

### Iteration 3: exact triad obstruction

Apply the audit to the checked high-high-to-low fixture and amplitude families.
For each finite-degree ansatz, test whether the highest odd-degree nonlinear
term has a fixed sign or can be dominated by the declared dissipation. A sign
indefinite leading term rejects that ansatz class.

### Iteration 4: independent review

Have a fresh reviewer inspect the class definition, degree argument, and triad
calculation for hidden quantifier changes, incorrect scaling, or confusion
between a Galerkin counterexample and a PDE theorem.

### Iteration 5: disposition

Record one of:

- `refuted`: the entire declared finite-degree subclass fails an exact test;
- `blocked`: the audit identifies a missing coefficient search, continuum
  bridge, or sign condition;
- `conjectured`: a candidate survives finite-mode tests but lacks a PDE bridge;
- `proved`: only if a complete internal proof artifact and falsification attempt
  satisfy the repository contract.

## Burn-down result

- **Iteration 1:** specification committed as `444eca3`.
- **Iteration 2:** generator degree audit and focused tests committed as
  `3df8ea9`.
- **Iteration 3:** exact high-high-to-low triad degree audit committed as
  `fa2f213`.
- **Iteration 4:** two independent reviewers found a real mismatch between
  the fixture's high-only amplitude parameter and uniform field scaling. The
  repair added an exact uniform-scaling regression and was recorded in round
  049.
- **Iteration 5:** full validation completed: ledger valid, 58 tests passed,
  no editor diagnostics, and no whitespace errors.

The finite-degree Galerkin search did not produce a surviving coercive
functional. It did produce a scoped obstruction: cubic flux completions create
quartic generator terms, and the exact triad defeats the corresponding
quadratic-dissipation pattern. The next required bridge is analytic and
continuum-level: cutoff-uniform coefficient control, pressure handling, and
fixed-profile-time local coercivity.

## Stop conditions

Stop this program if:

1. the highest-degree term is sign-indefinite on an exact triad family;
2. a proposed certificate requires constants growing with amplitude or cutoff;
3. a positive finite-mode result has no plausible cutoff-uniform analytic bridge;
4. the next iteration merely renames a previously rejected pressure, transport,
   or fixed-time argument.

## Non-claims

This plan will not prove that no Navier--Stokes functional exists. It can prove
only a no-go result for the declared finite-degree Galerkin subclass, or produce
a finite-mode candidate that requires a separate continuum theorem.
