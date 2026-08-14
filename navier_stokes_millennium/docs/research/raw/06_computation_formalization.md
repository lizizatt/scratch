# Computation and Formalization for 3D Navier-Stokes Regularity

Research date: 2026-08-13

Source count: **11** primary or first-party sources: **10 inspected**, **1
uninspected and not used to establish a claim**.

## Verdict

The strongest presently defensible role for code is to **generate and check an
auditable certificate for specified data on a specified finite time interval**.
Such a certificate can prove existence of a nearby exact strong solution, not
merely regularity of a discretization. For one datum it can become a global
certificate only when a separate, established continuation argument is also
closed, for example by reaching a rigorously verified small-data regime or by
solving a global scalar control inequality.

For the Millennium problem, code can check finite inequalities inside an
analytic proof. It cannot supply the missing quantifiers by simulation: the
periodic positive statement asks for every smooth divergence-free datum and all
time [S1, Statement B, p. 2]. No inspected source reduces that universal claim
to a completed finite computation.

The prior draft was treated as untrusted. In particular, its cited paper
"Computable regularity of solutions to the three-dimensional Navier-Stokes
equations" was not found. The relevant inspected paper is Robinson and
Sadowski, *Numerical verification of regularity ... for bounded sets of initial
data* [S4].

## Epistemic statuses

This report uses the repository statuses exactly:

- `established`: imported from an inspected primary source with matching
  hypotheses;
- `proved`: derived in this project with a complete proof artifact;
- `conjectured`: plausible but not proved;
- `blocked`: missing a named lemma, estimate, or construction;
- `refuted`: contradicted by a checked argument or counterexample.

No claim in this report is marked `proved`.

## Claim ledger

| ID | Status | Claim | Dependencies and exact locator | Boundary or falsification check |
|---|---|---|---|---|
| CF-01 | `established` | The Clay positive target is global and universal in the datum: for any smooth divergence-free datum satisfying the stated decay or periodicity hypotheses, a smooth solution must exist on the whole interval $[0,\infty)$. | [S1], Statements A and B, p. 2; hypotheses (4), (6)-(8), (10)-(11), pp. 1-2. | A certificate for one datum, one bounded ball, or one finite $T$ does not match these quantifiers. |
| CF-02 | `established` | On a periodic cube, an approximate trajectory satisfying an explicit strict inequality involving its initial mismatch, full-PDE residual, and Sobolev growth certifies a true strong solution on $[0,T]$. | [S2], Corollary 5 and inequality (21), pp. 14-15; $m\ge3$. | The quantities in (21) must be rigorous bounds for a continuous trajectory. Samples or floating-point estimates alone do not satisfy the hypothesis. |
| CF-03 | `established` | A related residual criterion works at minimal strong-solution regularity in $H^1$ on a sufficiently smooth bounded domain or a periodic domain, with explicit viscosity dependence. | [S3], Theorem 6.1(i), inequality (6.2), pp. 9-11; robustness theorem 4.1, pp. 4-6. | Theorem 6.1(ii), which says sufficiently large Galerkin approximations eventually pass, assumes that the strong solution already exists. |
| CF-04 | `established` | In the torus framework of Morosi and Pizzocchero, rigorous differential-error, datum-error, and growth estimators plus a solution of a scalar control inequality bound the exact solution; a global control function implies a global exact solution for that datum. | [S5], Definition 4.1, pp. 7-8; Proposition 4.4, equations (4.19)-(4.27), pp. 9-10. | This is datum-specific. The estimators and constants must themselves be certified, and globality requires the control function on all $t\ge0$. |
| CF-05 | `established` | Galerkin convergence and eventual passage of an a posteriori test are conditional detection results, not independent proofs that every solution is regular. | [S2], Theorem 6, pp. 16-19, and Theorem 8, pp. 19-21; [S3], Theorem 5.1 and Theorem 6.1(ii), pp. 7-11. | Removing the assumed strong solution from these convergence clauses invalidates the inference. |
| CF-06 | `established` | For zero forcing on the periodic cube, Robinson and Sadowski give a sound finite verification scheme for an $H^2$ ball conditional on regularity of that ball, and an $H^1$-ball finite-termination result conditional on global regularity of the equations. | [S4], Theorem 5.2 and its proof, pp. 7-10; Theorem 6.1 and conclusion, pp. 10-11. | Propositions 5.3 and 5.4 assume Statement 5.1 is true; Theorem 6.1 explicitly assumes global regularity. Thus this is a conditional semidecision result, not a proof of its premise. |
| CF-07 | `established` | Finite-time enstrophy maximization in Kang, Yun, and Protas is a nonconvex numerical search for local maximizers under fixed $E_0$ and $T$; the method cannot certify that the reported maximizers are global. | [S6], Problem 3.1, p. 10; numerical method, p. 15; discussion, pp. 30-31. | An undiscovered maximizing branch is explicitly not ruled out. Finite ranges of $E_0$, $T$, and resolution cannot establish a universal enstrophy bound. |
| CF-08 | `established` | Formal tools can certify arithmetic subclaims and numerical implementations: CoqInterval checks supported real inequalities and integral enclosures, Flocq formalizes floating-point arithmetic, Gappa proves arithmetic properties of numerical programs, and one inspected case study machine-checks a 1D wave solver's method error, roundoff, runtime safety, and C implementation relative to named axioms. | [S8], abstract and Sections 3-5, especially Theorems 1-2, pp. 12-14, and conclusion, pp. 21-22; [S9], "Invocation"; [S10], "Overview"; [S11], project overview. | None of [S8]-[S11] formalizes the 3D Navier-Stokes a posteriori theorem or proves a Navier-Stokes certificate. |
| CF-09 | `blocked` | A computation-only route from finitely many trajectories to Clay Statement A or B is unavailable in the inspected sources. | Missing: a theorem giving a uniform continuation bound and a finite, certified reduction covering every admissible smooth datum, together with rigorous residual, tail, and rounding bounds. | Discharge all named obligations with a proof whose quantifiers match [S1]; numerical agreement or denser sampling does not disconfirm the blockage. |

