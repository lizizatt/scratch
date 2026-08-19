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

## Current status (2026-08-17)

The problem remains open. Thirty-four adversarial gauntlet rounds (and
counting) have attacked frequency-packing, phase-space, and critical-profile
routes; several narrow sub-claims were refuted with explicit counterexamples,
and one conditional theorem, `LOCAL-L3-CONTINUATION`
([proof](docs/proofs/LOCAL_L3_CONTINUATION.md)), was proved: a local,
fixed-radius uniform $L^3$ bound near a hypothetical singular time already
rules out that singularity. Deriving that local bound from finite-energy data
remains the open step; see [`docs/OUTCOME.md`](docs/OUTCOME.md) for the
candidate-disposition table and gauntlet history.

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
