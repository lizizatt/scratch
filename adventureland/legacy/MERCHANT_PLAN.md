# Puppygirl merchant plan

Reliable bank/bag/store inventory, combine when able, list most valuable unheld items. Gear upgrades/delivery live in `gear_ops`.

## Cycle (every `CYCLE_MS`, default 5 min)

```
go bank → park_bag → snap_bank
  → start_gear_session  // hold + deliver gaps
  → run_combine         // COMBINE_PRIORITY (ringsj-first)
  → upgrade_one         // scroll0/scroll1 via gear_ops (GEAR_RISK=1)
  → ponty_buy           // wbook0/shield whitelist under fair cap
  → stock_store
```

`stock_store`: close → bank → park → empty stand → require clear → park → restock expensive-first → plaza `(main, 40, -20)` → open → list bag leftovers.

## Config (`merchant.js`)

```js
var HOLD = [
  ["armorring", 1], ["vitring", 9],
  ["blade", 1], ["staff", 1],
  ["helmet", 1], ["coat", 1], ["pants", 1], ["shoes", 3], ["gloves", 3],
  ["ringsj", 6], ["hpbelt", 3], ["hpamulet", 3], ["wshoes", 2], ["wcap", 1]
];
var GOLD_FLOAT = 100000;
var COMBINE_MAX = 5;
var SALE_MULT = 0.95;
```

- **`HOLD`**: `[name, maxQty, minLevel?]` — `hold_item` protects the highest-level `maxQty` copies across bag/bank/stand; surplus may list. `vitring` is listed explicitly (no BOM auto-expand).
- **No `STOCK`**: stand fill is always highest `rank_val` eligible bank loot.
- Bag policy: park all parkables (pots / `stand0` / locked stay).

## CODE slots

| Slot | Role |
| --- | --- |
| `merchant.js` | Boot, party cmds, stand helpers, combine, `run_cycle` / `run_econ` |
| `merchant_ops.js` | Lens + move/park/`hold_item`/`stock_store` |
| `gear_ops.js` | CM ads, `upgrade_one`, gear delivery session |

Load order: `merchant_ops → gear_ops`. Cap 176 lines/slot.

## Stand rule

Trade slots need the merchant stand **open** to unequip out or `trade()` in. Close the stand for bank/travel (`go_npc` / `park_bag`).