## The quantifier ladder

The following levels must not be collapsed.

| Level | Legitimate conclusion | What is still missing |
|---|---|---|
| Discrete run | A finite-dimensional program produced particular values. | Consistency with the full PDE, truncation error, roundoff, and any exact-solution statement. |
| One datum, finite time | A true strong solution exists on $[0,T]$ near a certified approximate trajectory [CF-02, CF-03]. | Continuation beyond $T$ and other data. |
| One datum, all time | The same datum is global if a finite certificate reaches an established global regime, or if a control inequality is global [CF-04]. | Other data. |
| Bounded family | A rigorously covered family is regular if every covering certificate and the uniform constants are proved. [S4] supplies conditional finite-termination results, not the premise [CF-06]. | Larger balls and a uniform reduction of all smooth data. |
| Universal regularity | Every datum in Statement A or B is global [CF-01]. | This is the open problem. |

For the unforced nondimensional periodic problem, [S4, Lemma 4.2, p. 7]
provides a useful finite continuation horizon: every weak solution eventually
enters the known small-enstrophy regime. Certifying regularity up to that horizon
therefore suffices for the selected datum or covered ball. The horizon grows with
the data bound, so this does not turn one bounded-ball computation into a proof
for all smooth data.

## Directly computable criteria

### High-regularity residual test

In [S2], write $u_a$ for the approximate trajectory, $v_0$ for the exact initial
datum, and

$$
r_a(t)=\dot u_a(t)+\nu A u_a(t)+B(u_a(t),u_a(t))-f(t).
$$

On the periodic cube, Corollary 5 states that for $m\ge3$, under its listed
regularity hypotheses, the strict inequality

$$
\|u_a(0)-v_0\|_m+\int_0^T\|r_a(s)\|_m\,ds
<\frac{1}{c_mT}\exp\!\left[-c_m\int_0^T
  \bigl(\|u_a(s)\|_m+\|u_a(s)\|_{m+1}\bigr)\,ds\right]
$$

implies that the exact problem has a strong solution on $[0,T]$ [S2,
inequality (21), pp. 14-15]. This is an exact-PDE theorem. Its left side is not
the residual of only the projected equations.

[S2, Corollary 9, pp. 20-21] treats a linearly interpolated fully discrete
trajectory, but assumes convergence of its time derivative to the Galerkin time
derivative. It does not itself provide interval bounds for a floating-point time
stepper or quadrature.

### Minimal-regularity residual test

