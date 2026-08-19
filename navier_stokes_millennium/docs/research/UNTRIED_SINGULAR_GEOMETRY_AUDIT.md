# Quantitative Singular-Set Geometry Audit

**Date:** 2026-08-18  
**Disposition:** blocked; CKN measure information does not yield the target.

## First lemma

A quantitative route would need a theorem of the form: a scale-uniform
capacity, porosity, or Minkowski-content bound on the terminal singular set,
combined with suitable-solution estimates away from that set, implies

$$
\sup_j\limsup_k M_k\int_{B_{\rho_k}(a_k)}|u(x,\tau_{k,j})|^2\,dx<\infty.
$$

## Audit

CKN's zero parabolic one-dimensional measure is too weak. Even stronger
statements about the size of a set do not automatically bound the amplitude of
a function concentrating near that set. A singleton can have zero Hausdorff
measure and zero capacity in relevant dimensions while local $L^3$ mass still
diverges for a concentrating field. The existing `LOCAL-L3-FROM-CKN` stress test
already establishes this measure-to-integrability failure at the level of the
available energy information.

A useful geometric theorem would need a quantitative capacity-to-integrability
estimate that includes the Navier--Stokes pressure, time slices, and KNSS
rescaling. None of those hypotheses is supplied by CKN partial regularity.

## Kill test and source gap

The kill test is a one-point concentration with arbitrarily small singular-set
content but unbounded local cubic mass. It is not a full suitable-solution
counterexample, so it does not refute every stronger geometric theorem. It does
refute the proposed inference from set-size information alone. No audited
primary source supplies the required capacity/porosity-to-fixed-slice estimate.

**Result:** Quantitative singular-set geometry is not a standalone bridge. It
would need a new PDE-specific amplitude theorem before it could affect the
canonical target; no claim is added.
