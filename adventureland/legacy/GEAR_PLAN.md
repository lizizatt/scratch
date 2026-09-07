# Party gear — opportunistic plan

Merchant upgrades (bag) then delivers on hold; fighters equip + advertise over CM. Cap **7** CODE slots. ≤176 lines/slot.

**Refresh gate:** loadouts below may be stale. Before any live ops, refresh worn + bank + stand + gold via MCP/`mainframe_get_character`. Do not execute from this table alone.

## Product decisions

| Choice | Decision |
| --- | --- |
| **Primary owner** | **Merchant upgrades then delivers.** Gold is on Puppygirl; fighters `offload` to ~1k. Funded fighter bench is **not** the automation path (manual escape only). |
| **`*_upgrade.js`** | **Do not reuse.** Archive offline. New grade-gated helper only. |
| **UNIQUE destroy** | **`GEAR_RISK=1`:** UNIQUE may upgrade (scroll0 allowlist + scroll1 at grade1 up to `MAX_SAFE1`). Candy/carrot still denied. Failures destroy. |
| **Shield vs carrotsword** | **Deferred.** No auto dual-wield dogma. |
| **Transport** | Gear census/delivery = **`send_cm` only.** Merchant is out of combat party — no `partym` / `~g`. |

### Prior review — kept killed

| ID | Still killed by |
| --- | --- |
| bank-eats-gear | `bank_dump` rewritten to `!is_keep`; `equip_pending` first |
| gold-drain | Merchant spends gold/scrolls |
| upgrade-destroys | scroll0 gate + preview + UNIQUE locked until `GEAR_RISK=1` |
| naive-upgrade-script | new `pick_upgrade`; candy/carrot denied |
| strip-loses-accessories | merchant bag-only upgrade; no fighter strip/wear |
| no-delivery-pipe | CM protocol + merchant `on("cm")` |
| hold-name-clog | qty quotas in rewritten `held_set` |
| score-lies | `item_properties` / level-scaled fields — **never** `item_value` for equip |
| census-impossible | fighter CM ads; merchant listens CM |
| dual-wield-dogma | deferred |
| stale-snapshot | refresh gate |

## Snapshot (illustrative)

Empty gaps at last audit: **Sarene rings**, **Jazwyn gloves**, **Zarook offhand**.

- **Jazwyn 46:** candycanesword+0, carrotsword+0 shiny, eears+0, epyjamas+0, pants+5, eslippers+0, empty gloves, stramulet+1, hpbelt+0, ringsj+2; bag ringsj+0
- **Sarene 46:** mushroomstaff+5, rednose+0, coat+1, pants+3, shoes+3, gloves+3, skullamulet+0, intbelt+0, empty rings
- **Zarook 46:** staff+4, empty offhand, xmashat+4, wattire+0, pants+5, wshoes+0, gloves+0, hpamulet+2, hpbelt+0
- **Puppygirl 23:** ~2.08M gold; bank has hpbelt+1, shoes+4, ringsj, hpamulet×2, …

## Slot budget — commit (before Phase 1)

Line counts today: `fighter_core` 171, `merchant` 171, `merchant_plan` 118, `merchant_ops` 150. **No “prefer no 8th” hedge.**

**Commit: free CODE name `merchant_plan` → add `gear_ops`.**

Exact merge:

1. **Delete** `merchant_plan` from `UPLOADS` / `load_code`.
2. **Inline into `merchant_ops.js`** only what stand/combine still need, compressed ≤176 total for that file:
   - Keep: `vg`, `rank_val`, `sale_price`, `keep_combine`, `idx`, `cnt`, `cscroll`, `snap_bank`/`bank_obj` (or equivalent), **rewritten quota `held_set`**.
   - **Drop from CODE:** `plan_item`, `bom_add`, `ponty_*`, `pick_ponty`. HOLD BOM auto-expand is gone — list ingredient names explicitly in `HOLD` / `GEAR_HOLD` if still needed (e.g. `vitring` for armorring).
