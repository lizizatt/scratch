# Adventure Land party — V2.0 plan

**Status:** decisions locked (2026-09-07); authority confirmed; sim pathing + Monte Carlo scoped.  
**Goal:** sim-first rewrite with Jazwyn as sole combat/logistics commander, bandwidth-limited shared state, fighters almost never world-hop, and Mainframe proof that matches sim invariants.

---

## 0. Locked decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Worlds | **Keep dual world** (farm US/III, hold/home US/II). Fighter world hops are **rare** — only on explicit user/`!world`/`hold` command. **Merchant does ~99% of hops.** Restock = **same-world town**, never a world hop for pots. |
| 2 | Party chat | **~1/min high-level state summary** — human-readable **and** sync medium. |
| 3 | Sync architecture | Each character maintains **shared party state**. Sync via **party chat + direct CM to Puppygirl**. **Diff-based** unless first message or full-sync requested. |
| 4 | Social NL | **Remove** Ding/Gratz/Ok (comms load). |
| 5 | Present | **Vision ∧ range** (in vision and within formation/cohesion radius). |
| 6 | Rares | **Whitelist interrupt:** any member who **sees** a rare announces → assemble → Puppygirl restocks needy → kill → resume prior task. **Only Puppygirl may change servers.** MVP whitelist includes **phoenix**. |
| 7 | Gear / hold | **No plaza hold** unless user explicitly `hold`. Puppygirl **field-delivers upgrades** on request. Hold = **user utility to assemble**, not automation’s restock path. |
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
| Chat/CM rate limits | Event-triggered diffs + 1/min heartbeat; no social chatter. |
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

### 4.1 Lessons from analogues

| Field | Idea | Apply here |
| --- | --- | --- |
| **Event-triggered control** (multi-robot ETC) | Send only when error vs last-sent state exceeds a threshold; enforce **min inter-event time** (anti-Zeno / anti-throttle) | Diff sync only on meaningful change; hard ≥5s (or chat gap) between party sync lines |
| **Delta / δ-CRDTs** | Ship **deltas**, not full replicas; periodic anti-entropy / full snapshot | Diff messages by default; full sync on join, request, or digest mismatch |
| **Gossip / swarm** | Unreliable broadcast + local merge; don’t assume every peer heard every packet | Party chat = best-effort multicast; CM to Puppygirl = reliable unicast for jobs; merge by version vectors |
| **Leader–follower formation** (robotics) | One reference trajectory; others track | Jazwyn = reference; others FollowLeader |
| **Task allocation (CBBA-ETC)** | Negotiate only on high-value events | Rare-seen, dry pots, hold — not every tick |

We do **not** need full CRDT math in-game. We need the **shape**: last-sent snapshot, diff, full sync, min gap, deterministic merge.

### 4.2 Party state schema (sketch)

Each character keeps `S` (local estimate of shared truth) and `S_sent` (last broadcast):

```text
S = {
  v: number,              // monotonic per-author or vector clock lite
  lead: "Jazwyn",
  intent: { kind, mtype?, world?, hold?, t },
  members: {
    Jazwyn:  { map, x, y, hp, mp, pots, server, present?, rip, task },
    Sarene:  { ... },
    Zarook:  { ... },
    Puppygirl:{ map, x, y, server, job?, reachable? }
  },
  rare: null | { mtype, map, x, y, by, phase },  // interrupt FSM
  dlv: null | { id, who, phase },
  mode: "farm" | "hold" | "rare" | "assemble"
}
```

### 4.3 Wire formats

**Party chat (≤1/min heartbeat + event diffs):**

```text
~S f=armadillo h=0 w=US/III          // compact heartbeat (leader)
~d Jaz:m=main,x=520,y=1840,p=1       // diff fragment(s)
~F req=1                             // request full sync
~R phoenix@main:610,1800 by=Sarene   // rare spot (event)
```

**CM → Puppygirl (jobs + guaranteed logistics):**

```text
{ v, job: "dlv_pots"|"dlv_gear"|"meet"|"idle_home", ... }
{ v, nack: "gold"|"path"|"space", id }
```

**CM ← Puppygirl:** status / ack only (no competing intents).

### 4.4 Sync rules

1. On boot: `~F` full sync request; accept first full `~S` / peer dump.
2. Else: compute `diff(S, S_sent)`; if empty and `<60s` since heartbeat, stay quiet.
3. If diff non-empty and `now - last_chat >= gap`: send coalesced diff (or heartbeat if due).
4. Always mirror logistics-critical diffs to Puppygirl via CM (even if chat dropped).
5. Merge: higher `v` wins per field; leader `intent` always overrides follower guesses.
6. Instrument: `sync drop`, `sync full`, `sync diff`, `chat throttle` counters.

---

## 5. Behavior requirements (updated)

### A. Cohesion

- Present = **in vision and within range** (tune radius in sim; start ~`FORM_SMART`).
- Jazwyn: announce map-town / transfer **before** acting; **WaitParty** after; no leave until present (except user hold/world).
- Followers: never independent `go_farm` while party-with-leader.
- Fighters: **no world hop** unless user/`!world`/`hold` path.

### B. Farming & rares

- Ladder + `!hunt` / `grind` under Jazwyn intent.
- **Rare interrupt FSM:** `idle → spotted → assemble → restock_wait → kill → resume`.
  - Spotter announces once (rate-limited).
  - Assemble on **current server** to spotter/Jazwyn.
  - Puppygirl hops **to fighters** if needed; fighters don’t hop to her.
  - MVP rare list: **phoenix** (+ extend later).

### C. Supply

- Normal: field dlv, same world.
- Fallback: if Puppygirl unreachable N seconds → **same-world town** pot buy (instrumented); never world hop for pots.
- Any subset boots: solo/duo farm works; requests no-op until merchant appears.