[S3, Theorem 6.1(i), inequality (6.2), pp. 9-11] has the same certificate
shape in the $H^1$ setting: initial $H^1$ mismatch plus the time integral of the
full residual in the required norm must lie below an explicit viscosity- and
trajectory-dependent margin. This broadens the domain and lowers regularity, but
does not weaken the need for rigorous evaluation of every term.

### Scalar control inequality

[S5] packages the a posteriori argument as estimators
$\epsilon_n(t)$, $\delta_n$, $D_n(t)$, and $D_{n+1}(t)$ for differential error,
datum error, and approximate-solution growth. Proposition 4.4 asks for

$$
D^+R_n\ge -\nu R_n+(G_nD_n+K_nD_{n+1})R_n+G_nR_n^2+\epsilon_n,
\qquad R_n(0)\ge\delta_n.
$$

Then $\|u(t)-u_a(t)\|_n\le R_n(t)$ on the control interval; if $R_n$ is
global, so is the exact solution [S5, equations (4.19)-(4.22), pp. 9-10]. This
is a useful certificate interface because the PDE computation can export scalar
upper-bound functions. It is not universal in the datum.

## Obligations for a rigorous certificate

Passing a displayed test requires more than evaluating its formula in ordinary
floating point. A certificate should expose the following independent
obligations.

| Obligation | What the artifact must establish | Why omission is fatal |
|---|---|---|
| Exact problem identity | Domain, viscosity, boundary conditions, forcing, initial datum, zero-mean convention, and divergence-free constraint are represented exactly or enclosed with a proved correction. | Otherwise the certificate can concern a nearby but different PDE. |
| Residual | A rigorous upper bound for the **full** residual $r_a$ in exactly the Sobolev norm required by the imported theorem, on every time slab. Include interpolation, differentiation, projection, aliasing, and forcing errors. | A small residual for the Galerkin ODE alone does not invoke [S2], [S3], or [S5]. |
| Tail and projection | Bound every unrepresented contribution to the datum, forcing, growth norms, and residual. For a Galerkin path this includes $Q_N[B(u_N,u_N)-f]$, which appears explicitly in [S2, equation (30), p. 20]. | The convergence theorem only says this tends to zero under an assumed strong solution; it does not provide the finite, computable bound required by a certificate. |
| Rounding and quadrature | Use exact rational arithmetic or outward-rounded intervals for coefficient generation, FFT/convolution, linear solves, time stepping, norms, exponentials, constants, and time integrals. Prove an upper bound on the test's left side and a lower bound on its right side with a positive gap. | Resolution studies and floating-point agreement do not prove a strict inequality. [S4, p. 6] notes that the integrals cannot be computed exactly; that is an obligation, not a license to approximate them informally. |
| Time reconstruction | Define a continuous $u_a(t)$ from stored states and enclose both it and $\dot u_a$ between time nodes. | The cited theorems take norms and residuals of a continuous-time function, not only samples. |
| Analytic constants | Certify the Sobolev, bilinear, Poincare, projection, and stability constants in the exact normalization used by the code. | A favorable inequality using an incompatible Fourier normalization or nonrigorous constant proves nothing. |
| Continuation | For a finite computation, prove an endpoint condition that invokes a cited global theorem, a finite late-time horizon such as [S4, Lemma 4.2] in its setting, or a global control function as in [S5]. | Regularity on every fixed interval already computed does not imply all-time regularity without a finite continuation argument. |
| Universal coverage | If the target is [S1, Statement A or B], prove a finite or symbolic reduction covering every admissible smooth datum and preserving all hypotheses. | Sampling, optimization, and one bounded ball leave the universal quantifier open. |
| Proof checking | Either formalize the analytic implication from the certificate to strong-solution regularity, or state it as an explicitly trusted theorem with every hypothesis checked. | A verified arithmetic kernel cannot repair a missing PDE theorem or a mismatched hypothesis. |

A separate estimate of the unknown exact solution's unresolved tail is not always
needed: the a posteriori stability theorem is precisely what can control the
unknown solution from the approximate path. What must be bounded is every tail
entering the **data, residual, and certificate norms**. This distinction keeps the
obligation finite without silently replacing the PDE by its truncation.

## Enstrophy-growth optimization

