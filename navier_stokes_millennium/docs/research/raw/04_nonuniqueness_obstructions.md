# Nonuniqueness, Ill-Posedness, and Cascade Obstructions

**Research date:** 2026-08-13

**Artifact status:** raw source-audited research report; not a proof of the
Navier-Stokes Millennium problem

**Primary mathematical sources:** **15**. Full text was directly inspected for
14; the theorem body of [KP05] was access-limited, so only its publisher
abstract and metadata are used. One companion code repository [HWY-code] was
inspected separately and is not included in the count.

**Scope:** nonuniqueness for the exact incompressible Navier-Stokes equations;
convex integration and later critical-data constructions; forced versus
unforced Leray-Hopf results; critical and supercritical norm inflation; Tao's
averaged-equation blowup; and the rigorous limits of energy-cascade heuristics.

## 1. Audit verdict

None of the inspected theorems proves any of Fefferman's alternatives (A)-(D).
The reasons are theorem-specific:

1. Published convex-integration results [BV19], [BCV21], and [CL22] solve the
	exact, unforced equation on a torus and can start from smooth data, but the
	nonunique branches are not Leray-Hopf: they lack the full energy inequality
	and/or $L^2_tH^1_x$ regularity.
2. [ABC22] gives two distinct **suitable Leray-Hopf** solutions on
	$\mathbb R^3$ with zero initial velocity and the same force, but that force
	has self-similar singular behavior at $t=0$ and does not satisfy
	Fefferman's smooth rapidly decreasing force hypothesis.
3. [CP25] gives two global solutions, smooth for every $t>0$, to the exact
	unforced periodic equation, but its $BMO^{-1}$ initial datum has infinite
	kinetic energy and is not smooth.
4. [CDP26] claims an unforced weak branch from every smooth periodic datum that
	is spatially smooth at every time and classically smooth away from one
	time. Its blowup is from the **right**, the branch lies in neither
	$L^\infty_tL^2_x$ nor $L^2_tH^1_x$ near that time, and a classical branch
	coexists with it. It is an unpublished v2 preprint, not a Clay breakdown
	theorem.
5. [HWY26] claims unforced suitable Leray-Hopf nonuniqueness on $\mathbb R^3$,
	but for an initial datum singular like $|x|^{-1}$ at the origin. It is an
	unpublished computer-assisted preprint whose certificate was not rerun in
	this audit. Even if correct, its rough datum and nonuniqueness conclusion do
	not prove a Clay alternative.
6. Norm inflation in [BP08], [Luo24], and [Luo25] occurs while the selected
	solution is still smooth. It proves instability of a rough topology, not
	finite-time singularity or failure of a smooth solution to exist.
7. [Tao16] proves finite-time blowup for an **averaged** bilinear operator that
	preserves the usual energy cancellation. This rigorously blocks arguments
	using only that cancellation and generic harmonic-analysis estimates, but
	it is not the Navier-Stokes equation.
8. Dyadic blowup, supercritical scaling, and a one-way cascade are not
	interchangeable with blowup of the exact PDE. [Tao09] proves global
	regularity for a logarithmically supercritical modified equation, [CD14]
	exhibits norm inflation even in globally regular hyperdissipative regimes,
	and [Tao16] identifies interference that defeats a naive shell-to-shell
	cascade.

The recent preprints [CDP26] and [HWY26] are recorded because the literature is
version-sensitive. Their source statements are reported exactly; this audit
does not promote their new mathematical claims to independently verified
facts.

## 2. Epistemic statuses

This report uses the repository's required statuses:

- `established`: imported from an inspected primary source with matching
  hypotheses;
- `proved`: derived here with a displayed proof artifact and falsification
  check;
- `conjectured`: plausible but not proved;
- `blocked`: a named verification, hypothesis, or source is missing; and
- `refuted`: contradicted by a checked theorem, calculation, or quantifier.

For a new preprint, the statement "Theorem X in vN asserts Y" can be
`established` as a bibliographic fact while the independent correctness of Y
remains `blocked`.

## 3. The Clay comparator

Fefferman's official description [F, equations (1)-(11) and statements
(A)-(D), PDF pp. 1-2] is the controlling target.

| Alternative | Quantifier, domain, and force | Required conclusion |
|---|---|---|
| **(A)** | For every divergence-free Schwartz datum on $\mathbb R^3$; $f\equiv0$ | A global $C^\infty$ solution on $\mathbb R^3\times[0,\infty)$ with uniformly bounded kinetic energy. |
| **(B)** | For every smooth unit-periodic divergence-free datum on $\mathbb R^3/\mathbb Z^3$; $f\equiv0$ | A global periodic $C^\infty$ velocity and pressure. |
| **(C)** | There exist a divergence-free Schwartz datum and a force smooth through $t=0$, with every space-time derivative rapidly decreasing; $\mathbb R^3$ | No global solution in Fefferman's smooth bounded-energy class exists. |
| **(D)** | There exist smooth unit-periodic data and a smooth periodic force whose derivatives rapidly decrease in time | No global periodic smooth solution exists. |

The erratum on [F, sixth physical PDF page] makes periodicity of the pressure
explicit. A proof
of one alternative suffices. Two logical points control this report:

- (A) and (B) assert **existence**, not uniqueness. A wild weak solution can
  coexist with the required global smooth solution.
