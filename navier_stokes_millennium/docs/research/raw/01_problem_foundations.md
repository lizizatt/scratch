# Problem Foundations for the Three-Dimensional Navier-Stokes Millennium Problem

**Research date:** 2026-08-13

**Artifact status:** raw research report; not a proof of the Millennium problem

**Scope:** the official problem, its data and solution classes, weak-solution terminology,
energy, scaling, local theory, and the exact standard for resolution

## 1. Result of this source check

The Clay Mathematics Institute (CMI) still labels the Navier-Stokes problem
**Unsolved** as of the research date [CMI status page]. The governing source is
Charles Fefferman's official description [F], especially equations (1)-(11),
statements (A)-(D), PDF pp. 1-2, and the appended errata on PDF p. 5.

The four alternatives are not four versions of one forced whole-space problem:

1. **(A)** is global existence and smoothness on $\mathbb R^3$, with zero force.
2. **(B)** is global existence and smoothness on $\mathbb R^3/\mathbb Z^3$, with
   zero force.
3. **(C)** is existence of smooth, rapidly decreasing whole-space data and force
   for which no global smooth bounded-energy solution exists.
4. **(D)** is the analogous breakdown assertion for smooth periodic data and a
   smooth periodic force that rapidly decreases in time.

Fefferman asks for a proof of **any one** of (A)-(D) [F, PDF p. 2]. In particular,
(C) and (D) permit nonzero forcing and therefore do not, by themselves, negate
the unforced assertions (A) and (B).

[CMI status page]: https://www.claymath.org/millennium/navier-stokes-equation/
[F]: https://www.claymath.org/wp-content/uploads/2022/06/navierstokes.pdf

## 2. Equations and conventions

Fefferman writes the incompressible equations on $\mathbb R^n$, $n=2$ or $3$,
with $t\geq 0$ as

$$
\partial_t u_i+\sum_{j=1}^n u_j\partial_j u_i
=\nu\Delta u_i-\partial_i p+f_i,
\qquad i=1,\ldots,n,
\tag{NS}
$$

$$
\operatorname{div}u=0,
\qquad u(x,0)=u^\circ(x),
\tag{IC}
$$

where $\nu>0$. The pressure is determined only up to addition of a function of
time. In the periodic alternatives the spatial domain is the unit-period torus

$$
\mathbb T^3:=\mathbb R^3/\mathbb Z^3.
$$

This is not the $2\pi$-period torus used in some PDE papers. See [F, equations
(1)-(3), PDF p. 1].

## 3. Exact data and solution hypotheses

### 3.1 Whole space

For every spatial multi-index $\alpha$ and every nonnegative integer $K$, the
initial velocity must obey

$$
|\partial_x^\alpha u^\circ(x)|
\leq C_{\alpha K}(1+|x|)^{-K}.
\tag{F4}
$$

Thus $u^\circ$ and all of its spatial derivatives are rapidly decreasing; in
modern language $u^\circ$ is a divergence-free Schwartz vector field.

When a force is allowed, every spatial and temporal derivative must obey, for
all $\alpha,m,K$,

$$
|\partial_x^\alpha\partial_t^m f(x,t)|
\leq C_{\alpha mK}(1+|x|+t)^{-K},
\qquad (x,t)\in\mathbb R^3\times[0,\infty).
\tag{F5}
$$

The accepted whole-space solution class is

$$
p,u\in C^\infty(\mathbb R^3\times[0,\infty))
\tag{F6}
$$

and

$$
\int_{\mathbb R^3}|u(x,t)|^2\,dx<C
\quad\text{for every }t\geq0,
\tag{F7}
$$

with one constant $C$ independent of $t$. These are exactly [F, equations
(4)-(7), PDF p. 1]. No condition in (F4) or (F5) is merely an $H^s$ condition.

### 3.2 Periodic domain

The initial velocity and force satisfy unit-periodicity in every coordinate,

$$
u^\circ(x+e_j)=u^\circ(x),
\qquad f(x+e_j,t)=f(x,t),
\qquad j=1,2,3.
\tag{F8}
$$

In place of spatial decay, $u^\circ$ is smooth and every derivative of the force
decreases rapidly in time:

