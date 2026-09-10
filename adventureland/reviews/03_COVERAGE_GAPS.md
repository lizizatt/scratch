# 03 — Coverage gaps

## Well covered (sim adversary exists)

| LESSONS / theme | Suite |
|-----------------|-------|
| Bare bank_store / bank:full | `test_live_regressions`, `test_bank_park` |
| Bank linger stale index | `test_bank_linger` |
| Restock distance / empty_send | `test_restock_range`, `test_dlv_safe_meet` |
| Safe meet / pack standoff | `test_dlv_safe_meet` |
| Rare resume | `test_rare_resume` |
| Merchant avoid + valley | `test_merchant_avoid` |
| winter_cave retreat town | `test_equip_class` (surprising home; accurate) |
| Hunt soft-abandon (lead) | `test_monsterhunt` |
| Idle combine | `test_idle_bank_clean` |
| Stall / upgrade_skip / trade arity | `test_stall_gear_spam`, scenarios |
| Equip class gate | `test_equip_class` |
| Chat 15s / CM same-server (+ cross-server omitted) | `test_comms` |
| Merchant queue survives hop + onReload | `test_adversarial` |
| World hop / hold HOME | `test_scenarios`, `test_adversarial`, viz `world-hop` |
| Gear gifts / batch | scenarios + `test_equip_class` / `test_dist`; viz `farm-15min-gear` |
| Vision/reconnect knobs vs fixtures | `test_packs` (fixture sync; live re-measure still open Q) |
| Live interval clearInterval / fighter tickBusy | `test_live_runtime_interval` |
| Dist compressed boot | `test_dist` |

## Thin or missing (post-ralph + backlog ship)

| Gap | Why it matters | Suggested adversary |
|-----|----------------|---------------------|
| Soft-abandon follower assert | Sync via intent+hb; suite only checks lead | Soft-abandon then assert Sarene/Zarook leave bee |
| Orphan hold timeout | Stuck hold forever | Persist hold, no merchant, advance 90s+ — today fails (no feature) |
| CM burst call count | `limits.calls` / limitdc hygiene | `hold()` then count CM timestamps / call bumps |
| `limitdc` / call budget | Live disconnect | Sim bumpCall threshold → disconnect flag |
| Stuck-move (15s/10) | Path storms | Inject blocked dest + spam move |
| Live mh_live / overnight scripts | Not in `tests/run.js` | Keep out of unit CI; document as soak only |

## Closed coverage (this pass)

| Theme | Suite |
|-------|-------|
| Heartbeat non-lead / stale-seq | `test_party_state` |
| Avoid fallback under pack | `avoidFailPolicy` in `test_merchant_avoid` |
| Merchant hunt/world succession | `test_adversarial` fan-out → Sarene lead |

## Viz traces vs new behaviors

Recorded: `valley-dodge`, `puppy-route`, farms, dlv-dry, `world-hop`, gear farm. **Not** recorded: soft-abandon death loop, rare_resume mid-hunt, winter_cave retreat. Optional if scrubbing those fixes matters.
