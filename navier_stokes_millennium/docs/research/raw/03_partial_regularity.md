# Partial Regularity, Singular Sets, and Backward Uniqueness

**Research status:** source-grounded report, checked 2026-08-13
**Scope:** unforced three-dimensional incompressible Navier-Stokes equations,
primarily in the whole space or an interior cylinder
**Primary sources used:** 6 (2 only partially accessible; see the source audit)

This report distinguishes four statements that are often conflated:

1. global existence of a finite-energy Leray-Hopf weak solution;
2. the local energy inequality defining a suitable weak solution;
3. partial regularity of every suitable weak solution; and
4. conditional full regularity under the endpoint bound
   $L^\infty_tL^3_x$.

None of the partial-regularity results below proves that the singular set is
empty. The global regularity problem remains outside their conclusions.

## Claim ledger

| ID | Claim | Status | Depends on | Primary evidence or proof artifact |
|---|---|---|---|---|
| PR-01 | Finite-energy divergence-free data on $\mathbb R^3$ admit a global Leray turbulent solution, with regularity on open time intervals whose complement is null. | established | none | [L34], existence theorem in Section 31, p. 241; structure theorem in Section 33, pp. 244-245 |
| PR-02 | Suitability is a local condition on a pair $(u,p)$ and includes the local energy inequality (LEI). | established | none | [L98], (2.3) and definition, pp. 244-245; [ESS03], Definition 2.1, p. 215 |
| PR-03 | Suitable finite-energy weak solutions exist; this is an existential construction, not a theorem that every abstract Leray-Hopf solution is suitable. | established | PR-02 | [L98], Theorem 2.2 and the paragraph preceding it, pp. 245-248, referring to the construction in [CKN82] |
| PR-04 | Every weak solution satisfying only the abstract Leray-Hopf axioms also satisfies the LEI. | blocked | PR-01, PR-02 | Missing implication: global/strong energy inequality $\Rightarrow$ LEI. [L98], p. 245, explicitly says suitability of the standard Galerkin solutions was unclear and uses a different suitable approximation. No cited source closes this implication. |
| PR-05 | At a finite right endpoint of a Leray regularity interval, the spatial singular set is contained in a closed set of finite $\mathcal H^1$ measure. | established | PR-01 | [S76], Theorem 1, pp. 535-536 |
| PR-06 | The exceptional times in Scheffer's formulation have zero $\mathcal H^{1/2}$ measure. | established | PR-01 | [S76], Theorem 2, p. 536 |
| PR-07 | The singular set of every suitable weak solution has zero one-dimensional parabolic Hausdorff measure. | established | PR-02 | [CKN82], main theorem; independently reproduced in [L98], Theorem 3.3 and final conclusion, pp. 253-256 |
| PR-08 | Small scale-invariant $L^3$ velocity plus $L^{3/2}$ pressure implies interior regularity. | established | PR-02 | [L98], Theorem 3.1, pp. 249-252; [ESS03], Lemma 2.2, pp. 215-216 |
| PR-09 | A sufficiently small limiting scaled enstrophy $r^{-1}\int_{Q_r}\lvert\nabla u\rvert^2$ implies regularity. | established | PR-02, PR-08 | [L98], Theorem 3.3 and its concluding paragraph, pp. 253-256 |
| PR-10 | PR-07 implies $\mathcal H^1(\Sigma_t)=0$ for every time and $\mathcal H^{1/2}(\pi_t\Sigma)=0$. | proved | PR-07 | Covering proof and falsification checks in Section 5 |
| PR-11 | In [ESS03], $L_{3,\infty}$ means $L^\infty_tL^3_x$, and this bound implies smoothness and uniqueness. | established | PR-01 | [ESS03], mixed-norm definition, p. 213; Theorem 1.3, p. 214 |
| PR-12 | The backward-uniqueness theorem used by [ESS03] requires a differential inequality, zero terminal trace, Gaussian growth control, and local parabolic $L^2$ regularity. | established | none | [ESS03], conditions (5.1)-(5.4) and Theorem 5.1, pp. 233-234 |
| PR-13 | Zero parabolic $\mathcal P^1$ measure does not imply an empty singular set or parabolic dimension strictly below one. | proved | PR-07 | Counterexamples and falsification checks in Section 5 |

`blocked` in PR-04 is deliberate. Some authors use "Leray solution" for a
particular approximation limit that already has additional admissibility. Here
"abstract Leray-Hopf" means only the energy class, distributional equation,
weak time continuity, initial trace, and global/strong energy inequality, as in
[ESS03], pp. 212-213.