$$
|\partial_x^\alpha\partial_t^m f(x,t)|
\leq C_{\alpha mK}(1+t)^{-K}
\quad\text{for all }\alpha,m,K.
\tag{F9}
$$

The solution $u$ is unit-periodic and $p,u$ are smooth on
$\mathbb R^3\times[0,\infty)$. The erratum appended to [F, PDF p. 5] says that
periodicity of $p$ must also be required. There is **no analogue of (F7)** in the
stated periodic solution class [F, equations (8)-(11), PDF pp. 1-2].

## 4. Fefferman's four alternatives, literally

| Alternative | Quantifier and domain | Force | Required conclusion |
|---|---|---|---|
| **(A)** | For every smooth divergence-free $u^\circ$ satisfying (F4), on $\mathbb R^3$ | $f\equiv0$ | There exist $p,u$ satisfying (NS), (IC), (F6), and (F7) for all $t\geq0$. |
| **(B)** | For every smooth divergence-free $u^\circ$ satisfying (F8), on $\mathbb T^3$ | $f\equiv0$ | There exist periodic smooth $p,u$ satisfying (NS) and (IC) for all $t\geq0$. |
| **(C)** | There exist smooth divergence-free $u^\circ$ and smooth $f$ satisfying (F4)-(F5), on $\mathbb R^3$ | May be nonzero | No pair $(p,u)$ satisfies (NS), (IC), (F6), and (F7) for all $t\geq0$. |
| **(D)** | There exist smooth divergence-free $u^\circ$ and smooth $f$ satisfying (F8)-(F9), on $\mathbb T^3$ | May be nonzero | No periodic smooth pair $(p,u)$ satisfies (NS) and (IC) for all $t\geq0$. |

These are [F, statements (A)-(D), PDF p. 2]. Consequences that are easy to miss:

- (A) and (B) are both **unforced**.
- (B) is periodic, not a forced version of (A).
- (C) and (D) are existential and allow $f=0$, but do not require it.
- Fefferman does not require a closed-form or numerically explicit counterexample.
- The periodic alternatives do not state a uniform energy condition.
- A forced counterexample under (C) says nothing logically decisive about (A),
  and a forced counterexample under (D) says nothing logically decisive about
  (B).

## 5. Energy: identity for smooth solutions, inequality for weak solutions

### 5.1 Smooth energy identity

**Claim FND-003 (`proved`).** Assume enough decay on $\mathbb R^3$ to
justify integration by parts, or use periodic boundary conditions on $\mathbb
T^3$. A smooth solution satisfies, for $0\leq s\leq t$,

$$
\frac12\|u(t)\|_2^2
+\nu\int_s^t\|\nabla u(r)\|_2^2\,dr
=\frac12\|u(s)\|_2^2
+\int_s^t\!\int f(x,r)\cdot u(x,r)\,dx\,dr.
\tag{E}
$$

**Proof artifact.** Take the $L^2$ inner product of (NS) with $u$. The pressure
term vanishes because $\operatorname{div}u=0$. The nonlinear term vanishes since

$$
\int u\cdot(u\cdot\nabla)u
=\frac12\int u\cdot\nabla|u|^2=0.
$$

The viscous term is $-\nu\|\nabla u\|_2^2$; integration in time gives (E).

**Falsification check.** If either $\operatorname{div}u=0$ or the boundary/decay
hypothesis is removed, the two discarded integrals need not vanish. If the force
were left unscaled in the scaling calculation below, (E) would also cease to be
dimensionally consistent.

For $f=0$, (E) makes kinetic energy nonincreasing. Thus any unforced classical
solution for which the calculation is justified has the uniform bound required
by (F7). This does not make global weak existence a solution of (A): (A) also
requires $C^\infty$ regularity everywhere for all time.

Energy equality is not a characterization of strong solutions. Some nonsmooth
weak solutions satisfy equality under additional integrability assumptions.
Accordingly, replacing "$\leq$" by "$=$" in a weak definition is not equivalent
to proving smoothness.

### 5.2 A modern Leray-Hopf energy inequality

A current, precise convention is [Albritton-Brue-Colombo, Definition 1.1,
preprint pp. 1-2; ABC]. On $\mathbb R^3\times(0,T)$, with divergence-free
$u_0\in L^2$ and $f\in L^1(0,T;L^2)$, a Leray-Hopf solution has

