# Vorticity Filament Geometry Audit

**Date:** 2026-08-18
**Disposition:** blocked; no finite-energy bridge to the target was found.

## First lemma

A clean non-circular bridge would be fixed-profile control

$$
\sup_j\limsup_k\|\omega(\tau_{k,j})\|_{L^{3/2}(\mathbb R^3)}<\infty.
$$

Biot--Savart and Hardy--Littlewood--Sobolev would then give the critical
$L^3$ velocity bound needed by the ancient-profile rigidity step.

## Audit

Finite dissipation controls enstrophy only in time average. It does not give
fixed-profile-time $L^{3/2}$ vorticity control. Direction coherence was already
attacked; curvature, helicity, straight filaments, and local stretching do not
supply the missing amplitude control without additional hypotheses.

A smooth concentrated swirl profile can have bounded energy, straight vortex
lines, zero curvature, benign local helicity density, and negligible local
stretching while its transverse velocity and vorticity norms grow with the
concentration scale. This is an estimate-level stress test, not a suitable
Navier--Stokes counterexample.

## Kill test and source gap

The kill test is a concentrated azimuthal tube: geometry remains simple while
$M_k\int_{B_{\rho_k}}|u|^2$ grows when the observation radius contains many
transverse scales. Existing geometric criteria assume coherence, sparseness,
filament transport, or special helical structure; no audited source derives
those hypotheses from finite-energy suitable-solution data at fixed profile
times.

**Result:** Vorticity geometry remains a possible conditional regularity
framework, but it does not derive `LOCAL-L2-ANTI-CONCENTRATION` from the current
hypotheses. No claim is promoted to proved or refuted.