- (C) and (D) assert **nonexistence of every accepted global smooth solution**
  for selected smooth data and force. Nonuniqueness of weak solutions is not
  that conclusion.

## 4. Solution classes that must not be collapsed

| Label used here | Minimum relevant content | What the label does not supply by itself |
|---|---|---|
| Distributional/very weak solution | The PDE holds against test functions; the paper specifies an ambient integrability class. | Energy admissibility, $L^2_tH^1_x$, uniqueness, or smoothness. |
| Bounded kinetic-energy weak solution | Typically $u\in C_tL^2_x$ or $L^\infty_tL^2_x$. | The integrated viscous dissipation term or the Leray-Hopf energy inequality. |
| Mild/Oseen solution | A Duhamel formula with the heat semigroup. | Leray-Hopf admissibility unless the needed energy estimates are also proved. |
| "Dissipative" weak solution in [BV19] | The prescribed kinetic energy can be chosen nonincreasing. | $u\in L^2_tH^1_x$ and the integrated energy inequality. |
| Leray-Hopf solution | $u\in L^\infty_tL^2_x\cap L^2_t\dot H^1_x$, distributional equation, initial trace/weak continuity, and global energy inequality. | Suitability under every convention, uniqueness, or full regularity. |
| Suitable weak solution | A weak solution satisfying a local energy inequality for $(u,p)$ (and force, if present). | Uniqueness or an empty singular set. A local definition alone need not give finite total energy. |
| Classical solution on an interval | Smooth jointly in space and time on that interval. | Smoothness across an omitted time or global continuation. |
| Spatially smooth at each time | $u(t,\cdot)\in C^\infty$ for each fixed $t$. | Joint time smoothness, boundedness as $t\to T_*$, or Leray-Hopf energy control. [CDP26] exploits exactly this distinction. |
| Norm inflation | Arbitrarily small initial norm leads to arbitrarily large norm in arbitrarily short positive time. | Blowup of the solution, loss of smoothness, nonuniqueness, or nonexistence. |

## 5. Exact-equation nonuniqueness: quantifier and class table

All equations in this table are the exact incompressible Navier-Stokes
equations, not Tao's averaged equation or a dyadic model.

| Source and theorem | Exact quantifier and data | Domain; force | Constructed regularity | Energy and Leray-Hopf status | Clay consequence |
|---|---|---|---|---|---|
| [BV19], Definition 1.1 and Theorem 1.2, preprint pp. 1-3 | For **any** smooth nonnegative energy profile $e:[0,T]\to\mathbb R_{\geq0}$, there exists a weak solution with $\int|v(t)|^2=e(t)$. | $\mathbb T^3=\mathbb R^3/(2\pi\mathbb Z)^3$; unforced; viscosity in $(0,1]$. | $v\in C_tH_x^\beta$ for some $\beta>0$; vorticity in $C_tL^1_x$. | Finite kinetic energy. The paper explicitly does **not** prove $L^2_t\dot H^1_x$ or the Leray-Hopf inequality. | None. Even a nonincreasing $e$ gives only the paper's weaker "dissipative" label. |
| [BCV21], Definition 1.1, Theorem 1.1, Remarks 1.2-1.3, preprint pp. 1-3 | For any two strong solutions $u^{(1)},u^{(2)}$ on $[0,T]$ whose data have zero spatial mean, there is a weak solution equal to the first on $[0,T/3]$ and the second on $[2T/3,T]$. Hence zero-mean strong initial data have nonunique weak continuations in the theorem's class. | $[-\pi,\pi]^3$ periodic; unforced. | $C_t(H^\beta\cap W^{1,1+\beta})$; smooth outside a time set of dimension $<1-\beta$. | Not Leray-Hopf. Taking zero initial data and a later nonzero shear makes kinetic energy increase from zero. | None. A smooth classical branch exists on the same interval, so (B) is not negated. |
| [CL22], Theorems 1.6 and 1.8, Remarks 1.7 and 1.9, preprint pp. 4-6 | For $d\geq2$, $1\leq p<2$, every $q<\infty$, and every $\varepsilon>0$, a smooth divergence-free zero-mean comparison field can be approximated by a weak solution; smooth initial data have infinitely many weak solutions in $L^p_tL^\infty_x$. | $\mathbb T^d=\mathbb R^d/\mathbb Z^d$; unforced. | $L^p_tL^\infty_x\cap L^1_tW^{1,q}_x$; smooth off a time set of Hausdorff dimension $\leq\varepsilon$. | Explicitly non-Leray-Hopf; examples can have unbounded kinetic energy and fail the global energy equality. | None. The exact PDE and smooth periodic data match part of (B), but a bad weak branch does not disprove existence of a global smooth branch. |
| [ABC22], Definition 1.1 and Theorems 1.2-1.3, preprint pp. 1-6 | There **exist** $T>0$, one force $f$, and two distinct solutions with the same zero initial datum. | $\mathbb R^3$; forced; $f\in L^1_tL^2_x$. | Smooth for every $t>0$; critical self-similar bounds. | Both are suitable Leray-Hopf solutions and satisfy the global and local energy inequalities with equality. | None. The force is singular at $t=0$ and fails Fefferman (5); nonuniqueness is not the nonexistence required by (C). |
| [CP25], Theorem 1.2 and Remarks 1.3-1.7, preprint pp. 1-3 | There **exists** a divergence-free $U^0\in BMO^{-1}$ giving two distinct global solutions. | $\mathbb T^3=\mathbb R^3/(2\pi\mathbb Z)^3$ in the proof; unforced. | Both are $C^\infty$ for $t>0$, bounded in the Koch-Tataru path space, and continuous into $\dot W^{-1,p}$ for all finite $p$. | Not Leray-Hopf because $U^0\notin L^2$; the construction deliberately uses infinite energy. | None. The datum is rough and not in Fefferman's periodic smooth class. |
| [CDP26], Theorem 1.1 and Remarks 1.2-1.5, preprint pp. 2-5 | **For every** smooth divergence-free $u_0$, and every selected $T_*$ before a short classical lifespan, v2 claims a weak branch that equals the classical solution through $T_*$ and blows up from the right. | $\mathbb T^d$, every $d\geq2$; unforced. | Classical on $[0,T_*]$ and $(T_*,T]$; $u(t,\cdot)\in C^\infty$ even at $T_*$; weak-* $BMO^{-1}$ time continuity; Type-I $L^\infty$ growth as $t\downarrow T_*$. | The paper explicitly states $u\notin L^\infty_tL^2_x$ and $u\notin L^2_tH^1_x$ near $T_*$. Not Leray-Hopf; infinite-frequency energy injection is necessary. | None. This is a right-hand wild-branch singularity coexisting with a local classical branch, not forward breakdown or nonexistence in (B)/(D). Preprint status applies. |
| [HWY26], Theorem 1 and Definition 1, preprint pp. 1-2 | v2 claims there **exists** a compactly supported $u_{\rm loc}$ producing infinitely many solutions. $u_{\rm loc}\in C^\infty(\mathbb R^3\setminus\{0\})\cap L^q$ for every $q<3$ and behaves like $|x|^{-1}$ at the origin. | $\mathbb R^3$; unforced. | Claimed suitable Leray-Hopf solutions, smooth for $t>0$, with $L^s_tL^q_x$ bounds on the supercritical side $3/q+2/s>1$. | The preprint asserts the global energy inequality; positive-time smoothness yields local energy equality away from $t=0$. The datum is in $L^2$ but is not smooth at the origin. | None even if validated. Rough-data Leray-Hopf nonuniqueness is not (A), (C), or smooth-data blowup. Correctness is `blocked` here pending independent verification. |

