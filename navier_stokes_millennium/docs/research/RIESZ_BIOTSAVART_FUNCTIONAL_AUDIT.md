# Riesz and Biot--Savart Functional Audit

**Date:** 2026-08-19
**Disposition:** blocked; the candidate is a nonlocal rewriting of the critical
$L^3$ obstruction.

## Candidate

Let $\mathcal B=\nabla\times(-\Delta)^{-1}$, so $u=\mathcal B\omega$ for
solenoidal fields. Test the localized critical functional

$$
\mathcal F_{R,a}(\omega)=\int\chi_{R,a}|\mathcal B\omega|^3\,dx
=\int\chi_{R,a}|u|^3\,dx.
$$

It has the correct Navier--Stokes scaling, but its criticality is also its
problem: it directly measures the quantity the existing continuation route
needs to derive.

## First evolution obstruction

Differentiating the functional through
$u_t=\nu\Delta u-\mathbb P(u\cdot\nabla u)$ gives diffusion and cutoff terms,
plus the pressure-equivalent pairing

$$
3\int p\left(|u|u\cdot\nabla\chi
+\chi u\cdot\nabla|u|\right)\,dx.
$$

The Leray projection has not removed the pressure mechanism; it has hidden it
inside a nonlocal Riesz transform. The interior term is sign-indefinite.

## Stress tests

- A translated vorticity packet creates a nonzero Biot--Savart multipole in a
  remote observation ball. Cutting it away loses the velocity; retaining it
  requires an uncontrolled kernel tail.
- A smooth shear is pressure-free and consistent with the functional but gives
  no damping mechanism for concentrated absolute mass.
- The exact high-high-to-low triad, with a constant background perturbation,
  makes the pressure-equivalent interior term change sign under $u\mapsto-u$.
  Its quartic amplitude growth cannot be absorbed by cubic dissipation.
- A concentrated straight vortex tube is an exact periodic stress test with
  bounded energy and divergent critical $L^3$ mass at its scale. It is not a
  whole-space singular-solution counterexample.
- At KNSS times, the energy estimate gives only the same $M_kE_0$ loss and
  time-averaged control as the original local $L^3$ route.

## Disposition

The explicit Biot--Savart functional does not survive: its first unabsorbable
term is a sign-indefinite nonlocal pressure pairing, and localization adds
multipole tails. The broader Riesz/Biot--Savart class remains blocked rather than
refuted; moving pressure into a kernel does not create coercivity or fixed-time
anti-concentration.
