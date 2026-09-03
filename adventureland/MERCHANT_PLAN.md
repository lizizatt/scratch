# Puppygirl merchant plan

Replace the old `TODO` notes. Current `merchant.js` stays the plaza stand / `hold()` / `resume()` loop. Acquire, Ponty, craft trees, and bank↔stand restock live in extra CODE slots loaded via `load_code`.

## Decisions

| Topic | Choice |
| --- | --- |
| Data source | Adventure Land MCP (`search_game_data`, `get_game_data`, `get_code_method`). Do not hardcode recipes except as test fixtures copied from MCP. |
| Ponty buy | Walk to Ponty, `get_secondhands()`, then `buy_secondhand(rid)`. Cap: listing price ≤ `G.items[name].g * 1.25`. Prefer `buy_with_gold(name, q)` only for real NPC shop stock (pots, stand, etc.). |
| Sort | Vendor gold `G.items[name].g`. Hold/stock: cheapest first. Sale-box restock: most expensive bank item that is not held. |
| Craft | Generic `plan_item(name)` → tree, bill of materials, ordered ops. Ring of Armor is the first consumer, not a one-off. Heavy tests. |
| Empty stock list | After hold work, skip stock acquire. Still run sale-box restock from bank. |
| CODE budget | Thin `merchant.js` (≤176 lines). Logic in extra slots, e.g. `merchant_plan.js` / `merchant_ops.js`, `load_code`d from puppygirl. |
| Gold | Keep a **100k** float. Never spend below it on Ponty / compound / craft. |
| Stand | `close_merchant` before bank / Ponty / Cole. Reopen at plaza `(40, -20)` after. |

## MCP discovery

Verified against live MCP (`get_game_data` version 6178) and `list_code_methods`:

```
search_game_data({ query: "Ring of Armor", section: "items" })
get_game_data({ section: "items", name: "armorring" })
get_game_data({ section: "craft", name: "armorring" })
search_game_data({ query: "Ponty", section: "npcs" })   → secondhands
search_game_data({ query: "Cole", section: "npcs" })    → mcollector
get_code_method({ name: "get_secondhands" })
get_code_method({ name: "buy_secondhand" })
get_code_method({ name: "buy_with_gold" })
get_code_method({ name: "auto_craft" })
get_code_method({ name: "compound" })
```

`buy_with_gold` is NPC-shop gold. Ponty is recovered listings keyed by `rid`. Using `buy_with_gold("armorring")` will not buy from Ponty.

### Ring of Armor (first target)

`G.craft.armorring`:

```json
{
  "items": [[1, "snakefang"], [1, "lotusf"], [1, "vitring", 2]],
  "cost": 0,
  "quest": "mcollector"
}
```

| Display | id | vendor `g` |
| --- | --- | ---: |
| Ring of Armor | `armorring` | 180000 |
| Ring of Vitality | `vitring` | 24000 |
| Lotus Flower | `lotusf` | 12000 |
| Snake Fang | `snakefang` | 1200 |

The third ingredient is **one `vitring` at level 2**, not two unleveled rings. Level 2 accessories come from `compound` (three same-level pieces + scroll). The generic planner must expand `[qty, name, level]` into compound steps, not skip to Ponty for a +2 that may not exist.

Cole is `G.npcs.mcollector` (`quest: "mcollector"`). Craft at Cole with `auto_craft("armorring")` once bag stacks match the recipe (server wants each ingredient in one slot).

## Lists (top of merchant CODE)

```js
var HOLD = [["armorring", 1]];
var STOCK = [];
var GOLD_FLOAT = 100000;
var PONTY_MAX = 1.25;
```

Each entry is `[item_id, quantity]`. Quantity is count of matching items in the **target inventory** (hold → bank, stock → sale box). Level-sensitive recipes are not list rows; the planner owns levels.

## Inventories

Scan on boot and before each acquire:

