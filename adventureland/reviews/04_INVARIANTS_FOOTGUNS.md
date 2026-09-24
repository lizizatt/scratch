# 04 — Invariants & footguns

## Claimed invariants vs enforcement

| Claim | Enforcement | Hole |
|-------|-------------|------|
| Owner-writes-only intent | `setIntent` lead-gated; `applyHeartbeat` lead-only for `f`/`m`/`h` | Pass present party list; non-lead seq still tracked |
| Stale heartbeat ignored | `applyHeartbeat` returns when `parsed.seq < S.seq[from]` | — |
| Chat ≥16s gap | `CHAT_GAP_MS` + `chat_queue` | CM / some PM paths share different budgets |
| Never path rare by **type** | `farm:skip_rare_type` | Daisy hunt **does** `goTo(packCenter(h.id))` — intentional for fixed packs; lethal if pack is ghost/mummy-tier |
| Merchant never enters pack danger | `approachPointFor` + `avoidFailPolicy` + tests | −400y fallback meet still soft |
| Single-flight ticks | Fighter + merchant: live `tickBusy`; controllers also `busy` | Both interval mirrors present |
| Sim ≈ live bank | inject bare-invalid | Easy to forget inject in new tests |
| mvpPass path_storm | Transfer phoenix + Port town | Other Transfer storms not graded |
| Hunt soft-abandon stops lead suicide pathing | death counter + skip id | Condition still active; no server abandon; party follows via formation/hb |

## Footguns (ops / API)

1. **`mainframe_code_eval` / live injects** — `live_*`, `mh_live_*` push CODE into running VMs. Leftover injects survive until relink. Always strip + redeploy clean after experiments.
2. **Bare `bank_store(i)`** — still present as final fallback in `al_api.bank_store` and `merchant.storeBagItemToBank`. Live rejects bare; sim needs inject to match.
3. **Merchant console globals** — `hunt`, `hold`, `world`, `hunt_quest` always armed after `v2_start_merchant`. Cmds fan out via `cmFighters`.
4. **`.al_mcp_token`** — account auth; do not commit (LESSONS: prior leak).
5. **Upload ≠ reload** — `publish.js --upload` without `relink_party` leaves old heap running.
6. **Sim-only `_inject*`** — must not ship in published bundles. **Gap:** `test_dist` does not currently ban `_inject` strings; do not claim dist smoke catches this until a real assert exists.

## Dual-use note

This repo is a personal bot for Adventure Land, not malware. Still treat Mainframe eval and token files as high-privilege: prefer observe scripts over injects when possible.
