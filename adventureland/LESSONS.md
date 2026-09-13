# LESSONS.md — server-specific facts learned from V1 (drives sim design)

**Purpose:** everything we learned the hard way about how the real Adventure Land server / client / Mainframe behave, with evidence, so the V2 simulator reproduces the *same* invariants and friction. V1 slot code was removed; path cites below name historical files (`fighter_core.js`, `gear_ops.js`, …) not live paths. Chat cites are `chat L<n>` — user reports of live behavior are primary evidence.

**Confidence tags:** `SRC` = read from the open-source server/client (`kaansoral/adventureland`) · `LIVE` = observed on the real server (artifact / user report / Mainframe contract) · `CODE` = inferred from a historical V1 workaround · `ASSUMED` = believed, unverified — expose as a sim knob and let an explorer measure it. **Check `SRC` before building an explorer** — several "unknowns" turned out to be readable.

**V2 constants live in `src/constants.js`** (`CHAT_GAP_MS=16000`, `JOB_MS=480000`, `GOLD_FLOAT_FIGHTER=100000`, `GOLD_FLOAT_MERCHANT=150000`). §7 table below is **V1 historical** — do not treat it as current bot truth.

---

## 0. TL;DR for the sim designer

The fake env we tested against (V1 (removed)) passed **430 tests** while the live party still wandered and got chat-throttled. The gap *is* the lesson:

| Real server | What `al_env.js` modeled | Consequence |
| --- | --- | --- |
| `smart_move` takes seconds–minutes; stalls, fails, routes via town/doors/tunnels | Instant teleport, always succeeds unless `env.moveFail` (`al_env.js:469-526`) | Every race between "moving" and "state changed" was invisible |
| Party chat and CM are rate-limited ("You can't chat this fast", `limitdc`) | `party_say` = array push (`al_env.js:283`); `send_cm` unlimited (`:285`) | Chat storms never failed a test |
| `get_player` returns only entities in **vision** | `get_player` = `parent.entities[name]` (`al_env.js:528`) | "Party list says they're here but I can't see them" never happened in tests |
| Straight-line motion blocked by walls/water; islands need tunnels | `can_move_to` = one hard-coded rectangle (`al_env.js:429`) | Spider-island "stuck on the coast" (chat L1638, L1908) |
| `change_server` reloads the page — heap wiped | Sets two fields (`al_env.js:464`) | Persist-across-hop bugs only surfaced live |
| Time passes: cooldowns, pot safeties, respawns, spawns | Cooldowns always ready (`is_on_cooldown: () => false`, `al_env.js:555`); `sleep` resolves instantly (`:269`) | Nothing about pacing was tested |
| `stop("smart")` cancels only the smart route | `stop()` ignores its arg (`al_env.js:281`) | Cancel semantics untested |
| Server id must be compared exactly | n/a | `/US II/` regex matched `US III` (`live_farm_observe.js:5,168`) |

**Sim must have:** a clock; a path engine with travel time, obstacles and a failure model; a chat/CM budget that *errors and can disconnect*; a vision radius distinct from party-list knowledge; a reload-on-hop runtime with `localStorage`; seeded randomness. Everything below is detail for those.

**Mainframe's own definitions we should match** (`LIVE` V1 (removed)):

```text
traffic:     requested_actions_not_confirmation
observation: authenticated_game_server_events
movement:    confirmed_position_and_map_changes_only
stuck:       stationary_for_15s_with_10_recent_move_requests
```

That last line is a ready-made sim invariant: **stuck = 15 s stationary with ≥10 move requests**.

---

## 1. Movement & pathing

### 1.1 `smart_move` semantics
- Returns a promise that may **resolve** `{failed:1, reason}` **or reject** `{reason}`; legacy normalizes both in every call — `CODE` `fighter_core.js:59` (`chase_leader`), `:62` (`restock`), `:73` (`go_farm`); `gear_ops.js:23` (`dlv_smart`).
- `smart.moving` is the global in-flight flag; code refuses to start a second route while set — `CODE` `fighter_core.js:62,73`.
- `stop("smart")` cancels the route; used on hold/hunt/world commands, on hearing the leader's leave announcement, on stuck, and on formation arrival — `CODE` `fighter_core.js:64,71,82`.
- **Stuck detection:** no `real_x/real_y` change for `SMART_STUCK_MS=20000` while `smart.moving` → `stop("smart")` — `CODE` `fighter_core.js:84`; test `tests/test_class_scripts.js:261`. Merchant `dlv_smart` adds a hard watchdog: **90 s same-map / 180 s cross-map** — `CODE` `gear_ops.js:23`.
- `smart_move({to:"<mtype>"})` works for packs with a fixed spawn; for a roaming rare it fails → V1 fell back to `use("town")` and retried forever: **63× "Off to phoenix", 52× "Port town"** in a 12‑min run — `LIVE` `_live_phoenix_observe_run.txt:66-230`, `_live_phoenix_observe.json` (`cohesion.announces`). **Never path to a rare by type; only to a *seen* entity's coordinates.**
- Cross-map failure recovery = `use("town")`, `sleep(1500–2000)`, retry — `CODE` `fighter_core.js:58-59`; test `test_class_scripts.js:347`.
- Named targets (`{to:"bank"}`, `{to:"potions"}`, `{to:"upgrade"}`) fail intermittently on Mainframe; **coordinates first**, names as fallback — `CODE` `fighter_core.js:61-62` (bank `0,-50` → `{to:"bank"}`; pots `56,-122` → `40,-120` → `{to:"potions"}`; upgrade `{to:"upgrade"}` → `-207,-220`).
- `BUSY_MS=60000` clears a hung logistics `busy` flag and stops smart — `CODE` `fighter_core.js:5,83`.

