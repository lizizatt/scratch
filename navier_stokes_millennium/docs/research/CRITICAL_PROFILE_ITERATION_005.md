# Critical Profile Iteration 005: Local Energy Inequality Attack

**Status:** blocked; no proof or disproof of the Millennium problem. This
attack targets `LOCAL-L3-BOUND-DERIVATION` (equivalently, deriving the
hypothesis of the proved claim `LOCAL-L3-RECORD-CENTERS`) using the local
Scheffer/CKN energy inequality restricted to a backward parabolic
neighborhood of only the KNSS record-center trajectory, as a route distinct
from the already-refuted global energy/Serrin interpolation
(`LOCAL-L3-FROM-ENERGY`) and CKN singular-set (`LOCAL-L3-FROM-CKN`) attempts.

## Local energy inequality attack

For a suitable weak solution $u$ with pressure $p$ and nonnegative
$\phi\in C_c^\infty$ supported in a parabolic cylinder, the local energy
inequality (`PR-02`) is

$$
2\iint|\nabla u|^2\phi
\le
\iint\Big[|u|^2(\partial_t\phi+\Delta\phi)+(|u|^2+2p)\,u\cdot\nabla\phi\Big].
$$

The exact KNSS record-point normalization (not a maximizer over earlier
times, and with no supplied spatial trajectory derivative) is: $h(t)=\|u(t)\|_\infty$,
$H(t)=\sup_{0\le s\le t}h(s)$, $t_k\uparrow T$ with $h(t_k)=H(t_k)$,
$N_k=H(t_k)$, $\gamma_k\downarrow1$, $M_k=|u(x_k,t_k)|\ge N_k/\gamma_k$,
$r_k=M_k^{-1}$, giving the rescaled bound $|v_k(y,s)|\le\gamma_k$ for
$s\le0$ and $|v_k(0,0)|=1$.

**Scaling audit.** Under this rescaling the slice $L^3$ mass is exactly
invariant, while $\int|v_k(s)|^2\,dy=M_k\int|u(t_k+r_k^2s)|^2\,dx\le M_kE_0$
— finite energy control degrades by a factor of $M_k$. With the
scale-invariant quantities $\mathcal A(R)=R^{-1}\operatorname*{ess\,sup}_t
\int_{B_R}|u|^2$, $\mathcal B(R)=R^{-1}\iint_{Q_R}|\nabla u|^2$,
$\mathcal C(R)=R^{-2}\iint_{Q_R}|u|^3$, $\mathcal D(R)=R^{-2}
\iint_{Q_R}|p-(p)_{B_R}|^{3/2}$, the local energy inequality gives
$\mathcal A(R/2)+\mathcal B(R/2)\lesssim\mathcal C(R)^{2/3}+\mathcal
C(R)+\mathcal C(R)^{1/3}\mathcal D(R)^{2/3}$, while local interpolation runs
the opposite (circular) direction: $\mathcal C(R)\lesssim\mathcal
A(R)^{3/4}\mathcal B(R)^{3/4}+\mathcal A(R)^{3/2}$. At a sampled time
$\tau_{k,j}=t_k+r_k^2s_j$, KNSS gives $\int_{B_R}|u(\tau_{k,j})|^3\le\gamma_k
M_k\int_{B_R}|u(\tau_{k,j})|^2\le\gamma_k(M_kR)\mathcal A(R)$. Writing
$L=M_kR$, a uniform bound needs $\mathcal A(R)=O(L^{-1})$, but finite energy
only gives $\mathcal A(R)\le E_0/R=E_0M_k/L$, yielding merely $O(E_0M_k)$.

**Pressure decomposition.** Splitting $p=p_{\rm near}+p_{\rm far}$ via a
cutoff on $B_{2R}(a)$: the near part obeys the Calderón-Zygmund bound
$\mathcal D_{\rm near}(R)\lesssim\mathcal C(4R)$, which is circular (exactly
the cubic quantity being sought). The mean-free far part's invariant tail
$\Theta(a,R,t)=R^3\int_{|y-a|>2R}|u(y,t)|^2/|y-a|^4\,dy$ is bounded only by
$\Theta\lesssim E_0/R=E_0M_k/L$ from finite energy — the same supercritical
rate as the velocity term. Pressure nonlocality survives trajectory
localization: remote mass is controllable after subtracting the pressure
gauge, but only at the supercritical rate, and fixing a physical $R$ shifts
the uncontrolled contribution back into the circular near term.

**Time averaging does not repair it.** Fixed-radius spacetime averaging over
the trajectory gives $R^{-2}\int_{t_k-R^2}^{t_k}\int_{B_R(x_k)}|u|^3\le C_R$,
but this selects only $k$-dependent good times $s_k\sim-M_k^2R^2\to-\infty$,
not a fixed profile time $s_j$ chosen before $k\to\infty$ as KNSS compactness
requires; recentring at $s_k$ loses the normalization at $(0,0)$, so the
averaged bound cannot be transferred to the same nonzero ancient profile. A
moving cutoff does not help either: KNSS supplies no trajectory derivative
$a'(t)$ or control of $u-a'(t)$ on the cutoff boundary, and the pressure term
is unchanged.

**Stress test.** A divergence-free bump rescaled as $w_M(x)=M\psi(x/M^{-2/3})$
has $O(1)$ energy and $O(M)$ sup-norm, matching the KNSS normalization
algebraically, yet its record-scale rescaling converges to a nonzero
constant with expanding-ball $L^3$ mass diverging for every $L_M\to\infty$.
This is not a genuine Navier-Stokes solution satisfying the local energy
inequality, so it is not a PDE counterexample, but it confirms finite energy
plus the bare KNSS pointwise normalization cannot algebraically force the
bound without using the equations' pressure structure — which itself does
not close, as shown above.

**Precise missing estimate.** A sufficient new hypothesis would be
$\sup_j\limsup_k M_k\int_{B_{\rho_k}(a_k)}|u(x,\tau_{k,j})|^2\,dx<\infty$ — a
genuinely stronger local $L^2$ anti-concentration bound. KNSS converts this
directly into the required $L^3$ bound, but finite energy alone supplies
only $M_kE_0$, and the local energy inequality/pressure system above does
not improve that to the required bound.

## Disposition

- Local energy inequality along the record-center trajectory: **blocked**,
  not refuted. No PDE counterexample is known; the obstruction is a precise
  missing local $L^2$ anti-concentration estimate (above), distinct from
  both the global energy/Serrin and CKN singular-set obstructions.
  `LOCAL-L3-BOUND-DERIVATION` remains `blocked`.