3. Compress `merchant_ops` park/stock dead paths as needed so **ops+inlined plan ≤176**.
4. New slot **`gear_ops.js`** (≤176): merchant CM listener, ads store, `pick_upgrade` / `upgrade_one`, deliver state machine, combine priority helper for party accessories.
5. `merchant.js` load order: `load_code("merchant_ops"); load_code("gear_ops");`
6. Compress `fighter_core` **in Slot-0** until Phase 1–2 gear surface fits **≤176**. Honest budget: keep/TTL + `equip_pending` + `score` + `gear_ad` + `hear_cmd` gear branch ≈ **50–70** dense LOC — not “≥25”. If compress cannot free that much, **cut Phase 1 scorer** to empty-slot / same-name-higher-level only (no fat `item_properties` path) until headroom exists. Slot-0 accept fails closed if either file exceeds 176.

`deploy_mcp.js` UPLOADS after change (still 7):

`warrior`, `mage`, `priest`, `merchant`, `merchant_ops`, `gear_ops`, `fighter_core`.

**Slot-0 test migration:** update `tests/run.js` / `test_merchant_plan.js` that `load_code`/`require` `merchant_plan`; quarantine or rewrite `plan_item`/BOM-hold tests; add `al_env` upgrade preview stub (`chance` number).

## Architecture

```text
HOME = US/II (hold + gear meet)     FARM = US/III (grind)

fighter_core:
  equip_pending() → bank_dump() using !is_keep
  hear_cmd: hold/hunt/grind (unchanged) + gear_* objects
  send_cm(MERCHANT, gear_ad) on interval / change while hold or every 20s
  on gear_offer: equip → send_cm gear_got {ok:1|0}

merchant + gear_ops:
  character.on("cm", hear_gear)
  cycle: combine (ringsj-first) → upgrade_one → stock_store
  on gear session: interrupt cycle → deliver only while fighters hold on HOME
```

## Contracts

### `is_keep` / `bank_dump` (fighter_core) — MUST rewrite dump

Today: `bank_dump` stores everything `!is_pot`. **Expanding `is_keep` alone does nothing** until dump uses it.

```text
gift_ttl = {}   // offerId → { name, expire_ms }; set on gear_offer; TTL 120s
                // is_keep matches it.name against any non-expired gift_ttl entry

is_keep(it):
  if !it → true
  if is_pot(it) || it.name === "stand0" || it.name === "tracker" || it.l → true
  if /^scroll\d$/.test(it.name) || /^cscroll\d$/.test(it.name) → true
  if any gift_ttl[id].name === it.name && Date.now() < gift_ttl[id].expire_ms → true
  // this-visit only: class-legal bag piece that scores > worn for its slot
  if pending_better(it) → true
  else → false
  // NOT: it.level > 0 forever  (bag deadlock)

equip_pending():
  for each bag index with item it:
    targets = candidate_slots(it)   // see below
    best = null
    for s in targets:
      worn = character.slots[s]
      sw = worn ? score(worn, s) : 0   // empty slot baseline = 0
      if score(it, s) > sw && (!best || sw < best.sw):
        best = { slot: s, sw }
    if best: equip(i, best.slot); clear gift_ttl for matching offer
  // call at start of restock bank visit AND on gear_offer

candidate_slots(it):
  t = G.items[it.name].type / wtype
  if ring → ["ring1","ring2"]   // empty first via score 0; equal-level second ring still wins vs empty
  if amulet → ["amulet"]; belt → ["belt"]; etc.
  weapons/armor → single matching equipment slot
```

`pending_better(it)` is true iff `candidate_slots` finds any slot with `score(it) > score(worn||empty)`.

```text
bank_dump():
  if map !== "bank" return
  equip_pending()
  for i, it in items:
    if it && !is_keep(it):
      try bank_store(i)
```

### Score (equip only)

```text
score(it, slot, ctype):
  // FORBIDDEN for equip: item_value, calculate_item_properties
  props = typeof item_properties === "function" ? item_properties(it) : null
  if props:
    weapon → props.attack (gate wtype/ctype)
    armor  → (props.armor||0) + (props.resistance||0) + 0.02*(props.hp||0)
    amulet/belt/ring → class primary (str/int/vit from props)
  else:
    level-scaled G.items[it.name] fields × (1 + 0.08*(it.level||0))  // proxy only
  refuse wrong class, locked swap-down, same-name lower level
```