### 5.1 Buckmaster-Vicol: arbitrary kinetic energy is not Leray-Hopf

[BV19, Theorem 1.2, preprint p. 2] prescribes the scalar kinetic-energy
profile exactly. Choosing $e(0)=0$ and $e(t)>0$ later gives a nonzero weak
solution with zero initial velocity. Choosing two profiles that agree initially
and then differ gives nonuniqueness. Choosing $e$ nonincreasing gives what the
paper calls dissipative weak solutions.

The paper immediately states the missing hypotheses on preprint p. 3: it does
not prove the Leray-Hopf energy inequality or $L^2_t\dot H^1_x$. A nonincreasing
function $\|u(t)\|_2^2$ does not imply

$$
\frac12\|u(t)\|_2^2+\int_0^t\|D u(s)\|_2^2\,ds
\leq \frac12\|u(0)\|_2^2.
$$

The omitted nonnegative dissipation term is decisive. Thus "dissipative" in
this theorem must not be rewritten as "Leray-Hopf" or "suitable."

### 5.2 Gluing results: smooth data do not make the wild branch admissible

[BCV21, Theorem 1.1] glues arbitrary strong solutions while retaining small
positive Sobolev regularity and a small set of singular times. [BCV21, Remark
1.2] explicitly takes the zero solution first and a nonzero shear flow later.
That construction proves unforced nonuniqueness from smooth data in its weak
class, but also visibly violates the unforced energy inequality.

[CL22, Theorem 1.8] moves near the Ladyzhenskaya-Prodi-Serrin threshold in the
class $L^p_tL^\infty_x$, $p<2$. On each regularity interval the classical
energy identity holds, but [CL22, Remark 1.9(3)-(4), preprint p. 5] says the
global identity fails and higher norms diverge across the accumulating
intervals. The theorem is sharp for its general weak class at the endpoint
$(p,q)=(2,\infty)$; it does not reach $p=2$ or Leray-Hopf.

### 5.3 Forced suitable Leray-Hopf nonuniqueness

In [ABC22], the force has a smooth compactly supported similarity profile
$\bar F$ but the physical force is

$$
\bar f(x,t)=t^{-3/2}\bar F(x/\sqrt t).
$$

[ABC22, equation (1.24), preprint p. 6] gives, in particular,
$\|f(t)\|_2\lesssim t^{-3/4}$, which is integrable in time but singular at
$t=0$. Higher derivatives are more singular. This is why the force belongs to
$L^1_tL^2_x$ and supports a Leray-Hopf theory while failing Fefferman's
$C^\infty(\mathbb R^3\times[0,\infty))$ and rapid-decay condition (5).

The theorem is nonetheless a genuine and important distinction: forced
suitable Leray-Hopf solutions can be nonunique. The invalid inference is from
that fact to Clay (C).

### 5.4 Critical rough data with immediate smoothing

