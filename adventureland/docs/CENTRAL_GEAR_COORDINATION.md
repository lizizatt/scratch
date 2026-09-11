# Central Gear Coordination Design

## Status

Proposed design. This document describes the intended evolution of gear management; it is not an interface contract for the current implementation. See `INTERFACE_CONTROL_DOCUMENT.md` for current behavior.

## Goals

- Make Puppygirl the authoritative party inventory observer, gear planner, upgrade oracle, and transfer coordinator.
- Keep fighters focused on combat, formation, survival, and executing explicit logistics orders.
- Keep Jazwyn's squad-leader role for party movement and combat separate from Puppygirl's logistics authority.
- Allow Puppygirl to command one character to give a precisely identified item to another character.
- Support coordinated exchanges, including cycles such as moving Jazwyn's intelligence earrings to Zarook and Zarook's strength earrings to Jazwyn.
- Harden the existing merchant-mediated gift flow before adding direct fighter-to-fighter execution.
- Recover safely from duplicate messages, stale state, full bags, movement, reloads, and partial transactions.

## Non-goals

- Fighters will not independently negotiate gear.
- Fighters will not independently score party-wide upgrades.
- Potion sharing between fighters is out of scope.
- The first version will not move characters solely to complete a gear transfer. Transfers wait until the participants are naturally in range; merchant delivery remains the fallback for merchant-held gear.
- The protocol does not provide true atomic exchange because Adventure Land exposes one-way item sends rather than escrow. It provides recoverable, idempotent coordination.

## Desired ownership model

| Concern | Owner |
|---|---|
| Combat target, formation, party movement | Jazwyn, with existing succession |
| Local survival and legal equip checks | Each fighter |
| Party inventory model | Puppygirl |
| Gear scoring and final assignment | Puppygirl |
| Upgrade, compound, buy, bank, and gift planning | Puppygirl |
| Transfer transaction state | Puppygirl, mirrored minimally by participants |
| Physical `send_item` and `equip` calls | Ordered fighter |

Puppygirl's view is authoritative for planning, but observations are not assumed to be current forever. Every decision is tied to inventory revisions and is revalidated by the fighters immediately before execution.

## Current system and gaps

The current flow is safe enough for merchant-held upgrades:

1. Fighters periodically send `gear_ad` snapshots containing equipped slots, free-space information, and class.
2. Puppygirl stores those advertisements and runs `planGifts()` against items she controls.
3. A delivery job carries the item to the selected fighter.
4. Puppygirl sends `gear_offer`; the fighter equips the matching item and reports `gear_got`.
5. Displaced or unwanted items eventually flow back through the ordinary fighter-to-merchant loot path.

This flow has important limits:

- Puppygirl sees equipped gear but not a complete, revisioned view of fighter bags.
- `planGifts()` is greedy by recipient and slot rather than a party-wide assignment.
- A cross-equipped swap cannot start when both useful items are worn and Puppygirl holds neither.
- Item matching primarily uses name and level, which is ambiguous when duplicates exist.
- Gift protection is time-based and local; it is not a transaction reservation shared by all actors.
- Messages do not form a durable prepare/send/receive/equip state machine.
- A fighter can change equipment, move, fill its bag, reload, or enter another operation after the plan was calculated.
- Direct commands need stricter sender and participant validation than ordinary coordination messages.

## First step: harden the existing flow

These changes should land before direct fighter transfers.

### Revisioned inventory advertisements

Replace the gear-only advertisement with a complete logistics snapshot:

```js
{
  v: 2,
  inventory_ad: 1,
  who: "Jazwyn",
  revision: 42,
  observed_at: 1789080000000,
  server_region: "US",
  server_identifier: "IV",
  map: "cave",
  x: -210,
  y: -470,
  esize: 7,
  slots: {
    earring1: { uid: "slot:earring1:intearring:2", name: "intearring", level: 2 }
  },
  bag: [
    { uid: "bag:17:strearring:1", index: 17, name: "strearring", level: 1, q: 1 }
  ],
  reservations: []
}
```