`item_value` remains OK for **merchant sale ranking** (`rank_val`) — not for equip.

### CM shapes (JSON objects via `send_cm`)

All gear messages are **objects** (not strings). Merchant already sends `{hold:1}`, `{hunt:k}`, `{grind:1}`. Fighters already `character.on("cm", hear_cmd)`.

| Msg | Dir | Fields |
| --- | --- | --- |
| `gear_ad` | F→M | `{ gear_ad: 1, name, esize, slots: { mainhand: "n@lv"\|"-", offhand, helmet, chest, pants, shoes, gloves, cape, belt, amulet, ring1, ring2 } }` |
| `gear_offer` | M→F | `{ gear_offer: 1, name, level, slot, id }` (`id` = offer uuid string) |
| `gear_got` | F→M | `{ gear_got: 1, id, name, level, slot, ok: 0\|1 }` |
| `gear_busy` | M→F | `{ gear_busy: 1 }` optional — merchant starting session |

**esize:** only `character.esize` on the advertising fighter, carried in `gear_ad.esize`. **Ban** reading esize from vision/`get_player`.

### `hear_cmd` object handling (fighters)

```text
hear_cmd(m):
  if !m return
  from = m.name || m.from; must be MERCHANT (case-insensitive) for commands
  d = m.message != null ? m.message : m.data
  if typeof d === "string":
    // existing: hold:1 / hold:0 / hunt: / grind / JSON.parse fallback
    ... unchanged ...
  if typeof d === "object" && d:
    if d.gear_offer: handle_gear_offer(d); return
    if d.gear_busy: return  // optional log
    // existing:
    if d.hold != null: set_hold...
    if d.hunt != null || d.grind: set_hunt...
    return
```

Do not require gear messages to be strings. Do not break merchant `send_cm(FIGHTERS, {hold:1})`.

### Merchant CM listener (new — required)

Today merchant has **no** `character.on("cm")`. Add in `gear_ops` boot (called from merchant):

```text
character.on("cm", hear_gear)
hear_gear(m):
  d = m.message != null ? m.message : m.data
  if typeof d !== "object" || !d return
  from = m.name || m.from
  if d.gear_ad && in_arr(from, FIGHTERS): store ads[from] = d
  if d.gear_got: resolve_offer(d)
```

Ads never use party chat.

## Delivery session (HOME only)

Fighters farm **US/III** unless hold. Delivery **only** while all targets are on hold at **HOME US/II**.

### Who triggers hold

| Trigger | Who |
| --- | --- |
| Operator | merchant console `hold()` → existing `tell(1)` CM/PM |
| Auto gear session | merchant `start_gear_session()` → `hold()` then wait ads |
| End | merchant `resume()` after offers resolved or aborted |

Fighters do **not** self-`!hold` for routine delivery (operator/`!hold` still works).

### State machine

```text
states: idle → holding → meet → offer_sent → (acked | timeout) → next | resume

start_gear_session(targets):
  if busy cycle: set interrupt flag; finish current await safely; skip stock_store until session ends
  hold()                          // CM {hold:1} to all FIGHTERS
  wait until each target: ad received && same server HOME && map main/bank/nearby
  for each planned gift (bank retrieve → bag):
    if ads[who].esize < 1: skip / ask them equip_pending via… they already dump-keep; wait next ad
    smart_move meet point main (e.g. near potions/upgrade)
    send_item(who, bag_i, 1)
    send_cm(who, { gear_offer:1, name, level, slot, id })
    state = offer_sent; offer_owner = merchant bag→in-flight
    wait ≤ OFFER_MS (20000):
      gear_got ok:1 → clear; done
      gear_got ok:0 → retrieve if still in their bag impossible; re-bank from merchant if send failed; else log
      timeout → send_cm resume not yet; mark failed; item may be in their bag — they equip_pending on next bank; merchant does not re-send same id
  when queue empty or abort:
    resume()                      // {hold:0}
    clear interrupt; allow stock_store
```

