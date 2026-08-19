# Critical Profile Iterations 006-008: Record-Trajectory Anti-Concentration Attacks

**Status:** exploratory note; no canonical claim or gauntlet round is recorded.

These iterations continue the `LOCAL-L3-BOUND-DERIVATION` burn-down after
Iteration 005 isolated the missing ingredient: a local $L^2$
anti-concentration estimate strong enough to control record-time local
$L^3$ mass.

## Iteration 006: Morrey-scale upgrade from local energy

Attempt: combine local energy inequality (`PR-02`) with parabolic Morrey-style
bounds to force

$$
\sup_j\limsup_{k\to\infty} M_k\int_{B_{\rho_k}(a_k)}|u(x,\tau_{k,j})|^2\,dx < \infty.
$$

Result: blocked. The available estimate closes only at the supercritical scale
$R^{-1}\int_{B_R}|u|^2$, while the required record-time control needs an extra
$M_k^{-1}$ gain at radii comparable to $M_k^{-1}$. No source-backed inequality
in the present dependency closure supplies that gain.

## Iteration 007: backward heat-kernel weighting along the record trajectory

Attempt: center a backward heat-kernel cutoff at the KNSS record centers and
use weighted local energy balance to suppress far-field pressure influence.

Result: refuted as a derivation route. The transport and cutoff-gradient terms
retain the same critical scaling as the target quantity, so the weighted
identity does not produce a one-sided coercive bound at fixed profile times.
This is an estimate-level obstruction, not a Navier-Stokes counterexample.

## Iteration 008: quantile-time extraction at fixed profile offsets

Attempt: use quantile selection in each backward window to choose times where
local cubic mass is small, then diagonalize across windows to recover bounds at
fixed profile offsets.

Result: blocked. KNSS compactness needs estimates at profile times fixed before
$k\to\infty$, but quantile-selected times drift with $k$ and do not furnish a
uniform transfer map to those fixed offsets without a new continuity modulus in
time for localized $L^3$ mass.

## Disposition

- `LOCAL-L3-BOUND-DERIVATION` remains **blocked**.
- `LOCAL-L3-FROM-LOCAL-ENERGY` remains **blocked**.
- No change to `CLAY-A`.
