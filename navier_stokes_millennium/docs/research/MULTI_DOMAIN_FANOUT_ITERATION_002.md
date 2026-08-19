# Multi-domain Fanout Iteration 002

**Status:** blocked; no proof or disproof of the Millennium problem.

This round executes one gate attempt per Track A-E from `MULTI_DOMAIN_FANOUT_ITERATION_001.md`.

## Iteration 012 (Track D): defect measure to CKN bridge

Attempt: define a scale-invariant local defect quantity
\(
\mu(Q_r)=r^{-2}\iint_{Q_r}|u|^3 + r^{-2}\iint_{Q_r}|p-(p)_{B_r}|^{3/2}
\)
with a localized pressure split to avoid overcounting and test whether small
\(\mu\) on a Vitali family implies CKN-smallness on a nested cylinder.

Result: blocked. The pressure split is not stable under the required overlap
bookkeeping at record scales, so no monotone/non-overcounting transfer to the
single-cylinder CKN criterion was obtained.

## Iteration 013 (Track A): record-center profile compactness with pressure defects

Attempt: extract a record-centered rescaled sequence and prove tightness of the
localized pressure-defect component in a negative Sobolev topology compatible
with local energy testing.

Result: blocked. Velocity compactness can be arranged weakly, but the pressure
defect term fails a uniform tail bound at the same scales; compactness of the
pair \((u,p)\) in the needed local class does not close.

## Iteration 014 (Track C): Carleman absorbability for ancient limits

Attempt: choose a backward parabolic weight and test whether transport and
pressure commutator terms can be absorbed into the principal Carleman bulk term
for candidate ancient critical limits.

Result: refuted as a direct route. Absorption requires coefficient control
stronger than the missing critical localized bound; the route is circular at the
first nontrivial inequality.

## Iteration 015 (Track B): depletion inequality from alignment hypotheses

Attempt: enforce a local alignment hypothesis on vorticity direction and derive
an explicit
\[
(\omega\!\cdot\!\nabla u,\omega)_{Q_r}\le (1-\eta)\,\nu\|\nabla\omega\|_{L^2(Q_r)}^2 + \mathrm{Rem}(r)
\]
with \(\mathrm{Rem}(r)\) controlled by suitable-solution quantities.

Result: blocked. The alignment condition that yields \(\eta>0\) is not known to
propagate from the available suitable-solution control at record scales; the
remainder estimate is therefore conditional only.

## Iteration 016 (Track E): cutoff-uniform robustness transfer

Attempt: set a Galerkin-to-suitable convergence template with constants uniform
in cutoff level \(N\), targeting a continuation bound in a critical norm.

Result: blocked. The continuity constants degrade with \(N\) in the nonlinear
stability step, so the limiting statement becomes non-informative for the PDE.

## Disposition

- `DEFECT-MEASURE-CKN-BRIDGE`: **blocked**.
- `PROFILE-COMPACTNESS-LOCAL`: **blocked**.
- `CARLEMAN-ANCIENT-RIGIDITY`: **blocked** (direct route refuted this round).
- `DEPLETION-TO-CRITICAL`: **blocked**.
- `ROBUSTNESS-TO-CRITICAL-UNIFORM`: **blocked**.
- Core bottleneck unchanged: no coercive record-scale localized anti-concentration estimate.