### 1.2 Straight-line pathing traps (all live)
- **Spider island:** visible from town but reachable only via tunnel; fighters and merchant beelined and sat on opposite coasts for hours — `LIVE` chat L1301, L1638, L1908. Fix: exclusion zones; `al_env.js:429` encodes one (`main x 304..688, y -300..120`). Policy fallout: `FARM_BAN = spider/scorpion/bigbird` — `CODE` `fighter_core.js:4`, `README.md:58`.
- **Interiors:** merchant stuck in `winter_inn` — `LIVE` chat L2111; legacy special-cases `jail/winter_inn/winter_cave/bank` before any delivery move — `CODE` `gear_ops.js:24`.
- **Walls while healing:** priest beelining to a teammate — `LIVE` chat L345 → heal only after arrival.
- **Training dummy:** `target` monster in town is attackable; bot locked onto it — `LIVE` chat L132; skip `unlist` / `*target*` — `CODE` `fighter_core.js:74`.
- **Jail:** exit with `leave()` + `sleep(1000)`, not town — `CODE` `fighter_core.js:73`, `merchant_ops.js:35`.
- **Bank as a trap:** merchant immobile 120 s+ at `bank 0,-37` — `LIVE` `_live_observe_all.json`.

### 1.3 Coordinates (seed data for the sim world)

| Place | Coords | Evidence |
| --- | --- | --- |
| Pot NPC / plaza hang | `main 56,-122` (alt `40,-120`) | `fighter_core.js:47,61-62`, `merchant_ops.js:36` |
| Bank interior target | `bank 0,-50`; observed sit `0,-37` | `fighter_core.js:62`; `_live_phoenix_observe_run.txt:49` |
| Bank exit / merchant plaza | `main 40,-20` | `merchant_ops.js:36,80`, `gear_ops.js:24` |
| Upgrade NPC | `main -207,-220` (env uses `-204,-129` — **wrong**) | `fighter_core.js:62` vs `al_env.js:505` |
| Ponty / secondhands | `main 106,-47` | `merchant_ops.js:36` |
| Gear handoff meet | `main -100,-180` | `live_party_verify.js:90` |
| Town spawn after `use("town")` | `main ~0,0` / observed `68,-34` | `al_env.js:450`; `_live_dry_run.txt:49` |
| Desertland join spawn | `0,0`, `±48,56` | `_live_phoenix_observe_run.txt:49-53` |
| Pack centers | `FARM_XY` table | `fighter_core.js:72`; live multi-spawn `_pack_locs.json` (bee ×5, bat ×5, snake also in `halloween`) |

Pack geometry from `G.maps[map].monsters[]` — `boundary:[x0,y0,x1,y1]` or `position:[x,y]`+`radius` — `CODE` `gear_ops.js:21-22`. **Sim must not assume one pack per mtype.**

Maps touched: `main, bank, cave, winterland, winter_inn, winter_cave, desertland, halloween, jail, mtunnel` — `CODE` `fighter_core.js:62`, `al_env.js:443`.

### 1.4 `move()` vs `smart_move`
- `move(x,y)` = straight-line nudge; used for combat approach and formation inside `FORM_SMART=220`; `smart_move` beyond — `CODE` `fighter_core.js:71`, `warrior.js:23`, `mage.js:13`, `priest.js:30`.
- `is_moving(character)` gates combat ticks — `CODE` `warrior.js:3`.
- Prefer `real_x/real_y` over `x/y` everywhere — `CODE` `fighter_core.js:69`.
- Formation: `FORM_NEAR=18`, `FORM_FAR=40`, `FORM_SMART=220`, re-anchor only after leader moves ≥`FORM_REANCHOR=70` (kills jitter) — `CODE` `fighter_core.js:5`; offsets mage `{-45,55}`, priest `{45,55}` face-relative — `mage.js:18`, `priest.js:36`.

---

## 2. Vision, entities, party list

