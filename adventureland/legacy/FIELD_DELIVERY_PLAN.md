# Field delivery — request/handshake plan

Merchant delivers items to fighters **in the field**. Fighters do not town for restocks. Merchant stays **out of party**. Cap **7** CODE slots, ≤176 lines each.

**Evidence sources:** Adventure Land MCP `get_code_method` (`send_item`, `send_cm`, `send_gold`, `change_server`, `get_player`, `smart_move`), [coding guide](https://adventureland.dcoles.net/guide.html), live party layout (fighters FARM `US/III`, merchant often `US/II`).

## Product decisions

| Choice | Decision |
| --- | --- |
| **Meet point** | **Fighter’s current farm location** (map + x/y + server). No town hold for pots/gear delivery. |
| **Transport** | Physical `send_item` / `send_gold` only (must be nearby). Coordination = **`send_cm` only** (no PM / party_say for protocol). |
| **Trigger** | Fighter **requests** what they need; merchant does not scrape worn gear to invent jobs. |
| **Duplicates** | Do **not** stockpile spare gear on fighters or HOLD “just in case.” Merchant buys/pulls **on demand**. |
| **Gold** | Merchant pays for delivered consumables. Fighters keep ~1k via existing offload when merchant is in range. |
| **Phase 1 demo** | **Potion restock on demand.** |
| **Phase 2 (later)** | Request upgrade of a named bag/worn piece, or replacement piece — same pipe. |
| **Town hold / plaza gear session** | **Retired for consumables.** Old `start_gear_session` hold-to-HOME path is superseded by field delivery. Keep merchant bank/stand econ on a timer when **no** delivery jobs. |

## Hard API constraints (must design around)

1. **`send_item(receiver, num, quantity)`** — nearby only; Promise; failures `{failed:true, reason}`.
2. **`get_player(name)`** — **visible** entities only. Merchant cannot “see” fighters on another map/server. Location must come from the request (and optional beacons).
3. **`send_cm(to, message)`** — works to named characters (array ok). Docs: *“Server-routed messages consume communication capacity.”* This is a throttle surface — treat like chat.
4. **`change_server(region, name)`** — **navigates the page; runtime state is lost.** Any in-flight queue **must** survive via `localStorage` (or equivalent) and resume on boot.
5. **`smart_move`** — async path to coords/maps/NPCs; can fail/interrupt.
6. **No magiport** in this party (already removed). Catch-up is walk + server hop only.

## Architecture

```text
FARM = US/III (fighters grind; merchant comes here to deliver)
ECON = US/II (merchant bank/stand/combine/upgrade when idle)

fighter_core:
  when low pots → dlv_request(kind:"pots", items, loc) via rate-limited CM
  on dlv_* handshake messages → update pending job; never party_say protocol
  optional loc beacon while job open (rate-limited)

merchant + gear_ops (delivery owner):
  on cm: enqueue dlv_req → ack
  delivery worker preempts idle econ cycle
  hop server if needed (persist queue first)
  buy/pull items → smart_move to last known loc → send_item → confirm
  structured game_log every state transition
```

### Slot budget

Keep 7 names: `warrior`, `mage`, `priest`, `merchant`, `merchant_ops`, `gear_ops`, `fighter_core`.

- **`gear_ops`**: field delivery state machine + CM hear + (retained) `upgrade_one` / Ponty for later phases.
- **`fighter_core`**: replace town-pot path with `dlv_request`; CM handshake handlers; shared rate-limit helper (duplicated densely; no 8th slot).
- **`merchant.js`**: call `deliver_tick()` / prefer delivery over `run_cycle` when queue non-empty.

## CM protocol (versioned objects)

All messages are JSON objects. Prefix `dlv_` for delivery. Every message includes `v:1` and `id` (string, fighter-generated, unique per job).

| Dir | Message | Meaning |
| --- | --- | --- |
| F→M | `dlv_req` | New job: `{v, id, kind, items:[{name,q}], map, x, y, server:[R,I], esize}` |
| M→F | `dlv_ack` | `{v, id, ok:1\|0, reason?}` queued or rejected |
| F→M | `dlv_loc` | Beacon: `{v, id, map, x, y, server}` while job open |
| M→F | `dlv_here` | Merchant in range / about to send: `{v, id}` |
| M→F | `dlv_sent` | `{v, id, items:[{name,q}]}` after successful `send_item`s |
| F→M | `dlv_got` | `{v, id, ok:1\|0, have?:{name:q}}` verify |
| M→F | `dlv_done` | `{v, id, ok:1\|0, reason?}` terminal |
| either | `dlv_cancel` | `{v, id, reason}` abort |

**Kinds (phase 1):** `pots` only.  
**Kinds (phase 2+):** `gear_give`, `gear_swap` (replace worn), `upgrade_pull` (send piece to merchant — optional later; may briefly require fighter stay put).

### Potion `items` shape

Fighter computes deficit to `POTION_TARGET` (or a delivery chunk, e.g. min(deficit, 200)):

```text
items: [{name:"hpot1", q:160}, {name:"mpot1", q:160}]
```

Merchant buys any shortfall (respect `GOLD_FLOAT`), then delivers.

## Handshake + timeouts

```text
F: create id, set pending, cm_send(dlv_req)
   wait ACK_MS (15s) for dlv_ack
   if none → retry with backoff (max 3), else log fail

M: on dlv_req
   if duplicate id → re-ack prior state
   if queue full → ack ok:0 reason:busy
   else enqueue, ack ok:1, log

M: worker
   persist queue
   if server mismatch → change_server (boot resumes worker)
   ensure items in bag (buy pots / bank_retrieve)
   loop until timeout JOB_MS (180s):
     use latest loc (req or beacon)
     smart_move({map,x,y})
     if get_player(who) && dist≤SEND_RANGE (320):
       cm dlv_here
       send_item each stack (await; verify bag delta)
       cm dlv_sent
       wait GOT_MS (20s) for dlv_got
       cm dlv_done; dequeue; break
     else sleep + wait beacon
   on timeout: dlv_done ok:0 reason:timeout; dequeue

F: on dlv_sent → count items → dlv_got
F: on dlv_done / cancel → clear pending
F: while pending && every BEACON_MS (8s) → dlv_loc (rate-limited)
```

## Rate limiting (anti-throttle)

Single helper pattern on both sides:

```text
CM_GAP_MS = 700          // min gap between any outbound CM from this character
PEER_GAP_MS = 700        // extra: same peer
BEACON_MS = 8000
REQ_COOLDOWN_MS = 60000  // per kind (pots) after successful done or hard fail
gear_ad interval ≥ 20s   // kill hold-time 250ms ad spam forever
```

Rules:

- **No PM** for protocol (already killed for hold).
- **No `party_say`** for protocol / hold status (already mostly game_log).
- **Never** `send_cm(FIGHTERS, …)` bursts for delivery; unicast per job.
- Queue outbound CMs; `await sleep` to respect gaps.
- Log drops: `game_log("cm throttle skip "+type)`.

Party chat remains social-only (Ding/Gratz) with existing `PSAY_MS`.

## Logging (paramount)

Use `game_log` strings that are greppable and stable:

```text
dlv:req id=… kind=pots q=hpot1:160+mpot1:160 @US/III main 700,-100
dlv:ack id=… ok=1
dlv:hop US/III
dlv:buy hpot1 160
dlv:move main 700,-100
dlv:here id=… dist=40
dlv:send hpot1 160 → Jazwyn
dlv:sent id=…
dlv:got id=… ok=1
dlv:done id=… ok=1
dlv:fail id=… reason=timeout|no_space|buy|move|hop
```

Merchant also `set_message("Dlv "+who)` while working.

## Fighter behavioral change (phase 1)

| Old | New |
| --- | --- |
| `needs_vendor` / low pots → town `restock("potions")` | low pots → `dlv_request("pots")` if no pending; **stay farming** |
| `psay("I need some potions!")` | optional once per cooldown (or drop); protocol is CM |
| bag full `esize===0` | still need a path (phase 1b): request `dlv_req kind:"pickup"` later; for now keep rare town dump **or** wait for merchant proximity offload — **call out as known gap** |

Critical HP + zero HP pots: still allow emergency town (safety exception). Document as exception.

## Merchant behavioral change

| Old | New |
| --- | --- |
| `start_gear_session` hold fighters to HOME | **remove from happy path**; field `deliver_tick` |
| econ cycle every 5 min always | run only when delivery queue empty |
| merchant glued to US/II | hop to fighter `server` for jobs; return to ECON when idle |

`localStorage` key e.g. `dlv_q_puppygirl`: JSON array of jobs + `active_id`.

## Phase 2 sketch (not in phase 1 impl)

- `kind:"replace"` `{slot, name, level?}` — merchant brings better piece from bank; fighter unequips / `equip_pending`.
- `kind:"upgrade"` — fighter sends item to merchant (`send_item` when merchant arrives), merchant upgrades in town, returns — **longer handshake**; optional pause farming.
- Same `dlv_*` envelope + rate limits + logging.

## Adversary review (plan)

### Pass 1 — MUST-FIX

| ID | Finding | Resolution |
| --- | --- | --- |
| hop-wipes-queue | `change_server` destroys JS heap | Persist queue + active job to `localStorage` before hop; boot resumes |
| cm-capacity | `send_cm` server route consumes capacity; old gear_ad/hold spam | Unicast + `CM_GAP_MS` + kill fast ads; no PM |
| invisible-target | `get_player` null off-vision | Carry map/x/y/server in req; beacon; smart_move before send |
| fighter-moves | pack kites while merchant walks | `dlv_loc` beacons; rematch coords until JOB_MS |
| full-bag | send_item fails no space | ack/reject if `esize<1`; fighter must free space or got ok:0 |
| multi-req | 3 fighters request at once | FIFO queue; ack busy only if hard cap exceeded (cap≥8) |
| econ-starvation | endless deliveries | Fairness: max N jobs then one econ pass; or econ if queue empty ≥CYCLE_MS |
| emergency-death | no pots mid-fight | Keep emergency town if hp critical && 0 hp pots |
| dup-id | retries | Treat duplicate id as re-ack, do not double-buy |
| false-success | send_item “ok” but wrong | Check bag delta / `dlv_got` counts before done |

### Pass 2 — REJECT until

- Phase 1 explicitly does **not** require fighters in party with merchant.
- Phase 1 potion path does **not** call `set_hold` / HOME hop for fighters.
- Logging strings listed and used at every transition.
- Tests cover: req→ack→send→got→done; ack reject no space; timeout; duplicate id; CM gap; localStorage resume after simulated hop.

### Pass 3 — ACCEPT criteria (plan)

- [x] Field meet using request coordinates + optional beacon  
- [x] Handshake table complete; CM-only; rate limits specified  
- [x] Server hop + persistence called out  
- [x] Potion demo is the phase 1 accept slice  
- [x] Town hold delivery retired for this path  
- [x] Phase 2 upgrade/replace is additive on same pipe  
- [x] Slot budget unchanged (7)  
- [x] Adversary MUST-FIX items have concrete mitigations  

### Pass 4 — second adversary (post-draft)

| ID | Finding | Resolution |
| --- | --- | --- |
| stand-blocks-move | Open merchant stand prevents travel | `ensure_stand(false)` / `close_stand` before any delivery move |
| buy-on-wrong-map | After hop to III, must buy at potions on that server’s `main` | `go_npc("potions")` on current server after hop; do not assume II stock |
| coalesce | Three fighters stacked — three full trips waste capacity | If next queue jobs share server+map and dist(centroid)<200, deliver in one visit (phase 1 SHOULD; implement if lines allow) |
| stack-qty | Pots stack — use `send_item(who, i, q)` not one-by-one | Always pass quantity |
| code-restart-mid-send | Hop mid-buy leaves orphan bag pots | Persist job state `buying\|moving\|sending`; on boot finish active job before idle econ |
| fighter-rip | Dead receiver | Skip send; `dlv_done ok:0 reason:rip`; fighter re-req after respawn |

**Plan verdict: ACCEPT** (phase 1 scope). Remaining risk accepted: bag-full pickup deferred; upgrade-in-field is phase 2; coalesce is best-effort.

## Implementation review (adversary, post-code)

### Verified against plan + coding guide

| Constraint | Evidence in code |
| --- | --- |
| `send_item` nearby only | `dlv_send_all` checks `get_player` + `SEND_RANGE` 320 |
| `get_player` vision-only | Meet uses req/beacon `map/x/y`; never assumes entity exists off-map |
| `send_cm` capacity | `cm_send` gap `CM_GAP_MS=700`; unicast; no PM protocol |
| `change_server` wipes heap | `dlv_save` before hop; `dlv_load` on boot + tick |
| Stand blocks travel | `ensure_stand(false)` / `close_stand` at tick start |
| Merchant pays pots | `dlv_ensure_items` buys; fighters request while broke |
| Not in party | Merchant never `send_party_invite` for delivery |

### Pass — MUST-FIX status

| ID | Status |
| --- | --- |
| hop-wipes-queue | **fixed** — `localStorage` `dlv_q_<name>` |
| cm-capacity | **fixed** — gap + unicast |
| invisible-target | **fixed** — coords + beacons |
| fighter-moves | **fixed** — `dlv_loc` |
| full-bag | **fixed** — ack `no_space`; fighter skip |
| multi-req | **fixed** — FIFO, cap 8 |
| econ-starvation | **fixed** — `DLV_BATCH_MAX=3` then one econ |
| emergency-death | **fixed** — critical HP + 0 hp pots → town |
| dup-id | **fixed** — re-ack, no double queue |
| false-success | **fixed** — bag delta on send; `dlv_got`; clear `_got` *before* `dlv_sent` |
| stand-blocks-move | **fixed** |
| buy-on-wrong-map | **fixed** — buy after hop on current server |
| stack-qty | **fixed** — loop `send_item` until qty |
| fighter-rip | **fixed** — `dlv_done reason:rip` |

### Pass — REJECT checks

- [x] Potion path does **not** `set_hold` / HOME hop for normal low pots  
- [x] Merchant not required in party  
- [x] Greppable `dlv:` logs at req/ack/hop/buy/move/here/send/sent/got/done  
- [x] Tests: handshake, no_space, timeout/rip, dup id, CM gap, localStorage resume, no town on low pots  

### Accepted residual risks

- Coalesce multi-fighter same map: not implemented (line budget).  
- Bag-full pickup: still rare town dump when `esize===0`.  
- Orphan pots if hop mid-buy: next tick finishes active job (items already in bag count toward need).  
- Fighter `dlv_got` absolute qty check (not pre/post delta): OK while requesting from low stock.

**Implementation verdict: ACCEPT** (phase 1 potion demo).

## Implementation phases

### P0 — Plan commit
This document committed on branch.

### P1 — CM utility + potion request/deliver
1. Rate-limited `cm_send` + greppable `dlv:` logs (fighter + merchant).  
2. Fighter: low pots → `dlv_req` pots; beacon; got handler; no town for normal pots.  
3. Merchant: queue, ack, buy, travel, `send_item`, sent/done; preempt econ.  
4. `localStorage` resume.  
5. Tests + deploy.  
6. Live demo: drain pots on one fighter, observe `dlv:` logs and refill without town.

### P2 — Replace / upgrade requests
Build on P1 envelope only after P1 live-stable.

## Non-goals

- Merchant joining party  
- PM / party_say protocol  
- Magiport  
- Keeping duplicate gear “warehouses” on fighters  
- Blind auto-equip from census without a request (old plaza session)  
- Offerings automation  

## Success (phase 1)

Fighters stay on FARM map/server with low pots; merchant receives CM, hops if needed, walks in, `send_item` pots, handshake completes; greppable logs explain any failure; no “You can't chat this fast” from protocol traffic under normal load.
