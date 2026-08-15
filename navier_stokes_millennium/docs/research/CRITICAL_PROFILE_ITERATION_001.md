# Critical Profile Iteration 001

**Status:** blocked; no proof or disproof of the Millennium problem.

## Target

The target is `CRITICAL-BOUND`: if a smooth whole-space solution from
Fefferman-admissible data has finite maximal time, prove

$$
\sup_{t<T_*}\|u(t)\|_{L^3(\mathbb R^3)}<\infty.
$$

ESS gives the conditional implication that this bound excludes a finite
endpoint. The profile route asks whether failure of the bound produces an
ancient profile covered by an existing Liouville theorem.

## What the rescaling gives

At record points $(x_n,t_n)$ with amplitudes $Q_n\to\infty$, set
$r_n=Q_n^{-1}$ and

$$
 v_n(y,s)=r_nu(x_n+r_n y,t_n+r_n^2s),
\qquad
 q_n(y,s)=r_n^2p(x_n+r_n y,t_n+r_n^2s).
$$

Under suitable local bounds, interior estimates can produce a nonzero local
ancient limit with $|v(0,0)|=1$. Pressure requires a time-dependent gauge and
separate tail control. Mildness must also be passed through the limit.

## Exact first gap

Albritton-Barker's Liouville theorem applies to a mild ancient solution with a
bounded strong $L^3$ sequence at times $s_k\downarrow-\infty$:

$$
\sup_k\|v(\cdot,s_k)\|_3<\infty.
$$

The rescaled data do not provide this. A fixed original time becomes a moving
time $s_n=(t_0-T_*)/r_n^2\to-\infty$, while local convergence of $v_n$ is only
on fixed compact time intervals. Critical scaling preserves the $L^3$ norm,
so scaling and translation cannot turn an unbounded $L^3$ sequence into a
bounded one.

Compactness of minimal initial data modulo scaling and translation is not
compactness of the evolving orbit. A bounded-backward orbit or equivalent
profile precompactness would supply the missing hypothesis, but deriving it
is essentially the unresolved critical estimate.

## Disposition

- ESS conditional regularity: established in the project source audit.
- Albritton-Barker ancient Liouville theorem: established for its stated class.
- Local nonzero ancient profile from a singularity: conditional and incomplete.
- Global mildness, pressure-tail control, and backward $L^3$ boundedness: blocked.
- `CRITICAL-BOUND`: blocked.

No finite-mode computation addresses this gap. No admissible finite-time
singular solution was found, so this is not a disproof of Navier-Stokes
regularity.
