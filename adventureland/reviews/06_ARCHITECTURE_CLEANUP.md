# 06 — Architecture cleanup (dead code & rearrange)

**Date:** 2026-09-10 (scrubbed after removing V1 `legacy/`)  
**Companion:** [RALPH_LOOP.md](./RALPH_LOOP.md), [05_ACTION_BACKLOG.md](./05_ACTION_BACKLOG.md).

## Verdict

Most weight is **ops dumps + god-file size**, not abandoned published modules. Highest-leverage cleanup: clarify layers, then continue slicing `merchant.js` the way `merchant_avoid` / `merchant_meet` / `bank_clean_plan` already do.

## Dead / unused

### Trimmed previously
- `constants.ATTACK_MS` — unused export (sim uses `sim/knobs.ATTACK_MS`)
- `monsterhunt.parseHuntSn` — never called
- Entire `legacy/` V1 tree — removed 2026-09-10 (LESSONS keeps historical facts; observe fixtures live under `tests/fixtures/`)

### Quarantine (do not delete blindly)
| Item | Why keep |
|------|----------|
| Root `_*.json`, `live_*` dumps | Probe artifacts → move under `ops/artifacts/` + gitignore |
| `live_*.js`, `mh_live_*.js`, `tools/*probe*` | Ops / soak — not publish |

### Keep (looks orphan, has callers)
| Item | Real role |
|------|-----------|
| `sim/combat.js` (moved from `src/`, 2026-09-11) | **Sim-only** combat via `boot_party` — not live slots |
| `monsterhunt_runner.js` | Test/sim Daisy driver |
| `derive_bank_lists.js` | Ops list derivation |
| `al_api.js` | Live shim in published bundles |

## God files — suggested splits

### `merchant.js` — primary

| Slice | Contents | Status |
|-------|----------|--------|
| Meet / move | approach/resolve/transit/fieldMove/ensureSendRange/avoidFail | **Done** — `merchant_meet.js` + `merchant_avoid.js` |
| Delivery | queue, `hearCm` dlv, `deliverActive`, abort | still in `merchant.js` → `merchant_delivery.js` later |
| Idle econ | vendor, xyn, ponty, craft, upgrade, combine, park, gift | still in `merchant.js` → `merchant_idle.js` later |
| Console cmds | `cmFighters`, hunt/hold/world/hq | keep thin in boot or `merchant_cmds.js` |

Add new files to `publish.manifest.js` `v2_merchant` **before** `merchant.js`.

### `fighter.js` — second

Rare / mhunt / dlv-client / gear-offer extracts; keep `bootFighter` as sole controller export.

## Layering

```
Published:  slots/* + v2_lib / v2_fighter / v2_merchant
Sim-only:   boot_party, sim/combat.js, monsterhunt_runner
Ops-only:   live_*.js (repo root), mh_live_*, tools probes
Generated:  dist/
Reviews:    reviews/
```

Misleaders: `sim/combat.js` ≠ slot `combat()`; root `live_*` ≠ `src/live_*_runtime.js`; `boot_party` is sim harness not live boot.

## Rearrange plan (remaining)

1. Gitignore / move root `_*.json` dumps → `ops/artifacts/`.
2. Cluster ops scripts → `ops/live/` (path updates only).
3. ~~Move `combat.js` → `sim/combat.js`; fix `boot_party` require.~~ Done 2026-09-11.
4. Split delivery/idle from merchant boot once one live observe is green.

**Out of scope:** rewrite slot combat, change sim combat lead hardcode (behavior/succession work).
