# Adventure Land party — V2.0 plan

**Status:** decisions locked (2026-09-07); authority confirmed; sim pathing + Monte Carlo scoped.  
**Goal:** sim-first rewrite with Jazwyn as sole combat/logistics commander, bandwidth-limited shared state, fighters almost never world-hop, and Mainframe proof that matches sim invariants.

---

## 0. Locked decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Worlds | **Keep dual world** (farm US/III, hold/home US/II). Fighter world hops are **rare** — only on explicit user/`!world`/`hold` command. **Merchant does ~99% of hops.** Restock = **same-world town**, never a world hop for pots. *Review addendum:* Puppygirl **idles on the farm world** (CM is same-server, §4.0); US/II only for user hold. |
| 2 | Party chat | **~1/min high-level state summary** — human-readable **and** sync medium. Server allows **1 code chat / 15 s / character** (§4.0). |
| 3 | Sync architecture | Shared party state, **owner-writes-only** fields, diff on change + heartbeat as the full sync. Party chat among fighters; **same-server CM** to Puppygirl (PM only for cross-world summons). |
| 4 | Social NL | **Remove** Ding/Gratz/Ok (comms load). |
| 5 | Present | **Vision ∧ range** (in vision and within formation/cohesion radius). |
| 6 | Rares | **Whitelist interrupt:** any member who **sees** a rare announces → assemble → Puppygirl restocks needy → kill → resume prior task. **Only Puppygirl may change servers.** MVP whitelist includes **phoenix**. |
| 7 | Gear / hold | **No plaza hold** unless user explicitly `hold`. Gear is a **field logistics job** (§5D): Puppygirl **pushes** upgrades automatically whenever she holds a strictly better piece; batched onto pot runs. Hold = **user utility to assemble**, not automation’s path. |
| 8 | Slots / publish | **OK to refactor slots.** Add a **code compressor**: author readable/documented source → verify behavior-preserving compress → publish ≤176 lines / ≤6–7 slots. |
| 9 | MVP bar | All **sim** tests pass. Mainframe: **0 chat throttle**, **no restock-fail storm**, **≥30 min** valid farming + **successful Puppygirl deliveries**, **no manual refills**, **no fighter world transfers**. |

### Big-picture mandates

- **Sim-first design.** Fast-than-realtime multi-character sim; integration suite catches ~99% before deploy.
- **Sim presents same invariants as real server** (tests verify that claim).
- **Research-backed sync** for many agents, minimal bandwidth (robotics / multi-agent analogues).
- **Fighters basically never world hop.**
- **Instrument all problem cases** (`game_log` / structured counters).
- **Boot any order / any subset.** Isolated subsets work; emergency same-world town restock only if Puppygirl unresponsive.
- **Jazwyn is leader.** Puppygirl is logistics under Jazwyn’s command — no Jazwyn↔Puppygirl control fight.

---

## 1. Product (V2)

Combat trio + out-of-party merchant that:

1. Stay **present** with Jazwyn while grinding / interrupting for rares.
2. Farm ladder + explicit hunt overrides under Jazwyn’s intent.
3. Stay supplied via **field delivery** (same world); emergency town restock only if merchant dead/silent.
4. Field gear delivery on request; hold only when **you** call it.
5. Merchant econ when idle; merchant hops worlds as needed for jobs/home.
6. Operable via party commands + merchant API + Mainframe observe.

Non-goals: magiport; merchant in combat party; auto plaza gear sessions; fighter-driven world shopping.

---

## 2. Platform constraints

| Constraint | Implication |
| --- | --- |
| ≤176 lines/slot, ≤7 slots | Author in readable multi-file tree; **compress at publish**. |
| `change_server` reloads heap | Persist jobs; fighters avoid hops so they don’t lose state mid-farm. |
| `get_player` = vision | “Present” = vision + range, not party-list coords alone. |
| **1 code chat / 15 s / character**; CM same-server only (§4.0) | Per-character 16 s outbound queue; diffs + 1/min heartbeat; merchant on farm world; PM for cross-world summons. |
| `smart_move` flaky | One motion owner; backoff; coords preferred. |
| No Mainframe eval | Deploy + relink; sim carries the iteration loop. |