## 1. Equations, scaling, and regular points

With viscosity normalized to one,

$$
\partial_tu+(u\cdot\nabla)u-\Delta u+\nabla p=0,
\qquad \nabla\cdot u=0.
$$

The parabolic scaling is

$$
u_\lambda(x,t)=\lambda u(\lambda x,\lambda^2t),
\qquad
p_\lambda(x,t)=\lambda^2p(\lambda x,\lambda^2t).
$$

For $z_0=(x_0,t_0)$, write

$$
Q_r(z_0)=B_r(x_0)\times(t_0-r^2,t_0).
$$

A point is regular if $u$ is locally bounded, equivalently locally Holder
continuous after an epsilon-regularity theorem is applied; the equations then
bootstrap to smoothness on a smaller cylinder. The singular set $\Sigma$ is the
complement of the regular set. Since regularity is local, $\Sigma$ is relatively
closed.

## 2. Leray-Hopf versus suitable weak solutions

### 2.1 Leray-Hopf is a global finite-energy notion

On $\mathbb R^3\times(0,T)$, an abstract Leray-Hopf weak solution has, in
particular,

$$
u\in L^\infty(0,T;L^2_\sigma)
   \cap L^2(0,T;\dot H^1_\sigma),
$$

satisfies the equation distributionally, has an appropriate weakly continuous
$L^2$ representative and initial trace, and obeys the global energy inequality

$$
\frac12\|u(t)\|_2^2+
\int_0^t\|\nabla u(s)\|_2^2\,ds
\leq \frac12\|u_0\|_2^2.
$$

See [ESS03], definition (1.3)-(1.7), p. 212, and Theorem 1.1, pp. 212-213.
Leray's original existence theorem is in [L34], Section 31, p. 241.

### 2.2 Suitability is local and includes an extra inequality

For an interior open space-time set $D$, a suitable weak solution is a pair
$(u,p)$ with local energy-class bounds, $p\in L^{3/2}_{\rm loc}(D)$, the
distributional equations, and, for every nonnegative
$\phi\in C_c^\infty(D)$,

$$
2\iint_D |\nabla u|^2\phi
\leq
\iint_D\left[
|u|^2(\partial_t\phi+\Delta\phi)
+(|u|^2+2p)u\cdot\nabla\phi
\right].
\tag{LEI}
$$

This is [L98], (2.3) and the definition on pp. 244-245; compare [ESS03],
Definition 2.1, p. 215. It is a local definition: it does not by itself assert
finite total energy, a global boundary condition, or an initial trace. A
globally constructed finite-energy suitable solution can have both labels, but
the definitions should not be identified.

The pressure exponent also needs care. The local suitable definition above asks
for $L^{3/2}$. For the energy class in the setting of [L98], Lemma 2.3,
pp. 246-247, pressure estimates improve this to space-time $L^{5/3}$ after a
pressure normalization. That pressure integrability does not prove the sign in
the LEI.

### 2.3 What is known and what remains a proof obligation

Known:

- CKN's approximation, together with the compactness mechanism stated as
  [L98], Theorem 2.2, pp. 245-248, constructs suitable weak solutions.
- The LEI passes to a limit when the approximants already satisfy it and the
  velocity converges strongly enough; this is exactly the content of [L98],
  Theorem 2.2.
- For the stronger solutions used in the endpoint argument, [ESS03], p. 221,
  observes that the local energy inequality is an equality.

Not licensed by these sources:

- The distributional equation plus the global energy inequality does not, by
  citation or definition, supply the LEI.
- Therefore CKN cannot be invoked for an arbitrary object called a "weak
  solution" or even for an abstract Leray-Hopf solution until suitability is
  proved or assumed.

[L98], p. 245, explicitly records that it was "not at all clear" whether the
weak solutions from the standard Galerkin procedure were suitable. This report
found no primary theorem among the checked sources proving the general
implication in PR-04, so it remains `blocked` rather than being silently assumed.

## 3. Scheffer's results: slices first, then space-time

### 3.1 The 1976 theorem is a spatial-slice theorem

Scheffer starts from Leray's decomposition into disjoint open regularity
intervals $J_q$. If $t_0$ is the finite right endpoint of one such interval,
[S76], Theorem 1, pp. 535-536, gives a closed $S\subset\mathbb R^3$ such that
$u$ extends continuously to