### D. Hold & gear

- `hold` = user assemble tool (long-term).
- Automation never opens plaza hold for gear/pots.
- Upgrades: request → Puppygirl field deliver → equip.

### E. Comms

- No Ding/Gratz/Ok.
- One chat writer; priorities: **user command echo < rare event < sync diff < 1/min heartbeat**.
- Death/combat → `game_log` only.

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
| **World stub** | maps, doors/spawns, distance, vision radius, monsters (incl. phoenix), NPCs |
| **Path engine** | `smart_move` / `move` / town with time + quirks from §6.2–6.3 |
| **Character runtime** | items, pots, rip, server id, levels/att caps |
| **Comms** | party_say with **real rate-limit model**; CM with gap; drop/reorder options |
| **Clock** | accelerate time; deterministic + Monte Carlo seeds |
| **Invariants monitor** | together, no fighter hop, chat throttle=0, no restock-fail storm, dlv completes, path-storm=0 |

### 6.5 Parity claim (must be tested)

Suite `test_sim_parity` documents which invariants are enforced identically in sim vs observe scripts (attendance, hop policy, chat budget, dlv handshake, **path success/fail shape**). Gaps listed explicitly — no silent drift.

**Confidence ladder:** unit path fixtures → short farm scenarios → **compressed 30 min farms** → Monte Carlo → only then Mainframe 30 min gate.

### 6.6 Integration + Monte Carlo (faster than realtime)

**Deterministic scenarios**

1. Boot orders: all permutations of 1–4 characters.
2. Compressed **30 min farm** (armadillo and other ladder packs).
3. Dry pots → dlv success; merchant delayed; merchant missing → same-world town fallback.
4. Phoenix spot mid-farm → assemble → kill → resume (no fighter hop).
5. User `hold` / `resume` / `!world` (only then fighter hop).
6. Chat stress: throttle counter stays 0 under sync+rare+heartbeat.
7. Path fail injection: no Transfer/Port / restock-fail storm.

**Monte Carlo (goal once wall-clock allows)**

Vary seeds across:

- farm target (`FARM_XY` ladder packs)
- party levels / att caps (ladder choice)
- boot order / subset (1–4 chars)
- merchant latency / temporary silence
- path fail rates (calibrated bands)
- rare spawn timing (phoenix)

Pass criteria: invariant rates (0 fighter hop, 0 chat throttle, restock-fail storm=0, dlv success ≥ threshold) hold across N runs; failures dump seed + timeline for replay.

**Speed target:** one 30‑min-equivalent farm in **≪ realtime** (aim: seconds–tens of seconds wall clock) so hundreds of MC runs are practical in CI or overnight.

---

## 7. Publish pipeline (readable → 176)

```text
src/           # documented, multi-file, testable
  party_state.js
  motion.js
  leader.js
  ...
tools/compress_code.js   # minify/pack lines; strip comments; optional name mangle
dist/          # ≤176 lines / slot — what deploy_mcp publishes
tests/         # run against src (and optionally re-run critical tests on dist)
```

Compressor **must** fail CI if:

- any slot >176 lines after compress, or  
- golden behavioral tests differ src vs dist.

Slot refactor is allowed; target ~6–7 published names.

---

## 8. Precedence (single stack)

1. Rip / jail / hard safety  
2. User hold / resume / world  
3. Rare interrupt  
4. WaitParty / cohesion  
5. Field dlv / gear job (Puppygirl)  
6. Farm / follow intent  
7. Merchant econ idle  

One **motion owner** per character; planner only sets intent.

---

## 9. Instrumentation (problem cases)

Always `game_log` + counters (exported in Mainframe observe):

`chat_throttle`, `sync_diff`, `sync_full`, `wait_party`, `wait_timeout`, `restock_fail`, `town_fallback`, `fighter_hop` (should stay 0 in MVP farm), `rare_spot`, `dlv_ack/fail`, `motion_stall`, `smart_fail`.

---

## 10. MVP success bar (acceptance)

**Sim:** full integration suite green (incl. scenarios in §6.4).  

**Mainframe (≥30 min observe):**

- 0 `can't chat this fast`  
- 0 restock-fail storm  
- Valid farming (on pack / hunting assigned target)  
- ≥1 successful Puppygirl field delivery without manual refill  
- **0 fighter world transfers** unless test explicitly issued `!world`/`hold`  
- Boot-any-order smoke (optional second run)

---

## 11. Still open (smaller)

Tune with sim + live probes, not opinion:

1. Present **range** (px) and WaitParty **timeout**.  
2. Sync **diff threshold** (what counts as “changed enough”).  
3. Heartbeat **60s** vs 45–90s under load.  
4. Rare whitelist beyond phoenix for post-MVP.  
5. Exact published slot names after compressor exists.  
6. GEAR_RISK / UNIQUE policy (unchanged until gear pass).  
7. Path-fail **rate bands** from explorers (per route class).  
8. MC suite size / CI budget once wall-clock known.

---

## 12. Phasing (next build order)

1. ~~Authority (§3)~~ **confirmed** — Jazwyn wins; Puppygirl typed nacks only.  
2. Agree **wire alphabet (§4.3)** compactness vs readability (can parallel).  
3. **Sim skeleton + path engine** (even before full V2 bots) — replay fixtures + fail injection.  
4. **Live path explorers** → fixtures → calibrate sim.  
5. State sync + motion under Jazwyn intent; rares; compressor.  
6. Compressed 30 min farms → Monte Carlo → Mainframe 30 min gate.

---

*Analogues consulted: event-triggered multi-agent consensus (limited bandwidth), δ-CRDT / delta sync, gossip replication in swarms, leader–follower formation control.*