[CP25, Theorem 1.2, preprint p. 2] proves unforced nonuniqueness in the same
large-data Koch-Tataru path class in which small $BMO^{-1}$ data are globally
well posed. Both branches are smooth for all positive time. [CP25, Remark 1.5]
states exactly why this is not a Leray-Hopf theorem: the initial velocity is
not in $L^2$ and the simplified mechanism requires infinite energy. [CP25,
Remark 1.6] further says that the datum is smooth only outside a measure-zero
set.

"Smooth solutions from critical data" therefore means positive-time
smoothing of rough data, not two classical solutions emanating from a
Fefferman-smooth datum.

### 5.5 The 2026 instantaneous-blowup preprint

[CDP26, Theorem 1.1] uses "instantaneous blowup" for

$$
\limsup_{t\downarrow T_*}\|u(t)\|_\infty=\infty,
$$

where the approach is from **later** times. The solution equals the ordinary
classical solution on $[0,T_*]$, is classical again on $(T_*,T]$, and has a
smooth spatial value at $T_*$. The singularity is temporal, not loss of spatial
smoothness at the selected time. Standard local theory from $u(T_*)$ supplies
a different bounded classical continuation, producing weak-class
nonuniqueness.

[CDP26, Remark 1.4, preprint p. 4] states that the constructed branch is in
neither Leray-Hopf energy space near $T_*$. The paper also explains that the
energy entering from infinite wavenumber is necessary for its Type-I event.
Thus the result, if validated, is evidence about general weak solutions and an
inverse cascade, not the forward maximal-classical-solution blowup described by
Fefferman on PDF pp. 2-3.

### 5.6 The 2026 unforced Leray-Hopf preprint

[HWY26, Theorem 1, preprint p. 1] claims the first unforced suitable
Leray-Hopf nonuniqueness theorem. The construction seeks a forward
self-similar profile and an unstable eigenpair, then localizes the
scale-invariant datum. Its own Section 1.2 stresses that this is forward
self-similarity from a datum singular like $|x|^{-1}$, not backward
self-similarity or finite-time blowup from smooth data.

This report marks the mathematical claim `blocked` rather than
`established` for independent purposes:

- arXiv:2509.25116v2 has no journal reference or non-arXiv DOI as of the
	research date;
- the decisive exact profile and eigenpair depend on computer-assisted bounds;
- the companion repository [HWY-code] requires Julia 1.11 or newer and at
	least 800 GB RAM, so the notebooks were not rerun here;
- the repository has no release; the inspected default-branch tip was commit
	`615ee6f3eca3abad7b5814fe9334bcd80bea0328` dated 2026-03-23; and
- its README tree lists a `Manifest.toml`, while its later run notes say the
	project does not include one and dependencies will be resolved dynamically.

That reproducibility inconsistency is a caveat, not a mathematical refutation.
No published acceptance or refutation of the v2 claim was established in this
audit. Even if every certificate is correct, $u_{\rm loc}$ is not smooth at the
origin and the conclusion is nonuniqueness, so no Clay alternative follows.

## 6. Norm inflation and ill-posedness

For the classical equation on $\mathbb R^3$,

$$
u_\lambda(x,t)=\lambda u(\lambda x,\lambda^2t),
$$

and the homogeneous Besov norm scales as

$$
\|u_\lambda(0)\|_{\dot B^s_{p,q}}
=\lambda^{s+1-3/p}\|u(0)\|_{\dot B^s_{p,q}}.
$$

Thus $s_c=-1+3/p$ is critical; $s<s_c$ is supercritical in this convention.

| Source and theorem | Space and quantifier | Data/domain/force | What happens at the inflation time | What it does not imply |
|---|---|---|---|---|
| [BP08], Theorem 1.1, preprint p. 3 | For every $\delta>0$, small $\dot B^{-1}_{\infty,\infty}$ data produce norm $>\delta^{-1}$ at some $0<t<\delta$. | Schwartz data on $\mathbb R^3$; unforced classical NSE. | The constructed local solution exists; the rough critical norm is large. | This is **critical**, not supercritical, and the theorem does not assert loss of smoothness or finite maximal time. |
| [Luo24], Theorem 1.3, preprint p. 3 | For every $0<s<1/2$ and $\varepsilon>0$, $\|u_0\|_{H^s}\leq\varepsilon$ while $\|u(t_*)\|_{\dot H^s}\geq\varepsilon^{-1}$ for some $t_*\leq\varepsilon$. | Divergence-free $C_c^\infty(\mathbb R^3)$ data; unforced. | $u\in C^\infty([0,t_*]\times\mathbb R^3)$. | No singularity, nonuniqueness, or failure of Clay (A)/(C). v2 is an unpublished preprint. |
| [Luo25], Theorem 1.1, preprint pp. 1-2 | For $s$ nonzero and $-3<s-3/p<-1$, small $\dot B^s_{p,1}$ data produce large $\dot B^s_{p,\infty}$ norm. Embeddings yield inflation in every $\dot B^s_{p,q}$ in this range. | Divergence-free $C_c^\infty(\mathbb R^3)$ data; unforced. | The solution is $C^\infty$ throughout $[0,t_*]$. | No blowup. The excluded $s=0$ supercritical Lebesgue cases remain open in this theorem. v1 is an unpublished preprint. |
| [Luo25], Theorem 1.3, preprint p. 3 | For every $M>0$, some smooth solution has $\|\omega(t_*)\|_\infty/\|\omega_0\|_\infty\geq M$. | $C_c^\infty(\mathbb R^3)$ data; unforced. | A finite, short burst of arbitrarily large growth. | Not unbounded growth for one fixed datum and not a self-sustaining feedback loop; the paper explicitly places those beyond scope. |
| [CD14], Theorem 1.1 and Corollary 1.2, preprint pp. 2-3 | For fractional dissipation $(-\Delta)^\alpha$, $\alpha\geq1$, small negative Besov norms inflate in arbitrarily short time. | Smooth $2\pi$-periodic data; unforced generalized NSE. | The solution is smooth; for $\alpha\geq5/4$ it can be global. | Norm inflation does not imply blowup. For $\alpha>1$ this is not the classical NSE. |

