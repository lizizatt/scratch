# 06 — Architecture cleanup (dead code & rearrange)

**Date:** 2026-09-09  
**Scope:** clarity pass after backlog fixes (avoid pack abort, heartbeat owner-write, merchant CM fan-out).  
**Companion:** [RALPH_LOOP.md](./RALPH_LOOP.md), [05_ACTION_BACKLOG.md](./05_ACTION_BACKLOG.md).

## Verdict

Most weight is **ops dumps + `legacy/` + god-file size**, not abandoned published modules. Highest-leverage cleanup: clarify layers, then slice `merchant.js` the way `merchant_avoid` / `bank_clean_plan` already do.

## Dead / unused

### Trimmed this session
- `constants.ATTACK_MS` — unused export (sim uses `sim/knobs.ATTACK_MS`)
- `monsterhunt.parseHuntSn` — never called

### Safe later (un-export only)
- Soft-dead exports used only inside their modules: some `gear.*` / `motion.formationPos` re-exports if no external importer

### Quarantine (do not delete blindly)
| Item | Why keep |
|------|----------|
| `legacy/` | V1 history / LESSONS provenance |
| Root `_*.json`, `live_*` dumps | Probe artifacts → move under `ops/artifacts/` + gitignore |
| `live_*.js`, `mh_live_*.js`, `tools/*probe*` | Ops / soak — not publish |
| `code/bank_clean.js` | One-shot TEMP; idle combine now in V2 |

### Keep (looks orphan, has callers)
| Item | Real role |
|------|-----------|
| `src/combat.js` | **Sim-only** combat via `boot_party` — not live slots |
| `monsterhunt_runner.js` | Test/sim Daisy driver |
| `derive_bank_lists.js` | Ops list derivation |
| `al_api.js` | Live shim in published bundles |

## God files — suggested splits

### `merchant.js` (~1.4k LOC) — primary

| Slice | Contents | Target |
|-------|----------|--------|
| Meet / move | `approachPointFor`, `resolveDeliveryMeet`, `transitBlockers`, `fieldMove`, `ensureSendRange`, `avoidFailPolicy` | `merchant_meet.js` |
| Delivery | queue, `hearCm` dlv, `deliverActive`, abort | `merchant_delivery.js` |
| Idle econ | park, stall, upgrade, combine, vendor | `merchant_idle.js` |
| Console cmds | `cmFighters`, hunt/hold/world/hq | keep thin in boot or `merchant_cmds.js` |
| Boot | `tick`, hooks, return ctrl | `bootMerchant` only |

Add new files to `publish.manifest.js` `v2_merchant` **before** `merchant.js`.

### `fighter.js` (~1k LOC) — second

Rare / mhunt / dlv-client / gear-offer extracts; keep `bootFighter` as sole controller export. Same manifest discipline for `v2_fighter`.

## Duplication to consolidate (later)

- Lead resolve: `party_state.currentLeader` vs `merchant.fighterLead` vs slot/sim hardcoded `"Jazwyn"`
- `goDaisy` in fighter vs `monsterhunt_runner`
- Sell lists: `SELL_WHITELIST` ≡ bank_clean defaults ≡ `code/bank_clean.js`
- Test-local `nearPack` helpers vs `packs.nearPack`

## Layering confusion (rename/move mentally)

```
Published:  slots/* + v2_lib / v2_fighter / v2_merchant
Sim-only:   boot_party, combat.js, monsterhunt_runner
Ops-only:   live_*.js (repo root), mh_live_*, tools probes
Generated:  dist/
History:    legacy/
```

Misleaders: `src/combat.js` ≠ slot `combat()`; root `live_*` ≠ `src/live_*_runtime.js`; `boot_party` is sim harness not live boot.

## Rearrange plan (low risk, ordered)

1. Keep reviews/backlog in sync with shipped behavior (done with this doc).
2. Gitignore / move root `_*.json` dumps → `ops/artifacts/`.
3. Cluster ops scripts → `ops/live/` (path updates only).
4. Move `combat.js` → `sim/combat.js`; fix `boot_party` require.
5. Move non-published helpers (`monsterhunt_runner`, `derive_bank_lists`) out of “live bot” surface.
6. Dead-export trim (started: ATTACK_MS, parseHuntSn).
7. Extract `merchant_meet.js` (pure meet/move) + manifest — no behavior change.
8. Split delivery/idle from merchant boot once meet extract is green + one live observe.

**Out of scope for rearrange:** delete `legacy/`, rewrite slot combat, change sim combat lead hardcode (behavior/succession work).

## Shipped with this pass (code)

| Fix | Where |
|-----|--------|
| Avoid-fail near pack → retreat, not `smart_move` | `avoidFailPolicy` + `fieldMove` |
| Heartbeat owner-write + stale-seq `return` | `party_state.applyHeartbeat` + fighter present list |
| Merchant hunt/grind/world/hq via `cmFighters` | `merchant.js` (succession-safe) |
| Tests | `test_party_state`, avoid policy unit, succession CM adversary |