[S6] formulates, for fixed initial enstrophy $E_0$ and final time $T$, the
problem of maximizing final enstrophy over divergence-free $H^1$ initial data,
while assuming smoothness on $[0,T]$ [Problem 3.1, p. 10]. The implementation
uses an adjoint gradient method, pseudo-spectral state solves, and resolutions
from $128^3$ to $512^3$ [p. 15]. Its reported finite-range scaling and vortex
structures are evidence about the maximizing branches found.

The paper explicitly states that first-order optimization finds local maximizers,
cannot guarantee global maximizers, and cannot rule out other branches [S6,
pp. 30-31]. It also observes roundoff in its gradient check [p. 15]. Therefore:

- the computations can generate adversarial initial data for a proposed
  inequality or continuation criterion;
- they can reveal that an instantaneous bound is dynamically unsustained on the
  branches found;
- they can suggest improved exponents or structures for analytic work;
- they do not certify a supremum over all data, prove bounded enstrophy, or prove
  the absence of blow-up.

[S7] is the earlier Lu-Doering instantaneous-growth paper cited by [S6]. Its
full text was not inspected, so no theorem or optimization claim in this report
depends on it.

## Formal proof support

The inspected formal-method sources support a component strategy:

1. CoqInterval's official documentation [S9, "Invocation"] directly supports
   proofs of inequalities over recognized real expressions, selected integral
   enclosures, and expressions using Flocq rounding.
2. Flocq [S10, "Overview"] directly supplies a Rocq formalization of
   multi-radix, multi-precision floating-point arithmetic and rounding theorems.
3. Gappa [S11, project overview] directly supports proving arithmetic properties
   of floating- and fixed-point numerical programs and can act as a Rocq tactic
   or Why3 backend.
4. Boldo et al. [S8] demonstrate a larger pipeline for a **one-dimensional
   linear wave equation**: convergence/method error, roundoff propagation,
   runtime safety, and C-code conformance are checked with Coq, Gappa, SMT
   solvers, and Frama-C. Their conclusion identifies one remaining analytic axiom
   about Jacobi polynomials and says other PDEs require problem-specific work
   [pp. 21-22].

This evidence justifies formalizing an independent checker for finite arithmetic
and residual certificates. It does not substantiate claims that Lean, Rocq, or
another prover already contains the functional analysis, local existence,
continuation, or a posteriori theorem needed for an end-to-end 3D Navier-Stokes
certificate. No such formalization was found in the inspected primary sources.

## Recommended code boundary

Code should own the finite, replayable part:

- produce exact or interval Fourier/time coefficients;
- emit upper bounds for datum error, full residual, projection tail, growth
  norms, and all quadratures;
- solve and certify the scalar control inequality or endpoint continuation test;
- check a strict final margin independently of the simulator;
- search enstrophy-maximizing flows to attack proposed analytic lemmas;
- export a compact proof object for a small trusted checker or proof assistant.

Analysis must own the quantifiers and infinite-dimensional bridge:

- the a posteriori stability theorem and its constants;
- the theorem converting the endpoint or control bound into global existence;
- any uniform covering or reduction from all smooth data to finitely checkable
  cases.

Thus the best defensible project goal is a **single-datum finite-time exact-PDE
certificate**, followed where possible by a **single-datum global continuation
certificate**. A universal regularity claim remains `blocked` until the analytic
coverage and continuation obligations are proved independently of finite
sampling.

## Source register

Page numbers below refer to the printed page labels in the inspected manuscript,
not the PDF viewer's cover-page count.

### Inspected

**[S1]** Charles L. Fefferman, *Existence and Smoothness of the Navier-Stokes
Equation*, Clay Mathematics Institute problem description. Statements A-D,
pp. 1-2 inspected.

- Primary URL: https://www.claymath.org/wp-content/uploads/2022/06/navierstokes.pdf
- Problem page: https://www.claymath.org/millennium/navier-stokes-equation/

**[S2]** Sergei I. Chernyshenko, Peter Constantin, James C. Robinson, and
Edriss S. Titi, *A posteriori regularity of the three-dimensional Navier-Stokes
equations from numerical computations*, Journal of Mathematical Physics 48
(2007), 065204.

- DOI: https://doi.org/10.1063/1.2372512
- Inspected author manuscript: https://arxiv.org/abs/math/0607181
- Locators: Corollary 5, inequality (21), pp. 14-15; Theorems 6 and 8,
  pp. 16-21; Corollary 9, pp. 20-21.

