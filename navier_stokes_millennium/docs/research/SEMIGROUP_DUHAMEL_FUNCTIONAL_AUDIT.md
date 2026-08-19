# Semigroup/Duhamel Functional Audit

**Date:** 2026-08-19  
**Disposition:** blocked; the first candidate failed its audit.

## Candidate

For $A=-\mathbb P\Delta$ and $E_s=e^{-\nu sA}$, test

$$
S_\lambda(t)=\int_0^\infty \lambda e^{-\lambda s}
\|E_su(t)\|_3^3\,ds.
$$

The parameter $\lambda$ has inverse-time scaling. Under
$u_\kappa(x,t)=\kappa u(\kappa x,\kappa^2t)$,

$$
S_\lambda[u_\kappa](t)=S_{\lambda/\kappa^2}[u](\kappa^2t).
$$

## Evolution

Writing $B(u,u)=\mathbb P(u\cdot\nabla u)$ and $v_s=E_su$,

$$
\dot S_\lambda
=\lambda(S_\lambda-\|u\|_3^3)
-3\int_0^\infty\lambda e^{-\lambda s}
\langle |v_s|v_s,E_sB(u,u)\rangle\,ds.
$$

The pressure-free projection does not remove the nonlinear Duhamel term. A
semigroup split $E_sB(u,u)=B(v_s,v_s)+C_s$ leaves a commutator $C_s$.

## Kill tests

- A constant field has $\dot S_\lambda=0$, so no strict damping follows.
- A smooth shear is strongly attenuated for fixed $\lambda$ at high frequency,
  so fixed-$\lambda$ control misses high-frequency concentration.
- The exact high-high-to-low triad has a nonzero low-mode commutator after heat
  damping: the high inputs decay rapidly, but their low nonlinear output decays
  at the low frequency rate.
- A concentrated packet satisfies
  $S_\lambda[u_\kappa]=S_{\lambda/\kappa^2}[u]$, so every fixed $\lambda$
  becomes blind as $\kappa\to\infty$. Uniform control over all $\lambda$ is
  equivalent to controlling $\|u\|_3^3$ itself.

## Fixed-profile obstruction

At KNSS scale $r_k$, a fixed profile semigroup scale corresponds to
$\lambda\sim r_k^{-2}\to\infty$. A bound at fixed $\lambda$ therefore cannot
transfer to the prescribed profile slices. The commutator pairing is also
sign-indefinite and has a nonintegrable endpoint estimate near $s=0$.

The semigroup/Duhamel class is not refuted in full. This candidate is blocked by
scale-parameter escape, a triad-visible Duhamel commutator, and fixed-time
transfer.