- `get_player(name)` = **vision only**; `get_party()` gives `map, x/real_x, y/real_y, rip` (sometimes `level, max_hp`) for all members regardless of distance — `CODE` `fighter_core.js:54,69`; `FIELD_DELIVERY_PLAN.md:23`.
- **Blind-leader case:** leader in party list, same map, within `FORM_SMART`, but `get_player` null → tolerated **20 s** (`lead_blind_since`) then treated as gone — `CODE` `fighter_core.js:69`; test `test_class_scripts.js:813`.
- Party coords can be **stale, map-less, or missing** — every consumer guards `real_x!=null?real_x:x` and `p.map` — `CODE` `fighter_core.js:54,59,69`.
- Finding a fighter cross-map: `get_player` → req/beacon `map,x,y,server` → `pack_center(farm)` — `CODE` `gear_ops.js:22-24`. `live_dump_pots` falls back `get_player → parent.entities → get_party()` — `fighter_core.js:40`.
- Ranges used: `send_item`/`send_gold` **320** (`SEND_RANGE`, `gear_ops.js:2`; gold offload `fighter_core.js:46`), loot toss 400 (`fighter_core.js:44`), pot-dump approach 280 (`:40`), taunt peel 200 (`warrior.js`), `mluck` 320 (`G.skills.mluck.range`, `merchant.js:125`). Exact `send_gold` limit — `ASSUMED` (env says 400, `al_env.js:414`).
- `send_item`/`send_gold` failures: `no_target | map | distance | no_space` — `CODE` `al_env.js:387-414`, `FIELD_DELIVERY_PLAN.md:22`.
- V1 "together" = all party same map, within `FORM_SMART*2.5=550` — `CODE` `fighter_core.js:54`. Live spread: **1334 px** while nominally farming, **96 px** when actually together — `LIVE` `_live_farm_observe.json`, `_live_phoenix_observe.json`.
- `get_nearest_monster({type,max_att,no_target})`; `att_cap() = max(8, floor(peak_max_hp*0.24))` — `CODE` `fighter_core.js:15,73`; `warrior.js:8`.

---

## 3. Chat & CM (the throttle)

**Resolved from server source** (`github.com/kaansoral/adventureland`, verified 2026-09-07) — tag `SRC`:

- **Code chat limit = 1 message per 15 s per character.** `socket.on("say")`: `if (data.code && player.last_say && ssince(player.last_say) < 15) return fail_response("chat_slowdown")`; plus a **400 ms** floor for any chat; `player.last_say` set on every successful say (party, PM, general, **human-typed included**) — `SRC` `node/server.js:4345-4354`. CODE's `party_say(message)` → `parent.party_say(message, safeties)` so it always carries `code=true` — `SRC` `js/runner_functions.js:1222-1228`. **V1's `PSAY_MS=5000` was 3× too fast — that is the root cause of every throttle we saw**, not "everyone announcing" per se.
- **CM is same-server only.** `socket.on("cm")` resolves `players[name_to_id[name]]` on the local server; off-server names are silently omitted from the returned `receivers` (free reachability probe) — `SRC` `node/server.js:4324-4337`. **A merchant on another world cannot receive CM.**
- **PM crosses servers** (`xserver` relay) and shares the 15 s code-chat budget — `SRC` `node/server.js:4368,4380`.
- **`limitdc`** is the socket **call-count** limit (`limits.calls`), not chat — `SRC` `node/server.js:4147-4198`. Sim needs a separate call budget.

Live history:

- **"You can't chat this fast."** hit all three fighters, never the merchant — `LIVE` chat L1190, L1354, L1367, L3092. `limitdc` from socket spam in the bank — `LIVE` chat L1092.
- V1 mitigation: `PSAY_MS=5000` gap, `PSAY_Q_MAX=8` queue, `~s` supersedes older `~s`, dup-suppress, re-queue on fail — `CODE` `fighter_core.js:29`. **Own party_say echo resets `last_psay`** (correct instinct; the constant was wrong) — `fighter_core.js:82`. Clean run: `throttle:0` — `LIVE` `_live_farm_observe.json`.
- `send_cm` pacing `CM_GAP_MS=700` — `CODE` `fighter_core.js:36`, `gear_ops.js:15`. CM has no 15 s rule but counts toward the call budget.
- `game_log` is local/free; used for ops logs. Party chat = humans + `~s` sync + `!cmd` — `CODE` `FIELD_DELIVERY_PLAN.md:141`.
- Hooks: `character.on("partym")`, `on("cm")`, `on("pm")`, global `on_party_invite` — `CODE` `fighter_core.js:50,87`.
- Commands: `!hold !resume !grind !hunt <m> !world <R/I>` applied **including speaker** — `fighter_core.js:78,82`. Status `~s h=0|1 f=<m> w=US/III` every `STATE_MS=20000` (leader) — `:76`.
- Delivery CM vocabulary: `dlv_req/ack/loc(+ping)/need_q/need/here/sent/got/done/loot_q/loot_done/status/cancel` — `CODE` `fighter_core.js:41-43`, `gear_ops.js:25-31`; live lines `dlv:req … @US/III cave -60,-480`, `dlv:here … dist=2`, `dlv:survey n=3 buy=hpot1:404+mpot1:403` — `LIVE` `_live_dry_run.txt:55-250`.