### 6.1 What "ill-posed" means in these theorems

The results disprove continuity or boundedness of a data-to-solution map in the
specified rough topology. They do not say that smooth-data local existence or
classical uniqueness has failed. Each datum used in [BP08], [Luo24], and
[Luo25] has its ordinary smooth local solution; the point is that the lifespan
or norm growth cannot be controlled continuously by the small supercritical
norm alone.

The [BP08] space $\dot B^{-1}_{\infty,\infty}$ is invariant under Navier-Stokes
scaling. Calling that theorem "supercritical norm inflation" is an overclaim.
[Luo24] and [Luo25] supply the directly checked supercritical results.

### 6.2 Why large finite growth is not blowup

[Luo25, Theorem 1.3 and the paragraph following it, preprint p. 3] explicitly
distinguishes a short burst from the repeated feedback needed for singularity.
The quantifiers are

$$
\forall M\;\exists u_0\;\exists t_*(u_0):
\frac{\|\omega(t_*)\|_\infty}{\|\omega_0\|_\infty}\geq M,
$$

not

$$
\exists u_0\;\exists T_*<\infty:
\limsup_{t\uparrow T_*}\|\omega(t)\|_\infty=\infty.
$$

Changing the datum with $M$ cannot be exchanged with one datum and one
singular time.

## 7. Tao's averaged Navier-Stokes blowup

After eliminating pressure, Tao writes the exact equation as

$$
\partial_tu=\Delta u+B(u,u),
$$

where the symmetric Euler bilinear operator obeys

$$
\langle B(u,u),u\rangle_{L^2}=0.
$$

[Tao16, definition (1.12), preprint pp. 6-8] defines an averaged operator
$\widetilde B$ by averaging the trilinear form of $B$ after applying rotations,
bounded dilations, and order-zero Fourier multipliers to its three arguments.
The averaging is chosen so that

$$
\langle\widetilde B(u,u),u\rangle_{L^2}=0,
$$

and hence smooth solutions of

$$
\partial_tu=\Delta u+\widetilde B(u,u)
\qquad \mathrm{(ANS)}
$$

obey the ordinary unforced energy identity.

**Exact theorem.** [Tao16, Theorem 1.5, preprint p. 9] constructs a symmetric
averaged operator with this cancellation and a divergence-free Schwartz datum
on $\mathbb R^3$ for which no global mild $H^{10}$ solution of (ANS) exists.
The following paragraph strengthens the construction to a smooth mild solution
on $[0,T_*)$ whose $H^{10}$ norm diverges and which blows up at the spatial
origin as $t\uparrow T_*<\infty$.

This theorem is:

- unforced;
- on $\mathbb R^3$;
- from Schwartz divergence-free data;
- energy conserving/dissipating in exactly the usual smooth identity; and
- a genuine finite-time blowup theorem for (ANS).

It is **not** a theorem for the exact Navier-Stokes bilinear operator $B$.
Therefore it proves neither (A) nor (C). Its rigorous implication is a barrier:
any regularity proof that treats $B$ only through estimates and cancellation
properties also shared by $\widetilde B$ cannot distinguish the blowing-up
equation from the exact one. A successful positive proof must use finer
structure, such as a property of the exact Fourier symbol, vorticity equation,
or unique continuation that the averaged operator lacks. See [Tao16, preprint
pp. 9-10].

The version matters. The arXiv comment for v3 and footnote 8 on preprint p. 7
state that a referee found the needed nondegeneracy failed without dilation
averaging. Dilation averaging was added in v3. Any summary based on v1 or v2
that says only rotations and order-zero multipliers is obsolete.

## 8. Rigorous limits of naive energy-cascade arguments

### 8.1 The energy norm is supercritical, but that is only an obstruction

**Claim CAS-1 (`proved`).** Under the exact scaling,

$$
\|u_\lambda(t)\|_2=\lambda^{-1/2}\|u(\lambda^2t)\|_2,
\qquad
\|u_\lambda(t)\|_{\dot H^s}
=\lambda^{s-1/2}\|u(\lambda^2t)\|_{\dot H^s}.
$$

**Proof artifact.** Substitute $y=\lambda x$ in the $L^2$ integral and use
that each homogeneous derivative contributes a factor $\lambda^s$.

**Falsification check.** At $s=1/2$ the second exponent is zero, agreeing with
criticality. At $s=0$ it reproduces the first formula. A sign reversal would
fail both checks.