**Re-bank owner:** items still in merchant bag after failed send → `bank_store`. Items successfully `send_item`'d are fighter-owned; merchant does not pull back (AL has no remote reclaim). Timeout after successful send: fighter `gift_ttl` keeps them out of dump until equip or TTL expiry.

**Interrupt:** `run_cycle` / `run_econ` check `gear_session`; if set, do not `stock_store` / do not wander plaza open-stand until session clears. Combine may run before session starts (same cycle) or be deferred one cycle.

## Upgrade (merchant bag, `gear_ops`)

```text
SCROLL0_ALLOW = [
  "pants","coat","gloves","shoes","helmet","staff",
  "eears","epyjamas","eslippers","wattire","wshoes","wcap"
]
SCROLL1_DENY = ["candycanesword","carrotsword"]  // also skip xmashat when level≥4 (grade flips)
UNIQUE = ["epyjamas","eears","eslippers","mushroomstaff","candycanesword","carrotsword","xmashat"]

eligible(it):
  upgradeable && !it.l && item_grade(it)===0 && level < MAX_SAFE(5)
  && name in SCROLL0_ALLOW && name not in SCROLL1_DENY
  && (GEAR_RISK===1 || name not in UNIQUE)
  && !(name==="xmashat" && (it.level||0) >= 4)

upgrade_one:
  pick eligible lowest level (or party-need from ads)
  ensure scroll0 in bag (buy with gold above GOLD_FLOAT)
  preview = await upgrade(i, scroll_i, null, true)   // calculate only
  // Gate on real preview fields (al_env stub + one live check):
  //   skip if preview failed/rejected OR preview.chance == null OR chance < MIN_CHANCE (default 0.9)
  // Do NOT invent preview.success as “will succeed.”
  await upgrade(i, scroll_i)
  wait q.upgrade
  // fail DESTROYS item — UNIQUE defaults off via GEAR_RISK
```

## HOLD quotas — rewrite listing skip

Today `held_set` does `s[name]=1` (qty ignored).

**Single API (no either/or):**

```text
HOLD / GEAR_HOLD entries: [name, maxQty, minLevel?]  // merge into one HOLD list in merchant.js
hold_item(it) → bool   // true = do not list/sell this piece
  entries for name: maxQty, minLevel
  pool = all bag+bank+stand copies of name with level >= minLevel
  sort pool by level desc (keep best)
  protected = first maxQty of pool
  if it is in protected → true (hold)
  else → false (list surplus, lowest level naturally outside protected)
```

`list_sale` / `bank_sellable` MUST call `hold_item(it)`. Delete `held_set` map API once call sites migrated (Phase 4 / Slot-0). No `skip[name]` truthy map.

## Combine priority

```text
COMBINE_PRIORITY = ["ringsj","hpbelt","hpamulet","stramulet","intbelt","rednose", ...]
combine_step: among cand with cnt>=3, sort by priority index then higher level
armorring / vitring compounds only if no higher-priority party name is combinable
```

Empty ring slots: **equip** bank `ringsj` via delivery **before** waiting for +2 compound.

## Phases

Tests green → `deploy_mcp.js` → Stop/Run. Refresh snapshot before live work.

### Slot-0 — merge plan → ops, add `gear_ops` stub

- Execute slot budget commit (delete `merchant_plan` name, inline keepers, add `gear_ops` empty boot + `on("cm")`).
- Inline keepers include rewritten **`hold_item`** (not old `held_set`).
- Compress `fighter_core` until Phase 1–2 surface fits (target free **≥55** lines, or adopt slim scorer cut).
- Preflight: if inlined ops would exceed 176 before cuts, list exact ops functions to delete/merge in the PR — fail Slot-0 rather than ship dual plan+ops.
- Note: `merchant.js` is 171/176 — gear_session interrupt hooks must be tiny or live in `gear_ops` only.

**Accept:** `deploy uploads seven names including gear_ops not merchant_plan`; `merchant_ops ≤176`; `gear_ops ≤176`; `fighter_core ≤176 with gear stubs linked`; merchant_plan tests migrated/quarantined.

### 1 — Keep + equip_pending + bank_dump rewrite

- Implement `is_keep` (TTL gifts, not level>0 forever), `equip_pending`, **`bank_dump` skips `!is_keep`**.

