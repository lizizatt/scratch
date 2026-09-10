# Adventure Land V2 — Code Review Pack

**Date:** 2026-09-09  
**Scope:** `adventureland/` V2 bots (src/sim/tests/publish/live/viz)  
**Deploy at review start:** hunt soft-abandon (`mhunt:soft_abandon`) uploaded + party relinked US III.  
**Docs status:** draft → adversarial ralph loop → revised (see [RALPH_LOOP.md](./RALPH_LOOP.md)).

## Documents

| Doc | Purpose |
|-----|---------|
| [01_ARCHITECTURE.md](./01_ARCHITECTURE.md) | Ownership map: slots, combat, hop, gifts, publish |
| [02_RISKS.md](./02_RISKS.md) | Ranked residual risks (severity-calibrated) |
| [03_COVERAGE_GAPS.md](./03_COVERAGE_GAPS.md) | LESSONS vs tests; real gaps only |
| [04_INVARIANTS_FOOTGUNS.md](./04_INVARIANTS_FOOTGUNS.md) | Claimed invariants + dual-use APIs |
| [05_ACTION_BACKLOG.md](./05_ACTION_BACKLOG.md) | Prioritized next work |
| [06_ARCHITECTURE_CLEANUP.md](./06_ARCHITECTURE_CLEANUP.md) | Dead code, god-file splits, rearrange plan |
| [07_PONTY_RON_PLAN.md](./07_PONTY_RON_PLAN.md) | Ponty + Ron browse/buy for gear targets |
| [RALPH_LOOP.md](./RALPH_LOOP.md) | Adversarial critique log of these docs |

## How to read

1. Architecture for orientation.
2. Risks + backlog for what to fix next.
3. Coverage / invariants for what the suite does *not* prove.
4. Ralph loop for which draft claims were wrong and why.

## Confidence legend

- **High** — verified kill/strand path against current `src/` / tests; concrete symbol cited
- **Med** — mechanism real; likelihood or blast radius limited, or needs live proof
- **Low** — hypothesis / historical V1 lesson not confirmed as V2 failure mode
