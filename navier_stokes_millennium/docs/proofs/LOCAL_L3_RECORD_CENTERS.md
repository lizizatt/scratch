# Record-Center Weakening of the Local L3 Continuation Criterion

## Statement

Let $u$ be a whole-space mild Navier-Stokes solution on $[0,T)$ from smooth
rapidly decreasing data, with $T<\infty$ maximal, and suppose $T$ is a finite
singular endpoint. Let $(x_k,t_k)$, $r_k=M_k^{-1}\downarrow0$ be the KNSS
record-point sequence (`KNSS-RECORD-PROFILE`) producing the nonzero mild
ancient limit $v$. Suppose there exist centers $a_k\in\mathbb R^3$ with
$|a_k-x_k|\to0$, radii $\rho_k>0$, and a backward sequence of profile times
$s_j\downarrow-\infty$ such that

$$
C:=\sup_j\limsup_{k\to\infty}
\int_{B_{\rho_k}(a_k)}|u(x,t_k+r_k^2s_j)|^3\,dx<\infty,
\qquad
M_k(\rho_k-|a_k-x_k|)\to\infty\text{ as }k\to\infty.
$$

Then $v\equiv0$, contradicting the KNSS normalization $|v(0,0)|=1$; so no such
$T$ exists. This hypothesis is strictly weaker than the $M_R$ hypothesis of
`LOCAL-L3-CONTINUATION`, which requires the local $L^3$ bound uniformly over
*every* center $a\in\mathbb R^3$, not just along the record-center trajectory
$a_k\to x_k$.

## Proof

Let $d_k=|a_k-x_k|$ and set $v_k(y,s)=r_ku(x_k+r_ky,t_k+r_k^2s)$, the same
KNSS rescaling used in `LOCAL-L3-CONTINUATION`; by that theorem's compactness
step, $v_k\to v$ locally uniformly along a subsequence, with $v$ a nonzero
mild ancient solution and $|v(0,0)|=1$. This step uses only
`KNSS-RECORD-PROFILE` and does not invoke any local $L^3$ hypothesis.

Fix $j$ and $L>0$. By hypothesis, $M_k(\rho_k-d_k)\to\infty$, so for all
sufficiently large $k$, $L<M_k(\rho_k-d_k)$, i.e. $Lr_k<\rho_k-d_k$, hence

$$
B_{Lr_k}(x_k)\subset B_{\rho_k}(a_k).
$$

Critical $L^3$ change of variables gives

$$
\int_{B_L}|v_k(y,s_j)|^3\,dy
=\int_{B_{Lr_k}(x_k)}|u(x,t_k+r_k^2s_j)|^3\,dx
\le\int_{B_{\rho_k}(a_k)}|u(x,t_k+r_k^2s_j)|^3\,dx.
$$

Local uniform convergence of $v_k\to v$ implies convergence in
$L^3(B_L)$, so taking $\limsup_k$ and using the hypothesis,

$$
\int_{B_L}|v(y,s_j)|^3\,dy\le C.
$$

The bound $C$ is independent of $L$, so letting $L\to\infty$ (monotone
exhaustion of $\mathbb R^3$ by balls) gives

$$
\|v(s_j)\|_{L^3(\mathbb R^3)}^3\le C\qquad\text{for every }j.
$$

Hence $\sup_j\|v(s_j)\|_3\le C^{1/3}<\infty$ with $s_j\downarrow-\infty$. The
established Albritton-Barker Liouville theorem (`AB-L3-ANCIENT`) then forces
$v\equiv0$, contradicting $|v(0,0)|=1$. Therefore no such finite singular
endpoint exists. $\blacksquare$

## Why the weakening is valid

The original `LOCAL-L3-CONTINUATION` proof uses uniformity over all centers
$a\in\mathbb R^3$ only to (a) select $a=x_k$ in the local $L^3$ inequality,
and (b) upgrade an essential-supremum-in-time hypothesis to a bound at the
specific rescaled times $t_k+r_k^2s$, via lower semicontinuity of
$G(t)=\sup_a\int_{B_R(a)}|u(x,t)|^3dx$. Neither KNSS compactness,
nontriviality, mildness, nor the final Albritton-Barker application ever uses
control at centers other than the ones actually sampled by the rescaling.
When the hypothesis instead directly names the sampled times $s_j$ and
centers $a_k$, the lower-semicontinuity step is unnecessary and the argument
goes through verbatim with only local information along the record-center
trajectory. Setting $a_k=x_k$, $\rho_k=R$ recovers `LOCAL-L3-CONTINUATION` as
a special case, confirming this hypothesis is genuinely weaker (not merely a
restatement).

Mass escaping to infinity in the rescaled picture does not obstruct this
argument: the bound is only claimed and used on each fixed ball $B_L$ before
exhaustion, so no global (rescaled-space) uniform control is required at any
finite stage. A second concentration at finite rescaled distance from $a_k$
is eventually swallowed by $B_{\rho_k}(a_k)$ once $M_k(\rho_k-d_k)\to\infty$;
one at diverging rescaled distance plays no role in the fixed-$L$ estimate.

## Scope

This is a genuine narrowing of the hypothesis needed by
`LOCAL-L3-CONTINUATION`, not a new derivation of it from finite-energy data.
Restricting to record centers does not currently make the underlying
derivation problem easier: energy-type interpolation only supplies
time-integrated ($L^{4/3}_t$) local $L^3$ control, not control at the specific
selected times $t_k+r_k^2s_j$, and the concentrating counterexample in
`docs/proofs/COUNTEREXAMPLES.md` already concentrates at the record center
itself. `LOCAL-L3-BOUND-DERIVATION` therefore remains blocked even under this
weaker target.
