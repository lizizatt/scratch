# Adventure Land — test coverage audit

**Date:** 2026-09-03 (revised after adversarial review)  
**Runner:** `node adventureland/tests/run.js`  
**Scope:** runtime CODE (merchant + fighters + upgrades + `al_core.js`). Deploy scripts noted only where relevant.  
**Verdict:** Fighter combat/chat/hold is well covered. Merchant post-refactor path (combine → `stock_store`) has strong integration coverage for the regressions that recently bit us. Remaining holes are failure returns, no-craft/Ponty asserts, sale-side combine pull, `ensure_stand` no-op, and mock/`wait_q` honesty — not phantom unit gaps.

---

## 1. Test inventory

| Suite | File | Approx. cases | What it covers |
| --- | --- | ---: | --- |
| Core pure helpers | `tests/test_al_core.js` | ~64 | Ladder, party farm peaks, pots/vendor, combat target pick, priest decision, chat classify, skills, follow, gear classifiers |
| Class scripts | `tests/test_class_scripts.js` | ~70+ (many ×3 classes) | `warrior.js` / `mage.js` / `priest.js` combat, logistics, hold/hunt, potions, dummy skip, party FLOW |
| Gear scripts | `tests/test_gear_scripts.js` | ~36 (11×3 + extras) | `*_upgrade.js` is_gear / find_upgrade / tick / buy basics / wrong class |
| Merchant boot/API | `tests/test_merchant_script.js` | ~21 | Console cmds, listing, cycle throttle, mluck, server hop; plus AL send/bank mock checks via fighters |
| Merchant plan/ops/combine | `tests/test_merchant_plan.js` | ~46 | Plan BOM, park honesty, stand open for trade/unequip, restock, combine, buy_scroll, ensure_bag, stock_store |
| Env/harness | `tests/al_env.js` | (fixture) | VM `load_code`, bank/trade/compound mocks, stand-gated trade/unequip |
| Runner | `tests/run.js` | — | Runs the five suites above in order |

**Not in runner / not in tree:** `grind_ladder.js` is not present under `adventureland/` and is not in `UPLOADS`. Do not track it. `deploy.js` / `deploy_mcp.js` are upload tooling — no unit tests unless deploy mapping regresses.

**Line-budget tests:** `≤176` CODE lines for `warrior.js`, `priest.js`, `mage.js`, `merchant.js`, `merchant_plan.js`, `merchant_ops.js`, `merchant_combine.js` (asserted in class + merchant suites).

---

## 2. Per-source coverage

### 2.1 `merchant.js` — boot, console API, stand, cycle

**Public / important surfaces**

| Symbol | Role |
| --- | --- |
| Config | `HOLD`, `GOLD_FLOAT`, `COMBINE_MAX`, `SALE_MULT`, `CYCLE_MS`, `FIGHTERS`, `HOME` |
| Boot | `load_code(plan→ops→combine)`; `PLAN_OK` iff `run_combine`, `stock_store`, `park_bag`, `buy_scroll` are functions |
| Console API | `hold()`, `resume()`, `hunt(mob)`, `grind()` |
| Stand | `stand_i()`, `open_stand()`, `close_stand()`, `ensure_stand(on)` (no-op if `!!character.stand === !!on`) |
| Sale | `next_trade()`, `sale_clear()`, `list_sale()`, `empty_sale()` |
| Loop | `use_pots()`, `mluck_near()`, `run_econ()` (combine→stock), `run_cycle()` (bank→park→snap→econ), `logistics()` |
| Home | `go_home()`, jail `leave` |

**Covered by**

