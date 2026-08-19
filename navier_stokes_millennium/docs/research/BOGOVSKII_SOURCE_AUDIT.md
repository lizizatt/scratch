# Bogovskii Route Source Audit

**Date:** 2026-08-18
**Status:** blocked; no source-backed bridge to
`LOCAL-L2-ANTI-CONCENTRATION` was found.

## Audit target

The target estimate is

$$
\sup_j\limsup_k M_k\int_{B_{\rho_k}(a_k)}
 |u(x,t_k+M_k^{-2}s_j)|^2\,dx<\infty,
$$

with KNSS record-point scaling, expanding rescaled balls, and fixed profile
times $s_j$. The question was whether an existing primary theorem on local
pressure estimates, suitable solutions, or Bogovskii/solenoidal localization
already supplies this estimate or one of its missing uniform ingredients.

## Primary sources checked

### Lin 1998

Fanghua Lin, *A New Proof of the Caffarelli-Kohn-Nirenberg Theorem*,
**Communications on Pure and Applied Mathematics** 51 (1998), 241-257.

- DOI: <https://doi.org/10.1002/(SICI)1092-1926(199803)51:3%3C241::AID-CPA2%3E3.0.CO;2-A>
- Accessible scan recorded in the project source audit:
  <https://varnothing.net/wp-content/uploads/2021/11/lin1998.pdf>
- Lemma 2.3, pp. 246-247: pressure integrability for the suitable-solution
  setting after pressure normalization.
- Theorem 3.1, pp. 249-252: interior epsilon regularity assuming small
  scale-invariant velocity and pressure quantities.
- Theorem 3.3, pp. 253-256: regularity from sufficiently small scaled
  enstrophy, obtained through the epsilon criterion.

These are conditional regularity and integrability statements. They do not
produce the required fixed-time local $L^2$ bound from finite global energy.
In particular, Theorem 3.1 assumes the cubic velocity-pressure smallness that
the current route would need to derive, while Theorem 3.3 supplies a
regularity test rather than an anti-concentration estimate.

### Escauriaza--Seregin--Sverak 2003

L. Escauriaza, G. Seregin, and V. Sverak, *$L_{3,\infty}$-solutions of the
Navier--Stokes equations and backward uniqueness*, **Russian Mathematical
Surveys** 58 (2003), 211-250.

- DOI: <https://doi.org/10.1070/RM2003v058n02ABEH000609>
- Official journal record and English PDF:
  <https://www.mathnet.ru/eng/rm609>
- Definition 2.1 and Lemma 2.2, pp. 215-216: suitable-solution framework and
  local epsilon regularity.
- Theorem 1.3, p. 214: the endpoint $L^\infty_tL^3_x$ continuation result.
- The backward-uniqueness hypotheses in Section 5 require additional terminal,
  growth, and differential-inequality information not supplied by finite
  energy or the KNSS record normalization.

ESS therefore confirms the continuation endpoint used by the project, but it
does not supply the missing local slice estimate or a pressure-free Bogovskii
reduction.

### Caffarelli--Kohn--Nirenberg 1982

L. Caffarelli, R. Kohn, and L. Nirenberg, *Partial regularity of suitable weak
solutions of the Navier--Stokes equations*, **Communications on Pure and
Applied Mathematics** 35 (1982), 771-831.

- DOI and publisher record:
  <https://doi.org/10.1002/cpa.3160350604>
  <https://onlinelibrary.wiley.com/doi/10.1002/cpa.3160350604>

The full text was not accessible in this environment. The project therefore
uses Lin's accessible primary reproof for theorem-level details and does not
infer an unverified CKN pressure-localization lemma.

## Bogovskii-specific source gate

The project contains no primary-source citation whose theorem statement has
all of the following features simultaneously:

1. a localized divergence correction on the relevant annulus;
2. suitable-solution admissibility and pressure handling;
3. constants uniform under the KNSS record rescaling;
4. a conclusion at fixed profile times $s_j$; and
5. the target $M_k$-weighted local $L^2$ anti-concentration bound.

A classical Bogovskii divergence solver may establish item 1 in isolation,
but that operator estimate does not imply items 2--5. No uncited theorem is
promoted to `established` in the claim ledger.

## Disposition

The source audit does **not** refute the anti-concentration target. It does
settle the current source question negatively: the audited Lin, ESS, and
accessible CKN-reproof material supplies only conditional epsilon regularity,
pressure integrability, partial regularity, or endpoint continuation. None
bridges finite energy to the required fixed-time local $L^2$ estimate.

The Bogovskii localization family should therefore be considered **blocked**
unless a new primary theorem with the exact KNSS-compatible hypotheses is
found. The next productive move is not another variant of this cutoff
calculation, but a genuinely different mechanism or a rigorously constructed
suitable-solution obstruction.
