# Critical Profile Iterations 009-011: Anti-Concentration Follow-ups

**Status:** exploratory note; no canonical claim or gauntlet round is recorded.

These iterations continue the `LOCAL-L3-BOUND-DERIVATION` burn-down after
Iteration 008. Target: derive the record-center local $L^3$ bound from finite
energy plus established suitable-solution structure.

## Iteration 009: CKN contrapositive at record scales

Attempt: use `PR-08` (CKN epsilon criterion) contrapositive on cylinders
centered at $(x_k,t_k)$ and nearby backward offsets to force quantitative lower
bounds that would conflict with finite-energy scaling.

Result: blocked. The contrapositive gives persistence of *some* scale-invariant
largeness in
$\mathcal C(R)+\mathcal D(R)$, but does not isolate a sign-definite contribution
that upgrades local $L^2$ control to the missing
$M_k\int_{B_{\rho_k}}|u|^2$ anti-concentration estimate. Pressure remains coupled
at critical scaling, so no coercive inequality closes.

## Iteration 010: local enstrophy-to-cubic conversion

Attempt: combine local Ladyzhenskaya/Gagliardo-Nirenberg with backward-window
control of $\iint_{Q_R}|\nabla u|^2$ from the local energy inequality to get
slice-wise local cubic control at fixed profile times.

Result: refuted as a direct route. The interpolation gives only spacetime or
exceptional-time control unless one already has a uniform localized $L^2$ slice
bound at the same scale. At record scales this is exactly the missing input, so
the argument is circular.

## Iteration 011: Littlewood-Paley split near record centers

Attempt: decompose $u=u_{\le J}+u_{>J}$ with $2^J\sim M_k$ at record times;
control high frequencies through dissipation and low frequencies through local
energy, then recombine to bound local $L^3$.

Result: blocked. High-frequency control is not available at fixed profile
offsets without stronger time localization, while low-frequency pieces inherit
supercritical leakage from nonlocal pressure/transport. The split reorganizes
the obstruction but does not remove the missing localized anti-concentration
estimate.

## Disposition

- `LOCAL-L3-BOUND-DERIVATION` remains **blocked**.
- `LOCAL-L3-FROM-LOCAL-ENERGY` remains **blocked**.
- No change to `CLAY-A`.
