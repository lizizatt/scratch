# Navier-Stokes Millennium Research Program

This directory is an auditable research program for the three-dimensional
incompressible Navier-Stokes existence and smoothness problem. It does **not**
claim to contain a solution. The problem remains open unless a complete proof
survives independent mathematical review.

The project separates three things that are easy to blur:

- established results, tied to primary sources;
- candidate deductions, represented as explicit dependency graphs;
- computational experiments, used to test ideas but never as proof of a
  universal analytic statement.

## Quick start

```bash
python -m unittest discover -s tests -v
python -m ns_millennium.ledger path/to/claims.json
```

Research notes, proof obligations, and gauntlet prompts will live under
`docs/`. Machine-readable claims and review records will live under
`artifacts/`.

The current result and stopping condition are recorded in
[`docs/OUTCOME.md`](docs/OUTCOME.md).

The cross-route blocker overview is recorded in
[`docs/research/BLOCKER_MAP.md`](docs/research/BLOCKER_MAP.md).

## Current status (2026-08-18)

The problem remains open. 51 adversarial gauntlet rounds have attacked
frequency-packing, phase-space, and critical-profile routes; several narrow
sub-claims were refuted with explicit counterexamples, and two conditional
theorems, `LOCAL-L3-CONTINUATION`
([proof](docs/proofs/LOCAL_L3_CONTINUATION.md)) and its record-center
weakening `LOCAL-L3-RECORD-CENTERS`
([proof](docs/proofs/LOCAL_L3_RECORD_CENTERS.md)), were proved: a local,
fixed-radius uniform $L^3$ bound near a hypothetical singular time already
rules out that singularity, even if only assumed along one backward-tracked
trajectory of centers. Deriving that local bound from finite-energy data
remains the open step. Later profile and multi-domain fanout iterations are
recorded as exploratory notes, not additional gauntlet rounds or ledger
claims; see [`docs/OUTCOME.md`](docs/OUTCOME.md) for the candidate-disposition
table and gauntlet history. The latest round attacked pressure-free annular
Bogovskii localization and remained blocked at the time-dependent correction
and critical transport terms. A primary-source audit found no existing
Bogovskii, Lin, ESS, or accessible CKN-reproof theorem matching the fixed-time
local $L^2$ target. Five additional technique-family audits (Besov,
minimal-blowup, vorticity geometry, monotonicity, and singular-set geometry)
also remained blocked or redundant with existing routes. The hash-chain
manifest also contains
non-mathematical synchronization/audit heads for the current research record.
The latest round constructed a scale-critical localized kinetic-enstrophy
functional; its interior stretching term is conditionally absorbable, but the
fixed-time annular tail remains blocked. A four-step functional-design loop
then tested instantaneous pressure moments, windowed energy, higher-derivative
enstrophy, and anisotropic vorticity penalties; all failed at pressure
differentiation, scaling, transverse transport, or fixed-time transfer. The
next nonlocal wavelet/phase-space candidate also failed: flux completion
created a quartic triad term, while its expanding-ball normalization recreated
the missing anti-concentration estimate.

## Resolution standard

An internal candidate may be called `proved` only when every dependency is
either established from a cited source or proved in the ledger, its
`proof_artifact` resolves inside the repository, and at least one recorded
falsification attempt has been answered. A `refuted` claim likewise needs a
checked counterexample artifact. The validator checks structure and references,
not mathematical truth, semantic equivalence, or reviewer identity. Even a
fully green internal ledger is a candidate proof, not a Millennium-problem
solution, until qualified independent experts verify it through a
human-controlled trust process.