`uid` is a short-lived observation identity, not a permanent game item ID. It binds the item name, relevant attributes, observed location, and advertisement revision. Before acting, the fighter must resolve it against current state and reject ambiguity or mismatch.

Puppygirl tracks `inventoryByCharacter[who] = { revision, observedAt, snapshot }`. Older revisions are ignored. A snapshot becomes ineligible for new planning after a bounded freshness interval, though it remains useful for diagnostics.

### Strict message authority

- Fighters accept logistics commands only when the normalized CM sender is Puppygirl.
- Puppygirl accepts inventory and transaction reports only from the character named by the message.
- All characters must be members of the configured roster.
- `from`, `to`, and message recipient must agree.
- Unknown versions, actions, phases, slots, and item shapes are rejected and logged.
- Commands carry an expiration time and Puppygirl plan revision.

### Exact item matching

Matching must include every property that affects value or transfer safety, including at least:

- Name, level, quantity, lock status, and equipped/bag location.
- Upgrade/compound-relevant attributes exposed by the live item object.
- Special or stat-roll properties if Adventure Land exposes them.

Inventory indices are hints only. Fighters re-scan current inventory immediately before sending or equipping.

### Durable reservations

Reservations replace gift-only TTL assumptions. A reserved item cannot be:

- Sent to Puppygirl by ordinary loot cleanup.
- Sold, traded, exchanged, upgraded, or compounded.
- Equipped for an unrelated local improvement.
- Assigned to another plan.

Reservations are persisted with the transaction ID and expire only after explicit completion, cancellation, or a conservative timeout. Timeout releases are reported to Puppygirl.

### Current gift transaction correlation

Merchant-to-fighter gifts should use the same transaction envelope proposed below. `gear_offer` and `gear_got` can remain as version-1 compatibility messages during migration, but new plans must correlate:

- The exact sent item.
- Intended recipient and slot.
- The inventory revision used for planning.
- Receipt and equip outcomes.
- The displaced item, including its new bag identity.

This prevents a duplicate item with the same name and level from satisfying the wrong gift.

## Party-wide assignment planner

Puppygirl builds a candidate pool from:

- All equipped fighter items.
- Transferable fighter bag items.
- Puppygirl's bag and bank.
- Pending purchases, upgrades, and compounds only after they actually complete.

The planner evaluates assignments rather than isolated gifts. An assignment is legal only when:

- `classOk()` and `canEquipSlot()` permit it.
- The item is not locked, protected, reserved, or required for another role.
- Handedness and offhand constraints remain valid.
- Every displaced item has a known destination or reserved bag slot.
- All required observations are fresh.

The objective should maximize party-wide score while applying policy bonuses for named targets from `GEAR_TARGETS`. Named targets should be explicit score bonuses or constraints, not hidden overrides that can contradict class scoring.

A plan must satisfy:

- No character's final assigned loadout is worse unless an operator explicitly forces it.
- The total party score improves by a configured minimum.
- Equivalent plans use deterministic character, slot, and item tie-breakers.
- Recently completed assignments have hysteresis so the same items cannot bounce between characters.

The output is a complete desired assignment and a dependency-ordered set of transactions. This supports swaps and longer cycles without treating each one-way send as an independent upgrade.

## Generic transfer protocol

### Command envelope

Puppygirl is the only producer of transfer commands:

```js
{
  v: 2,
  logistics: 1,
  tx: "gear-1789080000000-7",
  plan_revision: 19,
  action: "transfer_item",
  from: "Jazwyn",
  to: "Zarook",
  item: {
    uid: "slot:earring1:intearring:2",
    name: "intearring",
    level: 2,
    q: 1,
    observed_revision: 42
  },
  from_slot: "earring1",
  to_slot: "earring1",
  reason: "party_gear_assignment",
  expires_at: 1789080120000
}
```