$$
(\mathbb R^3\times J_q)\cup((\mathbb R^3\setminus S)\times\{t_0\}),
$$

and

$$
\mathcal H^1(S)<\infty.
$$

This is not a statement that $\mathcal H^1(S)=0$, and it is not a bound on a
four-dimensional space-time set. In the same paper, Theorem 2, p. 536, states
that the exceptional set of times has zero $\mathcal H^{1/2}$ measure. Scheffer
derives this from the quantitative interval information in Leray's theorem.

### 3.2 The 1977 theorem is existential

The publisher abstract for [S77] reports: for square-integrable initial data,
there exists a weak solution that is smooth outside a closed space-time set of
Hausdorff dimension at most two. Two cautions are essential:

1. this is an existence statement for a selected weak solution, not a theorem
   about every distributional weak solution; and
2. the full text was inaccessible in this environment, so this report does not
   silently identify Scheffer's precise Hausdorff gauge or metric with the later
   CKN parabolic gauge.

The exact metric-level comparison with CKN is therefore a blocked bibliographic
detail here. The accessible and fully checked [S76] theorem above is enough to
fix the important space-time-versus-slice distinction.

## 4. Epsilon regularity and the CKN theorem

Three scale-invariant quantities are

$$
C(r)=r^{-2}\iint_{Q_r}|u|^3,
\qquad
D(r)=r^{-2}\iint_{Q_r}|p|^{3/2},
\qquad
B(r)=r^{-1}\iint_{Q_r}|\nabla u|^2.
$$

Pressure may be changed by a function of time; a local criterion either fixes a
representative or subtracts a spatial mean.

### 4.1 Cubic velocity-pressure criterion

[L98], Theorem 3.1, pp. 249-252, proves that there are universal
$\varepsilon_0,C_0>0$ such that a suitable pair on $Q_1$ satisfying

$$
\iint_{Q_1}(|u|^3+|p|^{3/2})\leq\varepsilon_0
$$

is Holder regular in an interior cylinder. [ESS03], Lemma 2.2, pp. 215-216,
states a strengthened form: under the same smallness, all spatial derivatives
are Holder continuous and bounded on $Q_{1/2}$. Scaling gives the corresponding
criterion on $Q_r$ with the factor $r^{-2}$.

This is a one-scale epsilon-regularity theorem for the velocity-pressure
quantity. It should not be rewritten as an unsupported one-scale theorem
involving only $\int|\nabla u|^2$.

### 4.2 Scaled-gradient criterion

[L98], Theorem 3.3 and its final paragraph, pp. 253-256, combine decay
estimates with Theorem 3.1 to give regularity when

$$
\limsup_{r\downarrow0}
r^{-1}\iint_{Q_r(z_0)}|\nabla u|^2
\leq\varepsilon_0
$$

for a sufficiently small universal $\varepsilon_0$. Consequently, at every
singular point the corresponding upper scaled enstrophy density exceeds a
fixed positive threshold.

### 4.3 CKN conclusion

For every suitable weak solution, [CKN82]'s main theorem is

$$
\mathcal P^1(\Sigma)=0,
\tag{CKN}
$$

where $\mathcal P^1$ is one-dimensional parabolic Hausdorff measure. The
original Wiley full text was inaccessible here, so its internal theorem page
was not guessed. The statement and proof route were checked in the accessible
self-contained primary proof [L98]: Theorem 3.3, pp. 253-256, followed by the
explicit conclusion on p. 256 that the singular set has zero parabolic
$\mathcal P^1$ measure.

The covering mechanism is the contrapositive of epsilon regularity: every
singular point has positive upper $B(r)$ density, while
$|\nabla u|^2$ is integrable. A Vitali covering/density argument then forces
zero one-dimensional parabolic measure, not merely finite measure.

## 5. Parabolic dimension, projections, and slices

### 5.1 Definition

Use the parabolic metric

$$
d_p((x,t),(y,s))=\max\{|x-y|,|t-s|^{1/2}\}.
$$

Up to harmless constants, its radius-$r$ balls are spatial balls of radius
$r$ times time intervals of length $r^2$. Define

$$
\mathcal P^\alpha(E)=
\lim_{\delta\downarrow0}
\inf\left\{
\sum_i r_i^\alpha:
E\subset\bigcup_i B_p(z_i,r_i),\ r_i<\delta
\right\}.
$$

Space-time has parabolic dimension $3+2=5$. The CKN conclusion gives

