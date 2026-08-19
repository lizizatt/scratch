# Local L2 Anti-Concentration Target

**Status:** blocked; this is a canonical estimate target, not a proof of
regularity.

## Setup

Assume a smooth whole-space Navier-Stokes solution has a hypothetical finite
singular endpoint $T$. Let $(x_k,t_k)$ be a KNSS record-point sequence with
$t_k\uparrow T$, let

$$
M_k=|u(x_k,t_k)|\to\infty,
\qquad r_k=M_k^{-1},
$$

and let $s_j\downarrow-\infty$ be fixed profile times chosen before taking
$k\to\infty$. Define

$$
\tau_{k,j}=t_k+r_k^2s_j.
$$

The target may choose centers $a_k\in\mathbb R^3$ and radii $\rho_k>0$ satisfying

$$
|a_k-x_k|\to0,
\qquad M_k\bigl(\rho_k-|a_k-x_k|\bigr)\to\infty.
$$

The second condition ensures that every fixed rescaled ball centered at the
record point is eventually contained in $B_{\rho_k}(a_k)$.

## Canonical target

Prove, for every such hypothetical endpoint and KNSS sequence, that the
centers and radii can be selected so that

$$
\sup_{j\ge1}\limsup_{k\to\infty}
M_k\int_{B_{\rho_k}(a_k)}|u(x,\tau_{k,j})|^2\,dx<\infty.
$$

This is the precise local $L^2$ anti-concentration estimate isolated by the
record-center attacks. It is recorded as blocked in the claim ledger under
`LOCAL-L2-ANTI-CONCENTRATION`.

## Why this target is sufficient

The KNSS record bound gives $|u(x,\tau_{k,j})|\le\gamma_kM_k$ on the relevant
backward time interval, with $\gamma_k\downarrow1$. Therefore

$$
\int_{B_{\rho_k}(a_k)}|u(x,\tau_{k,j})|^3\,dx
\le\gamma_kM_k
\int_{B_{\rho_k}(a_k)}|u(x,\tau_{k,j})|^2\,dx.
$$

The target consequently supplies the local $L^3$ hypothesis of
`LOCAL-L3-RECORD-CENTERS`. Its proved rescaling argument then gives a uniformly
bounded $L^3$ ancient profile along the times $s_j$, contradicting
Albritton-Barker rigidity and ruling out $T$.

This implication is only a reduction to an estimate. It does not derive the
estimate from finite energy.

## Current obstruction

Finite energy gives only the scale-invariant local bound

$$
R^{-1}\int_{B_R}|u|^2\,dx\le E_0/R.
$$

At record scale $R\simeq M_k^{-1}$ this yields an $O(M_k)$ loss after the
factor $M_k$ in the target. The local energy inequality has the same problem:
the near pressure term is circular at the desired cubic scale, while the far
pressure tail is controlled only at the same supercritical rate.

A rescaled divergence-free bump with bounded energy and height $M_k$ confirms
that finite energy plus the pointwise KNSS normalization cannot establish the
target by algebra alone. It is not a Navier-Stokes solution and therefore is
not a PDE counterexample.

## Next adversarial gate

A successful attack must do one of the following:

1. prove the displayed estimate from the Navier-Stokes equations and suitable
   solution structure with constants uniform in $k$ and fixed profile times
   $s_j$; or
2. construct a genuine suitable-solution mechanism that violates it, with all
   pressure, energy, and endpoint hypotheses checked.

A scalar concentrating field, a finite-mode probe, or a time-averaged good-time
selection alone cannot settle this target.