---

## 4. Servers / worlds

- Server key formats seen: `region:"US", ident:"III"` → `US/III`; `runtime.server:"US III"` — `LIVE` `_live_phoenix_observe_run.txt:49`, `_live_dry_run.txt:49`. **Compare exactly** — `/US II/` matched `US III` — `CODE` `live_farm_observe.js:5,168-170`.
- `change_server(region,id)` **navigates the page; heap wiped**. Persistence is **`localStorage`** (not AL `set/get`): `hold_<name>`, `dlv_q_<name>`, `gear_sess_<name>` — `CODE` `fighter_core.js:7,10`, `gear_ops.js:9-10,44,51`; commits `0b44b01`, `8982a32`.
- **`parent.server_region/identifier` are unset for a while after link/reload**; `go_s` defers with `go_s:wait` every 10 s — `CODE` `fighter_core.js:12`; `LIVE` `_live_phoenix_observe_run.txt:62,65`, `_jaz_logs.json:36`. Fighters log `LIVE_SRV ?/?` briefly.
- Reconnect after hop: tens of seconds; harness waits 55–60 s after disconnect and up to 180 s for `game_connected` — `CODE` `live_party_verify.js:126,216`, `live_farm_observe.js:282`. Distribution — `ASSUMED`, explorer item.
- **Realm-hop debuff** for repeated hops — `LIVE` chat L2841.
- Joining a world then entering the bank **invalidated the pending party invite** — `LIVE` chat L1425.
- Naming trap: fighters `HOME=US/II, FARM=US/III`; merchant `HOME=US/III` (tracks farm); gear `GEAR_HOME=US/II` — `CODE` `fighter_core.js:5`, `merchant.js:2`, `gear_ops.js:44`.
- Merchant II↔III hop loop while fighters held — `LIVE` chat L2759; farm observe classifies any leave-III as unnecessary — `live_farm_observe.js:72-76,332`.

---

## 5. Combat / stats / potions

- Warrior: `charge` when out of range, `taunt` peel ≤200, `cleave` if MP ≥75 % — `CODE` `warrior.js:12-35`. Priest: `curse` at MP ≥70 %, `partyheal` if ≥2 below 80 % or one below 35 %, `revive` needs `essenceoflife` — `priest.js:2-32`. Mage assists leader target only; **no burst/magiport live** — `mage.js`, `FIGHTER_PLAN.md:9`.
- `ready(s) = can_use(s) && mp && level` — `fighter_core.js:75`. Env: `can_use` always true — `al_env.js:554`.
- MP starvation stall → mana pot threshold 50 % — `LIVE` chat L158. Potion use gated by `min(200, ping*3)` and `is_on_cooldown("use_hp")`; tier flip at level 30 (`hpot0→hpot1`) — `CODE` `fighter_core.js:13,48`.
- Death: `handle_death` schedules `respawn` +15 s — **not wired in `boot_fighter`** (`ASSUMED` dead code) — `fighter_core.js:85`.
- Ladder needed repeated retuning (red scorpions, "overlevelled at 45", boars→bats) — `LIVE` chat L1190, L1129, L2163 → **party level/gear is a Monte Carlo axis**.
- Town goos steal the pull after death (level/HP reset) → peak-HP memory — `CODE` `fighter_core.js:14,30`, `README.md:52`.
- Inventory: 42 slots; items `{name,q,level,l(locked),oo(orig owner),rid,src:"scnd",grace}`; `character.esize` free slots; `character.q.{upgrade|compound}.ms` for long actions — `LIVE` `_char_Jazwyn.json:88-96`; `CODE` `warrior_upgrade.js:102`.

---

## 6. Economy / NPCs / bank

- Bank ops only on `map==="bank"`; `character.bank = {gold, items0..N}` (42 each); nulled on leaving (`_bank` snapshot kept) — `CODE` `merchant_ops.js:9-15,41-42`; `LIVE` `_bank_snap.json`. `bank_store(i)`, `bank_retrieve(pack,i)`.
- Stand: `parent.open_merchant(slot)` / `close_merchant()`; `trade()` fails unless open; **open stand blocks travel** — `CODE` `merchant.js:74-84`, `gear_ops.js:67`; `slot_occuppied` spam — `LIVE` chat L662.
- Ponty loop (open→close→ponty→nothing) — `LIVE` chat L858. `get_secondhands()` → `rid/price`; `buy_secondhand(rid)` — `gear_ops.js:43`.
- Upgrade: `upgrade(i, scroll, null, true)` preview → gate `chance ≥ 0.9` — `gear_ops.js:42`; compound `cscroll0|1|2` by grade — `merchant_ops.js:8`.
- **Zero-gold/zero-pot deadlock** when fighters had given gold to an absent merchant — `LIVE` chat L2780, L2789, L2827. V1 fighters kept ~1000 gold float; **V2** uses `GOLD_FLOAT_FIGHTER=100000` / `GOLD_FLOAT_MERCHANT=150000` (`src/constants.js`).
- Buy pots on the **current** server after a hop (stocked on II, needed on III) — `CODE` `gear_ops.js:59`, `FIELD_DELIVERY_PLAN.md:225`.
- `performance_trick()` on boot for unfocused tabs — `merchant.js:173`.