| Behavior | Tests (patterns) |
| --- | --- |
| hold/resume CM+PM to fighters | `hold() DMs…`, `resume() DMs…` (`test_merchant_script`) |
| hunt/grind → Jazwyn | `hunt() tells…`, `grind() tells…` |
| list_sale: pots/stand0/locked skip; 16 slots; occupied slots | `idle merchant opens stand…`, `skips locked…`, `at most 16…`, `does not re-list…` |
| logistics cycle bank→plaza; throttle | `boot snaps bank…`, `cycle throttles…`, `5-minute cycle empties sale…` |
| mluck level gate | `mluck skipped below…`, `mluck casts at level 40…` |
| go_home / wrong server | `merchant hops to Americas II…` |
| PLAN_OK false → skip econ | `missing plan CODE leaves PLAN_OK false and skips econ` |
| PLAN_OK true (behavioral) | Every happy `logistics()` / `run_cycle` path requires `PLAN_OK`; craft/ponty modules already absent from boot |
| run_econ respects float | `run_econ will not spend the reserved gold float` |
| empty_sale opens stand; bag-full park | `empty_sale and restock open the stand…`, `empty_sale parks mid-clear…` (`test_merchant_plan`) |
| list_sale pricing / HOLD / expensive-first / compoundables | many `list_sale…` / `sale_price…` in `test_merchant_plan` |

**Gaps — missing tests**

- **missing test:** happy `logistics`/`run_cycle` asserts **zero** `auto_craft` / `get_secondhands` / `buy_secondhand` (mocks exist in `al_env.js`; Phase 1 cut not locked by spies).
- **missing test:** cheap explicit `PLAN_OK === true` + `typeof` four helpers after boot (behavior already implied; optional assert).
- **missing test:** `ensure_stand(true/false)` **no-op** when `character.stand` already matches — assert `log.merchant` does **not** gain open/close.
- **missing test:** `run_cycle` returns `false` when `park_bag` returns false (`park fail` log).
- **missing test:** `logistics` skips when `busy` or `character.rip`; jail leave path.
- **missing test:** `list_sale` / `empty_sale` when `stand0` missing (`stand_i() < 0`).
- **not a priority:** `sale_clear` truth table, merchant `use_pots`, `next_trade` — exercised indirectly; do not overrank.

---

### 2.2 `merchant_plan.js` — pure inventory / BOM / pricing

**Exports (global functions after load)**

| Symbol | Role |
| --- | --- |
| `vg`, `rank_val`, `keep_combine`, `sale_price` | Value / sell / combine keep |
| `lv`, `skip_it`, `cscroll` | Helpers / scroll grade by `grades` |
| `bom_add`, `plan_item` | Craft/compound BOM (still used by `held_set`) |
| `snap_bank`, `bank_obj`, `idx`, `cnt` | Inventory index across bag/bank/sale/gear |
| `held_set` | HOLD names + BOM ingredient names |
| `ponty_fair`, `pick_ponty` | **Legacy** — cycle no longer buys Ponty; product frozen no-Ponty |

**Covered by**

| Behavior | Tests |
| --- | --- |
| `plan_item` craft/compound/cycle/upgrade→ponty | `plan_item armorring…`, `vitring+2…`, `detects craft cycles`, `does not compound upgrade-only…` |
| `sale_price` / listing floors | `sale_price never below…`, `list_sale never lists below…`, `list_sale prices at SALE_MULT…` |
| `keep_combine` / bank sell skip | `list_sale and bank_sellable skip compoundables…` |
| `rank_val` prefers `item_value` | **covered:** `bank_sellable ranks by item_value not only catalog g`; also `list_sale prices at SALE_MULT * item_value` |
| `held_set` BOM expansion | **covered:** `list_sale skips HOLD bill-of-material names` |
| `snap_bank` / `_bank` after plaza | **covered:** `boot snapshot still sees bank after cycle returns to plaza` (`character.bank === null`, still `cnt(..., "bank") === 1`) |
| `cnt` after plaza / combine | boot snapshot + combine count asserts |
| `cscroll` via live combine | level-2 path exercised by `run_combine prefers higher levels first` (uses `cscroll1`) |

**Gaps — missing tests**

- **missing test:** direct `cscroll(name, level)` boundaries only if you want a pure table; level-2 path already exercised by combine.
- **missing test:** `skip_it` unit (pots / stand0 / locked) — optional; listing/park already skip these.
- **covered (do not re-list as gaps):** `rank_val` via `bank_sellable ranks by item_value…`; `_bank` via `boot snapshot still sees bank after cycle returns to plaza`; BOM hold via `list_sale skips HOLD bill-of-material names`.
- **quarantine:** three `pick_ponty…` tests — product already “no Ponty” (`REFACTOR_PLAN.md` / `MERCHANT_PLAN.md`). Drop or label HOLD-BOM-only; do not expand Ponty coverage. `plan_item` craft trees remain useful only for `held_set` BOM.

