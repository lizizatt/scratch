# Conditional Regularity and Critical Well-Posedness

**Research status:** source-reconciled report, checked 2026-08-13

This report records what the main critical regularity theorems actually reduce
the Millennium problem to. It is not a proof. Bibliographic identities marked
`registry-checked` were checked against Crossref or the publisher record.
Theorem formulations marked `body-recheck` are conservative summaries whose
exact numbering and full hypothesis list still require line-by-line inspection
of the paper.

Throughout, $s$ is the time exponent and $r$ is the space exponent:

$$u \in L^s(0,T;L^r(\Omega)).$$

This convention matters because several sources reverse the letters or the
order of the mixed norm.

## Claim ledger

| ID | Claim | Status | Evidence and boundary |
|---|---|---|---|
| REG-001 | Serrin's critical line uses $2/s+3/r=1$ with $r>3$. | `blocked` | [S62] identity and source cross-citations checked; the original theorem body has not been inspected in this audit. |
| REG-002 | The endpoint $L^\infty_tL^3_x$ on $\mathbb R^3$ is regular. | `established` | [ESS03], DOI and article identity registry-checked; theorem scope cross-checked against the partial-regularity report. |
| REG-003 | Arbitrary divergence-free $L^3$ data have a local mild solution; sufficiently small $L^3$ data are global. | `blocked` | [K84] identity registry-checked; the theorem body and exact solution space have not been inspected in this audit. |
| REG-004 | Small $BMO^{-1}$ data have a global Koch-Tataru solution; local large-data theory is stated in the smaller $VMO^{-1}$ setting. | `blocked` | [KT01] identity registry-checked; the theorem body and exact norm hypotheses have not been inspected in this audit. |
| REG-005 | The energy-space norms alone provide a scale-independent uniform bound in some Serrin regularity norm. | `refuted` | The concentrating family in `docs/proofs/COUNTEREXAMPLES.md` has bounded energy norms while every Serrin mixed norm grows at least like $\lambda^{1/2}$. |
| REG-006 | Every smooth-data solution obeys a uniform critical norm bound. | `blocked` | This is the missing a priori estimate, not a consequence of the cited theorems. |

## Ladyzhenskaya-Prodi-Serrin criteria

For a three-dimensional weak solution, the standard conditional regularity
region is

$$
u\in L^s_tL^r_x,\qquad \frac{2}{s}+\frac{3}{r}\leq 1,
\qquad 3<r\leq\infty.
$$

The safest attribution to Serrin's 1962 interior theorem is the critical line
$2/s+3/r=1$ with $r>3$, including $(s,r)=(2,\infty)$ but not
$(s,r)=(\infty,3)$. The broader inequality and global weak-solution variants
are a family of later Ladyzhenskaya-Prodi-Serrin formulations; a final
bibliography must cite the exact formulation used rather than attribute all of
them to one paper.

What this gives is conditional smoothness (and the associated weak-strong
uniqueness in an appropriate setting), not a derivation of the mixed-norm
bound from finite energy.

**Primary identity.** [S62] J. Serrin, "On the interior regularity of weak
solutions of the Navier-Stokes equations," *Archive for Rational Mechanics and
Analysis* 9 (1962), 187-195,
<https://doi.org/10.1007/BF00253344>. Bibliographic identity registry-checked;
exact theorem numbering is `body-recheck`.

## The missing endpoint: bounded $L^3$

Escauriaza, Seregin, and Sverak prove the whole-space endpoint omitted above:
for the relevant Leray-Hopf/suitable weak Cauchy solution on
$\mathbb R^3\times(0,T)$,

$$
\sup_{0<t<T}\|u(t)\|_{L^3(\mathbb R^3)}<\infty
$$

rules out a singularity at $T$. The title's notation $L_{3,\infty}$ means
$L^\infty_tL^3_x$ in this context. It is not the spatial Lorentz space
$L^{3,\infty}$.

This result does not provide the displayed bound for arbitrary smooth data and
does not by itself establish the corresponding theorem on bounded domains.

**Primary source.** [ESS03] L. Escauriaza, G. A. Seregin, and V. Sverak,
"$L_{3,\infty}$-solutions of the Navier-Stokes equations and backward
uniqueness," *Russian Mathematical Surveys* 58:2 (2003), 211-250,
<https://doi.org/10.1070/RM2003v058n02ABEH000609>. Article identity, pages,
and DOI registry-checked. The competing suffix `000611` returned by one review
agent did not resolve and is rejected.