---

## 3. Authority model — Jazwyn leads

```text
                    ┌─────────────┐
     user / !cmds → │   Jazwyn    │  commander (intent + combat lead)
                    │  (leader)   │
                    └──────┬──────┘
           intent / state  │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   Sarene (follow)   Zarook (follow)   Puppygirl (logistics)
        │                  │                  │
        └──────── party state bus ────────────┘
```

| Actor | Owns | Does not own |
| --- | --- | --- |
| **Jazwyn** | Party **intent** (hunt/grind/hold/resume/world when commanded); pull target; cohesion gates; rare-interrupt orchestration; when to request restock/gear | Merchant econ micro-decisions |
| **Sarene / Zarook** | Follow Jazwyn motion; assist target; heal; **spot rares** and announce | Pack choice; world hops; inventing travel |
| **Puppygirl** | Execute logistics **jobs** issued/authorized by leader state (dlv pots, field gear, world hop to meet, econ when idle) | Overriding hunt/hold; starting plaza hold; competing “what should we farm” |

**Rule (confirmed):** If Jazwyn’s published intent and Puppygirl’s local plan conflict, **Jazwyn wins**. Puppygirl may only **nack** (`gold` / `path` / `space`) — never silently do something else, and never start a hold/hunt on her own.

Merchant still **initiates** physical hops to the fighters’ server for delivery — that’s logistics execution, not competing command.

---

## 4. Shared state + low-bandwidth sync

### 4.0 Server rules that bound the design (verified in `kaansoral/adventureland` source, 2026-09-07)

| Rule | Source | Consequence |
| --- | --- | --- |
| **Code-originated chat: 1 message per 15 s per character** (`say` handler: `data.code && ssince(last_say) < 15 → chat_slowdown`). `last_say` is set by *any* successful say incl. human-typed, PM, and general chat. 400 ms floor for everything. | `node/server.js:4345-4354`; `js/runner_functions.js:1222` (`party_say` passes `safeties` → `code=true`) | V1's `PSAY_MS=5000` was **3× too fast — this is the throttle root cause**. Budget is **per writer**, not shared. |
| **CM is same-server only** (`players[name_to_id[name]]` on the local server; others silently omitted from `receivers`). | `node/server.js:4324-4337` | Puppygirl on another world is **deaf to CM**. `receivers` is a free reachability probe. |
| **PM crosses servers** (`xserver` relay) but counts against the same 15 s budget. | `node/server.js:4368,4380` | Only cross-world channel; use sparingly (hold summons). |
| `limitdc` = socket call-count over `limits.calls`, not chat. | `node/server.js:4147-4198` | Sim models call budget separately from chat budget. |
| Party members' `map,x,y,rip` are free via `get_party()`. | LESSONS §2 | **Never put coordinates on the wire.** |

### 4.1 Lessons from analogues (kept only where they earn their place)

| Field | Idea | Apply here |
| --- | --- | --- |
| **Event-triggered control** | Send only on meaningful change; enforce **min inter-event time** | Diff on change; hard **≥16 s** per character between chats (server rule + margin) |
| **Owner-writes / single-writer registers** | Each field has exactly one author → merge is trivial | Jazwyn owns `intent/mode/rare/dlv`; each fighter owns `members[me]`; no vector clocks |
| **Gossip** | Broadcast is best-effort | Periodic heartbeat re-asserts truth; no digest / anti-entropy protocol |
| **Leader–follower formation** | One reference trajectory | Jazwyn = reference; others track via party-list coords |

Dropped as overcomplication: δ-CRDT/version-vector merging, digest mismatch, `~F` full-sync requests.

### 4.2 Party state schema

