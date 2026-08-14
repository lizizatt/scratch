# External Review Attestations

A resolved `CLAY-*` target requires at least two distinct JSON attestations in
this directory. Each must name the target, bind to the current target-closure
SHA-256, give verdict `accepted_complete_proof`, and identify the reviewer's
name, affiliation, and qualification.

These files are human-controlled attestations. The local validator checks their
shape, uniqueness, and hash binding; it cannot authenticate identities or
signatures. Production use should add signatures from an external trust root.
