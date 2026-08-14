# Hypothetical Blowup and Exclusion Strategies

**Research status:** source-reconciled report, checked 2026-08-13

This report maps what a contradiction proof based on rescaling would still
have to establish. It deliberately records narrower claims than several agent
drafts: exact self-similarity is not all Type I behavior, axisymmetric
Liouville theorems are not full three-dimensional Liouville theorems, and a
critical-element argument is specific to the space in which its profile
decomposition is proved.

## Claim ledger

| ID | Claim | Status | Evidence and boundary |
|---|---|---|---|
| BUP-001 | Nontrivial backward self-similar Leray profiles in $L^3(\mathbb R^3)$ are excluded. | `established` | [NRS96], Theorem 1; theorem body and profile hypotheses inspected. |
| BUP-002 | Tsai extends self-similar exclusions under local-energy plus stated integrability/decay hypotheses. | `blocked` | [T98] identity registry-checked; the theorem body and exact alternatives have not been inspected in this audit. |
| BUP-003 | Every Type I singularity is exactly self-similar. | `blocked` | A Type I rate bound does not imply profile stationarity, but no Navier-Stokes Type I singularity is known from which to build a counterexample. |
| BUP-004 | Every bounded ancient solution in full 3D is zero. | `refuted` | Constant vector fields are immediate counterexamples; [KNSS09] proves special-class results. |
| BUP-005 | A uniform $L^\infty(0,T_*;L^3)$ bound prevents blowup at $T_*$. | `established` | [ESS03], reviewed in `03_partial_regularity.md`. A single bounded time slice is insufficient. |
| BUP-006 | Concentration compactness works in every critical Banach space. | `blocked` | Each space needs its own profile decomposition and perturbation theorem; those inputs are unavailable at several endpoints. |
| BUP-007 | A rigidity theorem excludes every possible critical ancient object. | `blocked` | This is the central missing step. |
| BUP-008 | A mild ancient solution bounded in $L^3$ along times $t_k\downarrow-\infty$ is zero. | `established` | [AB19], Theorem 1.2; primary theorem text inspected. |

## Backward self-similar profiles

A backward self-similar ansatz at time $T$ has the form

$$
u(x,t)=\frac{1}{\sqrt{T-t}}
U\!\left(\frac{x}{\sqrt{T-t}}\right).
$$

Necas, Ruzicka, and Sverak exclude nonzero profiles in the critical class
$U\in L^3(\mathbb R^3)$ for the corresponding stationary Leray system. This
rules out one rigid blowup shape, not every scale-critical concentration.

**Primary source.** [NRS96] J. Necas, M. Ruzicka, and V. Sverak, "On Leray's
self-similar solutions of the Navier-Stokes equations," *Acta Mathematica*
176:2 (1996), 283-294, <https://doi.org/10.1007/BF02551584>. Article identity,
pages, and DOI registry-checked. A competing DOI ending `BF02392690` resolves
to an unrelated harmonic-analysis paper and is rejected. Theorem 1 states that
a weak profile $U\in L^3(\mathbb R^3)$ is identically zero; the theorem body
was inspected after the initial metadata audit.

Tsai studies self-similar solutions satisfying local energy estimates and
extends the nonexistence analysis under specified profile integrability or
decay assumptions. The full theorem body must be consulted before replacing
those words with a universal statement: the paper is not a license to say that
all backward self-similar or discretely self-similar solutions are excluded.

**Primary source.** [T98] T.-P. Tsai, "On Leray's self-similar solutions of the
Navier-Stokes equations satisfying local energy estimates," *Archive for
Rational Mechanics and Analysis* 143:1 (1998), 29-51,
<https://doi.org/10.1007/s002050050099>. Bibliographic identity
registry-checked; exact theorem alternatives are `body-recheck`.

## Type I and Type II

One common velocity formulation is

$$
\text{Type I:}\quad
\sup_{t<T}(T-t)^{1/2}\|u(t)\|_{L^\infty}<\infty,
$$

with Type II denoting failure of that rate bound. Exact backward
self-similarity implies Type I behavior, but the converse does not follow from
the rate bound and is not known. Therefore
the NRS and Tsai theorems cannot be promoted to a theorem excluding every Type
I singularity. Special geometries and additional critical bounds have stronger
results, but general three-dimensional Type I exclusion remains a separate
rigidity problem.

ESS supplies a different exclusion: any putative whole-space blowup must lose
boundedness of the strong $L^3$ norm. It does not classify the rescaled object
that remains after that norm diverges.

## Ancient solutions and Liouville limits

Blowup rescaling often seeks a nontrivial ancient solution on
$\mathbb R^3\times(-\infty,0)$. The desired contradiction has two independent
obligations:

1. compactness strong enough to produce a nontrivial ancient limit with a
   precisely named solution class and normalization;
2. a Liouville theorem covering exactly that class.

Koch, Nadirashvili, Seregin, and Sverak prove Liouville theorems and
applications, notably in axisymmetric settings. They do not prove that every
bounded ancient solution in unrestricted 3D is zero. Even the latter wording
is false without normalization because constant vector fields are bounded
ancient solutions.