$$
\dim_p\Sigma\leq1.
$$

It does not give $\dim_p\Sigma<1$: a set can have Hausdorff dimension one and
still have zero one-dimensional Hausdorff measure.

### 5.2 Proof artifact for PR-10

Let $\Sigma$ have $\mathcal P^1(\Sigma)=0$. Given $\eta,\delta>0$, choose a
parabolic-ball cover with $r_i<\delta$ and $\sum_i r_i<\eta$.

The spatial projection is covered by $B_{r_i}(x_i)$, hence

$$
\mathcal H^1_\delta(\pi_x\Sigma)
\leq C\sum_i r_i<C\eta.
$$

Therefore $\mathcal H^1(\pi_x\Sigma)=0$, and every fixed-time slice
$\Sigma_t\subset\pi_x\Sigma$ satisfies

$$
\mathcal H^1(\Sigma_t)=0.
$$

The time projection is covered by intervals $I_i$ of length at most
$2r_i^2$. Thus

$$
\mathcal H^{1/2}_{2\delta^2}(\pi_t\Sigma)
\leq C\sum_i |I_i|^{1/2}
\leq C\sum_i r_i<C\eta.
$$

Therefore

$$
\mathcal H^{1/2}(\pi_t\Sigma)=0.
$$

In particular, the singular times are Lebesgue-null and
$\Sigma_t=\varnothing$ for almost every $t$. This projection argument is a
deduction from CKN, not the CKN theorem's original formulation.

### 5.3 Falsification attempts and sharp logical limits

The following test sets prevent overclaiming:

- A nonempty singleton has zero $\mathcal P^1$ measure. Thus
  $\mathcal P^1(\Sigma)=0$ cannot imply $\Sigma=\varnothing$.
- More generally, $E=C\times\{t_0\}$ has zero parabolic $\mathcal P^1$ measure
  whenever $\mathcal H^1(C)=0$, but its slice at $t_0$ can be nonempty and
  uncountable.
- Sets of Hausdorff dimension exactly one and zero $\mathcal H^1$ measure
  exist, so "measure zero" cannot be strengthened to "dimension less than
  one."
- A vertical time interval $\{x_0\}\times[a,b]$ is not a counterexample to
  the time-projection proof: it has parabolic dimension two, so it cannot have
  zero $\mathcal P^1$ measure.

These checks prove PR-13 and disconfirm the stronger claims that every slice is
empty or that the singular set has dimension strictly below one.

## 6. Singular times: two routes with different starting points

Leray's Section 33 structure theorem, [L34], pp. 244-245, gives a union of
open regularity intervals whose complement in the positive time axis has
Lebesgue measure zero. Scheffer's [S76], Theorem 2, p. 536, records the sharper
$\mathcal H^{1/2}$-null conclusion for that exceptional-time set.

CKN begins instead with a local space-time singular set of a suitable weak
solution. Section 5.2 above proves that its time projection is also
$\mathcal H^{1/2}$-null. The two statements are compatible, but their objects
should not be conflated without fixing the same solution representative and
the same meaning of regularity:

- Leray decomposes the time axis into global regularity intervals for a
  finite-energy solution.
- CKN classifies individual space-time points for a suitable pair.

At an exceptional time, CKN permits a nonempty spatial singular set, subject
to $\mathcal H^1(\Sigma_t)=0$. Neither route removes all exceptional times.

## 7. Backward uniqueness and the endpoint $L^3$ theorem

### 7.1 Correct meaning of $L_{3,\infty}$

[ESS03] defines $L_{s,l}(Q_T)$ with the first index spatial and the second
temporal; see p. 213. Therefore

$$
L_{3,\infty}(Q_T)=L^\infty(0,T;L^3(\mathbb R^3)).
$$

It is not the Lorentz space weak-$L^3$ on space-time. [ESS03], Theorem 1.3,
p. 214, states that a Leray-Hopf solution in this mixed space belongs to
$L^5(Q_T)$ and is consequently smooth and unique.

The blow-up consequence stated immediately before Theorem 1.3 is

$$
\limsup_{t\uparrow T_*}\int_{\mathbb R^3}|u(x,t)|^3\,dx=+\infty
$$

if a maximal smooth interval has a finite endpoint. The paper states a
`limsup`; replacing it by an asserted full limit is stronger than this theorem.

### 7.2 Exact backward-uniqueness theorem

[ESS03] works on