1. **Bag** — `character.items`
2. **Bank** — `character.bank` packs (`items0`…) while on `bank`
3. **Sale box** — `character.slots.trade1` … `trade16`

An internal index: `{ name, level, qty, where: "bag"|"bank"|"sale", loc }`.

Pots and `stand0` are never hold/stock/sale-restock candidates.

## Acquire

`acquire(name, qty, dest)` where `dest` is `"bank"` (hold) or `"sale"` (stock).

Iterative, one step then return so the loop can move:

1. Already enough in `dest` → success.
2. Enough elsewhere → move (untrade / bank_retrieve / bank_store / `trade`). Close stand before moving.
3. Else Ponty: `smart_move` to secondhands, `get_secondhands()`, pick cheapest listing with matching `name` (and required `level` if set) priced `<= G.items[name].g * PONTY_MAX`, spend only `character.gold - GOLD_FLOAT`, `buy_secondhand(rid)`.
4. Else if `G.craft[name]` (or a compound parent) can be planned and we can start the next op → run one op (buy ingredient, compound, `auto_craft`).
5. Else fail. Merchant loop **stops this pass** and goes to sale-box restock.

Do not buy a whole BOM up front. Buy / move / craft one step, rescan, repeat. Fail if Ponty has nothing affordable or gold is at the float.

## Craft planner

`plan_item(name, level)` returns `{ tree, bom, ops }` from `G.craft`, `G.items[].compound`, and MCP-checked CODE methods.

- BOM is flattened leaves: `{ name, level, qty }` after expanding crafts and compound (`three of level N` + scroll → `level N+1`).
- Ops are ordered: acquire leaves → compound upgrades → Cole/Xyn `auto_craft`.
- Missing `G.craft` and no Ponty path → unplannable (fail acquire).
- Tests: armorring tree (fang + lotus + vitring+2), vitring+2 expands to three +0 rings + scrolls, cycle detection, “already in bank” short-circuit, Ponty over max price, gold float block, wrong inventory move, Cole `auto_craft` after ingredients stacked.

Ring of Armor is the first integration: `acquire("armorring", 1, "bank")` using this planner, not a special `get_ring_of_armor`.

## Merchant loop

Keep today’s: home `US/II`, jail leave, plaza stand, mluck, `hold()` / `resume()`.

Replace “list every non-pot” as the only economy with:

1. **Boot** — close stand, bank once (still leave `FREE` bag slots), scan bag/bank/sale, plaza.
2. **Acquire hold** — sort `HOLD` by vendor `g` ascending. For each, try `acquire`. Success → next. Fail → stop hold/stock acquire this tick.
3. **Acquire stock** — same for `STOCK` (empty → no-op).
4. **Restock sale box** — among bank items **not** reserved by `HOLD`, repeatedly: fill empty trade slots, else replace the cheapest listed item with a more expensive bank item. Then plaza, `open_merchant`, list.
5. Close stand whenever leaving plaza for bank / Ponty / Cole.

## Files

| File | Role |
| --- | --- |
| `merchant.js` | Boot, servers, hold/resume, plaza, mluck, `load_code` helpers, call into planner/ops |
| extra CODE slot(s) | Index, Ponty, planner, acquire, sale restock |
| `tests/test_merchant_script.js` | Stand / hold / bank pull (existing) |
| `tests/test_merchant_plan.js` | Planner, BOM, Ponty price cap, float, inventory moves, armorring fixture |
| `tests/al_env.js` | Mocks: `get_secondhands`, `buy_secondhand`, `auto_craft`, `compound`, craft table |

`deploy_mcp.js` must upload the extra slot(s) as well as `merchant.js`.

## First slice (after this plan)

1. Fixture `G.craft.armorring` + item `g` values in tests (copied from MCP).
2. `plan_item("armorring")` unit tests (tree / BOM / ops, including vitring+2).
3. Ponty helper: listing filter + `g * 1.25` + float.
4. Wire acquire + loop behind `load_code` without blowing the 176-line slot.