---

### 2.3 `merchant_ops.js` — move / park / stock

**Exports**

| Symbol | Role |
| --- | --- |
| `go_npc` | Close stand → smart_move |
| `move_ent` | gear/sale/bank/bag ↔ bag/bank/sale (stand required for sale) |
| `find_ent`, `bag_three`, `wait_q`, `strip_gear` | Helpers |
| `bank_sellable` | Best bank item for restock (skip held/keep_combine) |
| `park_bag` | Honest: false if parkables remain |
| `ensure_bag` | Park/strip until `esize >= n` |
| `restock_sale` | Batch bank→bag then **one** `list_sale` |
| `stock_store` | Close→bank→park→empty_sale→require `sale_clear`→park→restock→plaza→list |

**`wait_q` note:** current `wait_q` polls then **returns without failing**. `combine_step` always treats post-`wait_q` as success path (`"ok"`). There is **no stuck-queue → fail** behavior in code today. Do not claim stuck-queue coverage until `wait_q` (or callers) implement fail-on-timeout. Separately, `al_env.sleep` clears `character.q` every call, which would also mask any future fail path.

**Covered by**

| Behavior | Tests |
| --- | --- |
| park strips gear; false if leftovers | `park_bag strips…`, `strips rings…`, `returns false when parkables remain` |
| ensure_bag true/false | `ensure_bag true when space`, `false when parkables cannot clear`, `false when bag is locked junk…` |
| restock stuck slot skip; pricing; batch open | `restock_sale skips a stuck…`, `restock_sale prices…`, `restock_sale opens the stand once…` |
| stock_store HOLD skip, happy clear-then-restock, async unequip | `stock_store empties…`, `refuses until fully cleared` (**happy** `ok === true` after clear), `awaited unequip clears…` |
| stand open before unequip/trade | `empty_sale and restock open the stand…` |
| go_npc / move fail | `go_npc fails when smart_move…`, `stale bank retrieve does not report moved` |

**Gaps — missing tests**

- **missing test:** `stock_store` returns `false` + `sale not clear` when clear cannot finish (happy clear-then-restock is **not** the failure contract).
- **missing test:** `stock_store` / `run_cycle` other failure logs (`plaza fail`, `stock no bank`, `stock empty fail`).
- **missing test:** `restock_sale`: N `bank_retrieve` then exactly one `list_sale` (tighten existing opens≤2 test).
- **missing test:** `move_ent` gear → bag success/fail; sale → bag with stand closed.
- **downgrade:** `move_ent` bank→sale is near-dead — `restock_sale` is bank→bag + `list_sale`, not bank→sale. Unit `find_ent` / `bag_three` low value until a live path needs them.
- **do not claim:** stuck `wait_q` failure (code never fails; see note above).

---

### 2.4 `merchant_combine.js` — scrolls + compound loop

**Exports**

| Symbol | Role |
| --- | --- |
| `buy_scroll(name)` | Spend only above `GOLD_FLOAT`; upgrade NPC; `"bought"\|"fail"` |
| `pull_combine` | `ensure_bag` then pull from bank/sale/gear until bag has 3 |
| `combine_step` | Highest level first; buy scroll; compound; `wait_q` |
| `run_combine` | Up to 24 steps |

**Not present (planned optional):** `compound_once` — no implementation, no tests (REFACTOR_PLAN Phase 3).

**Covered by**

| Behavior | Tests |
| --- | --- |
| pull from bank when bag has 1 of 3 | **`run_combine pulls bank copies when bag only has a partial set`** |
| multi-compound to COMBINE_MAX; prefer high level | `compounds duplicates…`, `prefers higher levels first` |
| float blocks scroll buy | `skips when scroll purchase would break float`, `buy_scroll respects GOLD_FLOAT` |
| buy when allowed; walk upgrade | `buy_scroll buys cscroll0…`, `compound path… walks to upgrade NPC` |
| ignore non-compound / at max | `ignores upgrade-only…`, `does not compound at or above COMBINE_MAX` |