---

## 7. Timing constants (what each protects)

| Const | Value | Protects against | Where |
| --- | ---: | --- | --- |
| `PSAY_MS` / `PSAY_Q_MAX` | 5000 / 8 | chat throttle / unbounded queue | `fighter_core.js:5,29` |
| `CM_GAP_MS` | 700 | CM capacity | `fighter_core.js:36`, `gear_ops.js:15` |
| `SMART_STUCK_MS` | 20000 | no-progress smart_move | `fighter_core.js:84` |
| `dlv_smart` watchdog | 90000 / 180000 | hung route same/cross map | `gear_ops.js:23` |
| `BUSY_MS` | 60000 | stale busy flag | `fighter_core.js:83` |
| `FARM_GO_MS` | 10000 | go_farm re-entry | `fighter_core.js:73` |
| `STATE_MS` | 20000 | `~s` spam | `fighter_core.js:76` |
| `GEAR_AD_MS` | 20000 / 60000 | gear-ad CM spam / stale ads | `fighter_core.js:80`, `gear_ops.js:44` |
| `REQ_COOLDOWN_MS` | 60000 | pot request storm | `fighter_core.js:41` |
| `ACK_MS` / `PENDING_MS` | 20000 / 480000 | lost ack / stale pending | `fighter_core.js:41` |
| `BEACON_MS` | 8000 | loc beacon spam | `fighter_core.js:42` |
| `JOB_MS` / `GOT_MS` / `SURVEY_MS` / `OFFER_MS` | 300000 / 20000 / 12000 / 20000 | merchant job TTL, got wait, survey, offer | `gear_ops.js:2-3` |
| status tell throttle | 12000 | `dlv_status` spam | `gear_ops.js:19` |
| `CYCLE_MS` | 300000 | merchant econ thrash | `merchant.js:1` |
| restock-fail backoff | 45000 | restock fail storm | `fighter_core.js:62` |
| rare retry | 45000 | phoenix path-fail loop | `fighter_core.js:73` |
| leader blind | 20000 | party-list vs vision flap | `fighter_core.js:69` |
| orphan hold clear | 90000 | hold persisted, no merchant | `fighter_core.js:87` |
| `wait_party` | 90000 | infinite wait | `fighter_core.js:57` |
| `go_s` wait log | 10000 | region unset after load | `fighter_core.js:12` |
| invite / gold gaps | 5000 / 2500 | invite / send_gold spam | `fighter_core.js:51,46` |
| pot safety | `min(200, ping*3)` | pot flood | `fighter_core.js:48` |
| town / leave sleep | 1500–2000 / 1000 | teleport settle | `fighter_core.js:58,73` |
| respawn | 15000 | premature respawn | `fighter_core.js:85` |
| gift TTL / gear session TTL | 120000 / 180000 | gifted gear dumped / stale session | `fighter_core.js:19`, `gear_ops.js:59` |
| tick rates | fighters 2.5 s logistics + 250 ms combat; merchant 10 s | — | `fighter_core.js`, `merchant.js` |
| Mainframe relink wait / connect wait | 55–60 s / ≤180 s | auth release / boot | `live_party_verify.js:216,126` |
| `FORM_NEAR/FAR/SMART/REANCHOR`, `FARM_NEAR` | 18/40/220/70, 60 px | formation thrash | `fighter_core.js:5` |

Plan docs still cite `ACK 15s` / `JOB 180s` in places; the table above is **V1 historical**. Current V2 values are in `src/constants.js`.

---

## 8. Failure modes seen live → fix (regression list for the sim)

