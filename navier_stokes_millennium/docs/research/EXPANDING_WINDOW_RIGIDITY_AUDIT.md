# Expanding-Ball Window Rigidity Audit

**Date:** 2026-08-19
**Status:** conditional sufficiency is plausible but requires a precise
profile-space bridge; finite-energy production is blocked.

## Window target

For fixed profile times $s_j\downarrow-\infty$, some $\delta>0$, and expanding
radii $L_k\to\infty$, consider

$$
\sup_j\limsup_k\frac1\delta
\int_{s_j-\delta}^{s_j}\int_{B_{L_k}}|v_k(y,s)|^2\,dy\,ds<\infty.
$$

The physical form is

$$
M_k\frac1{h_k}\int_{\tau_{k,j}-h_k}^{\tau_{k,j}}
\int_{B_{L_k/M_k}(x_k)}|u|^2\,dx\,dt<\infty,
\qquad h_k=\delta M_k^{-2}.
$$

## Conditional rigidity route

For each fixed $j$, bounded window average permits selecting a good time
$\sigma_{k,j}\in[s_j-\delta,s_j]$ with bounded localized mass. To pass to the
ancient profile and apply Albritton--Barker, one still needs:

1. lower-semicontinuity under local convergence and expanding-ball exhaustion;
2. a profile-space energy or interpolation statement turning the selected
   $L^2$ slice into bounded global $L^3$ control; and
3. $\sigma_j\to-\infty$ after a diagonal selection over $j$.

The window estimate is therefore a useful weaker target, but its sufficiency
should be stated conditionally on this profile-space bridge rather than silently
identified with the original pointwise target.

## Production audit

Rescaling gives the available estimate

$$
\int_{B_{L_k}}|v_k|^2\lesssim\min(M_kE_0,L_k^3),
$$

which diverges for every $L_k\to\infty$. The local energy inequality merely
transfers this unknown mass from an earlier slice and adds

$$
\frac1{L_k}\iint\left(|v_k|^3+|q_k-\bar q_k||v_k|\right),
$$

whose near term is circular and whose far term has the $M_k/L_k$ loss. Moving
packets and narrow time spikes show that no uniform rescaled-time modulus is
available from energy alone.

The smallest production input is an absolute local-energy or positive inward
stress-work bound over the expanding window. That is at least as strong as the
central anti-concentration mechanism and is not supplied by finite energy.

## Disposition

- `EXPANDING-BALL-SPACETIME-WINDOW`: blocked; conditional rigidity needs an
  explicit profile-space bridge and finite-energy production is unavailable.
- Near cubic closure: blocked by circular pressure.
- Far harmonic tail: blocked by the supercritical $M_k/L_k$ rate.
- Fixed-time transfer: pointwise transfer is bypassed by the window, but window
  production and profile-space passage remain unresolved.
