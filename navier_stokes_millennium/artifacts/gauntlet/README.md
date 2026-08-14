# Gauntlet Records

Each `round-NNN.json` freezes one adversarial review round. A record contains:

- the target and post-repair claim-ledger fingerprint;
- requested and actual reviewer agents, including capability failures;
- candidate findings and arbiter dispositions;
- repairs and executable validation;
- one result: `valid_findings_repaired`, `converged_no_findings`,
  `converged_no_verified_findings`, or `stopped_with_blocker`.

Only the two `converged_*` results count as internal gauntlet convergence. They
do not certify a Millennium solution. A settled Clay target additionally needs
repository-resolved independent external-review artifacts, enforced by the
claim validator.

Round files form a hash chain through `previous_round_sha256`, but true
immutability also requires version control. When the project is untracked,
records must say so; agents do not stage or commit it without user
authorization.
