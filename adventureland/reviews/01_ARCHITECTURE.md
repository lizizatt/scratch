# 01 — Architecture

## Runtime roles

| Char | Slot entry | Loads | Lead-only | All fighters / merchant |
|------|------------|-------|-----------|-------------------------|
| Jazwyn | `src/slots/warrior.js` | `v2_lib` + `v2_fighter` | Intent broadcast, Daisy `tickHuntQuest` / soft-skip, rare kill mark, party invite | Combat (warrior), rare spot, dlv request, `gear_ad`, local hold/hunt/world apply |
| Sarene | `src/slots/mage.js` | same | — (becomes lead on succession) | Same fighter set; mage combat |
| Zarook | `src/slots/priest.js` | same | — | Same + `pre_combat` heal / partyheal / revive |
| Puppygirl | `src/slots/merchant.js` | `v2_lib` + `v2_merchant` | — | Delivery queue, idle econ, console cmds; `cmFighters` fans hunt/hold/world/hq to all `FIGHTERS` (succession-safe) |

Succession: `party_state.currentLeader` + `LEADER_ORDER` (first present non-rip).

## Source → publish slots

Defined in `publish.manifest.js` (seven slots):

| Slot | Kind | Sources (order) / notes |
|------|------|-------------------------|
| `v2_lib` | bundle | `constants`, `packs`, `gear`, `monsterhunt`, `chat_queue`, `party_state`, `motion` |
| `v2_fighter` | bundle | `al_api`, `fighter`, `live_fighter_runtime` |
| `v2_merchant` | bundle | `al_api`, `bank_clean_plan`, `merchant_avoid`, `merchant`, `live_merchant_runtime` |
| `warrior` / `mage` / `priest` / `merchant` | entry | `src/slots/*.js` → character CODE names; keep `load_code`; class combat/`pre_combat` live here |

Compressor (`tools/compress_code.js`): strip requires/exports/comments, flatten whitespace, **pack many stmts per line** (`packToBudget`); **no rename/mangle** (globals shared by name after `load_code`). Caps: ≤176 non-empty lines (`assertLineBudget`); ≤12000 chars/line during greedy pack (soft — line count is what publish asserts).

**Headroom (measured 2026-09-09):**

| Bundle | Packed non-empty lines / 176 | Max line / 12000 | Total file chars (not a publish cap) |
|--------|------------------------------|------------------|--------------------------------------|
| `v2_fighter` | 4 / 176 (headroom 172) | **11999** / 12000 | ~36k |
| `v2_merchant` | 5 / 176 (headroom 171) | 11984 / 12000 | ~59k |

Scarce signal: **per-line char** (fighter is tighter). Line count is abundant. Do not treat total ~59k as a third budget.

## Layers

```
live Mainframe
  slots/*.js (combat/pre_combat + load_code) → v2_* → v2_start_* interval
sim
  boot_party → createWorld + bootFighter/bootMerchant
  combat.js = sim combat (not the live slot combat functions)
tests
  run.js → boot_party / units / dist smoke
ops
  publish.js --upload → save_code (all seven slots)
  tools/relink_party.js → disconnect → wait → link
  live_*.js / mh_live_*.js → observe / inject (not published)
viz
  record_viz.js → traces → viz/serve.js
```

## Major subsystems (state ownership)

| Subsystem | Owner | Notes |
|-----------|--------|------|
| Intent (`kind`, `mtype`, `hold`, world) | Lead `setIntent` | Lead-gated write |
| Heartbeat `~S` | Lead publishes; all `applyHeartbeat(from, parsed, present)` | Chat party line only. `f`/`m`/`h` **lead-only**; stale seq returns |
| Rare | Spotter enter; lead kill exit | `preRareSnap` local persist → `rare_resume` |
| Delivery | Fighter request; merchant `dlv_q_*` | `fieldMove` / avoid; avoid-fail near pack → retreat (not `smart_move`) |
| Gear gifts | Fighter `gear_ad` / equip; merchant `planGifts` / queue / send | TTL / `equipPending`; batch-on-pots |
| World hop | Fighter `hopPrep` / intent.world; merchant `change_server` | Restock-before-hop; storage survive; queue reload |
| Hunt quest | Merchant CM toggle; **lead** `tickHuntQuest` + soft-skip | Daisy condition persists; soft-skip is lead-local + intent/hb |

## Recent shipped behaviors (2026-09)

| Feature | Home |
|---------|------|
| `preRareSnap` / `rare_resume` | `fighter.js` |
| Engage-radius farm gate | `fighter.js` `ENGAGE_R` |
| Hunt soft-abandon (3 deaths) | `fighter.js` `noteHuntQuestDeath` |
| `merchant_avoid` + `fieldMove` | `merchant_avoid.js` / `merchant.js` |
| `retreatPlaza` towns off-map | `merchant.js` |
| Live interval dedupe + fighter `tickBusy` | `live_*_runtime.js` |
