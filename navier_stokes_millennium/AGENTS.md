# Agent Instructions

## Mission

Investigate the three-dimensional incompressible Navier-Stokes Millennium
problem through source-grounded mathematics, explicit proof obligations, and
adversarial review. Preserve uncertainty. Treat this repository as a research
record, not evidence that the open problem has been solved.

## Working Contract

1. Read `README.md` and the relevant document under `docs/` before changing an
   artifact.
2. Put each mathematical claim in the claim ledger. Give it one status and list
   every dependency needed for the inference.
3. Cite primary sources for `established` claims. Include theorem numbers and
   hypotheses when available.
4. Put complete internal proofs under `docs/proofs/`; attach a resolving
   `proof_artifact` and a concrete falsification attempt before marking an
   internal claim `proved`.
5. Record dead ends and counterexamples. A failed approach is reusable evidence.
6. Record every adversarial round under `artifacts/gauntlet/`, including actual
   agent models, capability failures, dispositions, and rejected findings.
7. Run `python -m unittest discover -s tests -v` after changing validator code.
8. Run the ledger validator after changing a claim artifact.

## Epistemic Status

Use exactly these statuses:

- `established`: imported from a cited primary source with matching hypotheses;
- `proved`: derived in this project with a complete proof artifact;
- `conjectured`: plausible but not proved;
- `blocked`: missing a named lemma, estimate, or construction;
- `refuted`: contradicted by a checked argument or counterexample.

Numerical evidence, symbolic output, dimensional analysis, analogy, and agent
agreement can motivate a claim but cannot by themselves upgrade it to `proved`.
An internal green check means only that the artifact satisfies this project's
contract. External expert review remains necessary.

## Gauntlet Reviews

A reviewer returns findings only. Each finding names the exact claim, the first
unsupported inference, a triggering example or missing hypothesis, and the
smallest repair. A fresh reviewer rechecks the whole dependency closure after a
repair. Convergence means no further verified internal findings were produced;
it does not certify a Millennium solution.
