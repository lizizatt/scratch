# Monotonicity and Entropy Audit

**Date:** 2026-08-18  
**Disposition:** blocked; no candidate Navier--Stokes functional survived the
first structural check.

## First lemma

The desired object would be a scale-critical local functional $\Phi(r,z_0)$
with a monotonicity inequality across parabolic scales, for example

$$
\Phi(r_1,z_0)\leq\Phi(r_2,z_0)-c\,\mathcal D(r_1,r_2),
\qquad r_1<r_2,
$$

where $\mathcal D\geq0$ controls the record-scale concentration and the
boundary/pressure error is controlled by $\Phi$ itself.

## Audit

The ordinary local energy identity has a cubic transport-pressure boundary
flux. It is not coercive at the critical scale. Borrowing monotonicity from
harmonic-map heat flow or Ricci flow does not supply the missing identity:
those theories have additional geometric or stress-energy structure and
classified bubbles, while Navier--Stokes has nonlocal pressure and vortex
stretching.

A periodic shear is a useful structural stress test: it is a genuine smooth
Navier--Stokes solution with zero nonlinear flux and zero pressure, yet its
scale-invariant local cubic quantity can be made arbitrarily large by amplitude
scaling. Thus flux-only or defect-only monotonicity cannot control
concentration. A new functional would need an absolute velocity term and a
new sign-definite identity, not just a rearrangement of energy flux.

## Kill test and source gap

The first kill test is amplitude scaling of the shear and the high-high-to-low
triad already in the ledger. Both defeat a proposed law whose defect sees only
flux or dissipation. No audited primary source provides a scale-critical,
coercive Navier--Stokes monotonicity formula with fixed-time local control.

**Result:** Monotonicity remains a high-upside research idea, but it has no
concrete candidate functional or first theorem. It is blocked at construction,
not refuted as a universal possibility.
