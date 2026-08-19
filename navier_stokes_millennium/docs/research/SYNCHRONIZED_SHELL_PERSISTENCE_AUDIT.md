# Synchronized Shell Persistence Audit

**Date:** 2026-08-19
**Disposition:** conditional criterion survives; Navier--Stokes production of
its persistence hypothesis remains blocked.

## Proposition

Let $P_j$ denote a dyadic shell, $E_j(t)=\tfrac12\|P_ju(t)\|_2^2$, and
suppose $t_j\uparrow T$ satisfies

$$
 c_-4^{-j}\le T-t_j\le c_+4^{-j},
 \qquad E_j(t_j)\ge\varepsilon 2^{-j}.
$$

Assume that throughout $[t_j,T)$ the shell's adverse leakage and viscosity
obey

$$
L_j(t)+\nu D_j(t)\le F_j(t)+\Gamma4^jE_j(t),
$$

where $F_j$ is favorable nonlinear influx and $E_j'=F_j-L_j-\nu D_j$.
Then

$$
E_j(t)\ge\varepsilon e^{-\Gamma c_+}2^{-j}
\quad (t_j\le t<T).
$$

For $s_N=\max_{J\le j\le N}t_j$, every shell $J\le j\le N$ is simultaneously
active, so

$$
\|u(s_N)\|_{\dot H^{1/2}}^2
\ge 2\sum_{j=J}^N2^jE_j(s_N)
\ge 2\varepsilon e^{-\Gamma c_+}(N-J+1)\to\infty.
$$

This repairs the old shell-time diagonal error: the conclusion uses one common
terminal time, not values from different shells at different times.

## Scaling

Under $u_\lambda(x,t)=\lambda u(\lambda x,\lambda^2t)$ with
$\lambda=2^m$,

$$
E_{j+m}[u_\lambda]=\lambda^{-1}E_j[u],
\qquad
D_{j+m}[u_\lambda]=\lambda D_j[u],
\qquad
\Pi_{j+m}[u_\lambda]=\lambda\Pi_j[u].
$$

The lower bound $E_j\gtrsim2^{-j}$ and terminal window
$T-t_j\asymp4^{-j}$ are therefore jointly scale-compatible.

## Stress tests

- Moving-shell packets evade the proposition because they do not satisfy the
  persistence inequality; comparable window width alone is insufficient.
- The exact high-high-to-low triad defeats any universal activation-to-persistence
  estimate: after uniform amplitude scaling, the donor-shell condition would
  require a fixed $\Gamma$ to dominate a term growing linearly in amplitude.
- A finite nested periodic shear can satisfy the conditional persistence
  inequality and force large same-time $\dot H^{1/2}$, but its initial energy
  diverges as nesting depth tends to infinity. It is not a finite-energy blowup
  construction.

## Missing PDE lemma

The unresolved statement is a cutoff-uniform terminal production-and-persistence
lemma: one finite-energy unforced solution must generate
$E_j(t_j)\ge\varepsilon2^{-j}$ for infinitely many shells at
$T-t_j\asymp4^{-j}$ while maintaining the leakage inequality through $T$.
The triad rules out a universal version based only on shell energy; a proof would
need new phase-locking, persistence, and viscosity-control structure.

## Final production audit

Finite energy does not force activation times $t_j$ with
$E_j(t_j)\geq\varepsilon2^{-j}$ and $T-t_j\asymp4^{-j}$: critical divergence
may be diffusely distributed across shells, and moving packets can activate one
shell at a time. Bernstein applied to the shell identity loses one full cutoff
power in the relative transfer estimate, so it cannot produce a
cutoff-independent persistence constant. The exact triad shows that any
shell-energy-only production estimate would also have an amplitude-dependent
constant.

The smallest repair is to assume activation plus an integrated logarithmic-loss
bound as an explicit hypothesis. That weakens the criterion but does not derive
it from finite-energy data.

## Disposition

The synchronized shell criterion is **valid as a conditional implication** but
`SHELL-PERSISTENCE-FROM-NS` remains `blocked`. It is a sharper negative-route
obligation, not a proof or counterexample to the Millennium problem.