Thus concentration at spatial scale $\lambda^{-1}$ can have small $L^2$ norm
while critical or higher norms remain fixed or grow. The energy estimate alone
cannot exclude concentration. This does not construct a solution that actually
concentrates.

### 8.2 Time-integrated dissipation does not give pointwise enstrophy control

The unforced energy inequality controls

$$
\int_0^T\|D u(t)\|_2^2\,dt,
$$

not $\sup_t\|D u(t)\|_2$. The scalar test functions

$$
g_N(t)=N^{1/2}\mathbf 1_{[0,N^{-1}]}(t)
$$

satisfy $\int g_N^2=1$ while $\|g_N\|_\infty=N^{1/2}$. This is not a
Navier-Stokes construction; it is a falsification of the purely functional
inference "finite time integral implies a uniform pointwise bound."

### 8.3 A one-way local cascade is an additional model assumption

The exact energy cancellation says that the nonlinear term does not change
total kinetic energy for a smooth solution. It does not say that every triadic
interaction sends energy monotonically from shell $n$ to shell $n+1$, that
interactions are strictly local in frequency, or that transfer has a fixed
sign.

[Tao16, preprint pp. 11-13] discusses a scalar dyadic model in which a tempting
forward cascade can fail because shell $n+1$ begins transferring to $n+2$
before receiving most of the energy from $n$. The resulting interference leaves
energy at lower shells long enough for dissipation to remove it. Tao's blowup
operator is engineered with extra internal modes and selected interactions to
avoid this obstruction. That engineering is precisely why its blowup cannot be
silently transferred back to the exact $B$.

[KP05] is the original dyadic source. Its publisher abstract reports finite-time
blowup for the inviscid dyadic Euler model and for sufficiently weak
hyperdissipation. The full theorem text was inaccessible in this run, so no
theorem number or sharper exponent is attributed to [KP05] here. [Tao16,
preprint p. 11] is the directly inspected source for the later comparison of
parameter ranges.

### 8.4 A finite cascade burst is not an infinite feedback loop

[Luo25] rigorously realizes forward mixing for positive regularity and backward
unmixing for negative regularity, but only until a finite smooth inflation time.
To turn this into blowup one would need one datum and estimates that reinitialize
the mechanism at infinitely many scales, control all cross-scale errors, keep
the cascade times summable, and prevent viscosity from dissipating the transfer.
No such theorem is supplied by norm inflation.

[CDP26] claims a complete inverse cascade for the exact PDE, but its wild branch
requires energy to enter from infinite frequency and leaves the Leray-Hopf
class. It therefore illustrates rather than removes the admissibility
obstruction.

### 8.5 Supercriticality does not determine the outcome

[Tao09, Theorem 1.1, preprint p. 2] proves global smoothness for

$$
\partial_tu+(u\cdot\nabla)u=-D^2u-\nabla p
$$

when, for large $|\xi|$,

$$
m(\xi)\geq\frac{|\xi|^{(d+2)/4}}{g(|\xi|)},
\qquad
\int_1^\infty\frac{ds}{s g(s)^4}=\infty.
$$

This includes a logarithmically supercritical hyperdissipative equation.
[CD14] additionally proves norm inflation for $\alpha\geq5/4$, where global
regularity is known. Therefore both implications

$$
\mathrm{supercritical\ scaling}\Longrightarrow\mathrm{blowup}
$$

and

$$
\mathrm{norm\ inflation}\Longrightarrow\mathrm{blowup}
$$

are `refuted` as general principles. These examples use modified dissipation,
so they do not prove regularity of the classical equation either.

### 8.6 What an actual cascade proof would owe

A negative Clay argument based on a cascade would have to prove, for the exact
operator and one Fefferman-admissible datum:

1. a quantitative transfer mechanism with the correct sign for the actual
	interacting modes;
2. control of nonlocal and overlapping triads rather than deleting them;
3. persistence or reinitialization through infinitely many scales;
4. summability of the transfer times before one finite $T_*$;
5. domination of viscosity at every stage;
6. convergence to an exact solution on $[0,T_*)$;
7. divergence of a continuation-controlling norm as $t\uparrow T_*$; and
8. an argument that no other global smooth solution with the same data exists,
	if the conclusion is phrased directly as (C) or (D).

Energy conservation, dimensional analysis, a shell-model blowup, or finite
norm growth discharges none of items 1-8 by itself.

## 9. Clay implication matrix