**Gaps — missing tests**

- **missing test:** `pull_combine` from **sale** (listed triple) then compound (product text: bank/sale).
- **missing test:** `pull_combine` returns `"fail"` when `ensure_bag` fails.
- **missing test:** `combine_step` continues to next candidate when `buy_scroll` fails.
- **missing test:** compound API throw → `"fail"`.
- **not applicable yet:** stuck queue → fail (`wait_q` never fails in current code).

---

### 2.5 `al_core.js` — shared pure module (Node `require`)

**Exports:** ladder constants; `desired` / `partyFarmTarget`; pots/vendor; `farmable` / `pickCombatTarget`; priest/chat/skills; gear helpers; follow/tank geometry.

**Covered by:** essentially all of `test_al_core.js` (ladder, party farm, pots including `needsVendor` / `needsPots` / `buyPotCounts`, combat pick BUG cases, priest, chat, skills, follow, gear).

**Gaps / architecture**

- Live `warrior.js` / `mage.js` / `priest.js` **do not load `al_core`**. Core tests do not prevent fighter-script drift. Call coverage “High (isolated)” — it does **not** guard live scripts.
- **real drift:** `al_core.priestDecision` has no &lt;35% single-ally partyheal branch; live `priest_tick` does. Prefer a core parity fix or an explicit “core intentionally weaker” note — not a new fighter test (fighter path already covered).
- Pedantic naming gaps (`affordable`, `attCap`, …) are low value; pots/vendor helpers are already tested by name.

---

### 2.6 `warrior.js`

**Important surfaces:** `desired`/`combat` (taunt/charge/cleave/peel/tank anchor), `invite_party`, hunt/grind via `hear_cmd`, hold/restock/`hang_hold`/`offload`, `go_farm` summon ask, logistics, chat FLOW.

**Covered heavily** in `test_class_scripts.js`: combat skills, peel-taunt, far-side stand, dummy skip, invite_party, hunt CM, hold CM/PM, restock bank-not-sell, offload, FLOW potions/upgrade/ding, party lowest pack travel.

**Gaps — missing tests**

- **missing test:** `needs_vendor` when `esize === 0` drives restock without chat rally (core covers `needsVendor(0,…)`; **scripts do not**).
- **missing test:** `handle_death` / jail leave (low priority vs merchant contracts).
- **missing test:** `att_cap` / `farm_ovr` disables max_att gate in combat.

---

### 2.7 `mage.js`

**Distinct:** `try_port` / `at_pack` / `port_no`, follow 180, no `invite_party`, no summon ask on `go_farm`, no hunt in `hear_cmd`.

**Covered:** magiport MP/pack/busy cases; assist lead; step off tank; hold; restock; FLOW.

**Gaps**

- **missing test:** `follow_lead` when leader on other map.
- **missing test:** `needs_vendor` when `esize === 0` (same as warrior).
- **missing test:** `handle_death`, jail (low priority).

---

### 2.8 `priest.js`

**Distinct:** `priest_tick` (revive / partyheal / heal), follow 80, summon ask on travel, combat curse; lead/tank target assist.

**Covered:** revive, partyheal MP gate, single heal, no beeline OOR, skip while smart_moving, idle when lead has no target, curse MP, FLOW.

**Priest gaps (corrected)**

- **covered:** emergency single-ally partyheal (&lt;35%) — `priest partyheals in an emergency` (Sarene `40/320`, one ally; hits `lowest.hp < max*0.35`).
- **real drift:** `al_core.priestDecision` has no &lt;35% branch (only `hurt >= 2`); live `priest_tick` does. Prefer a core parity fix or an explicit “core intentionally weaker” note — not a new fighter test.
- **tank fallback:** dead while `TANK === LEADER` (`both "Jazwyn"`); existing **`priest.js idle when lead has no target even if mage does`** is the contract. Do not invent a second-tank scenario unless config changes.
- **missing test:** `needs_vendor` when `esize === 0`; `handle_death` / jail (low priority).

---

### 2.9 `warrior_upgrade.js` / `mage_upgrade.js` / `priest_upgrade.js`