| # | Symptom | Root cause | Fix / lesson | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Chat throttle on all fighters | hold PMs ×3 + everyone announcing; 250 ms gear ads | CM-only commands; single announcer; 5 s gap; ads 3–20 s | chat L1354-L1367 |
| 2 | Stuck on coast heading to spiders | straight line across water | exclusion zones; `FARM_BAN` | chat L1301, L1638, L1908 |
| 3 | Restock fail loop | hold hopped HOME before restock; retry every 2.5 s | restock before hop; 45 s backoff; coords first | chat L2924; `fighter_core.js:62,86`; test `test_class_scripts.js:1100` |
| 4 | Merchant II↔III hop loop | gear pending vs hold state | persist gifts; no hop while pending | chat L2759; `8982a32` |
| 5 | 0 gold / 0 pots deadlock | fighter gold given away, merchant absent | fallback must not need fighter gold | chat L2780-L2827 |
| 6 | Phoenix "Off to / Port town" ×63 | `smart_move({to:"phoenix"})` — no fixed spawn | path only to seen coords | `_live_phoenix_observe_run.txt` |
| 7 | Fighter towns while merchant en route | dry-pots town race vs ack'd delivery | wait for ack'd delivery | `_live_dry_run.txt:82-120` |
| 8 | `limitdc` in bank | socket spam | pace bank ops | chat L1092 |
| 9 | Party invite lost after bank | map change invalidates invite | invite after settling | chat L1425 |
| 10 | Merchant stuck in inn / bank | unhandled interior; bank sit | interior exits before pathing | chat L2111; `gear_ops.js:24`; `_live_observe_all.json` |
| 11 | Priest wall-stuck healing | beeline heal | heal on arrival | chat L345 |
| 12 | Party split 1334 px while "farming" | independent `go_farm` per fighter | one motion owner | `_live_farm_observe.json` |
| 13 | `go_s:wait` after link | `server_region` unset | defer hop; keep farming | `fighter_core.js:12`; phoenix run |
| 14 | Hold survived reload → stuck on II | `hold_<name>` in localStorage | orphan-hold clear 90 s | `fighter_core.js:87` |
| 15 | Bought pots on wrong server | stock before hop | buy after hop | `gear_ops.js:59` |
| 16 | `US III` treated as `US II` | prefix regex | exact compare | `live_farm_observe.js:5` |
| 17 | Stand open → can't move | stand state | close before travel | `gear_ops.js:67` |
| 18 | Multi-line CODE inject rejected | AL editor | single-line injects | `live_phoenix_observe.js:74` |

---

## 9. Mainframe MCP (test-harness facts)

- `POST https://adventure.land/mcp`, Streamable HTTP, `Authorization: Bearer <token>` from `.al_mcp_token` (**never commit; it leaked once in chat L632 — rotate if in doubt**); sticky `mcp-session-id` header; JSON-RPC `initialize` → `notifications/initialized` → `tools/call`; results as JSON text in `content[].text` — `CODE` `live_mcp.js:26-66`.
- Tools used: `mainframe_get_dashboard`, `list_codes`, `get_code`, `save_code{slot,name,code}` (readback-verify), `mainframe_link_character{character,request_id,code_slot,server:"US III"}`, `mainframe_disconnect_character`, `mainframe_get_character` (`profile` stale vs `runtime.observation` live; `runtime.game_connected`), `mainframe_get_logs{character,limit}` → `{logs:[{at,values[]}]}` — `CODE` `deploy_mcp.js`, `live_farm_observe.js:161-186,350`; `LIVE` `_jaz_logs.json`.
- Slots: numeric 1–8 shared + `CH_*` per character; **≤176 lines/slot** (editor limit, chat L44); deploy asserts it — `live_farm_observe.js:142`. `save_code` does **not** restart running CODE (Stop/Run or relink) — `deploy_mcp.js:188`.
- Billing: 1 shell/period; period 60/50/45/40 min for 1–4 chars; Steam free hours first; **up to 3 code-started workers share one microVM (192 MiB)** — `LIVE` `_char_Jazwyn.json:5-57`.
- Log retention 30 days; `assignment_id` per run — `_jaz_logs.json`.
- Link may need 3–4 retries; disconnect→relink needs ~55–60 s — `live_farm_observe.js:276-283`.
- No remote eval; every iteration = deploy → relink → read logs (minutes). **This is why the sim exists.**
- Legacy cookie path `POST /json_api/save_code` still exists — `deploy.js:47-64`.

---

## 10. Sim requirements distilled (checklist)

1. **Clock** with acceleration; all `*_MS` above become testable.
2. **Path engine**: per-route travel time, obstacles (water/tunnel/doors/interiors), `smart_move` fail/reject/stall modes, `stop("smart")`, Mainframe stuck rule (15 s / 10 requests), `use("town")` + `leave()` semantics.
3. **Vision radius** separate from party list; party coords stale/map-less; `send_item` 320 + same map + esize.
4. **Comms budget**: party_say and CM token buckets that raise "can't chat this fast" and escalate to `limitdc`; self-echo counts.
5. **Server hop = runtime restart**: heap gone, `localStorage` survives, `server_region` unset for N s, reconnect delay, hop debuff, invites dropped by map change.
6. **World data from G**: multi-pack spawns, boundaries, `unlist` dummies, NPC coords; rare with no fixed spawn (phoenix) that may never appear.
7. **Character runtime**: 42 slots, `q`, cooldowns/`can_use`, pot safeties, level/att ladder as MC axis, death/respawn.
8. **Merchant**: bank only on bank map, stand blocks motion, buy-on-current-server.
9. **Exact server id** comparisons.
10. **Invariant monitors** mirroring §8: 0 throttle, 0 fighter hops, no restock-fail storm, together radius, delivery completes, no path storm.

## 11.5 V2 live bank / solo merchant (2026-09) — sim regressions