$$
Q_+=\mathbb R^n_+\times(0,1)
$$

with the backward heat operator $\partial_t+\Delta$. Conditions (5.1)-(5.4),
pp. 233-234, are

$$
|\partial_t w+\Delta w|
\leq c_1(|\nabla w|+|w|),
$$

$$
w(\cdot,0)=0,
\qquad
|w(x,t)|\leq e^{M|x|^2},
$$

and local square integrability of $w$, $\partial_tw$, and $\nabla^2w$.
Theorem 5.1, p. 234, then concludes $w\equiv0$ on $Q_+$. The proof uses the
Carleman inequalities in Section 6.

Thus backward uniqueness is not the hypothesis-free assertion "zero at the
final time implies zero before it." The differential inequality, growth, trace,
domain, and regularity hypotheses are part of the theorem.

### 7.3 How it enters Navier-Stokes regularity

In the proof of [ESS03], Theorem 1.4, a hypothetical singularity is rescaled.
The limiting vorticity $\omega$ is regular and bounded in an exterior region,
satisfies

$$
|\partial_t\omega-\Delta\omega|
\leq M(|\omega|+|\nabla\omega|),
$$

and vanishes at the terminal time there. Theorem 5.1 gives vanishing in the
exterior region; spatial unique continuation, [ESS03], Theorem 4.1, then
propagates this information. The resulting zero limiting profile contradicts
the nontrivial concentration forced by the assumed singularity. See [ESS03],
pp. 226-229.

This is a conditional exclusion mechanism. It proves regularity under the
$L^\infty_tL^3_x$ bound; it does not prove that every Leray-Hopf solution has
that bound.

## 8. Major corrections to the untrusted draft

1. **ESS space corrected.** $L_{3,\infty}$ in [ESS03] is
   $L^\infty_tL^3_x$, not Lorentz weak-$L^3$ and not weak-$L^3$ on
   space-time.
2. **ESS blow-up conclusion corrected.** The checked paper states divergence
   of a `limsup`, not that the $L^3$ norm has a full limit equal to infinity.
3. **Solution classes separated.** Leray-Hopf uses global finite-energy
   admissibility; suitability is local and adds the LEI for the pair $(u,p)$.
4. **Local-energy implication not assumed.** Existence of at least one
   suitable solution does not prove that every abstract Leray-Hopf solution is
   suitable. PR-04 remains `blocked`.
5. **Pressure exponents separated.** $L^{3/2}$ is the local suitable
   hypothesis used by Lin and ESS; $L^{5/3}$ is an available pressure
   improvement in the energy setting, not the source of the LEI.
6. **Scheffer 1976 corrected.** Its checked theorem is a spatial-slice bound
   $\mathcal H^1(S)<\infty$ at a regularity-interval endpoint, plus an
   $\mathcal H^{1/2}$ result for exceptional times. It is not CKN's
   space-time $\mathcal P^1=0$ theorem.
7. **Scheffer 1977 qualified.** The accessible abstract is existential and
   says dimension at most two. Its full metric definition was inaccessible,
   so no unverified parabolic reinterpretation is made.
8. **Epsilon criteria separated.** The one-scale theorem uses
   $r^{-2}\int(|u|^3+|p|^{3/2})$; the gradient-only statement uses a limiting
   scaled quantity and Lin's decay argument.
9. **Dimension language corrected.** $\mathcal P^1(\Sigma)=0$ implies
   $\dim_p\Sigma\leq1$, not necessarily $<1$, and certainly not
   $\Sigma=\varnothing$.
10. **Space-time and slices separated.** Every slice has zero
    $\mathcal H^1$, while only almost every slice is empty. A specified
    exceptional slice may be nonempty.
11. **Singular-time strength corrected.** The time projection is not merely
    Lebesgue-null; the covering argument gives zero $\mathcal H^{1/2}$
    measure.
12. **Backward uniqueness hypotheses restored.** The ESS theorem includes a
    parabolic differential inequality, zero trace, Gaussian growth, local
    $L^2$ derivative control, and a half-space domain.

## 9. Primary-source audit

### [L34] Leray 1934

Jean Leray, "Sur le mouvement d'un liquide visqueux emplissant l'espace,"
*Acta Mathematica* **63** (1934), 193-248.

- DOI: <https://doi.org/10.1007/BF02547354>
- Readable archived article:
  <https://archive.ymsc.tsinghua.edu.cn/pacm_download/117/5537-11511_2006_Article_BF02547354.pdf>