**Surfaces:** `is_gear`, `has_piece`, `find_upgrade`, `buy_basics`, `ensure_scroll`, `strip`/`wear`, `tick`/`loop`.

**Covered by** `test_gear_scripts.js` (per-class): loads, is_gear accept/reject, find_upgrade, locked, Need gold, upgrade once, has_piece equipped, done stops loop, buy basics once, wrong class; wand/blade extras.

**Gaps**

- **missing test:** `ensure_scroll` buys `SCROLL_BUY` when missing; `"No scrolls"` when gold &lt; `price * SCROLL_BUY + MIN_GOLD` (MIN_GOLD tick gate ≠ scroll reserve; ticks usually ship with scrolls already).
- **missing test:** upgrade failure / `character.q.upgrade` wait (sleep mock clears `q`).
- **missing test:** rip → respawn timeout path.

---

## 3. Recent regressions — coverage status

| Regression / contract | Status | Evidence |
| --- | --- | --- |
| Stand must be **open** for trade / trade-unequip | **Covered** | `empty_sale and restock open the stand before trade-slot moves`; al_env throws `stand_closed` |
| `ensure_stand` **no-op** when already open/closed | **Missing** | No assert that open/close is skipped when `!!character.stand === !!on` |
| `restock_sale` **batch** pull then single `list_sale` | **Partial** | `restock_sale opens the stand once after banking pulls` (opens ≤2); tighten to N retrieve + exactly one list |
| Combine **pull from bank** when bag partial | **Covered** | `run_combine pulls bank copies when bag only has a partial set` |
| Combine **pull from sale** | **Missing** | Product allows bank/sale; only bank partial covered |
| `park_bag` honesty (false if parkables remain) | **Covered** | `park_bag returns false when parkables remain` |
| `PLAN_OK` without craft/ponty | **Mostly covered** | Happy `logistics`/`run_cycle` require `PLAN_OK`; craft/ponty modules absent. Add cheap explicit assert of four helpers if desired. **Still missing:** assert cycle never calls `auto_craft` / `get_secondhands` / `buy_secondhand`. |
| Restock only after `sale_clear` | **Partial** | Happy clear-then-restock covered. **Missing:** `stock_store` returns `false` + `sale not clear` when clear cannot finish. |
| Gold float on scroll buy | **Covered** | `buy_scroll respects…`, combine skip float |

---

## 4. Mock fidelity (`tests/al_env.js` vs live AL)

| Area | Mock behavior | Gap vs live / risk |
| --- | --- | --- |
| `character.stand` | Set by `open_merchant` / `close_merchant`; **not** initialized in `makeCharacter` (undefined/falsy) | Live AL often has stand state after prior open; ensure_stand no-op relies on `!!` |
| Trade / unequip trade\* | Require `character.stand` or throw `Can't equip` | Good regression catch; live may also need stand **equipped** in bag |
| `bank_store` / `bank_retrieve` | Map must be `bank`; updates esize; syncs `_bank` | No delayed/async bank lag |
| Bank full | Logs `bank_full`, leaves item in bag | Exercised indirectly by park_bag false |
| `compound` | Instant success + sets `q.compound` | Always succeeds; no fail RNG |
| `sleep` | **Clears `character.q` every sleep** | Blocks honest queue tests; also masks that `wait_q` **never fails in production code** |
| `smart_move` | Instant teleport; clears `bank` off bank map | No pathing fail except `env.moveFail` |
| `can_use` / cooldowns | Always usable / never on CD | Over-optimistic vs live |
| `item_value` | Equals vendor `g` unless tests override | OK when tests stub higher value |
| Ponty / `auto_craft` | Still mocked | Useful for **negative** spies (cycle must not call them); do not grow Ponty feature tests |
| `load_code` | Sync `vm.runInContext` from disk | Matches deploy composition |
| Intervals | Stripped on load | Tick loops not simulated over time |
| `open_merchant(slot)` | Does not verify `items[slot]` is stand0 | Live may fail without stand |

**Highest-fidelity debt:** stop always clearing `q` in `sleep`, then either implement `wait_q` fail-on-timeout or document that combine never fails on stuck queue.

---

## 5. Prioritized gaps (post-adversarial)

