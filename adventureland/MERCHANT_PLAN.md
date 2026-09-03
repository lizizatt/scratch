# Puppygirl merchant plan

Reliable bank/bag/store inventory, combine when able, list most valuable unheld items.

## Cycle (every `CYCLE_MS`, default 5 min)

```
go bank → park_bag → snap_bank
  → run_combine     // stand may still be listed; pull triples from bank/sale into bag
  → stock_store     // sole clearer+lister
```

`stock_store`: close → bank → park → empty stand → require clear → park → restock expensive-first → plaza `(main, 40, -20)` → open → list bag leftovers.

## Config (`merchant.js`)

```js
var HOLD = [["armorring", 1]];
var GOLD_FLOAT = 100000;
var COMBINE_MAX = 5;
var SALE_MULT = 0.95;
```

- **`HOLD`**: don’t list/sell these names (and their `plan_item` BOM via `held_set`).
- **No `STOCK`**: stand fill is always highest `rank_val` eligible bank loot.
- Bag policy: park all parkables (pots / `stand0` / locked stay).

## CODE slots

| Slot | Role |
| --- | --- |
| `merchant.js` | Boot, party cmds, stand helpers, `run_cycle` / `run_econ` |
| `merchant_plan.js` | Lens: `idx`/`cnt`/`held_set`/`rank_val`/`sale_price`/`plan_item` |
| `merchant_ops.js` | Move/park/`ensure_bag`/`stock_store`/`restock_sale` |
| `merchant_combine.js` | `buy_scroll`, `combine_step`, `run_combine` |

Load order: `plan → ops → combine`. Cap 176 lines/slot.

## Stand rule

Trade slots need the merchant stand **open** to unequip out or `trade()` in. Close the stand for bank/travel (`go_npc` / `park_bag`).

