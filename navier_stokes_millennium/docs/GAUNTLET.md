# Agentic Research Gauntlet

The gauntlet converts a mathematical idea into an auditable disposition. It
does not convert agent consensus into proof.

## Inputs

Every run starts with one claim ID from `artifacts/claims.json`, its exact
quantifiers, dependencies, solution class, domain, and a proposed proof
artifact. Vague ideas first become `conjectured` claims; they do not enter proof
review until the statement is falsifiable.

## Roles

1. **Proposer:** writes the smallest complete argument and names every imported
   theorem.
2. **Scaling critic:** computes dimensions under Navier-Stokes scaling and
   checks amplitude, time-slab, endpoint, and dyadic summability losses.
3. **PDE critic:** checks pressure localization, nonlinear convergence,
   solution class, boundary/domain changes, and continuation criteria.
4. **Counterexample critic:** attacks with concentrating bumps, travelling
   profiles, high-high-to-low interactions, weak limits, and quantifier swaps.
5. **Source critic:** opens every cited primary theorem and matches hypotheses,
   version, domain, and conclusion.
6. **Arbiter:** independently verifies each finding and records its disposition.

Use fresh stateless agents for each critic. Rotate model families where
available. Exact preferred models may be unavailable; record the actual model
used rather than implying otherwise.

Every round writes `artifacts/gauntlet/round-NNN.json` using the contract in
`artifacts/gauntlet/README.md`. A reviewer that lacks source access is recorded
as blocked and does not count as a review.

## Iteration

1. Freeze the claim statement and dependency closure.
2. Dispatch the four critics independently.
3. Classify each finding as `valid`, `invalid`, `hallucinated`, or `decision`.
4. A valid finding sends the claim to `blocked` or `refuted`. Repair the
   smallest affected inference, rerun executable checks, then start a fresh
   full review.
5. A source mismatch cannot be repaired by weakening prose around the citation;
   either match the theorem's hypotheses or remove the dependency.
6. Record rejected duplicate findings so later agents must supply new evidence.
7. Record actual agents, candidate dispositions, repairs, validation, and the
   post-repair claim-ledger fingerprint before starting the next round.

Each finding has a stable fingerprint. A `duplicate` disposition names a
matching fingerprint from the validated prior-round chain. Converged rounds may
contain only `invalid`, `hallucinated`, or linked `duplicate` findings.

## Completion

Internal convergence requires all of the following:

- a fresh round produces no verified findings;
- every dependency is `established` or `proved`;
- every symbolic or computational certificate reproduces from the repository;
- every limiting operation names a topology and justifies nonlinear passage;
- the conclusion's quantifiers exactly match one Clay alternative.

Internal convergence still means **candidate proof**. A Millennium solution
requires independent expert verification outside this project. If a round
exposes an open lemma, the honest output is a precise blocked claim, not a
claim of victory.

The ledger enforces a canonical structured contract for Clay alternatives
A-D. A target cannot be `established` or `proved` without repository-resolved
gauntlet and independent external-review artifacts. These are structural gates,
not substitutes for expert mathematical judgment.

Certification hashes bind the current target dependency closure and the bytes
of every referenced evidence, proof, and counterexample artifact. Full
validation requires the repository root; callers requesting syntax-only checks
must opt into structural-only mode. An analytic claim that depends directly or
transitively on computation must map every computation to a proved analytic
soundness bridge.

Reviewer names, affiliations, qualifications, and model identifiers are
attestations unless an external human-controlled system signs them. The local
validator checks schema, uniqueness, current dependency hashes, and review
outcomes; it cannot authenticate an identity or model provider. Likewise, it
cannot infer from arbitrary prose that a differently named theorem is
semantically equivalent to a Clay alternative. Reviewers must reject shadow
targets, and only canonical `CLAY-*` claims may state a complete alternative.

## Lost-mode protocol

When all active routes repeat the same obstruction, sample one unrelated
discipline and investigate one concrete mechanism for at most one research
round. Translate it back only as a falsifiable mathematical lemma. Analogy may
generate a conjecture; it cannot serve as evidence. Record both useful and
failed transfers under `docs/analogies/`.
