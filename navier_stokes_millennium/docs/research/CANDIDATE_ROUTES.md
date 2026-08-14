# Candidate Routes and Dispositions

**Research date:** 2026-08-13

Four routes were developed independently and then attacked by fresh critics.
None produced a new proof obligation that closes the Millennium problem.

## Universal critical-flux absorption

On $\mathbb T^3$, the candidate asserted that a universal $\theta<1$ satisfies

$$
\Phi_N(v)\leq\theta\nu
\|\Lambda^{3/2}P_{\leq N}v\|_2^2
$$

for every smooth divergence-free field, where

$$
\Phi_N(v)=-\left\langle\Lambda P_{\leq N}v,
P_{\leq N}\mathbb P\nabla\!\cdot(v\otimes v)\right\rangle.
$$

If true, the truncated $\dot H^{1/2}$ identity would make the periodic critical
norm nonincreasing. The calculation below does not by itself address a
whole-space-only estimate.

**Disposition: `refuted`.** Let

$$
k=(1,0,0),\quad p=(0,4,0),\quad q=(1,-4,0),\quad p+q=k,
$$

with Fourier coefficients

$$
\widehat v(k)=(0,-i,0),\quad
\widehat v(p)=A(1,0,0),\quad
\widehat v(q)=A(4,1,0),
$$

and conjugate coefficients at negative frequencies. The field is real and
divergence-free. For $1<N<|p|,|q|$, the exact Leray-projected interaction gives

$$
\Phi_N(v)=2A^2,
\qquad
\|\Lambda^{3/2}P_{\leq N}v\|_2^2=2.
$$

Arbitrary $A$ defeats every universal absorption constant. The finite-mode
calculation is implemented in `ns_millennium/triad.py` and checked by
`tests/test_triad.py`.

## Shell-time diagonal inference

One step in the cascade candidate inferred one-time $H^1$ blowup from
$\sum_nN_n^2E_n(T_n)=\infty$ at shell-dependent times $T_n\uparrow T_*$.

**Disposition: `refuted`.** Values from different shells at different times do
not imply divergence of the $H^1$ norm at any one time. Abstractly,
$E_j(T_n)=\delta_{jn}N_n^{-2}$ makes the diagonal weighted sum diverge while
each time slice has only one active shell. This refutes only the diagonal
inference, not the existence of an exact Navier-Stokes cascade satisfying
additional persistence conditions. The proposed BKM step was also invalid:
divergence of $L^2$ enstrophy along a sequence does not imply
$\int\|\omega\|_\infty dt=\infty$.

A corrected cascade proposition would need synchronized lower bounds at times
$t_m\uparrow T_*$, the full projected imaginary triad product, quantified
leakage, and persistence. Whether an exact solution can satisfy those
hypotheses remains `blocked`.

## Compact similarity-orbit rigidity

The candidate asserted that a mild ancient solution with a precompact centered
similarity orbit in $L^3$ must vanish.

**Disposition: `proved but already known from a stronger theorem`.** A
precompact $L^3$ orbit is bounded, and $L^3$ is similarity invariant. Choose
any sequence $t_k\downarrow-\infty$; Albritton-Barker Theorem 1.2 then gives
$v\equiv0$ from $\sup_k\|v(t_k)\|_3<\infty$. The proposed Gaussian weighted
energy route was unnecessary and, without smallness, has an indefinite cubic
velocity-pressure term.

This theorem does not provide the missing critical bound for a hypothetical
blowup. It applies after that bound is available.

## Fault-tolerant quorum transfer

The random unrelated-discipline round proposed that every flux across a cutoff
could be absorbed by dissipation in a fixed-width overlapping shell band.

**Disposition: `refuted`.** Amplitude scaling makes flux cubic and dissipation
quadratic. An explicit high-high-to-low triad also jumps an arbitrarily wide
empty band. Repairs must include all interacting tails, amplitudes, phases, and
summability, reducing the idea to an ordinary flux estimate. See
`docs/analogies/fault_tolerant_distributed_systems.md`.

## Surviving block

The positive endpoint route still requires a new mechanism proving a critical
a priori bound for arbitrary smooth data. The negative route still requires an
exact, synchronized, viscosity-dominating cascade for one admissible datum.
Neither requirement was advanced to `proved` in this round.