The schema is generic enough for any item, but initial policy permits only gear selected by the gear planner. Potion transfer commands remain out of scope.

Puppygirl sends the plan to both participants:

- The sender receives an order to reserve and transfer the item.
- The recipient receives an expectation to reserve capacity and later equip the received item.

### Reports

Participants report state through one schema:

```js
{
  v: 2,
  logistics_report: 1,
  tx: "gear-1789080000000-7",
  who: "Jazwyn",
  phase: "prepared",
  revision: 43,
  item: { uid: "bag:12:intearring:2", name: "intearring", level: 2, q: 1 },
  error: null
}
```

Allowed phases:

| Phase | Meaning |
|---|---|
| `accepted` | Schema, authority, participant, and expiry checks passed |
| `prepared` | Item/capacity is reserved and current state matches the plan |
| `blocked` | Temporarily unable to proceed, with a machine-readable reason |
| `sent` | Sender's post-send inventory confirms the item left |
| `received` | Recipient's inventory confirms the exact item arrived |
| `equipped` | Recipient confirms the intended slot contains the item |
| `failed` | A terminal validation or execution failure occurred |
| `cancelled` | Reservation was released by coordinator order |

Reports are idempotent. Repeating a command returns the current phase and never repeats a completed send.

### Transaction state

Puppygirl persists:

```text
planned -> reserving -> prepared -> sending -> received -> equipping -> complete
                           |           |           |
                           +-------- blocked/failed/cancelled
```

Puppygirl may issue the physical send only after both participants report `prepared`. The sender then:

1. Confirms recipient visibility, map, server, range, and reserved capacity.
2. Re-resolves the exact item.
3. Unequips it if necessary.
4. Rechecks item identity and recipient readiness.
5. Calls `send_item` once.
6. Confirms the item left before reporting `sent`.

The recipient confirms arrival from current inventory rather than trusting the sender's report, equips only on Puppygirl's order, and reports the actual resulting slot and displaced item.

## Swap execution

For Jazwyn and Zarook's earrings:

1. Fresh advertisements show Jazwyn wearing an intelligence earring and Zarook wearing a strength earring.
2. Puppygirl calculates both final loadouts and confirms that each character improves.
3. Puppygirl reserves one free bag slot on each fighter and reserves both earrings.
4. Both fighters acknowledge `prepared`.
5. Puppygirl orders Jazwyn to unequip and send the intelligence earring to Zarook.
6. Zarook confirms receipt. Puppygirl then orders Zarook to unequip and send the strength earring to Jazwyn.
7. Both receipts are confirmed.
8. Puppygirl sends explicit equip orders for the intended slots.
9. Both fighters report their new equipment snapshots.
10. Puppygirl verifies the final assignment and marks the transaction complete.

If neither fighter has a free bag slot, Puppygirl must first create capacity through the existing loot or merchant flow. The system must never start the first leg while the second leg is known to be impossible.

Because a crash can occur between legs, a partial swap is not rolled back blindly. On recovery, Puppygirl reconstructs ownership from fresh snapshots and either completes the intended assignment or computes a safe explicit repair plan.

## Equip-order protocol

Receiving an item and equipping it are separate operations:

```js
{
  v: 2,
  logistics: 1,
  tx: "gear-1789080000000-7",
  plan_revision: 19,
  action: "equip_item",
  who: "Zarook",
  item: {
    uid: "bag:8:intearring:2",
    name: "intearring",
    level: 2,
    observed_revision: 44
  },
  slot: "earring1",
  expires_at: 1789080120000
}
```

The fighter retains final safety gates: class legality, slot legality, item presence, and live game rejection. It does not independently decide that a different item or slot would be better. A rejected equip is reported to Puppygirl with current slot and inventory evidence.

Weapons and offhands should initially be excluded from direct swaps. They create transient combat capability and handedness hazards. Roll out accessories first, then armor, then weapons only after safe-state coordination exists.