| Result | What it establishes | Why it proves neither positive nor negative Clay alternative |
|---|---|---|
| [BV19], Theorem 1.2 | Unforced finite-energy weak nonuniqueness and arbitrary kinetic-energy profiles on a torus. | Not Leray-Hopf or globally smooth; weak nonuniqueness does not negate smooth existence. |
| [BCV21], Theorem 1.1 | Unforced weak gluing from smooth periodic data. | Constructed branch violates energy admissibility; another classical branch coexists. |
| [CL22], Theorems 1.6/1.8 | Unforced nonuniqueness near the $L^2_tL^\infty_x$ threshold, from smooth data. | Still non-Leray-Hopf; no proof that a global smooth branch fails. |
| [ABC22], Theorems 1.2/1.3 | Forced suitable Leray-Hopf nonuniqueness on $\mathbb R^3$. | Force is not smooth at $t=0$ as required by (C), and nonuniqueness is not nonexistence. |
| [CP25], Theorem 1.2 | Unforced critical-path-space nonuniqueness with positive-time smoothness. | Initial datum is rough and has infinite energy. |
| [CDP26], Theorem 1.1 | Preprint claim of a right-hand Type-I event on a non-energy weak branch from every smooth periodic datum. | Not forward breakdown of the maximal classical solution, not Leray-Hopf, and a bounded classical continuation exists locally. |
| [HWY26], Theorem 1 | Preprint claim of unforced suitable Leray-Hopf nonuniqueness. | Initial datum is singular at the origin; nonuniqueness does not prove smooth-data breakdown. Independent certificate verification is blocked. |
| [BP08], Theorem 1.1 | Critical Besov norm inflation for smooth whole-space data. | The local solution remains a solution at the inflation time; no singularity theorem. |
| [Luo24], Theorem 1.3 | Supercritical Sobolev norm inflation for compactly supported smooth data. | The theorem explicitly keeps the solution $C^\infty$ through $t_*$. |
| [Luo25], Theorems 1.1/1.3 | Supercritical Besov inflation and arbitrarily large finite vorticity growth. | Quantifiers vary the datum with the target growth; no one-datum infinite growth or nonextendibility. |
| [CD14], Theorem 1.1 | Negative-Besov inflation for generalized dissipation. | Modified equation; inflation can coexist with known global regularity. |
| [Tao16], Theorem 1.5 | Finite-time blowup from Schwartz data with the usual energy cancellation. | The averaged bilinear operator is not the exact Navier-Stokes operator. |
| [Tao09], Theorem 1.1 | Global regularity slightly into a supercritical hyperdissipative regime. | Modified dissipation, so neither (A)/(B) nor (C)/(D) follows. |
| [KP05], publisher abstract | Blowup in a dyadic Euler/hyperdissipative sequence model. | A sequence model is not a velocity-pressure solution of the exact PDE. |

## 10. Common overclaims

1. **"Buckmaster-Vicol disproved uniqueness of Leray-Hopf solutions."** False.
	[BV19, preprint p. 3] explicitly says Leray-Hopf regularity and inequality are
	not proved.
2. **"A nonincreasing prescribed energy profile is the Leray-Hopf energy
	inequality."** False. It omits the integrated viscous dissipation and
	$L^2_tH^1_x$.
3. **"A wild weak solution from smooth data refutes Clay (B)."** False. (B)
	asks that at least one global smooth solution exist for every datum.
4. **"ABC proves forced Clay breakdown."** False. Its force is only
	$L^1_tL^2_x$ at the initial time, not Fefferman-smooth, and the theorem proves
	multiplicity rather than absence of smooth solutions.
5. **"CP gives two smooth solutions from smooth initial data."** False. The
	branches are smooth only for $t>0$; the $BMO^{-1}$ datum is rough and not in
	$L^2$.
6. **"The CDP preprint proves the usual finite-time blowup scenario."** False.
	Its norm diverges from the right, the spatial value at the event is smooth,
	and its branch is not in the energy class.
7. **"If HWY v2 is correct, the Millennium problem is solved."** False. Its
	datum is singular at the origin and the theorem concerns nonuniqueness.
8. **"Norm inflation is finite-time blowup."** False. The inspected inflation
	theorems keep the solution smooth at the inflation time.
9. **"Bourgain-Pavlovic is a supercritical ill-posedness theorem."** False.
	$\dot B^{-1}_{\infty,\infty}$ is scaling critical.
10. **"Arbitrarily large finite vorticity growth gives one solution with
	 unbounded vorticity."** False; $\forall M\exists u_0(M)$ cannot be swapped
	 to $\exists u_0\forall M$.
11. **"Tao proved Navier-Stokes blowup."** False. He proved blowup after
	 replacing $B$ by a specially averaged $\widetilde B$.
12. **"Energy cancellation rules out blowup."** False for the class of
	 averaged equations by [Tao16]; more structure is necessary.
13. **"Supercritical scaling predicts blowup as a theorem."** False by
	 [Tao09], and norm inflation can coexist with global regularity by [CD14].
14. **"A dyadic cascade is a rigorous reduction of 3D Navier-Stokes."** False.
	 It is a model unless a separate theorem embeds or controls all discarded
	 interactions.
15. **"Energy must flow monotonically to high frequency."** Not supplied by
	 the total energy identity; direction, locality, and sign require separate
	 estimates for the exact triads.
16. **"Suitable means unique."** False. [ABC22] constructs two suitable
	 Leray-Hopf solutions under one rough-in-time force.

## 11. Source register

The first 14 mathematical sources below were inspected in full for this report.
[KP05] was checked only through its publisher abstract and metadata. Publication
years in labels sometimes follow online publication or the currently reviewed
preprint version; the entries give the formal status.

