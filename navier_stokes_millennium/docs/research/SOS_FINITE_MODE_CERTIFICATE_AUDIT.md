# SOS Finite-Mode Certificate Audit

**Date:** 2026-08-19
**Disposition:** fixed-cutoff quartic certificates are algebraically feasible;
cutoff-uniform continuum certification remains blocked.

## Declared finite-mode system

On a finite divergence-free Galerkin mode set $K_N$, write the real coordinate
system as

$$
\dot x=-\nu A_Nx-B_N(x,x).
$$

For the critical quadratic energy $Q_N=\tfrac12x^TA_N^{1/2}x$,

$$
\mathcal L_NQ_N=\Phi_N-\nu D_N,
$$

where $\Phi_N$ is the cubic nonlinear flux and $D_N$ is quadratic
dissipation. The SOS certificate has the sign-correct form

$$
R_N=-\mathcal L_NV_N-cD_N+C\in\Sigma[x].
$$

## First degree lemma

If $V_N$ has highest degree $2m$, $D_N$ has degree at most $2m$, and $R_N$ is
globally nonnegative, then the highest nonlinear contribution

$$
\nabla V_{N,2m}(x)\cdot B_N(x,x)
$$

has degree $2m+1$ and must vanish identically. Otherwise it changes sign under
$x\mapsto-x$ and cannot be SOS or globally nonnegative. This kills a quadratic
critical candidate such as $Q_N$ when its cubic flux is nonzero.

## Quartic completion

A fixed-cutoff degree-four candidate

$$
V_N=Q_N+\beta_NE_N^2,
\qquad E_N=\tfrac12|x|^2,
$$

has residual

$$
R_N=-\Phi_N+(\nu-c)D_N+2\beta_N\nu E_NZ_N+C.
$$

The quartic $E_NZ_N$ term can dominate the cubic flux for each fixed $N$ with
sufficiently large $\beta_N$. This is a real finite-mode partial result, not a
PDE proof: it gives no cutoff-uniform coefficient bound by itself.

## Continuum obstruction

Under concentration scaling $u_L(x)=Lu(Lx)$, the critical flux and dissipation
scale like $L^2$, while $E_NZ_N$ does not supply a uniform critical coefficient
without choosing $\beta_N$ growing at least like $L^2$ on resolved packets. With
$N\simeq L$, the natural quartic coefficient therefore grows with cutoff.
A rescaling of $V_N$ only makes its critical coercivity degenerate.

The required missing lemma is a cutoff-uniform certificate: find a family
$V_N,D_N,C_N$ with coefficients and coercivity constants bounded in the
continuum scaling, and prove convergence to a whole-space analytic functional.
The present quartic construction does not meet that obligation.

## Stress tests

- The exact high-high-to-low triad kills the quadratic critical certificate.
- Uniform amplitude scaling confirms the cubic flux law; the fixture's donor-only
  parameter remains a separate quadratic stress test.
- The fixed-cutoff quartic completion survives algebraically, so the route is
  not refuted at finite $N$.
- Concentrating resolved packets force coefficient growth with $N$, blocking a
  scale-uniform continuum inference.

## Disposition

`SOS-CUTOFF-UNIFORM-CERTIFICATE` is **blocked**, not refuted. The fixed-cutoff
SOS search is worthwhile only as a source of coefficient-growth data or a
structural hint; it cannot currently establish regularity or the local
anti-concentration estimate.
