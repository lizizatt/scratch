# Resolvent and Mellin Functional Audit

**Date:** 2026-08-19
**Disposition:** blocked; the first candidate failed fixed-time and
parameter-uniformity tests.

## Candidate

Let $A=-\mathbb P\Delta$ and test

$$
R_{s,\lambda}(t)
=\|(\lambda+A)^{-s}A^{1/2}u(t)\|_2^2.
$$

Choosing the fractional order to match the three-dimensional critical scaling
leads formally to $s=3/2$ for the proposed resolvent family.

## Evolution

For $B(u,u)=\mathbb P(u\cdot\nabla u)$,

$$
\dot R_\lambda
=-2\nu\|A^{3/2}(\lambda+A)^{-3/2}A^{1/2}u\|_2^2
-2\langle(\lambda+A)^{-3/2}A^{1/2}u,
 A^{1/2}B(u,u)\rangle.
$$

The Leray projection removes the explicit pressure gradient, but the
nonlinear pairing remains sign-indefinite and nonlocal in frequency.

## Kill tests

- A single Fourier mode decays monotonically, so it does not expose the
  obstruction.
- The exact high-high-to-low triad produces a low-frequency nonlinear output
  that survives the resolvent even when the high inputs are damped.
- A concentrating rescaling sends the matching parameter to the opposite end of
  the resolvent spectrum; fixed-parameter bounds miss the concentration.
- At KNSS scale $r_k$, choosing $\lambda\sim r_k^{-2}$ makes the spectral
  weight collapse on low modes rather than control the local $L^2$ target.
- Pressure is hidden in the Leray operator, not controlled: the fractional
  spectral pairing does not produce a local pressure-tail estimate.

## First obstruction

The nonlinear term

$$
-2\langle(\lambda+A)^{-3/2}A^{1/2}u,
 A^{1/2}B(u,u)\rangle
$$

has no uniform sign or amplitude-independent bound on the triad. Matching the
resolvent parameter to the record scale creates parameter escape and loses the
fixed-profile local concentration information. A Mellin or Laplace average over
$\lambda$ would inherit the same issue unless its uniformity already implies
the missing critical $L^3$ bound.

The resolvent/Mellin class is not refuted in full. This candidate is blocked by
parameter escape, a triad-visible nonlinear pairing, and absence of a local
pressure/fixed-time bridge.