## Handling failures

| Failure | Required behavior |
|---|---|
| Duplicate command | Return current transaction phase; do not send twice |
| Stale advertisement | Reject preparation and request a fresh snapshot |
| Item moved or changed | Report `failed:item_mismatch`; do not substitute |
| Recipient not visible/in range | Report `blocked:not_in_range`; continue fighting and retry later |
| Recipient has no capacity | Report `blocked:no_space`; Puppygirl plans capacity |
| Sender cannot unequip | Report `blocked:combat_or_slot`; leave gear unchanged |
| `send_item` reports failure | Re-snapshot both parties before retrying |
| Ambiguous send result | Do not retry until ownership is established from both snapshots |
| Fighter reload | Restore reservation and transaction phase, then report current state |
| Puppygirl reload | Restore transaction journal and reconcile every nonterminal transaction |
| Transaction expires | Stop execution, preserve current ownership, release only safe reservations, and report |
| Planner changes its mind | Cancel the old plan and receive cancellation acknowledgements before reassigning items |

## Operator-initiated plans

Automatic planning and human observations use the same path. A console helper may submit:

```js
transfer_item("Jazwyn", { slot: "earring1" }, "Zarook", { slot: "earring1" })
```

This creates a proposed plan, not an immediate `send_item`. Puppygirl resolves current identities, checks that the resulting assignment is non-degrading, obtains fresh snapshots, and then uses the normal transaction protocol. A separate explicit `force` option may bypass the score requirement but must never bypass identity, authority, capacity, range, or equip-legality checks.

## Observability

Every transaction should emit concise, correlated events:

```text
gear_tx:plan tx=... Jazwyn:intearring@2->Zarook
gear_tx:prepared tx=... who=Jazwyn
gear_tx:blocked tx=... who=Zarook reason=no_space
gear_tx:sent tx=... from=Jazwyn to=Zarook
gear_tx:received tx=... who=Zarook
gear_tx:equipped tx=... who=Zarook slot=earring1
gear_tx:done tx=... delta=...
```

Routine inventory advertisements should not be logged. Repeated blocked states should be rate-limited by transaction and reason.

## Delivery sequence

1. **Current-flow hardening**
   - Revisioned full inventory advertisements.
   - Strict sender validation and exact item identities.
   - Persistent reservations and correlated merchant gifts.
   - Reconciliation after reload.

2. **Central assignment**
   - Pure party-wide assignment planner with deterministic results.
   - Simulation fixtures for cross-equipped earrings, duplicates, levels, full bags, class restrictions, and hand conflicts.
   - Planning only; continue executing through Puppygirl initially.

3. **Direct accessory transfers**
   - Generic transfer and report schemas.
   - Two-party preparation and persistent transaction journal.
   - Earrings, rings, amulets, belts, capes, and orbs only.

4. **Armor and cycles**
   - Multi-leg swaps and longer assignment cycles.
   - Recovery from interruption after every phase.

5. **Weapons and offhands**
   - Add only with an explicit non-combat safe state and complete handedness tests.

## Acceptance scenarios

- Cross-equipped strength/intelligence earrings are exchanged and both final loadouts improve.
- A duplicate transfer command produces one physical send.
- A stale inventory index cannot cause the wrong duplicate item to be sent.
- A fighter moving out of range blocks without abandoning combat or moving independently.
- A full recipient prevents the first leg of a swap.
- Reload each participant after every transaction phase and complete without item loss or duplicate sends.
- Puppygirl reload reconstructs an in-flight swap from fresh fighter snapshots.
- Ordinary loot cleanup never sends a reserved item to Puppygirl.
- Upgrade, compound, sell, and exchange operations skip reserved items.
- A lower-scoring or oscillating reassignment is rejected.
- A malicious or accidental logistics command from another fighter is ignored.
- Merchant-held gifts continue working throughout migration.