$$
u\in L^\infty(0,T;L^2)
\cap L^2(0,T;\dot H^1),
$$

is weakly continuous into $L^2$, attains $u_0$, solves (NS) distributionally,
and obeys

$$
\frac12\|u(t)\|_2^2
+\nu\int_0^t\|\nabla u(s)\|_2^2\,ds
\leq\frac12\|u_0\|_2^2
+\int_0^t\!\int f\cdot u\,dx\,ds.
\tag{LH}
$$

[ABC] normalizes $\nu=1$; (LH) restores $\nu$. Some definitions additionally
require the corresponding inequality from almost every starting time $s$.
That stronger representative-level convention is stated in the secondary
review [OP, Definition 4.5, preprint p. 44]. Arguments must say which convention
they use.

[ABC]: https://doi.org/10.4007/annals.2022.196.1.3
[OP]: https://doi.org/10.1017/9781108610575.007

## 6. Leray, Hopf, and the modern terminology

### 6.1 What Leray actually proved and called it

Leray's 1934 paper concerns the whole space $\mathbb R^3$. He called his global
objects **solutions turbulentes**, not "Leray-Hopf solutions." In Section 31,
pp. 240-241, he defines that class using square-integrability, weak
("quasi-") divergence and derivatives, an integral form of the equations, weak
time continuity, and a nonincreasing quantity encoding energy dissipation.
His existence theorem on p. 241 says that every square-integrable initial vector
field with quasi-divergence zero has at least one turbulent solution for all
later times [L, Section 31, p. 241]. The theorem there is unforced.

This supports the modern unforced statement

$$
u\in L^\infty_{\mathrm{loc}}([0,\infty);L^2)
\cap L^2_{\mathrm{loc}}([0,\infty);\dot H^1)
$$

with an energy inequality, but that displayed Bochner-space formulation is a
modern recasting, not a verbatim 1934 definition. The unofficial English
translation [LT] preserves Leray's original page numbers and was used only to
cross-check the French scan.

[L]: https://doi.org/10.1007/BF02547354
[LT]: https://arxiv.org/abs/1604.02484

### 6.2 What "Leray-Hopf" means

"Leray-Hopf weak solution" is retrospective terminology for an energy-class
distributional solution such as the one in Section 5.2. The compound name also
recognizes Hopf's treatment of bounded domains. The historical statement that
Hopf obtained the analogous result on a smooth bounded domain with Dirichlet
boundary conditions was checked in later literature [BV, p. 102] and [OP,
Definition 4.5 note, p. 44], not in Hopf's original text.

Hopf's original article was unavailable in full text during this research run;
only the publisher/DOI metadata was directly checked. It is therefore marked
**only secondarily checked** for theorem content:

E. Hopf, *Uber die Anfangswertaufgabe fur die hydrodynamischen
Grundgleichungen*, Math. Nachr. 4 (1950/51), 213-231,
<https://doi.org/10.1002/mana.3210040121>.

It is unsafe to say merely "weak solution" when energy matters. Buckmaster and
Vicol define a broader finite-energy distributional class on $\mathbb T^3$ [BV,
Definition 1.1, pp. 101-102] and prove nonuniqueness in that class [BV, Theorem
1.2, p. 103]. They explicitly state on p. 103 that their constructed solutions
are not proved to be Leray-Hopf: they need not satisfy (LH) or belong to
$L^2_t\dot H^1_x$.

[BV]: https://doi.org/10.4007/annals.2019.189.1.3

### 6.3 Forced Leray-Hopf nonuniqueness is not Clay breakdown

[ABC, Definition 1.1 and Theorem 1.2, preprint pp. 1-2] proves that two distinct
suitable Leray-Hopf solutions can have the same zero initial velocity and the
same force $f\in L^1_tL^2_x$ on $\mathbb R^3\times(0,T)$. This corrects the
outdated blanket statement that uniqueness of all forced Leray-Hopf solutions
is open.

It does **not** prove (C): the self-similar force has singular initial-time
scaling, and the theorem does not give a force satisfying Fefferman's
$C^\infty$-up-to-$t=0$ rapid-decay condition (F5). More fundamentally,
nonuniqueness supplies multiple weak solutions; (C) requires proof that no
global smooth bounded-energy solution exists for the selected smooth data and
force.

