# Modulation-Space Functional Audit

**Date:** 2026-08-19
**Disposition:** blocked; the first Gabor/modulation candidate failed.

## Candidate

Test a localized Gabor/STFT concentration functional: take a short-time
frequency representation $V_g u(x,\xi)$ and form a critical Carleson or
modulation-space supremum over spatial-frequency windows, normalized so that it
would control the record-scale local $L^2$ target.

## First evolution obstruction

The projected equation gives

$$
(\partial_t-\nu\Delta)V_g u
=-V_g\mathbb P(u\cdot\nabla u)+[V_g,\mathbb P\nabla] (u\otimes u)
$$

schematically. The frame commutator is order one at matched scales. More
importantly, the quadratic convolution couples separated frequency windows: a
high-high donor pair can create a low-frequency receiver outside the donor
window. A Gabor window cannot simultaneously make both the donor and receiver
local without paying the same phase-space uncertainty already present in the
wavelet audit.

## Stress tests

- Constants and pressure-free shears have zero nonlinear flux but nonzero
  absolute local coefficient energy, so flux alone is insufficient.
- A concentrated wave packet is detected by the frame, but its bounded global
  energy does not give a uniform fixed-time critical coefficient bound.
- The exact high-high-to-low triad produces an $O(A^2)$ low-mode transfer while
  the matched high-frequency window sees only the donors; the receiver escapes
  the local window.
- Taking a supremum over spatial centers or time slices recreates the missing
  fixed-time local anti-concentration quantifier.

## Disposition

The modulation-space class is not refuted in full. This explicit Gabor/Carleson
candidate is blocked by an order-one frame commutator, cross-window triadic
transfer, and the same fixed-time concentration estimate required by the
wavelet functional. No canonical claim is promoted to `proved` or `refuted`.
