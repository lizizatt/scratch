# Wavelet Phase-Space Functional Audit

**Date:** 2026-08-19  
**Status:** blocked; the candidate failed its first audit.

## Candidate

Use a divergence-free wavelet frame with localized coefficient energy $E_Q$ on
cube $Q$ and matched nonlinear packet flux $\Pi_{Q,j}$. Define

$$
\mathcal C_{\ell,Q_0}(u)
=\sup_{Q\subset Q_0,\,\ell\le r_Q\le\rho}
\frac{E_{3Q}(u)}{r_Q},
$$

and the scale-critical phase-space candidate

$$
\mathcal W_{\ell,\rho,a}(u)
=\frac{\rho}{\ell}\mathcal C_{\ell,Q_0(a,\rho)}(u)
+\sup_{Q\subset Q_0,\,2^{-j}\simeq r_Q}r_Q|\Pi_{Q,j}(u)|.
$$

The coefficient energy controls the local target through a frame localization
estimate, while the factor $\rho/\ell$ accounts for the expanding record-scale
ball.

## Scaling

For $u_\lambda(x,t)=\lambda u(\lambda x,\lambda^2t)$ and dyadic
$\lambda=2^n$, localized coefficient energy scales as

$$
E_{Q/\lambda}(u_\lambda)=\lambda^{-1}E_Q(u),
$$

and matched packet flux scales as

$$
\Pi_{Q/\lambda,j+n}(u_\lambda)=\lambda\Pi_{Q,j}(u).
$$

Thus $\mathcal W$ is formally scale-invariant. A continuous wavelet frame would
be needed for exact covariance under arbitrary $\lambda$.

## First evolution obstruction

For a divergence-free packet projection $P$,

$$
\frac12\frac d{dt}\|Pu\|_2^2+\nu\|\nabla Pu\|_2^2
=\Pi_P-\nu\langle\nabla Pu,\nabla(I-P)u\rangle.
$$

The pressure pairing disappears, but the matched-scale diffusion commutator is
order one. More decisively, differentiating a flux-completed functional gives

$$
\dot\Pi_P
=\|P\mathbb P\nabla\cdot(u\otimes u)\|_2^2
+\langle Pu,P\,DB(u)[B(u,u)]\rangle
+\text{viscous terms}.
$$

For the exact high-high-to-low triad, the first term is quartic in amplitude
while the candidate and dissipation are quadratic. No universal large-data
coercive inequality closes.

## Stress tests

- A constant field has zero packet flux, but the coefficient-energy part remains
  necessary to detect absolute local velocity.
- A smooth pressure-free shear has zero nonlinear flux while its localized
  coefficient energy remains nonzero; flux alone is insufficient.
- The checked high-high-to-low triad produces low-mode flux $2A^2$ with fixed
  recipient dissipation, and its flux derivative exposes the $A^4$ obstruction.
- A concentrating divergence-free packet with bounded energy and record height
  makes $M\int_{B_\rho}|u|^2$ diverge for expanding rescaled balls. Its wavelet
  functional correspondingly diverges; it is an algebraic stress test, not a
  Navier--Stokes counterexample.

## Quantifier gap

An ordinary critical Carleson bound controls $E_{Q_0}/\rho$. The target needs

$$
\frac{E_{Q_0}}{\ell}
=\frac{\rho}{\ell}\frac{E_{Q_0}}{\rho},
\qquad \rho/\ell\to\infty.
$$

Adding this factor makes the functional control the target, but its boundedness
is then essentially the anti-concentration estimate being sought. Spacetime
averaging would additionally lose the prescribed fixed profile times.

## Disposition

The wavelet phase-space functional **fails the first audit**. Its first
unabsorbable term is the quartic projected-nonlinearity square generated when
its flux component is differentiated. The underlying anti-concentration target
is neither proved nor refuted, and other nonlocal constructions remain possible.