## 7. Scaling and criticality

### 7.1 Exact whole-space scaling

**Claim FND-006 (`proved`).** If $(u,p,f)$ solves (NS) on $\mathbb R^3$, then
for every $\lambda>0$,

$$
u_\lambda(x,t)=\lambda u(\lambda x,\lambda^2t),
\qquad
p_\lambda(x,t)=\lambda^2p(\lambda x,\lambda^2t),
$$

$$
f_\lambda(x,t)=\lambda^3f(\lambda x,\lambda^2t),
\qquad
u^\circ_\lambda(x)=\lambda u^\circ(\lambda x),
\tag{S}
$$

solves the same equation with the same viscosity $\nu$. This is also recorded in
[ABC, equation (1.5), preprint p. 3].

**Proof artifact.** Each of $\partial_tu_\lambda$,
$(u_\lambda\cdot\nabla)u_\lambda$, $\nu\Delta u_\lambda$,
$\nabla p_\lambda$, and $f_\lambda$ equals $\lambda^3$ times its unscaled
counterpart evaluated at $(\lambda x,\lambda^2t)$. Also
$\operatorname{div}u_\lambda=\lambda^2(\operatorname{div}u)(\lambda x,
\lambda^2t)$.

**Falsification check.** Omitting the factor $\lambda^3$ from $f_\lambda$ or the
factor $\lambda^2$ from $p_\lambda$ makes the transformed terms have different
powers of $\lambda$.

On a fixed unit torus, (S) is not a continuous scaling symmetry: it changes the
period unless $\lambda$ is compatible with the lattice (for example, a positive
integer in the forward direction). The unrestricted symmetry is a whole-space
statement and a local guide to periodic concentration.

### 7.2 Norm scaling

For $1\leq p\leq\infty$ and homogeneous Sobolev index $s$,

$$
\|u^\circ_\lambda\|_{L^p(\mathbb R^3)}
=\lambda^{1-3/p}\|u^\circ\|_{L^p(\mathbb R^3)},
$$

$$
\|u^\circ_\lambda\|_{\dot H^s(\mathbb R^3)}
=\lambda^{s-1/2}\|u^\circ\|_{\dot H^s(\mathbb R^3)}.
\tag{SN}
$$

Thus $L^3$ and $\dot H^{1/2}$ are scale invariant. By contrast,

$$
\|u^\circ_\lambda\|_2=\lambda^{-1/2}\|u^\circ\|_2.
$$

The concentrating limit is $\lambda\to\infty$, corresponding to spatial scale
$1/\lambda$; in that limit the $L^2$ norm becomes **smaller**, not larger. This
is why the energy norm is supercritical: a uniform energy bound does not exclude
concentration at progressively smaller scales.

The inhomogeneous and homogeneous endpoint spaces are not equivalent:

$$
H^{1/2}(\mathbb R^3)=L^2(\mathbb R^3)\cap\dot H^{1/2}(\mathbb R^3)
$$

under the usual Fourier definitions, while $\dot H^{1/2}$ alone does not control
the low-frequency $L^2$ norm. Consequently $H^{1/2}$ is not exactly
scale-invariant and must not be called "equivalent" to $\dot H^{1/2}$.

## 8. What local theory establishes

### 8.1 Directly checked whole-space theorem

Leray proves the following for the unforced whole-space equation:

- regular solutions with the same initial state are unique [L, Section 18,
  p. 222];
- every "regular initial state" has a regular solution for a nonzero time
  interval [L, Section 19, pp. 222-224]; and
- such a regular solution has derivatives of all orders at positive times [L,
  Section 15, pp. 219-220].

Leray's regular initial state is divergence-free, has continuous velocity and
first derivatives, and has finite kinetic energy, supremum velocity, and
$L^2$ gradient quantities. Fefferman's Schwartz initial data in (A) satisfy
these hypotheses. Therefore (A) has a unique smooth solution locally in time.
The unresolved step is continuation for every $t\geq0$, uniformly over arbitrary
large data.