## Kato's critical $L^3$ theory

For divergence-free initial data $u_0\in L^3(\mathbb R^3)$, Kato develops a
local strong/mild solution theory. Sufficiently small $L^3$ data produce a
global solution. For large data the result is local; it does not assert global
regularity and it is not an unconditional uniqueness theorem for all weak
solutions.

The criticality is exact:

$$
\|\lambda u_0(\lambda\,\cdot)\|_{L^3}=\|u_0\|_{L^3}.
$$

**Primary source.** [K84] T. Kato, "Strong $L^p$-solutions of the
Navier-Stokes equation in $\mathbb R^m$, with applications to weak solutions,"
*Mathematische Zeitschrift* 187:4 (1984), 471-480,
<https://doi.org/10.1007/BF01174182>. The registry confirms this identity. A
review-agent alternative placing this title in *Archive for Rational Mechanics
and Analysis* 84 was false and is rejected.

## Koch-Tataru at $BMO^{-1}$

Koch and Tataru construct a critical mild-solution space using the heat
extension and a parabolic Carleson-measure norm. The robust scope is:

- sufficiently small divergence-free data in $BMO^{-1}(\mathbb R^n)$ give a
  unique global solution in their solution class;
- local arbitrary-data well-posedness is stated for $VMO^{-1}$ (or the
  corresponding vanishing small-scale closure), not for every element of
  $BMO^{-1}$;
- uniqueness is relative to the Koch-Tataru solution class, not every
  distributional or Leray-Hopf solution.

No cited result says that $BMO^{-1}$ is the largest possible critical space or
that large $BMO^{-1}$ data are globally regular.

**Primary source.** [KT01] H. Koch and D. Tataru, "Well-posedness for the
Navier-Stokes equations," *Advances in Mathematics* 157:1 (2001), 22-35,
<https://doi.org/10.1006/aima.2000.1937>. Bibliographic identity
registry-checked; theorem numbers and exact norm normalization are
`body-recheck`.

## Comparison

| Route | Hypothesis | Conclusion | What remains open |
|---|---|---|---|
| Serrin line | $u\in L^s_tL^r_x$, $2/s+3/r=1$, $r>3$ | Conditional regularity | Derive the bound from smooth finite-energy data. |
| ESS endpoint | $u\in L^\infty_tL^3_x$ on $\mathbb R^3$ | No singularity at $T$ | Bound the $L^3$ norm a priori. |
| Kato | $u_0\in L^3$ | Local for arbitrary data; global when small | Continue arbitrary large data globally. |
| Koch-Tataru | Small $u_0\in BMO^{-1}$ | Global in the Koch-Tataru class | Remove smallness or control the evolving critical norm. |

## Common overclaims rejected

1. ESS does not prove regularity under a spatial weak-$L^3$ Lorentz bound.
2. Kato does not prove global regularity for arbitrary $L^3$ data.
3. Koch-Tataru does not give arbitrary-data local theory in all of
   $BMO^{-1}$ or unconditional weak-solution uniqueness.
4. The energy estimate cannot be interpolated into a Serrin criterion without
   new information: its natural mixed norms remain supercritical.
5. Conditional criteria do not become unconditional when several of them are
   listed together. Every route still owes a critical a priori estimate.

## Missing estimate

The shortest endpoint route has one open arrow:

$$
L^\infty_tL^2_x\cap L^2_t\dot H^1_x
\quad\not\Longrightarrow\quad
L^\infty_tL^3_x
\quad\Longrightarrow_{\mathrm{ESS}}\quad
\text{regularity}.
$$

Thus a candidate proof must add a coercive quantity, cancellation, geometric
constraint, compactness-rigidity theorem, or monotonicity mechanism strong
enough to cross from the supercritical energy class to a critical regularity
class. Naming the endpoint theorem does not supply that mechanism.

## Verification debt

- Inspect the full texts of [S62], [K84], and [KT01] before pinning theorem
  numbers, boundary variants, or exact solution-space continuity statements.
- Keep the whole-space scope of [ESS03] explicit.
- Audit any later Lorentz, Besov, vorticity-direction, or bounded-domain
  extension as a separate theorem rather than silently folding it into these
  four sources.