**[S3]** Masoumeh Dashti and James C. Robinson, *An A Posteriori Condition on
the Numerical Approximations of the Navier-Stokes Equations for the Existence
of a Strong Solution*, SIAM Journal on Numerical Analysis 46(6) (2008),
3136-3150.

- DOI: https://doi.org/10.1137/060677537
- Inspected author manuscript: https://arxiv.org/abs/math/0701341
- Locators: Theorems 4.1-4.2, pp. 4-6; Theorems 6.1-6.2, pp. 9-12.

**[S4]** James C. Robinson and Witold Sadowski, *Numerical verification of
regularity in the three-dimensional Navier-Stokes equations for bounded sets of
initial data*, Asymptotic Analysis 59(1-2) (2008), 39-50.

- DOI: https://doi.org/10.3233/ASY-2008-0899
- Inspected author manuscript: https://arxiv.org/abs/math/0701268
- Locators: Corollary 3.2, pp. 5-6; Lemma 4.2, p. 7; Theorem 5.2,
  pp. 7-10; Theorem 6.1 and conclusion, pp. 10-11.

**[S5]** Carlo Morosi and Livio Pizzocchero, *Smooth solutions of the Euler
and Navier-Stokes equations from the a posteriori analysis of approximate
solutions*, Nonlinear Analysis 113 (2015), 298-308.

- DOI: https://doi.org/10.1016/j.na.2014.10.005
- Inspected author manuscript: https://arxiv.org/abs/1405.3421
- Locators: Definition 4.1, pp. 7-8; Proposition 4.4, pp. 9-10; application
  limits, Section 6, pp. 13-14.

**[S6]** Di Kang, Dongfang Yun, and Bartosz Protas, *Maximum amplification of
enstrophy in three-dimensional Navier-Stokes flows*, Journal of Fluid Mechanics
893 (2020), A22.

- DOI: https://doi.org/10.1017/jfm.2020.204
- Inspected author manuscript: https://arxiv.org/abs/1909.00041
- Locators: Problems 2.1 and 3.1, pp. 8 and 10; numerical approach, p. 15;
  discussion and limitations, pp. 30-31.

**[S8]** Sylvie Boldo, Francois Clement, Jean-Christophe Filliatre, Micaela
Mayero, Guillaume Melquiond, and Pierre Weis, *Wave Equation Numerical
Resolution: A Comprehensive Mechanized Proof of a C Program*, Journal of
Automated Reasoning 50 (2013), 423-456.

- DOI: https://doi.org/10.1007/s10817-012-9255-4
- Inspected author manuscript: https://arxiv.org/abs/1112.1795
- Locators: abstract and introduction, pp. 1-4; Theorems 1-2, pp. 12-14;
  formal proof accounting, pp. 19-21; conclusion, pp. 21-22.

**[S9]** CoqInterval project, *Interval Package for Rocq*, official
documentation, sections "Invocation", "Fine-tuning", and "Examples" inspected
2026-08-13.

- Primary URL: https://coqinterval.gitlabpages.inria.fr/

**[S10]** Flocq project, official documentation, "Overview" and browsable
library index inspected 2026-08-13. The linked founding paper is Sylvie Boldo
and Guillaume Melquiond, *Flocq: A Unified Library for Proving Floating-Point
Algorithms in Coq*, ARITH 2011, pp. 243-252; the report relies on the inspected
official documentation, not uninspected details of the paper body.

- Primary URL: https://flocq.gitlabpages.inria.fr/
- Founding-paper DOI: https://doi.org/10.1109/ARITH.2011.40

**[S11]** Gappa project, official project overview and documentation index
inspected 2026-08-13.

- Primary URL: https://gappa.gitlabpages.inria.fr/

### Uninspected

**[S7] UNINSPECTED.** Lu Lu and Charles R. Doering, *Limits on enstrophy
growth for solutions of the three-dimensional Navier-Stokes equations*, Indiana
University Mathematics Journal 57(6) (2008), 2693-2728.

- DOI: https://doi.org/10.1512/iumj.2008.57.3716
- Inspection note: bibliographic metadata and its citation by [S6] were checked,
  but no lawful accessible full text was obtained. It is included for provenance
  only. No `established` claim above depends on [S7].