Fefferman reports the corresponding local result for both (A) and (B), and says
that if the maximal time is finite then the velocity becomes unbounded near that
time [F, PDF pp. 2-3]. In this report the periodic local theorem is **only
secondarily checked through Fefferman's overview**; an original periodic local
existence paper was not inspected.

### 8.2 A directly checked critical-space result

Koch's author handout, based on joint work with Tataru, treats $\mathbb R^n$ with
$\nu=1$. Its Theorem 1, handout p. 1, states that if the divergence-free initial
datum has sufficiently small $BMO^{-1}_T$ norm, then there is a unique smooth
solution up to time $T$; taking $T=\infty$ gives a global small-data statement
[KT-handout]. The published joint article is Koch-Tataru, *Advances in
Mathematics* 157 (2001), 22-35,
<https://doi.org/10.1006/aima.2000.1937>.

[KT-handout]: https://math.virginia.edu/seminars/mathphys/1999-03/Mar23.pdf

This result illustrates the local/small-data side of the scaling threshold. It
does not control arbitrary large smooth data globally.

### 8.3 Fujita-Kato and Kato access caveat

The untrusted draft attributed a precise modern
$C_t\dot H^{1/2}\cap L^2_t\dot H^{3/2}$ theorem and two allegedly equivalent
initial spaces to "Fujita-Kato, Theorem 1." That exact attribution was not
retained:

- the original Fujita-Kato article was paywalled and its theorem text was
  **unavailable** in this run; only publisher metadata was checked:
  <https://doi.org/10.1007/BF00276188>;
- Kato's 1984 article was likewise **unavailable** beyond publisher metadata:
  <https://doi.org/10.1007/BF01174182>; and
- independently of attribution, $H^{1/2}\neq\dot H^{1/2}$, as Section 7.2
  shows.

The exact original theorem numbering, endpoint solution class, and proposed
equivalence are therefore not asserted here. This is recorded as `blocked` in
the claim ledger rather than filled from memory or a secondary citation.

## 9. What would resolve the problem

### 9.1 Mathematical resolution

A complete proof of any one of Fefferman's statements (A), (B), (C), or (D)
answers the official mathematical problem [F, PDF p. 2]. More concretely:

- To prove (A) or (B), one must handle **every** initial velocity in the stated
  class on the stated domain and produce the stated global smooth solution.
- To prove (C) or (D), one must prove existence of data and force in the exact
  stated class for which **no** global solution in Fefferman's accepted class
  exists.
- A finite maximal smooth solution with a rigorously proved nonextendible
  singularity would be a natural route to (C) or (D), once all data, force,
  domain, uniqueness, and solution-class hypotheses are matched. The literal
  conclusion, however, is "no global accepted solution," not merely "one chosen
  construction blows up."
- A singular or nonunique weak solution does not suffice. A bad weak solution
  may coexist with a global smooth solution.
- A result for rough initial data alone does not suffice without an argument
  producing data satisfying (F4) or (F8).
- A forced result must satisfy all of (F5) or (F9), including smoothness at
  $t=0$.

### 9.2 Qualification for the prize

Solving the mathematical statement is necessary but is not by itself an
immediate prize award. Under the official 2018 CMI rules [Rules]:

- only a complete solution to the official description is eligible (Section 5);
- it must be published in a qualifying outlet (Sections 4 and 6);
- at least two years must pass after publication (Sections 4 and 7);
- it must achieve general acceptance in the global mathematics community
  (Sections 4 and 7); and
- CMI then conducts its own evaluation and retains final discretion
  (Sections 3, 7, and 8).

CMI does not accept direct submissions [Rules, Sections 5(e) and 6].

[Rules]: https://www.claymath.org/wp-content/uploads/2022/03/millennium_prize_rules_0.pdf

## 10. Claim ledger

The statuses below use the repository's required vocabulary.

