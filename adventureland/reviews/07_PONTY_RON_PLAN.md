# Ponty & Ron browse plan (review cycle)

## Goal

Idle Puppygirl browses **Ponty** (`secondhands`) for gear that upgrades fighters or fills `GEAR_TARGETS`, then parks / gifts / upgrades — without bloating the bag or overpaying.

**Ron is tabled.** Lost-and-found browsing needs a **10M gold one-time access** fee — too steep until we have a large reserve and a bulk buy plan. Do not implement `tryRonBuy` / `get_lost_and_found` until that is revisited.

## Current targets (shipped)

| Who | Slot | Target | Why |
|-----|------|--------|-----|
| Jazwyn | offhand | `sshield` | dreturn tank |
| Jazwyn | mainhand | `fireblade` | gift/keep target (`DENY_UPGRADE` — not scroll-upgraded) |
| Jazwyn | earring1/2 | `strearring` | str |
| Zarook | offhand | `wbook0` | priest source |
| Zarook | earring1/2 | `vitearring` | vit |
| Sarene | offhand | `wbook0` | mage source |
| Sarene | earring1/2 | `intearring` | int (already wearing) |
| All fighters | cape | `cape` | empty slots |

`PONTY_WANT` quotas browse Ponty under `G.g * 1.25`. Goal earrings are **not** NPC-vendored.

## APIs

| NPC | List | Buy | Where | Status |
|-----|------|-----|-------|--------|
| Ponty | `get_secondhands()` | `buy_secondhand(rid)` | main ~`(106,-47)` / `smart_move("secondhands")` | **Shipped** |
| Ron | `get_lost_and_found()` | `buy_lost_and_found(rid)` | `woffice` — **10M one-time access** | **Tabled** |

Legacy reference: V1 `gear_ops` ponty quotas + fair-price cap (`G.g * PONTY_MULT`) — parity now in `src/constants.js` `PONTY_*` + `tryPontyBuy`.

## Idle order (current)

```
tryVendorNpc → tryExchangeOne → tryPontyBuy → tryCraftOne → upgrade/combine/gift
```

Ron stays out of this queue until access is intentional and funded.

### Buy rules (Ponty, shipped)

1. **Want list** = `PONTY_WANT` / `GEAR_TARGETS` union.
2. **Quota**: count bag+bank+equipped across party ads; skip if `have >= want`.
3. **Price**: Ponty `price <= fair(G.g, level) * 1.25` and `<= spendableGold()` (above `GOLD_FLOAT_MERCHANT`).
4. **One buy per idle tick**; park immediately if bag tight; never buy `VENDOR_NPC` / exchange fodder as “gear”.

### Ron (when un-tabled)

1. Same want list; prefer items that beat current ads by `score()`; skip vendor-junk names.
2. Prefer bulk shopping after the 10M unlock — not one-off window shopping.
3. Path: `smart_move` into `woffice`; log `ron:list` / `ron:buy`.

## Out of scope

- Auto-crafting fireblade from essence (separate from pickaxe/rod idle craft)
- Listing expensive finds back on stall