### P0 — merchant correctness (post-refactor contracts)

1. Happy `logistics`/`run_cycle`: zero `auto_craft` / Ponty secondhand activity.
2. `run_cycle` returns false + `park fail` when `park_bag` is false.
3. `stock_store` returns false + `sale not clear` when stand cannot fully clear.
4. `pull_combine` from sale (+ `ensure_bag` failure → `"fail"`).
5. `ensure_stand` no-op when state already matches (no extra open/close).

### P1 — tighten / mock honesty

6. `restock_sale`: N retrieves then exactly one `list_sale`.
7. `combine_step` continues when `buy_scroll` fails.
8. Fix `al_env.sleep` clearing `q`; then decide `wait_q` fail vs document no-fail.

### P2 — fighters / upgrades (after merchant)

9. Fighter `needs_vendor` when `esize === 0` drives restock.
10. Upgrade `ensure_scroll` buy/`SCROLL_BUY` reserve / `"No scrolls"`.
11. Cheap boot `PLAN_OK===true` + four helper typeof asserts.

**Explicitly deprioritized / drop**

- `idx()` / `cscroll` pure tables, `sale_clear` truth table, `handle_death` / jail everywhere, `al_core.desired === warrior.desired` parity as P0.
- Priest tank-fallback tests (`TANK === LEADER` → dead).
- Expanding `pick_ponty` coverage — quarantine or delete those three tests.
- `move_ent` bank→sale until a live path uses it.
- Claiming stuck-queue coverage while `wait_q` never fails.

---

## 6. Summary matrix

| File | Coverage | Notes |
| --- | --- | --- |
| `merchant.js` | Medium–High | Console + cycle happy path strong; ensure_stand no-op & no-craft spies missing; PLAN_OK fail path covered, success behavioral |
| `merchant_plan.js` | Medium–High | plan_item/pricing/rank_val/held/snap covered; quarantine `pick_ponty` |
| `merchant_ops.js` | High | park/ensure/stock happy path strong; **failure returns** and restock batch count thin; `wait_q` never fails |
| `merchant_combine.js` | High | bank partial pull covered; sale pull & ensure_bag fail missing |
| `al_core.js` | High (isolated) | Not wired to live scripts; priestDecision drifts from `priest_tick` |
| `warrior.js` | High | Combat/hold/FLOW excellent; `esize===0` vendor thin |
| `mage.js` | High | Magiport cases excellent |
| `priest.js` | High | Heal/revive/&lt;35% partyheal covered; tank fallback dead (`TANK===LEADER`) |
| `*_upgrade.js` | Medium–High | Happy upgrade path; `ensure_scroll` buy/reserve thin |
| `deploy_mcp.js` | None | OK (tooling) |

**Bottom line:** Hard merchant lessons (stand open for trade/unequip, honest park, clear-before-restock happy path, combine pull from bank, gold float) are encoded. Closest remaining holes: **no-craft/Ponty spies**, **`run_cycle`/`stock_store` false returns**, **`pull_combine` from sale**, **`ensure_stand` no-op**, and **`wait_q`/sleep honesty**.

---

## Implement next

```
[ ] logistics/run_cycle happy path: no auto_craft, no get_secondhands/buy_secondhand
[ ] run_cycle returns false when park_bag false (park fail)
[ ] stock_store returns false and does not restock when empty_sale cannot clear (stock empty fail)
[ ] ensure_stand no-op when character.stand already matches desired on/off
[ ] pull_combine from sale trade slot into bag then compound
[ ] pull_combine returns "fail" when ensure_bag false
[ ] restock_sale: N bank_retrieve then exactly one list_sale (tighten existing opens≤2 test)
[ ] combine_step continues to next candidate when buy_scroll fails
[ ] al_env.sleep does not always clear character.q; then decide wait_q fail vs document no-fail
[ ] fighter needs_vendor when esize===0 drives restock (warrior.js)
[ ] ensure_scroll buys SCROLL_BUY when missing; "No scrolls" when gold < price*SCROLL_BUY+MIN_GOLD
[ ] PLAN_OK===true after boot + typeof run_combine/stock_store/park_bag/buy_scroll (cheap assert)
```