| ID | Claim | Status | Dependencies and check |
|---|---|---|---|
| FND-001 | Equations, decay, periodicity, smoothness, and energy requirements are as stated in Sections 2-3. | `established` | [F], equations (1)-(11), PDF pp. 1-2; pressure erratum p. 5. |
| FND-002 | Fefferman's alternatives are exactly the table in Section 4. | `established` | [F], statements (A)-(D), PDF p. 2. |
| FND-003 | Smooth solutions obey (E) under the stated integration hypotheses. | `proved` | Dot-product derivation and boundary-term falsification check in Section 5.1. |
| FND-004 | The modern Leray-Hopf convention includes the energy class, distributional equation, initial trace, and (LH). | `established` | [ABC], Definition 1.1, preprint pp. 1-2. Convention variation checked secondarily in [OP], Definition 4.5, p. 44. |
| FND-005 | Leray constructed an unforced global turbulent solution for every square-integrable, quasi-divergence-free whole-space initial state. | `established` | [L], Section 31, pp. 240-241, existence theorem p. 241. |
| FND-006 | The transformations (S) and norm laws (SN) are the whole-space scaling laws. | `proved` | Term-by-term substitution and failed-factor check in Section 7; independently recorded in [ABC], equation (1.5), p. 3. |
| FND-007 | Smooth rapidly decreasing whole-space data have a unique local regular solution. | `established` | [L], Sections 15 and 18-19, pp. 219-224. |
| FND-008 | The exact periodic local theorem and the draft's exact Fujita-Kato endpoint attribution have been primary-source verified. | `blocked` | Periodic theorem only summarized in [F]; Fujita-Kato and Kato full texts unavailable. |
| FND-009 | Forced suitable Leray-Hopf solutions can be nonunique under an $L^1_tL^2_x$ force. | `established` | [ABC], Definition 1.1 and Theorem 1.2, preprint pp. 1-2. |
| FND-010 | That forced nonuniqueness theorem proves Fefferman's (C). | `refuted` | Its force does not meet (F5), and nonuniqueness is not nonexistence of a smooth accepted solution. |
| FND-011 | A proof of any one of (A)-(D) resolves the official mathematical question. | `established` | [F], PDF p. 2. Prize procedure is separately governed by [Rules], Sections 3-8. |
| FND-012 | CMI currently lists the problem as unsolved. | `established` | [CMI status page], checked 2026-08-13. |

## 11. Corrections to the untrusted draft

1. Replaced the draft's forced whole-space (B) with Fefferman's unforced periodic
   (B).
2. Restored the exact domain pairing: (A)/(C) are on $\mathbb R^3$ and (B)/(D)
   are on $\mathbb R^3/\mathbb Z^3$.
3. Restored zero force in both existence alternatives and allowed force only in
   the breakdown alternatives.
4. Restored rapid decay of **every** space derivative of $u^\circ$ and every
   space-time derivative of the whole-space force.
5. Restored periodic force hypotheses: periodic in space and rapidly decreasing
   in time, not in space.
6. Restored pressure periodicity from Fefferman's appended erratum.
7. Removed the nonexistent uniform-energy requirement from the periodic
   alternatives.
8. Replaced a modern Bochner-space definition falsely presented as Leray's
   literal 1934 definition with Leray's actual term, section, and hypotheses.
9. Removed the unsupported attribution to Leray of the modern forced hypothesis
   $f\in L^2_tH^{-1}_x$.
10. Marked Hopf's original theorem content as only secondarily checked because
    the original full text was unavailable.
11. Distinguished broad finite-energy weak solutions from Leray-Hopf solutions;
    the former are known to be nonunique, and forced examples of the latter are
    also known.
12. Corrected the energy statement: equality follows for sufficiently regular
    solutions, inequality belongs to the weak class, and equality alone does not
    imply smoothness.
13. Added the force scaling $f_\lambda=\lambda^3f(\lambda x,\lambda^2t)$ and the
    fixed-torus caveat.
14. Corrected the small-scale direction: concentration is $\lambda\to\infty$,
    where the $L^2$ norm shrinks.
15. Removed the false equivalence $H^{1/2}=\dot H^{1/2}$.
16. Replaced the unverified exact Fujita-Kato theorem/blow-up attribution with a
    directly checked smooth local theorem and a separately checked critical-space
    theorem.
17. Removed "largest known critical space" and "largest Serrin-class result"
    claims, which were unnecessary and context-dependent.
18. Corrected the resolution standard: (C)/(D) require nonexistence of any global
    accepted solution, not merely one weak singular solution or one failed
    construction.
19. Removed the requirement that breakdown data be given by a closed-form
    "explicit" formula; Fefferman's statements are existential.
