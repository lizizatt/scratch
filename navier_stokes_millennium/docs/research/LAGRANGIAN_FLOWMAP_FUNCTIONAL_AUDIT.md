# Lagrangian Flow-Map Functional Audit

**Date:** 2026-08-19
**Disposition:** blocked; material coordinates remove advection but not pressure
traction or deformation growth.

## Candidate

Let $X_t(a,t)=u(X(a,t),t)$, $F=\nabla_aX$, $G=F^{-1}$, and use a label cutoff
$\chi_R$ around a KNSS record label. Test

$$
\mathcal L_{\ell,R}(t)
=\frac1{2\ell}\int\chi_R(a)|u(X(a,t),t)|^2\,da
+\alpha\log K_R(t),
$$

where $K_R$ controls $F$ and $F^{-1}$ on the material tube. Since
$\det F=1$, bounded deformation makes the material tube comparable to an
Eulerian tube.

## Scaling and identities

Under Navier--Stokes scaling,

$$
X_\lambda(a,t)=\lambda^{-1}X(\lambda a,\lambda^2t),
\qquad F_\lambda=F(\lambda a,\lambda^2t),
$$

and $\ell\mapsto\ell/\lambda$, $R\mapsto R/\lambda$, the candidate is formally
scale-critical.

The material kinetic identity is

$$
\frac d{dt}\frac1{2\ell}\int\chi_R|U|^2da
=-\frac\nu\ell\int\chi_R|\nabla u|^2da
+\frac\nu{2\ell}\int |U|^2
\nabla_a\cdot(GG^T\nabla_a\chi_R)da
+\frac1\ell\int p(X,t)(GU)\cdot\nabla_a\chi_Rda.
$$

The cubic advective flux disappears. The first unabsorbable term is instead

$$
\frac1\ell\int p(X,t)(GU)\cdot\nabla_a\chi_Rda,
$$

the pressure traction through the material boundary.

The deformation equations are

$$
F_t=(\nabla u)(X,t)F,\qquad G_t=-G(\nabla u)(X,t),
$$

so deformation has no dissipative sign. For vorticity $W=\omega(X,t)$,

$$
W_t=(\omega\cdot\nabla)u(X,t)+\nu(\Delta\omega)(X,t),
$$

and the Euler Cauchy invariant is broken by the viscous term.

## Stress tests

- Exact shear has $p=0$ and zero convection, but $F$ and $F^{-1}$ can grow
  through accumulated strain. Deformation is not a Lyapunov quantity.
- Beltrami flow has benign helicity but does not force bounded deformation or
  local mass control.
- A concentrated rigid vortex tube can have $F$ orthogonal and $K_R=1$ while
  its record-scale local mass diverges. Perfect deformation control does not
  imply anti-concentration.
- A remote packet can leave the local material tube and its $F,G,U$ unchanged
  while changing the harmonic pressure traction in that tube.
- The KNSS record bound controls trajectory drift over fixed rescaled times but
  does not provide expanding-ball $L^2$ mass control at those times.

## Missing lemma

The route would need a scale-critical, fixed-profile-time estimate controlling
accumulated pressure and viscous traction through expanding material boundaries,
with constants uniform in the KNSS sequence. No current finite-energy estimate
supplies this; it is the pressure-tail blocker in material coordinates.

## Disposition

The local deterministic flow-map functional class is **blocked**, not refuted.
It removes one obstruction, cubic Eulerian advection, but replaces it with
pressure traction, deformation growth, and viscous commutators. A genuinely
pressure-aware nonlocal Lagrangian construction would be a different class and
would require a new first lemma.
