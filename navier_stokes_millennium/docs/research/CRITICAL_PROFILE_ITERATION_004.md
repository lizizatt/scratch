# Critical Profile Iteration 004: Four Attacks on the Local L3 Bound

**Status:** blocked; no proof or disproof of the Millennium problem. One
genuine narrowing of the open target was found and is recorded as
`conjectured`, pending independent adversarial verification.

These four attacks target `LOCAL-L3-BOUND-DERIVATION`: deriving the uniform
local $L^3$ bound $M_R$ required by `LOCAL-L3-CONTINUATION`
(`docs/proofs/LOCAL_L3_CONTINUATION.md`) from smooth finite-energy data.

## Vorticity-direction coherence

The Constantin-Fefferman criterion requires fixed $\Omega,\rho>0$ such that
wherever $|\omega(x,t)|,|\omega(y,t)|>\Omega$,

$$
|\sin\phi(x,y,t)|\le\frac{|x-y|}{\rho}.
$$

If this held for $u$ itself, its strong-solution conclusion already implies
$M_R$ directly — but that conclusion is a full regularity theorem, so
coherence is not a useful intermediate bridge; it is strictly stronger than
what is needed and does not decompose into a separate step. Coherence also
does not survive KNSS record-point rescaling: physical-scale coherence at
fixed $\rho$ becomes $\rho/r_n\to\infty$ under the profile rescaling, so it
cannot be assumed at the profile level from compactness alone. A stationary
shear field is a coherence-but-unbounded-$M_R$ counterexample (not a
finite-energy solution); a concentrating rescaled family is a
bounded-$M_R$-but-incoherent counterexample. Neither implication holds in
isolation.

## Carleman / backward-uniqueness adaptation

ESS's Theorem 5.1 is a qualitative zero-terminal-trace uniqueness theorem, not
a quantitative norm estimate. In their Theorem 1.4, the $L^3$ bound is used
*before* backward uniqueness, to force the rescaled limit's terminal vorticity
to vanish; Carleman then propagates that zero, it does not produce it.
Applying the same machinery directly to a bare KNSS record-point rescaling
fails at the same step: the velocity profile is normalized to $|v(0,0)|=1$,
contradicting a zero terminal trace, and finite energy supplies no terminal
vorticity trace under the rescaling (physical $L^2$ degenerates as
$r_n^{-1}$). Even granting an exterior zero vorticity trace, a nonzero
constant ancient solution has zero vorticity everywhere while its local $L^3$
mass over any fixed ball is infinite — an additional decay or tail hypothesis
would still be required. This route is blocked at the same missing tail
information as the tail-transfer and orbit-compactness attempts recorded in
`CRITICAL_PROFILE_ITERATION_002_003.md`.

## Type I rate plus self-similar exclusion

A Type I rate $\sup_x|u(x,t)|\le C/\sqrt{T-t}$ does not bound local $L^3$
mass: $\int_{B_R(a)}|u|^3\le|B_R|C^3(T-t)^{-3/2}$ diverges, and an explicit
concentrating scalar model confirms the local mass can genuinely diverge under
the exact Type I rate. The established exclusion theorem (`BUP-001`, NRS96)
only rules out a *stationary* self-similar $L^3$ profile. Whether every Type I
tangent limit must be stationary is exactly the still-blocked claim `BUP-003`;
invoking NRS96 here would be circular without first settling it. Neither
branch (Type I rate alone, or Type I plus unproven stationarity) currently
derives $M_R$.

## Weaker hypothesis: record centers instead of all of $\mathbb R^3$

The KNSS construction (following Remark 6.1) only constrains its centers
$x_k$ to be asymptotic spatial maximizers at record times $t_k$; it imposes no
constraint on $x_k$ at other times. This means the proof of
`LOCAL-L3-CONTINUATION` does not actually need $M_R$ bounded over *all*
centers $a\in\mathbb R^3$. A strictly weaker hypothesis suffices: for centers
$a_k$ with $|a_k-x_k|\to0$ and a backward sequence of profile times
$s_j\downarrow-\infty$,

$$
\sup_j\limsup_{k\to\infty}\int_{B_{\rho_k}(a_k)}|u(x,t_k+s_j/M_k^2)|^3\,dx<\infty,
\qquad M_k(\rho_k-|a_k-x_k|)\to\infty,
$$

still forces $\int_{B_L}|v(s_j)|^3\le C$ for every fixed $L$, hence
$\sup_j\|v(s_j)\|_3<\infty$, and Albritton-Barker rigidity applies exactly as
before. Independent adversarial review confirmed the derivation: it is now
recorded as `proved` (`docs/proofs/LOCAL_L3_RECORD_CENTERS.md`). Finite energy
still only controls the restricted local mass in $L^{4/3}_t$, not $L^\infty_t$,
so the narrower hypothesis remains exactly as open to derive from
finite-energy data as the original $M_R$; `LOCAL-L3-BOUND-DERIVATION` stays
`blocked`. The genuine progress is scoping: the target is now a bound along
one backward parabolic trajectory of record centers, not a uniform bound over
all of space.

## Disposition

- Vorticity-direction coherence bridge: **refuted** (circular/non-modular,
  and does not survive rescaling).
- Carleman/backward-uniqueness direct adaptation: **blocked** at the same
  missing tail-tightness information as prior attempts.
- Type I rate plus self-similar exclusion: **refuted** (Type I rate alone
  does not bound local mass; the stationarity bridge remains blocked).
- Record-center weakening of the hypothesis: **proved**, after independent
  adversarial verification. `LOCAL-L3-BOUND-DERIVATION` remains `blocked`.
