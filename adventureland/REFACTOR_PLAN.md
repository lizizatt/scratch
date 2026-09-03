# Puppygirl merchant refactor plan

Reliable bank/bag/store inventory, combine when able, list most valuable unheld items.

**Constraints:** CODE ≤176 lines/slot; boot `load_code`s helpers; keep `hold`/`resume`/`hunt`/`grind`; `node adventureland/tests/run.js`; `deploy_mcp.js`. Cap 7 slots. Keep `merchant_ops.js` as the filename.

## Product

1. After every mutating await, re-read via `idx` / `cnt` / `snap_bank` / `sale_clear`.
2. Each cycle: **combine** every eligible compoundable while spending would leave gold ≥ `GOLD_FLOAT`.
3. Then **`stock_store`**: clear the stand and fill with highest `rank_val` items not in `held_set` (also skip pots, `stand0`, locked, compoundables below `COMBINE_MAX`).
4. No crafting in the cycle. No `STOCK`. No Ponty. `HOLD` is the don’t-sell set. Bag policy: park all parkables (no free-slot reserve).

## Target cycle

```
go bank → park_bag → snap_bank
  → run_combine     // stand may still be listed; pull triples from bank/sale into bag
  → stock_store     // sole clearer+lister (see contract)
```

`run_econ()` is combine → `stock_store` (gut the current body; rename to `run_economy` only if moving it into boot for line budget).  
`run_cycle()` is bank arrive + park/snap + that path. It must not call `empty_sale`.

Combine does not require a clear stand. `stock_store` is the only clearer and must not restock unless `sale_clear()`.

## Modules

| Slot | Owns |
| --- | --- |
| `merchant.js` | Config (`HOLD`, `GOLD_FLOAT`, `COMBINE_MAX`, `SALE_MULT`, `CYCLE_MS`, … — no `STOCK`, no `FREE`), `load_code`, party cmds, pots/mluck, `logistics`, `run_cycle` / `run_econ`; sale helpers until a split moves them |
| `merchant_plan.js` | Pure: `idx`, `cnt`, `held_set`, `rank_val`, `sale_price`, `keep_combine`, `snap_bank`, `bank_obj`, `plan_item` (required — `held_set` expands HOLD BOM) |
| `merchant_ops.js` | `go_npc`, `move_ent`, `find_ent`, `park_bag`, `ensure_bag`, `strip_gear`, `wait_q`, `bag_three`, stand fill until split |
| `merchant_combine.js` | `buy_scroll`, `combine_step`, `run_combine`; `compound_once` after Phase 3 |
| `merchant_stand.js` | Contingency only if Phase 2 exceeds 176 |

Boot load order: `plan → ops → combine` (+ `stand` if split).  
Do not load `merchant_craft.js` or `merchant_ponty.js`. Remove both from `UPLOADS` and line-count lists in Phase 1 (same deploy as the cycle/economy cut); delete the files when no test imports them.

## Contracts

```text
buy_scroll(name) → "bought" | "fail"
  if gold - GOLD_FLOAT < vendor cost → fail
  go_npc("upgrade") → buy_with_gold(name, 1); no Ponty fallback

ensure_bag(n) → boolean
  esize >= n after park/strip; else false + game_log

park_bag() → boolean
  at bank and no parkable bag items left (skip pots, stand0, locked);
  false + game_log if bank unreachable or parkables remain
  (today returns true after best-effort — fix with ensure_bag)

empty_sale() → boolean
  close stand; unequip trades; ensure_bag(1) when bag full; true iff sale_clear()

stock_store() → boolean
  close → bank → park_bag → empty_sale → require sale_clear → park_bag
  → restock_sale (rank_val desc; skip held_set, keep_combine, pots, stand0, locked)
  → plaza (main 40,-20) → open_stand → list_sale
  false + game_log on failed step; no restock unless sale_clear()

compound_once(name, level) → "ok" | "fail"
  three + buy_scroll if needed → upgrade NPC → compound → wait_q → re-read

run_combine()
  repeat combine_step while possible
```

Success = inventory re-read matches intent. Catch → `game_log` + re-read + false/`"fail"`.  
`wait_q` stays (~50s poll); stuck queue fails the combine step.

## Phases

Each phase: tests → `deploy_mcp.js` → Stop/Run Puppygirl → one live cycle.

### 1 — Cut craft/Ponty/STOCK + new economy path

**One deploy** (do not unload craft/ponty while `run_cycle` / `run_econ` still call them).

- Delete `FREE` and `STOCK` from `merchant.js`.
- Stop `load_code` of craft and ponty.
- Add `buy_scroll` in `merchant_combine.js`. In `combine_step`, replace `buy_leaf(sc, 0)` with `buy_scroll(sc)`.
- Gut `run_econ` to combine → `stock_store` only (move into boot only if ops needs line budget for Phase 2).
- `run_cycle` = bank + park/snap + that path. Remove every `empty_sale` from `run_cycle`. Delete acquire/craft loops from ops.
- `PLAN_OK`: `run_combine`, `stock_store`, `park_bag`, `buy_scroll`. Not `buy_leaf` / `run_acquire` / `run_craft`. Missing any → load-fail path.
- Remove craft + ponty from `UPLOADS` and line-count lists. Delete those files when unused by tests.
- Replace `MERCHANT_PLAN.md` with this doc’s Product + Target cycle (single product doc). Align README; drop STOCK / craft-in-cycle / free-slot / Ponty claims.
- Tests: drop STOCK, craft-in-cycle, Ponty/`buy_leaf` cases; keep combine + gold scroll buy, `held_set`+BOM, expensive-first restock, empty/park/`stock_store`; happy path is combine + `stock_store`.

### 2 — Honest bag/stand

One deploy, in place: `ensure_bag`; honest `park_bag`; `empty_sale` uses `ensure_bag(1)`; fail-log critical paths; restock only after `sale_clear()`.

If ops exceeds 176: **2a** move stand fns to `merchant_stand.js` with no behavior change (same deploy: delete copies from boot and ops; update `UPLOADS` + line-count lists; load `… → stand`). **2b** honesty in a following deploy.

Tests: `park_bag` false when parkables remain; `ensure_bag` true/false; empty when bag was full; stock refuses until clear. Add delayed-unequip / one-shot `bank_store` fail mocks only if these miss a live failure.

### 3 — `compound_once` (optional)

After honesty is live: shared compound helper in `merchant_combine.js`. Skip if combine is stable and lines are tight.

## Out of scope

Crafting, Ponty (including keeping `merchant_ponty.js` “just in case”), `STOCK`, fighter refactors, TypeScript/bundlers, live websocket CI.