**Accept:**

- `bank_dump stores junk but keeps pots scrolls ttl gifts`
- `bank_dump calls equip_pending before store`
- `is_keep false for leveled junk coat after TTL` (no permanent level>0 keep)
- `equip_pending equips better ringsj into empty ring`

### 2 — CM ads + hear_cmd gear_* + merchant hear_gear

- Fighters `send_cm(MERCHANT, gear_ad)` with `esize` + slots.
- `hear_cmd` branches on object `gear_offer` without breaking `{hold,hunt,grind}`.

**Accept:**

- `hear_cmd hold object still sets hold`
- `hear_cmd gear_offer equips and replies gear_got`
- `merchant hear_gear stores gear_ad esize from CM not vision`
- `gear_ad includes character.esize field`

### 3 — Delivery session on hold HOME

- `start_gear_session` → hold → meet → offer → ack/timeout → resume.
- First live fills: Sarene rings, Jazwyn hpbelt+1 / gloves, Zarook shoes from bank as available.

**Accept:**

- `delivery aborted when fighter not hold`
- `offer timeout does not double-send same id`
- `resume sent when queue done`
- `run_cycle skips stock_store during gear_session`

### 4 — Accessories first (compound + equip rings)

- Rewrite listing skip via `hold_item` (delete `held_set`); `COMBINE_PRIORITY` ringsj-first.
- Wire `upgrade_one` into `run_econ` after combine (Phase 5); Phase 4 delivers rings before that burns cycles.
- Deliver/equip empty rings **in this phase** (not deferred behind armor scroll0). `equip_pending` must fill `ring1` then `ring2` via empty-slot baseline 0.

**Accept:**

- `hold_item protects maxQty highest-level copies lists lower surplus`
- `combine_step prefers ringsj over vitring when both triples exist`
- `empty rings filled from bank ringsj via gear session (both ring slots)`
- `list_sale/bank_sellable use hold_item not held_set map`

### 5 — Merchant scroll0 `upgrade_one`

- Allowlist + grade0 + preview; UNIQUE skipped unless `GEAR_RISK=1`.
- Priority: Sarene coat/pants/gloves/shoes → Zarook staff+4→+5, gloves, wshoes → Jazwyn non-UNIQUE allowlist. Never candy/carrot.

**Accept:**

- `pick_upgrade skips candycanesword grade>0`
- `pick_upgrade skips UNIQUE when GEAR_RISK=0`
- `upgrade_one uses calculate preview before real upgrade`
- `upgrade_one runs on merchant items only`

### 6 — Ponty + scroll1 uniques

- `GEAR_RISK=1`: UNIQUE may upgrade; grade0 still uses scroll0 allowlist; grade1 UNIQUE uses scroll1 up to `MAX_SAFE1` (candy/carrot still denied).
- `ponty_buy`: whitelist `wbook0`/`shield`, price ≤ `ponty_fair * PONTY_MULT`, spend above `GOLD_FLOAT`; skip if either already owned; deliver Zarook empty offhand.
- Still deferred: farm-loot `equip_pending` without bank; offerings; blind shield-for-carrotsword.

## Non-goals

- Reusing `*_upgrade.js` unchanged.
- Party `~g` / `partym` census (merchant not in party).
- `item_value` / `calculate_item_properties` for equip score.
- Vision-based `esize`.
- Permanent `is_keep` for all `level>0`.
- Offerings on upgrades.
- Mid-fight upgrade NPC visits.
- 8 CODE names.
- Blind shield-for-carrotsword.

## Anti-goals

- Expanding `is_keep` without changing `bank_dump` to use it.
- Ack-before-equip (`gear_got ok:1` only after successful equip).
- Delivery while fighters on FARM US/III.
- `held_set` that sets `s[name]=1` ignoring qty.
- Fighter-funded auto upgrades under offload.

## Success

Gifts survive hold banking; empty rings/gloves filled from owned loot before expensive scroll1; merchant compounds ringsj with priority; scroll0 upgrades burn Puppygirl gold safely; CM ads/delivery work with merchant out of party; exactly 7 CODE names with `gear_ops` replacing `merchant_plan`.
