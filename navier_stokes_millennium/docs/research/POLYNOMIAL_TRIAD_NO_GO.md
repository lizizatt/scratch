# Polynomial Degree and Triad No-Go Audit

**Date:** 2026-08-19  
**Status:** finite-mode no-go for a declared subclass; not a PDE regularity
result.

## Declared subclass

Consider a finite divergence-free Galerkin system

$$
\dot z=-\nu Az-B(z,z),
$$

and polynomial candidates whose declared dissipation has degree no larger than
the candidate's highest degree. The proposed coercive certificate is

$$
DV(z)[-\nu Az-B(z,z)]\leq-cD(z)+C,
\qquad c>0,
$$

with constants uniform in amplitude.

## Degree obstruction

If a homogeneous term $V_d$ has degree $d$, then the linear part of the
generator has degree $d$, while the quadratic Navier--Stokes part has degree
$d+1$:

$$
DV_d(z)[Az]\sim |z|^d,
\qquad
DV_d(z)[B(z,z)]\sim |z|^{d+1}.
$$

Therefore a nonzero sign-indefinite highest nonlinear term cannot be dominated
by a dissipation of degree at most $d$ as $z\mapsto Az$ with amplitude $A\to\infty$.
Adding a matching degree-$d+1$ term changes the problem to a higher-degree
candidate and must be audited recursively.

## Exact triad test

The repository's real divergence-free high-high-to-low fixture has critical
flux $2$ at unit amplitude. Scaling every Fourier coefficient by $A$ gives

$$
\Phi_{\mathrm{triad}}(A)=2A^3,
$$

verified exactly for $A=1,2,5$ by the finite-mode evaluator. Thus a functional
that adds cubic flux to quadratic energy has a nonlinear generator contribution
of degree four. The corresponding quadratic recipient dissipation remains
quadratic under amplitude scaling, so no universal large-amplitude estimate can
absorb the quartic term on this fixture.

This is the same structural mechanism behind the earlier refutation of
universal flux absorption, now expressed as a degree audit for polynomial
functional design.

## What this does and does not show

It rejects the declared finite-degree pattern when its highest nonlinear term is
nonzero and sign-indefinite on the exact triad. It does not reject:

- a functional with a genuinely sign-definite higher-degree cancellation;
- an infinite convergent hierarchy with a separately proved limit;
- a non-polynomial or trajectory-independent nonlocal construction; or
- the Navier--Stokes regularity statement itself.

Any survivor must state its coefficient class, positivity certificate,
cutoff-uniformity, and continuum bridge explicitly. Numerical agreement or a
finite Galerkin certificate alone cannot upgrade the result.