Encoded in `tests/test_live_regressions.js` + sim `_injectBankStoreBareInvalid`.

1. **`bank:full` was a lie.** Account vault had free slots (`items0` ~13 empty). Root cause: Mainframe `bank_store(i)` (no pack) often rejects `reason: "invalid"`; `bank_store(i, "items0", -1)` succeeds. Our park treated “0 stored” as `bank:full`. **Fix:** always store with an explicit pack that has a free slot; log `bank:store_fail <reason>`; emit `bank:full` only when free slots = 0. Probe: `tools/bank_store_probe.js`.
2. **`get_bank` MCP** reads account snapshot; **stale while a character has the bank mounted** — disconnect merchant ~20s for a fresh dump. Derive sell/combine lists from dump (`live_bank_dump.js`, `src/derive_bank_lists.js`).
3. **Solo Puppygirl idle** is econ-only (US III hop → vendor/xyn/ponty/craft/upgrade/combine/park/gift). No fighters ⇒ no pot jobs / gear ads.
4. **`gear:upgrade_skip` bank spam.** `tryUpgradeOne` scanned bank for any `eligibleUpgrade`, then logged skip every tick for below-gate pieces (e.g. gloves@4 → chance 0.68) without pulling. Operator saw: enter bank, spam `upgrade_skip chance=0.68`. **Fix:** only pull bank pieces with `chance ≥ MIN_UPGRADE_CHANCE`; rate-limit bag skip logs (60s / name@level).
5. **Publish:** edit `src/` only; `node publish.js` compresses → `dist/` → MCP. Relink required after `save_code`.
6. **Bank linger / “wanders into bank and does nothing”.** Vendor/reclaim counted sell-junk from stale `_bank` while on main, walked to bank, `bank_retrieve`’d the **pre-mount index**, missed the item, returned `false` **without leaving bank**. Every idle tick repeated. **Fix:** `ensureAtBank` → re-scan **live** `character.bank` only → retrieve → on miss/empty `leaveBankToPlaza`. Adversary: `tests/test_bank_linger.js`.
7. **Live-blind vault on main.** AL nulls `character.bank` off the bank map; V2 never wrote `_bank`, so after boot on main idle vendor/`planGifts` saw **zero** vault junk despite sellables in account bank — merchant idled forever (only `metrics`). **Fix:** `snapBank()` on mount/exit; one-shot `primeBankHint()` in `idleEcon`. Verifier must require `bank:prime` / `vendor:*`, not merely `map===main`.
8. **Trade reclaim / wrong `trade` arity (historical stall era).** Live 2026-09-09: 2-arg `trade(i, price)` never listed, then park re-banked. **Fix:** 4-arg `trade` via `al_api`; reclaim trade slots before NPC vendor; leave plaza after park. Junk path is now `tryVendorNpc` (stall listing retired).
9. **Solo mage/priest Idle.** Live solo trials 2026-09-09: Sarene/Zarook stood on armadillo pack with **0 damage** — combat only followed `get_player("Jazwyn").target`. **Fix:** same soloLead gate as warrior (`name===lead || lead not in party`) then `get_nearest_monster({type:mtype})`. Verifier must require combat metrics, not merely near-pack.
10. **Restock `send_fail` / `empty_send`.** Live burn-in ~+930s: Zarook `town_fallback`, merchant arrived at meet, fighter still pathing → `send_item` **distance** (>320) → `empty_send` loop; stand-open also blocks sends. **Fix:** `ensureSendRange` (re-acquire + approach up to 3×) before pot/gear send; retry on `distance`/`stand_open`; sim `send_item` rejects `stand_open`. Adversary: `tests/test_restock_range.js`.
11. **Vendor reclaim + `gear:upgrade_skip` spam.** Burn-in: trade-slot reclaim / below-gate gear left in bag while park locked → skip re-logged. **Fix:** park below-gate before vendor reclaim; skip-log once-only. Adversary: `tests/test_stall_gear_spam.js` (vendor-oriented).
12. **Warrior `equip staff` spam + dead merchant.** Live 2026-09-09: Jazwyn logged `equip staff +3 -> mainhand` every tick (staff in bag scored above blade; AL rejects wrong class so item stayed). Puppygirl died on pack during dlv with **no** merchant `rip` handler. **Fix:** `classOk` wtype gate in `equipPending`/`pendingBetter`/`planGifts`/`handleGearOffer`; merchant `rip:respawn` like fighters. Adversary: `tests/test_equip_class.js`.
12b. **Warrior `Wrong weapon` spam (2H / mage blade).** Live 2026-09-10: AL UI spammed `Wrong weapon` every tick. Root: `classOk` treated `wblade`/`basher`/`axe` as fine warrior 1H; `wblade` is **mage-only**, and `basher`/`axe` are **doublehand** — equip while `sshield` is on fails. **Fix:** hand tables from `G.classes` (+ `CLASS_HANDS` fallback); `canEquipSlot` blocks 2H with occupied offhand; `equipPending` awaits and verifies slot. Class score: warrior reflection/dreturn/str/armor; mage+priest **int**. Tests: `tests/test_gear_score.js`.
13. **Monster Hunt (Daisy) live.** Guide `monster-hunts`: `character.s.monsterhunt={id,c,sn,ms}`; `interact("monsterhunt")` near Daisy (main 126,-413); merchants cannot accept; refuse while `c>0`; kills only on issuing `sn`; turn-in grants `monstertoken`. **Live:** Puppygirl console `hunt_quest()` / `hunt_quest(0)` → CM all fighters; lead `tickHuntQuest` accept→`!hunt` intent→farm→turn-in loop. Sim runner + `tests/test_monsterhunt.js`. Condition is `persistent:true` — **death does not abandon**. Soft-skip: lead dies 3× on current `hunt.id` → `mhunt:soft_abandon` → default farm until that assignment clears, then resume.
14. **Merchant death on delivery.** Live: Puppygirl `smart_move` onto fighter pack coords / `packCenter` → armadillo aggro → rip. **Fix:** `approachPointFor` stands within `SEND_RANGE` along the vector toward `safeMeet` (never pack center); fighter keeps farming; `dlv:retreat` after done; rip aborts job + retreat. Adversary: `tests/test_dlv_safe_meet.js`.
15. **Idle bank combine missing.** Combine lived only in a one-shot script, so idle Puppygirl upgraded but never compounded bank triples. **Fix:** `tryCombineOne` in `idleEcon` (pull triple → buy cscroll → `compound`); sim `compound` API. Adversary: `tests/test_idle_bank_clean.js`.
16. **Merchant parked by party with full bag.** Overnight 2026-09-09: bag 36/42 of ringsj/hpbelt/hpamulet; bank **not** full (~26 free). Root: `empty_send` storm kept `store.active` so idle park/combine never ran; merchant lingered near pack. **Fix:** `noteEmptySend` → `dlv:retreat` each miss, abort after 5; park `COMBINE_PRIORITY` names; job_ttl also retreats.
17. **Rare ends → default armadillo.** After `rare_kill`/`gone`/`timeout`, mode was forced to `farm` without restoring prior `!hunt` intent; far pack targets also skipped `smart_move` (sim `get_nearest_monster` ignores vision → `move()` into walls). **Fix:** `preRareSnap` + `rare_resume`; engage-radius gate before combat; `!resume` keeps hunt kind. Adversary: `tests/test_rare_resume.js`.
18. **Merchant walks into mobs on delivery / arrive-and-wait.** (a) Full fighter bag → meet arrives → `send_fail no_space` → `empty_send` loop with `store.active` held until space frees or abort×5. Scenario: `tests/test_merchant_avoid.js` wait→resolve. (b) `smart_move` ignores entities → pack/corridor contact rip. **Fix:** `merchant_avoid.js` (velocity predict + lateral dodge); `fieldMove` engages avoid only when a hostile is within `engageR` (~180px), else `smart_move`. Adversary: cave-valley + engageR unit tests in `test_merchant_avoid.js`.
19. **`retreatPlaza` no-op off main → winter_cave rip loop.** Live 2026-09-09: Puppygirl `dlv:done` at `winter_cave 35,-71`, then `rip:respawn` every ~1.2s — `retreatPlaza` only `smart_move`d on `main`/`bank`. **Fix:** `use("town")` + `dlv:retreat_town` when map is neither, then plaza. Adversary: `tests/test_equip_class.js` winter_cave retreat.
20. **Review backlog hardening (2026-09-09).** … (f) Rare combat gap. (g) **Sarene town-bridge stall:** in party with lead coords but `smart_move` continually `interrupted` — lead `Transfer armadillo` farm echoes triggered follower `stop("smart")`. Fix: only stop on `port town` / `world`; Transfer announce only for cross-map; mage/priest pass `form`; follower no-lead → packCenter fallback.
21. **Named multi-spawn routes lose the fighter (2026-09-13).** `smart_move({to:"bat"})` can choose a different cave bat pack than the fighter's fresh beacon. Delivery routing must preserve concrete map/coordinates and choose a spawn-local safe standoff; never delegate a multi-spawn rendezvous back to the monster name.
## 11. Open questions for explorers (numbers the sim needs)

1. ~~Chat rate limit / CM budget / `limitdc`~~ — **resolved from server source, see §3.** Remaining: the numeric `limits.calls` value in production.
2. `smart_move` duration + failure rate per route class (town↔bank, town↔pack, cross-map, interior exits, tunnel).
3. Vision radius in px; party-list coordinate lag vs vision.
4. `change_server` reconnect distribution; how long `server_region` stays unset; realm-hop debuff duration.
5. Respawn/spawn timing for ladder packs; phoenix spawn behavior.
6. `send_item` / `send_gold` exact range; line-of-sight requirement.
7. Real upgrade NPC coordinates (`-207,-220` vs env `-204,-129`).