1. **[F]** Charles L. Fefferman, "Existence and Smoothness of the
	Navier-Stokes Equation," in *The Millennium Prize Problems*, AMS/Clay,
	2006, pp. 57-67. [Official PDF](https://www.claymath.org/wp-content/uploads/2022/06/navierstokes.pdf).
	Full text and appended erratum inspected.
2. **[BV19]** Tristan Buckmaster and Vlad Vicol, "Nonuniqueness of weak
	solutions to the Navier-Stokes equation," *Annals of Mathematics* 189:1
	(2019), 101-144. [DOI](https://doi.org/10.4007/annals.2019.189.1.3),
	[arXiv:1709.10033v4](https://arxiv.org/abs/1709.10033v4).
3. **[BCV21]** Tristan Buckmaster, Maria Colombo, and Vlad Vicol, "Wild
	solutions of the Navier-Stokes equations whose singular sets in time have
	Hausdorff dimension strictly less than 1," *JEMS* 24:9 (2022), 3333-3378;
	online 2021. [DOI](https://doi.org/10.4171/JEMS/1162),
	[arXiv:1809.00600v2](https://arxiv.org/abs/1809.00600v2).
4. **[CL22]** Alexey Cheskidov and Xiaoyutao Luo, "Sharp nonuniqueness for
	the Navier-Stokes equations," *Inventiones Mathematicae* 229:3 (2022),
	987-1054. [DOI](https://doi.org/10.1007/s00222-022-01116-x),
	[arXiv:2009.06596v2](https://arxiv.org/abs/2009.06596v2).
5. **[ABC22]** Dallas Albritton, Elia Brue, and Maria Colombo,
	"Non-uniqueness of Leray solutions of the forced Navier-Stokes equations,"
	*Annals of Mathematics* 196:1 (2022), 415-455.
	[DOI](https://doi.org/10.4007/annals.2022.196.1.3),
	[arXiv:2112.03116v1](https://arxiv.org/abs/2112.03116v1).
6. **[CP25]** Matei P. Coiculescu and Stan Palasek, "Non-uniqueness of smooth
	solutions of the Navier-Stokes equations from critical data," online in
	*Inventiones Mathematicae* (2025), issue 244:1 (2026), 165-219.
	[DOI](https://doi.org/10.1007/s00222-025-01396-z),
	[arXiv:2503.14699v2](https://arxiv.org/abs/2503.14699v2).
7. **[CDP26]** Alexey Cheskidov, Mimi Dai, and Stan Palasek,
	"Instantaneous Type I blow-up and non-uniqueness of smooth solutions of the
	Navier-Stokes equations," unpublished
	[arXiv:2511.09556v2](https://arxiv.org/abs/2511.09556v2), 2026 revision.
8. **[HWY26]** Thomas Hou, Yixuan Wang, and Changhe Yang, "Nonuniqueness of
	Leray-Hopf solutions to the unforced incompressible 3D Navier-Stokes
	Equation," unpublished computer-assisted
	[arXiv:2509.25116v2](https://arxiv.org/abs/2509.25116v2), 2026 revision.
	The paper was inspected; its numerical certificate was not rerun.
9. **[BP08]** Jean Bourgain and Natasa Pavlovic, "Ill-posedness of the
	Navier-Stokes equations in a critical space in 3D," *Journal of Functional
	Analysis* 255:9 (2008), 2233-2247.
	[DOI](https://doi.org/10.1016/j.jfa.2008.07.008),
	[arXiv:0807.0882v1](https://arxiv.org/abs/0807.0882v1).
10. **[Luo24]** Xiaoyutao Luo, "Illposedness of incompressible fluids in
	 supercritical Sobolev spaces," unpublished
	 [arXiv:2404.07813v2](https://arxiv.org/abs/2404.07813v2).
11. **[Luo25]** Xiaoyutao Luo, "Sharp norm inflation for 3D Navier-Stokes
	 equations in supercritical spaces," unpublished
	 [arXiv:2504.08288v1](https://arxiv.org/abs/2504.08288v1).
12. **[CD14]** Mimi Dai and Alexey Cheskidov, "Norm inflation for generalized
	 Navier-Stokes equations," *Indiana University Mathematics Journal* 63:3
	 (2014), 869-884. [DOI](https://doi.org/10.1512/iumj.2014.63.5249),
	 [arXiv:1212.3801v3](https://arxiv.org/abs/1212.3801v3).
13. **[Tao16]** Terence Tao, "Finite time blowup for an averaged
	 three-dimensional Navier-Stokes equation," *JAMS* 29:3 (2016), 601-674.
	 [DOI](https://doi.org/10.1090/jams/838),
	 [arXiv:1402.0290v3](https://arxiv.org/abs/1402.0290v3).
14. **[Tao09]** Terence Tao, "Global regularity for a logarithmically
	 supercritical hyperdissipative Navier-Stokes equation," *Analysis & PDE*
	 2:3 (2009), 361-366. [DOI](https://doi.org/10.2140/apde.2009.2.361),
	 [arXiv:0906.3070v4](https://arxiv.org/abs/0906.3070v4).
15. **[KP05]** Nets Hawk Katz and Natasa Pavlovic, "Finite time blow-up for a
	 dyadic model of the Euler equations," *Transactions of the AMS* 357:2
	 (2005), 695-708. [DOI](https://doi.org/10.1090/S0002-9947-04-03532-9).
	 Publisher abstract and metadata only; theorem body access is `blocked`.

**[HWY-code]** HouGroup2026,
[`3d-navier-stokes-nonuniqueness`](https://github.com/HouGroup2026/3d-navier-stokes-nonuniqueness),
inspected at commit `615ee6f3eca3abad7b5814fe9334bcd80bea0328`
(2026-03-23). This companion repository is not included in the count of 15
mathematical sources.
