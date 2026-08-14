# Literature Synthesis and Proof Landscape

**Status:** working synthesis, 2026-08-13

The official problem remains unsolved. This document extracts only the claims
needed to route new work; the source-level details and access caveats remain in
the six reports under `raw/`.

## Exact target

Fefferman's official statement offers four independent resolution paths:

| Alternative | Domain and force | Quantifier and conclusion |
|---|---|---|
| A | $\mathbb R^3$, unforced | Every divergence-free Schwartz datum has a global smooth bounded-energy solution. |
| B | $\mathbb T^3$, unforced | Every smooth periodic divergence-free datum has a global smooth periodic velocity and pressure. |
| C | $\mathbb R^3$, smooth rapidly decreasing force allowed | Some admissible datum and force have no global smooth bounded-energy solution. |
| D | $\mathbb T^3$, smooth time-decaying periodic force allowed | Some admissible datum and force have no global smooth periodic solution. |

A weak nonunique branch does not refute A or B, because those alternatives ask
for existence. A blowup result for a model equation, rough datum, or force
singular at $t=0$ does not establish C or D.

## Strongest established chain

For smooth divergence-free finite-energy data, weak solutions exist globally
and satisfy energy-class estimates of the form

$$
u\in L^\infty(0,T;L^2)\cap L^2(0,T;\dot H^1).
$$

This class is supercritical. Interpolation gives, among other bounds,
$u\in L^2_tL^6_x$, whose Serrin index is

$$
\frac{2}{2}+\frac{3}{6}=\frac32>1.
$$

The strongest short regularity chain available in the whole space is

$$
\boxed{\sup_{0<t<T}\|u(t)\|_{L^3}<\infty}
\quad\Longrightarrow\quad
\boxed{\text{no singularity at }T}.
$$

The implication is the Escauriaza-Seregin-Sverak endpoint theorem. The boxed
critical bound is not known for arbitrary smooth data. Listing additional
conditional criteria does not fill that arrow.

## What partial regularity contributes

Suitable weak solutions obey epsilon-regularity and singular-set bounds. These
results severely constrain a hypothetical singular set but do not prove it is
empty. They also require care with solution class: suitability includes a local
energy inequality and must not be silently inferred from an abstract weak
formulation.

## Blowup reductions

Rescaling a hypothetical first singularity can produce an ancient limit only
after proving compactness, passage of the nonlinearity, preservation of the
local energy inequality, and nontriviality. Existing rigidity results close
special branches, including exact backward self-similar profiles under named
hypotheses and selected symmetric ancient classes. They do not exclude every
Type I, Type II, discretely self-similar, or non-self-similar concentration.

The general contradiction route therefore has two open gates:

```text
hypothetical singularity
  -> critical normalization and compact ancient limit
  -> nontriviality in an exactly named solution class
  -> Liouville theorem for that exact class
  -> contradiction
```

No reviewed source closes both gates in the unrestricted three-dimensional
problem.

## What obstruction results rule out

- Energy cancellation and generic harmonic-analysis estimates are
  insufficient by themselves: Tao's averaged operator preserves the usual
  cancellation and nevertheless blows up.
- Norm inflation is finite large growth in a rough norm, not singularity.
- Convex-integration nonuniqueness is sensitive to force, datum, energy class,
  and local-energy admissibility. None of the reviewed results establishes a
  Clay alternative.
- A dyadic or shell cascade is a model until every discarded interaction is
  controlled for the exact operator.

## Role of computation

Code can certify algebra, scaling, interval bounds, residual estimates, and
finite-time regularity for specified data. A universal global result still
needs exact truncation-tail control and an analytic continuation argument whose
quantifiers cover all admissible data and all future times. Simulation alone
cannot discharge those obligations.

## Current proof obligations

The project tracks three non-equivalent routes:

1. **Critical a priori control.** Derive a scale-invariant continuation norm,
   such as $L^\infty_tL^3_x$, from smooth finite-energy evolution using a new
   property of the exact Navier-Stokes nonlinearity.
2. **Compactness plus rigidity.** Show that every hypothetical singularity
   produces a nontrivial ancient object in a named class, then prove a
   Liouville theorem for that full class.
3. **Exact cascade construction.** For a negative result, build one admissible
   datum whose exact triadic dynamics outrun viscosity through infinitely many
   scales in finite time and prove that no global smooth continuation exists.

The first two are positive routes; the third is a negative route. Each is
currently `blocked`, not `conjectured proved`.

## Source map

- Exact statement, scaling, energy, and foundational solution concepts:
  `raw/01_problem_foundations.md`
- Conditional regularity and critical well-posedness:
  `raw/02_regularity_criteria.md`
- Suitable solutions, epsilon regularity, and singular sets:
  `raw/03_partial_regularity.md`
- Nonuniqueness, norm inflation, and model-equation obstructions:
  `raw/04_nonuniqueness_obstructions.md`
- Self-similar, ancient-limit, and critical-element strategies:
  `raw/05_blowup_strategies.md`
- Validated numerics and formalization:
  `raw/06_computation_formalization.md`