- Checked locations: Section 31 existence theorem, p. 241; Section 33
  structure theorem, pp. 244-245; Section 34 interval estimates, pp. 246-247.
- Access: full text accessible. Project Euclid's copy was blocked by its
  automated-browser interstitial, but the university archive was readable.

### [S76] Scheffer 1976

Vladimir Scheffer, "Partial regularity of solutions to the Navier-Stokes
equations," *Pacific Journal of Mathematics* **66**(2) (1976), 535-552.

- DOI: <https://doi.org/10.2140/pjm.1976.66.535>
- Journal PDF:
  <https://msp.org/pjm/1976/66-2/pjm-v66-n2-p16-s.pdf>
- Checked locations: Leray theorem and Theorem 1, pp. 535-536; Theorem 2,
  p. 536.
- Access: full text accessible.

### [S77] Scheffer 1977

Vladimir Scheffer, "Hausdorff measure and the Navier-Stokes equations,"
*Communications in Mathematical Physics* **55**(2) (1977), 97-112.

- DOI: <https://doi.org/10.1007/BF01626512>
- Archive landing page:
  <https://projecteuclid.org/euclid.cmp/1103900978>
- Checked location: publisher/landing-page abstract and main-result summary,
  article opening p. 97.
- Access: **partial/inaccessible full text**. Springer redirected the PDF to
  authentication; Project Euclid returned an Incapsula anti-bot page; the
  indexed alternate PDF returned HTTP 403. The abstract-level statement is
  reported, but the paper's exact Hausdorff metric was not guessed.

### [CKN82] Caffarelli-Kohn-Nirenberg 1982

Luis Caffarelli, Robert Kohn, and Louis Nirenberg, "Partial regularity of
suitable weak solutions of the Navier-Stokes equations,"
*Communications on Pure and Applied Mathematics* **35**(6) (1982), 771-831.

- DOI: <https://doi.org/10.1002/cpa.3160350604>
- Publisher record:
  <https://onlinelibrary.wiley.com/doi/10.1002/cpa.3160350604>
- Checked result: article-level main theorem, cross-checked in the complete
  primary reproof [L98], Theorem 3.3 and p. 256.
- Access: **partial/inaccessible full text**. Wiley returned HTTP 403 or an
  authentication redirect, and open-access indexes listed no repository full
  text. Consequently, no internal CKN theorem number or exact theorem page is
  invented here.

### [L98] Lin 1998

Fanghua Lin, "A New Proof of the Caffarelli-Kohn-Nirenberg Theorem,"
*Communications on Pure and Applied Mathematics* **51**(3) (1998), 241-257.

- DOI:
  <https://doi.org/10.1002/(SICI)1097-0312(199803)51:3%3C241::AID-CPA2%3E3.0.CO;2-A>
- Readable scan:
  <https://varnothing.net/wp-content/uploads/2021/11/lin1998.pdf>
- Checked locations: LEI and suitable definition, pp. 244-245; Theorem 2.2,
  pp. 245-248; Lemma 2.3, pp. 246-247; Theorem 3.1, pp. 249-252;
  Theorem 3.3 and parabolic-measure conclusion, pp. 253-256.
- Access: full article text accessible; DOI metadata independently checked.

### [ESS03] Escauriaza-Seregin-Sverak 2003

Luis Escauriaza, Gregory Seregin, and Vladimir Sverak,
"$L_{3,\infty}$-solutions of the Navier-Stokes equations and backward
uniqueness," *Russian Mathematical Surveys* **58**(2) (2003), 211-250.

- DOI: <https://doi.org/10.1070/RM2003v058n02ABEH000609>
- Journal record and English PDF: <https://www.mathnet.ru/eng/rm609>
- Checked locations: Leray-Hopf definition and Theorem 1.1, pp. 212-213;
  mixed-norm definition, p. 213; Theorems 1.3-1.4, p. 214;
  Definition 2.1 and Lemma 2.2, pp. 215-216; Navier-Stokes use of backward
  uniqueness, pp. 226-229; conditions (5.1)-(5.4) and Theorem 5.1,
  pp. 233-234.
- Access: full English text accessible.

**Source count:** 6 primary papers. Four were read in full. [S77] and [CKN82]
were inaccessible at full-text level in this environment; every claim depending
on them was either limited to accessible metadata/abstract language or checked
against an accessible primary reproof, and the unresolved metric/page details
were explicitly left blocked.
