# 02 — Residual risks

Ordered by likelihood × blast radius after ralph calibration. Confidence in parentheses.

## P0 — can strand or kill the party again

### 1. Avoid / pack meet last-resort geometry (Med)
`resolveDeliveryMeet` can fall through to packCenter −400y if farm/safeMeet missing — better than center, not always safeMeet. Avoid-fail near pack now retreats (`avoidFailPolicy`); residual risk is meet choice, not fieldMove fallback.

## P1 — soft locks / wrong mode / latent holes

### 2. Persisted hold with no orphan clear (Med)
V1 orphan-hold (~90s without merchant) has **no** V2 counterpart. Storage restore of `hold:1` after hop can leave fighters parked until **any** resume path (`!resume` / CM resume / grind / hunt).

### 3. Soft-abandon UX / Daisy still live (Med — by design)
After 3 **lead** deaths on current `hunt.id`: intent → default farm; condition persists until expiry/replace/complete. Soft-skip clears when `!h || h.id !== skipId || !(h.c > 0)`. Party follows via lead intent + formation/hb.

### 4. CM burst from merchant console (Med → P2 ops)
`cmFighters` fires `send_cm` to all fighters with no gap. Frame as `limits.calls` hygiene, not chat-throttle redux.

## P2 — sim / ops fidelity

### 5. Merchant interval lacks `tickBusy` mirror (Low)
Controller `busy` already wraps async `tick`. Interval mirror is defense-in-depth only.

### 6. Sim never `limitdc` (Med)
`sim/comms.bumpCall` increments but does not disconnect.

### 7. No Mainframe “stuck move” invariant in sim (Med)
LESSONS §0: 15s stationary + ≥10 move requests. Not modeled.

### 8. Publish without relink (High ops, Low code)
`save_code` does not restart CODE. Relink is mandatory.

### 9. Slots/sim combat still hardcode lead `"Jazwyn"` in places (Low→Med)
Merchant console is succession-safe; sim `boot_party` combat opts and some slot solo gates may still assume Jazwyn.

## Recently closed (do not re-open without evidence)

| Issue | Close signal |
|-------|----------------|
| Rare → default armadillo | `test_rare_resume.js` |
| winter_cave rip loop | `retreatPlaza` town + `test_equip_class.js` |
| Hunt suicide pathing (lead soft) | 3-death soft-abandon + `test_monsterhunt.js` |
| Pack-center merchant death | `approachPointFor` + `test_dlv_safe_meet.js` |
| empty_send park storm | abort×5 + retreat |
| Avoid → `smart_move` into pack | `avoidFailPolicy` + `test_merchant_avoid` |
| Heartbeat non-lead / stale seq poison | `applyHeartbeat` gate + `test_party_state` |
| Merchant hunt/world → Jazwyn only | `cmFighters` + succession adversary in `test_adversarial` |
| `exitRare` mode=farm vs hunt intent | Normal; covered by rare_resume |