```text
S = {
  seq: { Jazwyn:n, Sarene:n, Zarook:n },      // per-author sequence (gap detection only)
  lead: "Jazwyn",                              // fixed; succession rule in §3
  intent: { kind, mtype?, world?, hold?, t },  // author: leader
  mode: "farm"|"hold"|"rare"|"assemble",       // author: leader
  rare: null | { mtype, by, t },               // author: leader (coords come from spotter's party-list entry / seen entity)
  dlv:  null | { id, who, phase, t },          // author: leader (fighters are source of truth for their own job)
  members: {                                   // author: each member for itself
    <name>: { pots: "ok"|"low"|"dry", rip, task, gear?: "slot@lv,..." }
  }
}
```

**Not on the wire:** `x,y,map,hp,mp,server` (free from `get_party()`), raw pot counts (quantised to 3 buckets), Puppygirl (she is out of party and cannot read or write party chat; she lives only in Jazwyn's local view via CM).

### 4.3 Wire formats

**Party chat** — one writer **per field**, each writer ≤ 1 line / 16 s:

```text
~S f=armadillo m=farm h=0            // leader heartbeat (~1/min) = full sync by definition
~d p=low                             // member self-diff (author implied by sender)
~R phoenix                           // rare spot (spotter); coords via spotter's party-list entry
```

**CM → Puppygirl (same server only; check `receivers`):**

```text
{ seq, job: "dlv_pots"|"dlv_gear"|"meet_home"|"cancel_all", who, items?, farm?, ... }
```

**CM ← Puppygirl:** `{ seq, ack|nack:"gold"|"path"|"space", id }`, `{ status, id, phase }`, `{ status_req }` on boot. Never intents.

**PM (cross-world, 1/15 s):** only `hold`/`meet_home` summons when Puppygirl is on the other world.

### 4.4 Sync rules

1. **Outbound chat queue per character**: min **16 s** since last *successful* own chat (measured from own `partym` echo, and reset by human-typed chat from that character); newer `~S`/`~d` supersedes queued older one; **no retry inside the window**. This is the single mechanism that guarantees 0 throttle.
2. Boot: listen; the first `~S` heard is the full sync. Leader on boot listens one heartbeat cycle, re-seeds `seq` above anything heard, then publishes.
3. Diff only on bucket change (`pots` bucket, `rip`, `task`); heartbeat re-asserts everything ≤ 1/min.
4. Merge: owner's latest wins; leader fields never overridden by non-leaders regardless of `seq`.
5. Puppygirl: jobs go by CM **only when `receivers` includes her**; otherwise queue locally and PM a summons at most 1/15 s. Fighters are source of truth for their own `dlv`; Puppygirl `status_req`s on boot.
6. Instrument: `chat_throttle` (Mainframe log regex for "You can't chat this fast." — CODE cannot see the rejection), `sync_diff`, `sync_full`, `cm_unreachable`.

---

## 5. Behavior requirements (updated)

### A. Cohesion

- **Present** has hysteresis: enter when `vision ∧ dist < R_in`; exit only after `(¬vision ∨ dist > R_out)` for **≥ 20 s** (keeps V1's blind-leader tolerance). While leader `task=moving`, evaluate on party-list same-map + distance only; vision required only on arrival.
- Jazwyn: announce map-town / transfer **before** acting; **WaitParty** after. **WaitParty timeout ⇒ abort the move and re-anchor to followers** (never proceed split, which is what V1 did).
- Followers: never independent `go_farm` while partied with a leader.
- Fighters: **no world hop** unless user/`!world`/`hold` path.
- **Party re-formation**: after any hop, leader re-invites once `server_region` is set and she is on `main` (not in bank — LESSONS #9); followers accept only invites from the current leader.
- **Leader absent** (not booted / dead / disconnected): deterministic succession **Jazwyn → Sarene → Zarook** — the highest-priority *present* fighter acts as leader (invites, heartbeat). Not an election: when Jazwyn is present she is leader unconditionally, so there is no control fight. Leader `rip` → followers path to the corpse and guard; priest revives. Puppygirl with no leader CM for 5 min → idle econ on the farm world.

### B. Farming & rares

- Ladder + `!hunt` / `grind` under Jazwyn intent.
- **Rare interrupt FSM (MVP):** `idle → spotted → assemble → kill → resume`.
  - Spotter sends one `~R <mtype>` (subject to the 16 s queue). Leader may also switch on seeing a whitelisted `mtype` herself.
  - Assemble target = **spotter's party-list coords** (free), then the seen entity's coords. **Never `smart_move({to:"phoenix"})`** (LESSONS #6).
  - Exits: `assemble_timeout` (60 s) or `rare_gone` (spotter loses vision 20 s) → `resume`.
  - **No `restock_wait`**: `dry` fighters stand off and follow at range; others kill. Puppygirl is not involved in the rare path.
  - MVP rare list: **phoenix** (+ extend later).

### C. Supply

- Normal: field dlv, same world. Puppygirl's **idle world is the farm world** (so CM reaches her); she visits US/II only for a user `hold`/`meet_home`.
- **Gold float**: fighters keep `GOLD_FLOAT ≥ 2 × POTION_TARGET × price(current tier)`; gold offload only above it. Delivery handshake includes merchant→fighter `send_gold` top-up if a fighter is below float (fixes LESSONS #5).
- **Fallback trigger** = `pots == dry` ∧ (no delivery `status` progress for 90 s ∨ `cm_unreachable`). Fighter sends `cancel` for its job, then same-world town buy (instrumented `town_fallback`). Never a world hop for pots. Fixes LESSONS #7 race.
- **Space deadlock**: Puppygirl leaves town with ≥ 3 free slots reserved for take-backs; fighters vendor-sell junk if `esize == 0` and a delivery is pending.
- Any subset boots: works via succession rule above; requests no-op until merchant appears.

### D. Hold & gear (locked 2026-09-07)

- `hold` = user assemble tool (long-term). Automation never opens plaza hold for gear/pots.
- **Gear is a field logistics job**, same pipe as pots — fighters never hop for it:

```text
fighter state diff (worn slots@lv, esize)
  → Puppygirl wishlist per fighter (state + bank + her upgrade results)
  → strictly better piece && esize ≥ 1  ⇒  job dlv_gear {who,name,lv,slot}
  → batch onto pending pot run; standalone only if idle
  → hop to farm world → walk in → send_item → gear_offer
  → fighter equips → gear_got ok → tosses replaced piece back → bank
```

- **Trigger:** Puppygirl **pushes automatically** (no request, no leader approval). Jazwyn’s intent gates **timing only** (never during rare assemble/kill; nack `path`/`space` otherwise).
- **Sourcing (all decided; phased):** **MVP delivers an existing bank piece** (proves the pipe). **Post-gate:** buy vendor base gear and upgrade it (main progression path); Ponty whitelist buys; compound accessories (ringsj/hpbelt/amulets first). Gear is not in the 30‑min acceptance bar (§10).
- **Space:** Puppygirl reserves ≥ 3 free slots for take-backs; a fighter with `esize == 0` vendor-sells junk before accepting.
- **Risk (MVP):** conservative — scroll0 only, preview `chance ≥ 0.9`, max **+5**, **never UNIQUE/seasonal**, never candy/carrot. Upgrades happen in town during idle econ with gold above `GOLD_FLOAT`. `GEAR_RISK` stays a knob for later.
- **Equip score:** `item_properties`-based, class-legal, empty slot = 0 baseline, rings fill `ring1` then `ring2`; never `item_value`.
- **Keep rule:** delivered piece protected from bank dump by gift TTL until equipped.
- Carried from V1: merchant-only upgrading; `*_upgrade.js` fighter scripts stay archived; `gear_ad` CM replaced by worn-gear fields in the shared-state diff.

### E. Comms

- No Ding/Gratz/Ok.
- **One writer per field** (§4.2), each behind its own 16 s queue. Queue priority when several lines are pending: **user command echo > `~R` > `~d` > `~S`** (a newer instance of the same kind replaces the older).
- Death/combat → `game_log` only.
- Operator note: typing chat from a character's own client resets that character's 15 s window — issue test commands from Puppygirl or the merchant console, not from a fighter.

---

## 6. Sim-first architecture

### 6.1 Why

Live Mainframe is slow, costly, and hides races. V1 bugs were mostly **control/sync** *and* **pathing friction** — sim must catch both before we trust complex systems.

### 6.2 Pathing is a first-class fidelity target

Live pain is dominated by `smart_move` quirks: stuck mid-route, door/transport edges, bank↔main, town after fail, cross-map chase, vision vs party-list coords, stall storms. Sim must **exercise these**, not abstract them away as “teleport to dest.”

| Mode | Behavior |
| --- | --- |
| **Nominal** | Graph-ish path with travel time, doors/transports, vision radius |
| **Injected** | fail / stall / no-progress / wrong-spawn / blocked door (seeded) |
| **Calibrated** | latency + fail rates from **live path probes** (below) |

`al_env` today is too optimistic for long farms; V2 sim replaces “instant success” with a path engine + failure model.

### 6.3 Live path explorers (calibration, not product)

One-off Mainframe scripts (safe to redeploy over V1 temporarily) that **do not farm** — they walk instrumented routes and dump JSON:

- Town ↔ pot NPC ↔ bank ↔ each `FARM_XY` pack (same world)
- Cross-map: main↔cave, main↔winterland, main↔desertland (merchant-relevant)
- Field dlv: merchant approach to fighter on pack (vision+range)
- Failure cases: interrupt mid-`smart_move`, town-retry, stuck watchdog
- Record: `{from,to,ok,ms,reason,map_hops,town_used,stalls,final_xy}`

Fixtures land in `adventureland/sim/fixtures/paths/` and feed the sim’s delay/fail distributions. Re-run explorers when game patches change pathing.

### 6.4 Sim responsibilities

| Layer | Provides |
| --- | --- |
| **World** | **load the real `G`** (static JSON shipped with the client) for maps, doors/spawns, monster boundaries, NPC coords — no hand-built stub; vision radius + phoenix roaming as knobs |
| **Path engine** | `smart_move` / `move` / town with time + quirks from §6.2–6.3 |
| **Character runtime** | items, pots, rip, server id, levels/att caps; `upgrade`/`compound` with real `chance` + destroy-on-fail; item stat tables for equip scoring; bank/bag/esize; **`localStorage` survives hop, heap does not; `server_region` unset for N s after reload** |
| **Comms** | **server rules from §4.0 by construction**: 15 s code-chat + 400 ms floor per character (human chat resets it), same-server CM with `receivers`, cross-server PM, call-count `limitdc`; drop/reorder knobs |
| **Clock** | accelerate time; deterministic + Monte Carlo seeds |
| **Invariants monitor** | one module shared with the Mainframe observe scripts (see 6.5) |

### 6.5 Parity — how it is actually tested

`test_sim_parity` is three concrete checks, not a document:

1. **Rules by construction**: comms/persistence models cite `server.js` lines (§4.0) and have unit tests for each rule (e.g. two code chats 10 s apart → second rejected; human chat at t=0 → code chat at t=10 rejected; CM to off-server name → not in `receivers`).
2. **Shared invariant monitor**: the same module that grades sim traces also grades Mainframe log dumps. Replay `legacy/_live_farm_observe.json` and `legacy/_live_phoenix_observe_run.txt` and assert it reproduces the recorded verdicts (throttle count, hop count, together %, the 63× phoenix path storm).
3. **Path distributions**: per route class, sim `smart_move` duration/fail samples fall within the explorer fixture bands (§6.3).

**Confidence ladder:** unit path fixtures → short farm scenarios → **compressed 30 min farms** → Monte Carlo → only then Mainframe 30 min gate.

### 6.6 Integration + Monte Carlo (faster than realtime)

**Deterministic scenarios**

1. Boot orders/subsets: **enumerate** all 15 subsets × orderings (deterministic, not MC), incl. leader-absent succession and Jazwyn rejoining.
2. Compressed **30 min farm** (armadillo first; other packs in MC).
3. Dry pots → dlv success; merchant slow (status flowing) → fighter waits; merchant silent 90 s → `cancel` + same-world town fallback; fighter below gold float → top-up.
4. Phoenix spot mid-farm → assemble to spotter → kill → resume; `assemble_timeout` and `rare_gone` paths; no fighter hop.
5. User `hold` / `resume` / `!world`: **hop-prep** (restock on current world, `cancel_all` CM, then hop) → re-invite after settle → Puppygirl `meet_home` via PM.
6. Chat stress: 3 fighters + heartbeat + `~R` + user echo + operator typing on Jazwyn → 0 throttle; leader reboot re-seeds `seq`.
7. Path fail injection: no Transfer/Port / restock-fail storm; Puppygirl reload mid-job with `server_region` unset → no re-hop loop.
8. Gear push: dlv_gear (existing bank piece) batched with a pot run → fighter equips, tosses old piece → no hold, no fighter hop; both bags full → no deadlock.

**Monte Carlo (after deterministic suite is green)**

MVP axes: merchant latency / silence; path fail rates (calibrated bands); seed for spawns/drops.  
Post-MVP axes (still wanted, not gating): farm target sweep; party levels / att caps; rare spawn timing.

Pass criteria per N runs: `fighter_hop == 0`; `chat_throttle == 0`; `restock_fail ≤ 1 per 45 s window and ≤ 3 per 30 min`; **dlv success ≥ 95 %** of requested deliveries; failures dump seed + timeline for replay.

**Speed target:** one 30‑min-equivalent farm in **≪ realtime** (aim: seconds–tens of seconds wall clock) so hundreds of MC runs are practical in CI or overnight.

---

## 7. Publish pipeline (readable → 176)

See **[`PUBLISH.md`](PUBLISH.md)** for the operator guide. Summary:

```text
src/                    # documented, multi-file, testable — edit here
publish.manifest.js     # slot map (sources → dist name → MCP upload name)
tools/compress_code.js  # strip comments/whitespace, pack ≤176 lines (NO mangle)
dist/                   # generated; gitignored
publish.js              # CLI: --build / --upload / --test / --dry-run / --list
```

The limit is **lines, not bytes** (V1 shipped 87-line files with ~1 kB lines). The compressor joins statements after stripping comments; it **must** fail if any slot >176 lines. Dist smoke tests in `tests/test_dist.js` load built slots into the sim.

---

## 8. Precedence (single stack)

1. Rip / jail / hard safety  
2. **Hop-prep** — when user hold/`!world` is pending: restock on current world if below threshold, CM `cancel_all` to Puppygirl, *then* hop (encodes LESSONS #3, #4, #7)  
3. User hold / resume / world (the hop itself; then re-invite after settle)  
4. **Dry pots** — `cancel` own job if no progress → same-world town fallback (never a hop)  
5. Rare interrupt  
6. WaitParty / cohesion  
7. Field dlv / gear job (Puppygirl)  
8. Farm / follow intent  
9. Merchant econ idle  

One **motion owner** per character; planner only sets intent.

**Persistence across `change_server` (both roles):** fighter `{hold, intent, seq}`; merchant `{job queue with per-phase TTLs, hop_intent{server,t0}, last fighter world, seq}`. Gear re-located by `name+level`, never bag slot. Min interval between merchant hops (realm-hop debuff) and no hop evaluation until `server_region` is set.

**Hold persistence:** `hold` is a user tool, so it **persists until user `resume`** — no orphan auto-clear. Mitigation for "forgot to resume": the heartbeat shows `h=1` and Puppygirl's console reports it.

**Worked scenario** (Puppygirl mid `dlv_gear`, phoenix spotted, Sarene dry, user `hold`): Jazwyn → hop-prep (restock if needed, `cancel_all`) → hop → re-invite. Sarene → dry outranks rare → `cancel` own job → same-world buy (gold float guaranteed) → follows hold. Zarook → hold. Puppygirl → `cancel_all` received (same server) → drops gear leg, keeps gear in bag by name → receives PM `meet_home` → hops.

---

## 9. Instrumentation (problem cases)

Always `game_log` + counters (exported in Mainframe observe):

`chat_throttle` (log regex — CODE cannot observe the rejection), `sync_diff`, `sync_full`, `cm_unreachable`, `wait_party`, `wait_timeout`, `restock_fail`, `town_fallback`, `gold_topup`, `fighter_hop` (should stay 0 in MVP farm), `merchant_hop`, `rare_spot`, `rare_timeout`, `dlv_ack/nack/fail`, `motion_stall`, `smart_fail`.

---

## 10. MVP success bar (acceptance)

**Sim:** deterministic suite (§6.6 #1–8) green against `dist`; parity checks (§6.5) green.

**Mainframe (≥30 min observe, sampled every 20 s):**

- **0** "You can't chat this fast." lines in any character's logs (operator issues commands from Puppygirl, not a fighter).
- `restock_fail` ≤ 1 per 45 s window and ≤ 3 total.
- **Valid farming**: ≥ 90 % of samples have all booted fighters on the same map+server within R of `pack_center(intent.mtype)`, leader with a non-null target.
- **Precondition**: fighters start with ≤ 40 pots so a delivery is forced; ≥ 1 delivery completes (`dlv_done`) with no manual refill.
- **0** fighter world transfers by exact `region+ident` compare, unless the test issued `!world`/`hold`.
- **Boot-any-order**: a second, required run booting Zarook → Puppygirl → Sarene → Jazwyn passes the same bars.
- Gear: **post-gate** (not in MVP acceptance); scenario §6.6 #8 gates in sim only.

---

## 11. Still open (smaller)

Tune with sim + live probes, not opinion:

1. Present `R_in`/`R_out` (px) — needs the **measured vision radius** from an explorer first (sim tuning alone is circular); WaitParty timeout.  
2. ~~Sync diff threshold~~ — resolved: 3 pot buckets + `rip` + `task`.  
3. Heartbeat 60 s vs 45–90 s under load.  
4. Rare whitelist beyond phoenix for post-MVP.  
5. Exact published slot names after compressor exists.  
6. ~~GEAR_RISK / UNIQUE policy~~ — locked conservative (§5D); revisit after gate.  
7. Path-fail **rate bands** from explorers (per route class).  
8. MC suite size / CI budget once wall-clock known.  
9. Zero-chat rare detection: can the leader read visible followers' `.target` and switch without any `~R`? Verify field visibility on other players.

---

## 12. Phasing (next build order)

1. ~~Authority (§3)~~ confirmed. ~~Adversarial review~~ done 2026-09-07 (server-source facts folded into §4.0).  
2. **Sim skeleton**: real `G` world, clock, comms model from §4.0 with rule tests, path engine with fail injection, shared invariant monitor replaying V1 live logs.  
3. **Live explorers** (facts not in server source only): vision radius, path duration/fail bands per route class, reconnect + `server_region` delay, phoenix behavior.  
4. State sync (owner-writes, 16 s queues) + motion under Jazwyn intent + succession; supply incl. gold float + fallback; rare FSM.  
5. Deterministic suite #1–8 → Monte Carlo (MVP axes).  
6. Compressor (joiner + terser-no-mangle + line assert), suite re-run on `dist` → Mainframe 30 min gate.  
7. Post-gate: gear sourcing pipeline (§5D), remaining MC axes, rare whitelist growth.

---

*Analogues consulted: event-triggered multi-agent consensus (limited bandwidth), single-writer registers / owner-writes replication, gossip replication in swarms, leader–follower formation control. Server behavior verified against `kaansoral/adventureland` `node/server.js` and `js/runner_functions.js`.*
