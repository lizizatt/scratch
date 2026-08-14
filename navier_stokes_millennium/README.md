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
