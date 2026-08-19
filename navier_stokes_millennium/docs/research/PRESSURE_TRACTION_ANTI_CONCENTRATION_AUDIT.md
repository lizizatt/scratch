# Pressure-Traction Anti-Concentration Audit

**Date:** 2026-08-19
**Disposition:** blocked; full stress-work control would suffice, but finite
energy does not derive it.

## Conditional lemma

Let $\Omega_{k,j}(t)$ be material domains containing the relevant KNSS balls
at fixed profile times. If

$$
\sup_j\limsup_k\left[
\frac{M_k}{2}\int_{\Omega_{k,j}(0)}|u_0|^2
+\left(M_k\int_0^{\tau_{k,j}}\int_{\partial\Omega_{k,j}(t)}
 u\cdot\sigma n\,dSdt\right)_+
\right]<\infty,
$$

where $\sigma=-pI+2\nu D(u)$, then the material energy identity implies the
record-scale local $L^2$ anti-concentration bound. This conditional implication
is valid: it controls the full signed mechanical work, not pressure alone.

## Why production fails

After KNSS rescaling $v=M_k^{-1}u$, $q=M_k^{-2}p$, and $L=M_kR$, the
traction budget is scale-critical. Splitting $q=q_{\rm near}+q_{\rm far}$ gives

$$
|\Pi_{\rm near}|\lesssim L^{-1}\int_{B_{4L}}|v|^3,
$$

which is exactly the uncontrolled critical cubic mass. The far harmonic tail
satisfies

$$
|\Pi_{\rm far}|\lesssim\|v\|_\infty\Theta(L),
\qquad
\Theta(L)=L^3\int_{|z|>2L}\frac{|v(z)|^2}{|z|^4}\,dz,
$$

and finite energy gives only the supercritical tail rate. Thus the full stress
budget needs both the original anti-concentration estimate and a nonlocal tail
estimate.

An additional material-domain incompatibility appears: expanding inradius and
finite initial energy impose incompatible bounds on $L$ and $M_k$ for a domain
anchored in the smooth initial data.

## Stress tests

- Remote packets change harmonic pressure traction while leaving local velocity
  data unchanged.
- Pressure-free shears have zero pressure work but still exhibit large local
  energy on expanding balls.
- Even centered concentrating profiles can have zero pressure flux by parity
  while violating the target algebraically; this shows traction alone is not
  enough.

These are algebraic or exact-flow stress tests, not whole-space singular
solutions.

## Disposition

The pressure-traction route yields a valid conditional energy reduction but no
finite-energy production lemma. Its first missing estimates are the near cubic
term and far harmonic tail at fixed KNSS profile times. The route is blocked,
not refuted, and it does not improve the central target beyond naming the exact
full-stress budget required.
