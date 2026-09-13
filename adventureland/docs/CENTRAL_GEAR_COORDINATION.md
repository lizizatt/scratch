# Central Gear Coordination

## Status

Puppygirl is the sole gear-routing and bank authority. Fighters never visit the
bank and never transfer gear directly to one another.

The authoritative wire contracts are documented in
[INTERFACE_CONTROL_DOCUMENT.md](INTERFACE_CONTROL_DOCUMENT.md), section 6.
They cover:

* revisioned fighter inventory advertisements;
* merchant pickup requests for exact Hunter or duplicate-progression items;
* fighter-to-merchant offload at a safe rendezvous;
* Puppygirl's bank retrieval, upgrading, compounding, and delivery queue;
* merchant-to-fighter `gear_offer` delivery and fighter `gear_got`
  acknowledgement;
* returning displaced or surplus gear to Puppygirl while she remains in range.

## Ownership and routing invariant

Every movable upgrade follows one route:

```text
fighter -> Puppygirl -> bank/economy/progression -> Puppygirl -> fighter
```

Fighter inventory advertisements are observations, not transfer commands.
Puppygirl uses them to choose pickups, progression challengers, and gifts.
Only the owning fighter may unequip or send an item, and only in response to a
Puppygirl pickup request. Only Puppygirl reads or writes the shared bank.

The former direct fighter-to-fighter transaction protocol was removed. This
eliminates multi-party reservation journals, ambiguous identical-copy
fingerprints during swaps, partial exchange recovery, and accessory-only
allocation behavior.

## Safety rules

* Equipped baselines are not risked by duplicate progression.
* Exact requested Hunter/progression names and levels are the only pickup
  candidates.
* Locked items are never moved.
* Fighters maintain field uptime; bank work cannot pull them away from combat.
* Delivery jobs retain acknowledgements, TTLs, retries, safe rendezvous logic,
  and post-delivery inventory advertisements.
* CM remains best effort, so persisted merchant jobs and fresh advertisements
  provide reconciliation rather than transport-level guarantees.