**Primary source.** [KNSS09] G. Koch, N. Nadirashvili, G. A. Seregin, and V.
Sverak, "Liouville theorems for the Navier-Stokes equations and applications,"
*Acta Mathematica* 203:1 (2009), 83-105,
<https://doi.org/10.1007/s11511-009-0039-6>. Article identity registry-checked.
Any proposed use must cite the exact theorem and preserve its symmetry,
boundedness, pressure, and normalization hypotheses.

Albritton and Barker prove a directly relevant unrestricted whole-space
Liouville theorem for a different ancient class. Their Theorem 1.2 states that
if $v$ is a mild ancient solution and

$$
\sup_k\|v(\cdot,t_k)\|_{L^3}<\infty
\quad\text{for some }t_k\downarrow-\infty,
$$

then $v\equiv0$. Consequently, an ancient mild solution whose centered
similarity orbit is precompact in $L^3$ is already covered: $L^3$ is invariant
under the similarity rescaling, and precompact sets are bounded. Compact-orbit
rigidity at this endpoint is therefore not a new proof obligation.

**Primary source.** [AB19] D. Albritton and T. Barker, "On local Type I
singularities of the Navier-Stokes equations and Liouville theorems,"
*Journal of Mathematical Fluid Mechanics* 21 (2019), article 43,
<https://doi.org/10.1007/s00021-019-0448-z>,
<https://arxiv.org/abs/1811.00502v2>. Theorem 1.2 and the paper's definition of
mild bounded ancient solutions were inspected directly.

This does not classify every ancient object arising from a hypothetical
singularity. A route that loses bounded strong $L^3$ control lies outside
[AB19], exactly as it lies outside the ESS endpoint criterion.

## Critical elements

Concentration compactness can turn failure of a conditional regularity theorem
into a minimal or compact blowup object in selected critical spaces. It is a
reduction, not a construction of blowup and not a contradiction by itself.

Kenig and Koch apply a critical-element method to mild solutions bounded in
$\dot H^{1/2}(\mathbb R^3)$, proving that finite-time singularity cannot occur
while that critical norm stays bounded. Their abstract explicitly identifies
the concentration-compactness plus rigidity architecture.

**Primary source.** [KK11] C. E. Kenig and G. S. Koch, "An alternative
approach to regularity for the Navier-Stokes equations in critical spaces,"
*Annales de l'Institut Henri Poincare C* 28:2 (2011), 159-187,
<https://doi.org/10.1016/j.anihpc.2010.10.004>. Abstract, article identity, and
pages registry-checked.

Other papers build minimal-data or profile-decomposition results in other
named spaces. Their hypotheses are not interchangeable. In particular, no
argument may replace a proved $L^3$, $\dot H^{1/2}$, or non-endpoint Besov
profile decomposition with the phrase "any critical Banach space."

## Quantitative regularity

Quantitative versions of critical-norm regularity estimate subcritical norms
or a regularity scale in terms of an assumed critical bound. They sharpen the
right-hand implication

$$
\sup_{t<T}\|u(t)\|_{L^3}\leq A
\quad\Longrightarrow\quad
\text{explicit regularity bounds depending on }A,
$$

but they do not bound $A$ for arbitrary data. Two review agents supplied
different, unrelated arXiv identifiers for Tao's paper; both identifiers were
checked and rejected. The quantitative-paper citation therefore remains a
deliberate bibliography TODO rather than a fabricated reference.

## Discrete self-similarity

A discretely self-similar solution repeats only under one scale factor
$\lambda>1$ rather than every scale. Continuous self-similar profile theorems
do not automatically cover this log-periodic setting. Forward self-similar or
forward discretely self-similar existence results also do not establish a
backward blowup solution. Direction in time is part of the theorem.

## Dependency map for a contradiction route

```text
Assume a first singularity at T
  -> choose a critical normalization
  -> prove compactness modulo scaling and translation
  -> retain nontriviality in the limit
  -> identify an ancient solution class exactly
  -> prove a Liouville/rigidity theorem for that exact class
  -> transfer triviality back to contradict the normalization
```

Known results close special branches: mild ancient solutions bounded in $L^3$
along a backward sequence, exact self-similar $L^3$ profiles, and selected
symmetric ancient classes. A general proof is blocked at obtaining a limit in
a controlled critical class and at rigidity beyond those classes. Type II and
critical-norm-divergent concentration remain outside these exclusions.

## Common overclaims rejected

1. Exact self-similar exclusion is not general Type I exclusion.
2. A conditional minimal blowup object is not evidence that blowup exists.
3. An axisymmetric Liouville theorem is not an unrestricted 3D theorem.
4. Constant solutions refute an unnormalized "all bounded ancient solutions
   are zero" statement.
5. Profile decomposition is not portable to an arbitrary critical space by
   analogy.
6. Quantitative bounds conditional on $A$ do not prove an a priori bound on
   $A$.

## Verification debt

- Inspect [T98] in full before pinning its exact profile integrability and
  decay alternatives.
- Inspect the individual theorem in [KNSS09] before using a Liouville result;
  the paper contains several classes, not one universal statement.
- Add minimal-data and $L^3$ profile-decomposition sources only after their
  article identities and exact spaces are independently verified.
- Locate and inspect the correct primary source for Tao's quantitative
  critical-norm bounds.
