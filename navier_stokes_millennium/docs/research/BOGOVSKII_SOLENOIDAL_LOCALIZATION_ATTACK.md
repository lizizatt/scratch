# Bogovskii Solenoidal Localization Attack

**Date:** 2026-08-18
**Status:** blocked; no proof or Navier-Stokes counterexample was obtained.

This is the focused attack requested for `LOCAL-L2-ANTI-CONCENTRATION`: use an
annular Bogovskii correction to construct a divergence-free localized test and
try to remove the pressure obstruction at the KNSS record scale.

## Proposed construction

Let $\eta$ be a cutoff equal to one on $B_\rho(a)$ and supported in
$B_{2\rho}(a)$. Since $\nabla\cdot u=0$,

$$
 g=\nabla\cdot(\eta^2u)=2\eta\nabla\eta\cdot u
$$

has zero integral on the annulus
$A=B_{2\rho}(a)\setminus B_\rho(a)$. An annular Bogovskii operator would
produce $w=\mathcal B_Ag$, extended by zero, with

$$
\nabla\cdot w=g,
\qquad z=\eta^2u-w,
\qquad \nabla\cdot z=0.
$$

A fixed-ratio annulus gives scale-uniform operator constants. This repairs the
geometric construction, but it does not produce an energy identity for
$\eta^2u$.

## First unsupported inference

Testing the momentum equation with $z$ does remove the direct pressure pairing
because $\nabla\cdot z=0$. However,

$$
\langle \partial_tu,z\rangle
=\frac12\frac{d}{dt}\int\eta^2|u|^2
 -\langle\partial_tu,w\rangle.
$$

The correction is velocity-dependent. If the equation is substituted into the
remaining term, then

$$
-\langle\partial_tu,w\rangle
=-\int u\otimes u:\nabla w
 +\nu\int\nabla u:\nabla w
 -\int p\,g,
$$

up to the chosen sign convention. The pressure flux therefore returns exactly
where the correction is used. The Bogovskii test does not give a pressure-free
localized energy estimate for the original velocity.

For a suitable weak solution, an additional admissibility issue occurs: the
velocity-dependent test requires time regularization (for example Steklov
averages). The pre-endpoint solution in the KNSS setup is smooth, so this is not
the decisive obstruction, but regularization does not remove the commutator.

## Scaling audit

On an annulus of radius $\rho$, write $U$ for the local velocity scale. Then
$|g|\sim U/\rho$, and scale-invariant Bogovskii bounds give

$$
\|g\|_{L^2(A)}\sim U\rho^{1/2},
\qquad
\|\nabla w\|_{L^2(A)}\lesssim U\rho^{1/2}.
$$

Consequently,

$$
\left|\int u\otimes u:\nabla w\right|
\lesssim U^3\rho^2,
$$

which is the same scale as the ordinary cutoff transport flux
$\int |u|^3|\nabla\eta|$. Diffusion gives only

$$
\left|\int\nabla u:\nabla w\right|
\lesssim \varepsilon\|\nabla u\|_{L^2(A)}^2
 +C_\varepsilon\rho^{-2}\|u\|_{L^2(A)}^2,
$$

and the last term has the same scale as the cutoff-gradient energy remainder.
No $M_k^{-1}$ anti-concentration gain appears.

At record scale $U\sim M_k$ and $\rho=L/M_k$, the transport/correction term is
$O(M_kL^2)$. After the Navier--Stokes rescaling this is the unbounded annular
cubic flux on expanding rescaled balls, not a uniform fixed-profile estimate.

## Fixed profile times

Even if the annular terms were controlled after spacetime integration, the
result would give only an averaged or good-time estimate. The target requires

$$
\sup_j\limsup_k M_k\int_{B_{\rho_k}(a_k)}
 |u(x,t_k+M_k^{-2}s_j)|^2\,dx<\infty
$$

at fixed $s_j$ chosen before $k\to\infty$. Smoothness for each $k$ gives
continuity but no uniform rescaled-time modulus; narrowing time spikes can
therefore evade a good-time selection. A direct fixed-time estimate or a new
uniform modulus is still missing.

## Stress tests and source status

- A bounded-energy rescaled divergence-free bump reproduces the pointwise KNSS
  normalization but is not a Navier--Stokes solution; it is an algebraic stress
  test, not a PDE counterexample.
- A zero-pressure periodic shear is a genuine solution but attacks flux-only
  packing routes, not this localized-energy route.
- No suitable-solution example violating the target was found.
- The repository contains no primary-source Bogovskii or localized solenoidal
  pressure theorem with hypotheses matching the KNSS fixed-profile target. No
  such theorem is promoted to `established` here.

## Disposition

The annular construction is **repairable**, but the pressure-free derivation is
**blocked**. The first decisive obstruction is the time-dependent Bogovskii
correction: controlling it by the equation restores the pressure flux, while
its nonlinear and diffusive terms remain at critical scale. The route does not
prove `LOCAL-L2-ANTI-CONCENTRATION`, does not refute it, and does not improve the
existing finite-energy obstruction.
