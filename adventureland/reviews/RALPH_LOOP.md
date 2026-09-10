# Ralph loop — adversarial critique of this review pack

**Date:** 2026-09-09  
**Passes:** two parallel adversarial agents vs draft docs, then human merge into docs.

Method: agents were instructed to prefer FALSE/OVERSTATED over OK, verify claims against `src/`, `tests/`, `publish.manifest.js`, `dist/`. Findings below are the ones that changed the pack; OK-confirmed claims are omitted.

## Pass 1 — severity-ranked doc errors

| # | Doc | Claim | Verdict | Fix applied |
|---|-----|-------|---------|-------------|
| 1 | 01 Headroom | “4 lines / ~36k; merchant tight via ~59k” | FALSE | Report packed lines /176 + maxLine/12000; fighter tighter on max-line |
| 2 | 02 §3 Heartbeat High | Any sender poisons farm in practice | OVERSTATED | Latent API hole Med; normal path lead-only publish |
| 3 | 02 §2 Merchant overlap | Long dlv overlaps if busy regresses (Med→High) | FALSE vs current | Defense-in-depth only; controller `busy` wraps tick |
| 4 | 02 §1 winter_cave + fieldMove | Live rip proves avoid→smart_move | FALSE link | Keep fallback risk; rip was retreatPlaza off-map |
| 5 | 02 §5 soft-resume | Resume only when id clears | OVERSTATED | Gone / replaced / `c<=0` |
| 6 | 02 §5 High by design | Soft-abandon High severity | OVERSTATED | Med UX caveat |
| 7 | 04 / closed | Soft-abandon “stops suicide” party-wide | OVERSTATED | Lead pathing stop; party via formation/hb |
| 8 | 00 INDEX | Link to RALPH_LOOP.md | FALSE | This file |
| 9 | 04 Footgun #6 | Dist smoke fails on `_inject*` | FALSE | No inject ban in `test_dist`; reword |
| 10 | 03 soft-abandon party | Followers still walk to pack | OVERSTATED | Assert hb/formation lag; not independent path |
| 11 | 02 §4 orphan | Only Puppygirl resume clears hold | OVERSTATED | Any resume/grind/hunt path |
| 12 | 02/04 hb | Seq “ignore” works | OVERSTATED | Stale-seq branch is a no-op comment |
| 13 | 01 typed hb | Separate typed/CM hb channel | OVERSTATED | `~S` chat only |
| 14–15 | 05 #1–2 | P0 heartbeat + merchant tickBusy | OVERSTATED | Correctness / optional hardening |
| 16–22 | various | fieldMove fallback, CM gap absence, orphan absence, suite mappings | OK | Kept |
| 25 | 05 #10 | Split merchant on ~59k chars | OVERSTATED | Line packing / max-line headroom |

## Pass 2 — different problems

| # | Claim | Why wrong | Fix applied |
|---|-------|-----------|-------------|
| 1–3 | Architecture = intent/formation/dlv only | Omits combat slots, gear gifts, world hop | 01 subsystems section |
| 4 | Publish = three v2_* slots | Seven slots including character entries | 01 full table |
| 5–6 | Char budget / compress | Total chars ≠ limit; pack packs stmts; assert lines only | 01 compress + headroom |
| 7 | Role authority table | Followers also spot rare / dlv / local cmds; priest heal | Split all-fighters vs lead-only |
| 8 | Merchant hunt/world → lead | Hardcodes `send_cm("Jazwyn")` despite succession | Risk + backlog |
| 9 | exitRare mode=farm vs hunt | Normal; hunt also uses mode farm | Removed as soft-lock |
| 10 | CM burst = chat disaster redux | LESSONS: CM was mitigation; gap is call hygiene | Downgrade framing |
| 11–12 | Cross-world deaf / vision knobs missing | Covered in `test_comms` / `test_packs` | Moved to well-covered |
| 13 | Soft-abandon party feature gap | Sync via setIntent+hb already | Assert-only backlog |
| 14 | Well-covered omits hop/gifts | Catalog + scenarios exist | Added rows |
| 15 | Dead RALPH link | Missing file | This file |

## Confidence after loop

- Treat **High** only for verified kill/strand paths with a concrete symbol.
- Latent ungated APIs with lead-only publishers → **Med** unless an inject/succession path is demonstrated.
- “By design” UX caveats ≠ High residual risk.
- Publish budgets: **lines used / 176** and **max line / 12000**; ignore total file char as a third cap.

## Open after docs (historical)

At ralph time these were still open; they later shipped — see [05_ACTION_BACKLOG.md](./05_ACTION_BACKLOG.md) Done and [02_RISKS.md](./02_RISKS.md) closed table (heartbeat gate, avoidFailPolicy, merchant `tickBusy`, cmFighters). Remaining deferred: orphan-hold auto-clear (by design), sim `limitdc`.
