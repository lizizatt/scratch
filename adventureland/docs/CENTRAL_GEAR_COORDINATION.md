# Central Gear Coordination

## Status

The first coordination slice is implemented. The authoritative current
contract is [INTERFACE_CONTROL_DOCUMENT.md](INTERFACE_CONTROL_DOCUMENT.md),
section 6. It covers:

* revisioned, full fighter inventory advertisements;
* movement-stable item fingerprints and exact observed-location references;
* CM sender gates;
* persisted fighter transactions/reservations and Puppygirl's transaction
  journal;
* party-wide planning for equipped and eligible unlocked/unreserved bag-held
  earrings, rings, amulets, belts, capes, and orbs, with bag items assigned
  only across owners;
* transaction-time suspension of normal-tick fighter loot, strip/equip
  maintenance, and periodic offload to preserve reserved inbound bag capacity;
* post-finish/cancel recovery gated on a later accepted advertisement using
  merchant-local receipt sequence, including equal-inventory-revision refreshes;
* `gear_plan`, `gear_tx_report`, `gear_transfer`, `gear_check`, `gear_finish`,
  and `gear_cancel`, including retries, deadlines, capacity, and range.

This file is no longer a wire-protocol specification. Everything below is
future design and is not implemented unless moved into the ICD.

## Remaining design scope

### Broader item and slot coverage

* Extend allocation to armor, mainhand, offhand, and class-specific weapon
  combinations without producing illegal or tactically poor loadouts.
* Extend bag allocation beyond today's direct accessory groups to broader item
  categories, merchant bag/bank inventory, quantity-aware stacks, and items
  that need upgrading before allocation.
* Model two-handed weapons, offhand displacement, locked/special items, and
  temporary loadouts explicitly.

### Operator interface

No current operator API exposes dry-run plans, approvals, transaction status,
forced cancellation, exclusions, or retry controls. A future interface should
make those operations auditable and authenticated rather than adding more
loosely validated chat commands.

### Recovery and reconciliation

* Reconcile ownership after ambiguous `send_item` outcomes, reloads, disconnects,
  partial swaps, and cancellation races.
* Add explicit receipt/finalization acknowledgements and durable replay rules.
* Define repair or rollback plans when a multi-leg exchange stops halfway.
* Reconstruct coordinator state from fresh inventory observations rather than
  trusting only a restored journal.

### Optimization

* Optimize the complete party loadout rather than one accessory group at a
  time.
* Add hysteresis, minimum-gain policy, operator priorities, and upgrade-cost or
  liquidity constraints.
* Account for combat role, skills, set bonuses, stat breakpoints, alternate
  loadouts, and uncertain item metadata.
* Add movement/rendezvous scheduling instead of requiring participants to
  already be within transfer range.

## Unresolved risks

* Current fingerprints are not unique instance IDs and omit quantity and many
  item properties; duplicate items can remain ambiguous.
* Version `v:2` is emitted but not negotiated or strictly rejected by current
  consumers.
* Successful item-send return values are trusted without post-send ownership
  proof.
* Finish/cancel reports are not consumed as acknowledgements, and fighter local
  expiry is silent.
* Merchant advertisements are heap-only after reload, while the transaction
  journal is durable.
* Name-based sender gates depend on trustworthy platform envelope metadata and
  are not cryptographic authentication.
* Broader planning can create cycles and temporary-capacity requirements that
  the current sequential accessory exchange does not solve generally.