20. Separated mathematical resolution from CMI's publication, waiting-period,
    acceptance, and evaluation rules.

## 12. Source and access audit

### 12.1 Directly checked source-owning or primary documents (7)

1. **Charles L. Fefferman**, *Existence and Smoothness of the Navier-Stokes
   Equation*, official CMI description, equations (1)-(11), statements (A)-(D),
   PDF pp. 1-5: [official PDF][F].
2. **Clay Mathematics Institute**, current Navier-Stokes status page, marked
   "Unsolved": [CMI status page].
3. **Clay Mathematics Institute**, *Millennium Prize Description and Rules*,
   Sections 3-8, PDF pp. 1-4: [Rules].
4. **Jean Leray** (1934), *Sur le mouvement d'un liquide visqueux emplissant
   l'espace*, Acta Math. 63, 193-248, Sections 15, 18-19, 31; DOI:
   <https://doi.org/10.1007/BF02547354>. The French scan was directly inspected
   via [open archival scan].
5. **Tristan Buckmaster and Vlad Vicol** (2019), *Nonuniqueness of weak solutions
   to the Navier-Stokes equation*, Ann. of Math. 189, 101-144, Definition 1.1,
   Theorem 1.2, pp. 101-103; DOI:
   <https://doi.org/10.4007/annals.2019.189.1.3>.
6. **Dallas Albritton, Elia Brue, and Maria Colombo** (2022), *Non-uniqueness of
   Leray solutions of the forced Navier-Stokes equations*, Ann. of Math. 196,
   415-455, Definition 1.1 and Theorem 1.2; DOI:
   <https://doi.org/10.4007/annals.2022.196.1.3>; [author preprint].
7. **Herbert Koch**, *Well-posedness for the Navier-Stokes equations*, author
   handout, Theorem 1, p. 1: [KT-handout]. It states that the talk is based on
   joint work with Daniel Tataru. Published joint record:
   <https://doi.org/10.1006/aima.2000.1937>.

[open archival scan]: https://archive.ymsc.tsinghua.edu.cn/pacm_download/117/5537-11511_2006_Article_BF02547354.pdf
[author preprint]: https://arxiv.org/abs/2112.03116

### 12.2 Directly checked secondary verification aids (2)

8. **Jean Leray, translated by Robert Terrell** (2016), *On the motion of a
   viscous liquid filling space*, unofficial English translation,
   <https://arxiv.org/abs/1604.02484>. Used only to cross-check translation;
   original page numbering is retained.
9. **Wojciech S. Ozanski and Benjamin C. Pooley** (2018), *Leray's fundamental
   work on the Navier-Stokes equations: a modern review*, Definition 4.5,
   Corollary 4.6, Theorem 4.7, preprint pp. 44-45; DOI:
   <https://doi.org/10.1017/9781108610575.007>; [preprint]. Used only where this
   report explicitly says "secondarily checked."

[preprint]: https://arxiv.org/abs/1708.09787

### 12.3 Primary citations checked only at metadata level (3)

These full texts were unavailable through the lawful publisher/repository routes
checked in this run. They are not used here to support exact theorem statements.

10. **E. Hopf** (1950/51), *Uber die Anfangswertaufgabe fur die
    hydrodynamischen Grundgleichungen*, Math. Nachr. 4, 213-231,
    <https://doi.org/10.1002/mana.3210040121>. **Theorem content only
    secondarily checked.**
11. **H. Fujita and T. Kato** (1964), *On the Navier-Stokes initial value
    problem. I*, Arch. Ration. Mech. Anal. 16, 269-315,
    <https://doi.org/10.1007/BF00276188>. **Full theorem text unavailable.**
12. **T. Kato** (1984), *Strong $L^p$-solutions of the Navier-Stokes equation in
    $\mathbb R^m$, with applications to weak solutions*, Math. Z. 187, 471-480,
    <https://doi.org/10.1007/BF01174182>. **Full theorem text unavailable.**

**Substantive source count:** 9 directly read documents: 7 source-owning/primary
documents and 2 explicitly labeled secondary aids.

**Metadata-only citations:** 3 additional primary records, all marked unavailable
or only secondarily checked above.
