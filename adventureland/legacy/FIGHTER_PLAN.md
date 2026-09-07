# Fighter shared-core plan

Party grind fighters: one shared runtime, thin class CODE. No summoning. No magiport.

**Constraints:** CODE ≤176 lines/slot; `load_code` helpers; keep hold/resume/hunt/grind; `node adventureland/tests/run.js`; `deploy_mcp.js`. **Cap 7 slots.**

## Product

1. **No magiport at all:** remove mage `try_port` / `at_pack` / `port_no`, summon chat, and **all** `on_magiport` / `accept_magiport`. Catch-up is walk/`smart_move` + pack rally. Update README + tests.
2. **Shared fighter framework** via `load_code("fighter_core")` + class hooks (merchant_plan/ops pattern). No summoning strings/skills.
3. **Formation movement (replaces follow-distance):** each non-leader has `{dx,dy,face}`:
   - **face=1 (facing-relative):** rotate offset by leader facing (`angle`).
   - **face=0 (world-relative):** fixed map axes.
   - Defaults: **mage** `{dx:-45,dy:55,face:1}`, **priest** `{dx:45,dy:55,face:1}` (behind flanks). Leader has no slot.
   - Facing source: `lead.angle` from `get_player(LEADER)` when in vision; else `last_lead_angle` cache; if never seen → treat offset as **world** for that tick.
   - Hysteresis: dist to slot **>40** → move toward slot; **≤18** → stop nudging.
   - Pathing: different map **or** dist(self, slot) **>220** → `smart_move` to slot; same map and nearer → `move` only.
   - While `leader_ok`, **formation is authoritative** — no class tank-spacing step-away that fights the slot (emergency unstick only if stacked on tank, dist **<8**).
   - Same HOME=`US/II` / FARM=`US/III` policy as today.
4. **Pack rally when no usable leader:** if leader rip, missing from party+vision, or coords unusable → `go_farm(desired())`. If rip but party still lists map/x/y → **one** `smart_move` to those coords; on fail → `go_farm`.
5. **Party chat = first-class sync + command bus:**
   - Commands typed in party chat on **any** character are applied by **all** characters **including the speaker**.
   - Status/social still skip self (Ding/Gratz) to avoid echo.
   - Compact `~s` state broadcasts so members stay aware.
6. **Anti-stuck:** [GAP] `busy` max ~60s → clear + `game_log`; [GAP] if `smart.moving` with no position progress → `stop("smart")` + replan; [GAP] `hold:0` / `!resume` also `stop("smart")`.
7. **Combat:** leader pulls; followers assist **leader target only** (priest may fall back to tank target). Hold/resume: restock → ready → hang; resume → FARM.

### Formation config

```text
FORM_BY_CTYPE = {
  mage:   { dx: -45, dy: 55, face: 1 },
  priest: { dx:  45, dy: 55, face: 1 }
}
NEAR = 18, FAR_NUDGE = 40, SMART_DIST = 220
```

`formation_pos(lead, cfg, angle)` → `{map,x,y}` using `cos/sin(angle)` when `face===1`.

### Party chat protocol

| Kind | Shape | Self-hear? | Who acts |
| --- | --- | --- | --- |
| **Command** | `!hold` `!resume` `!hunt <mtype>` `!grind` | **Yes** | All PARTY (+ speaker) |
| **Legacy NL command** | `let's kill <mtype>!` / `back to the grind` | **Yes** | All PARTY (+ speaker) |
| **Status machine** | `~s h=<0\|1> f=<mtype\|->` | Parse yes, **no social reply** | Merge into local view; ≤1/5s **and** on change |
| **Social** | `Ding!…` → others Gratz | **No** | Others only |
| **Need / rally NL** | contains `potion` / `upgrade` | Rally **yes** (incl. self); `Ok!` ack only if `from!==self` | Set `rally` |

**Parse:** trim; lower-case for match; commands = leading `!` **or** legacy kill/grind; `~s` = `k=v` pairs; unknown `!` → ignore; never treat Gratz/Ok/`Hold:` prose as commands.

**Broadcast:** `h` (hold), `f` (farm override or `-`). Emit on change and ≤1/5s when dirty.

**Merchant CM/PM:** keep `hold:1|0` / hunt as a **parallel** path for `hold()` / `resume()` / `hunt()` on puppygirl; party `!` commands must work standalone.

## Modules

| Slot | Owns |
| --- | --- |
| `fighter_core.js` | Consts, peaks/`desired`, pots, restock, bank_dump, offload, hold/`hear_cmd`/`hear`, **`formation_pos` / `follow_formation`**, `go_farm`, farmable helpers, busy/smart watchdogs, **`logistics`**, `~s` broadcast, `boot_fighter(hooks)` |
| `warrior.js` | `load_code("fighter_core")`; warrior `combat`; `boot_fighter({ combat, ding_line, do_invite: true })` |
| `mage.js` | mage `combat`; boot with mage FORM; no invite; **no** magiport |
| `priest.js` | `pre_combat` + `combat`; priest FORM; boot |
| `merchant.js` | Boot + cycle + **combine** (absorb `merchant_combine.js`) |
| `merchant_plan.js` / `merchant_ops.js` | Unchanged roles; ops does **not** own combine |

**Slot math (stay 7):** delete `merchant_combine` CODE name; add `fighter_core`.

**Load order (fighter):** class → `load_code("fighter_core")` → hooks → `boot_fighter(...)`.  
**Load order (merchant):** `plan → ops` (combine in boot).

**Contingency:** if `fighter_core` >176, split pure math (`formation_pos`, chat parse) only after freeing a name (stay ≤7).

**`al_core.js`:** Node-only oracle. Same phase as scripts: formation helpers replace `followDistance`/`shouldFollow`; delete `magePortOk` + summon; classify `!` commands vs social self-skip. Never loaded in-game.

## Contracts

```text
boot_fighter(hooks)
  hooks.combat(mtype) required
  hooks.pre_combat() optional → true skips combat tick
  hooks.ding_line string
  hooks.do_invite bool
  hooks.form {dx,dy,face} required for non-leader; ignored for leader
  wires: partym/cm/pm, on_party_invite ONLY (no on_magiport), intervals (once)
  owns logistics (2500ms) + 250ms tick

formation_pos(lead, form, angle)
  face=1: rotate (dx,dy) by angle; face=0: world axes
  if face=1 && angle==null → world axes that tick
  returns {map, x, y}

follow_formation()
  if hold or rip or smart.moving: return
  if !leader_ok → return false  // caller go_farm
  slot = formation_pos(...)
  d = dist(self, slot)
  if same map && d <= NEAR(18): return true
  if same map && d <= SMART_DIST(220): move(slot); return true
  else smart_move(slot); return true

leader_ok()
  leader exists, !rip, reachable (vision or party map/x/y),
  same-server intent after go_s(FARM) when !hold

logistics()  // core only
  jail / offload / hold / go_s(HOME|FARM) / vendor
  if is_lead: go_farm(desired) when no farm mob and !smart.moving
  else if leader_ok: follow_formation only
  else: go_farm(desired)

go_farm(mtype)
  no summon; smart_move to mtype; on fail town + retry

busy_watch / smart_watch
  [GAP] busy > 60s → clear + stop smart + game_log
  [GAP] smart.moving, no x/y progress > N ms → stop("smart")

hear(d)  // partym
  if command or legacy kill/grind:
    apply even when d.from === character.name
  else if d.from === character.name: return
  else: Ding→Gratz; potion/upgrade rally + Ok if from!==self
  if ~s: merge h/f (no reply)

hear_cmd(m)  // merchant cm/pm dual-path
  hold/resume/hunt/grind as today; stop("smart") on hold 0 and 1

broadcast_state()
  on change or ≤1/5s dirty: party_say("~s h=… f=…")
```

Success: formation while `leader_ok`; pack rally otherwise; no magiport; commands from any fighter (incl. self) update whole party; Ding speaker does not Gratz self; tests cover formation math, self-command, no summon/magiport; merchant still combines; ≤7 slots.

## Phases

Each phase: tests green → `deploy_mcp.js` → Stop/Run each fighter (and merchant if touched).

### 0 — Slot + oracle
- Inline `merchant_combine` into `merchant.js`; drop from `UPLOADS` / line lists / `load_code`.
- `al_core`: formation helpers; delete `magePortOk` + summon; `!` command classify vs social self-skip.
- Tests: no summon/magiport; formation math + hysteresis; chat self-command vs self-Ding.

### 1 — Extract `fighter_core`
- Shared logistics/hold/pots/chat/formation/`go_farm`; thin class hooks + FORM.
- Remove all magiport listeners and summon paths.
- Party `!` + legacy kill/grind (speaker-inclusive); `~s` broadcast.
- README: formation + party command bus; magiport gone.

### 2 — Anti-stuck
- busy 60s clear; smart no-progress stop+replan; resume stops smart.
- Tests: hung smart_move / stuck busy / formation thrash bounds.

### 3 — Polish (optional)
- Line-budget split only if forced.

## Out of scope
- Merchant economy/stand (except combine slot merge).
- Gear upgrade scripts.
- New ladder / servers.
- Magiport cast or accept.
- `al_core` in-game.
- Follow-distance band as primary movement.

## Anti-goals
- 8 CODE slots.
- Per-class `logistics` copy.
- Diverging `al_core` vs `fighter_core` policy.
- Follow-180 / “stay near leader blob” as primary nav.
- Any `accept_magiport` / `on_magiport` / port cast.
- Independent follower `go_farm` while `leader_ok`.
- Silent hung `busy` / endless `smart.moving`.
- Making **all** `hear` self-inclusive (Ding/Gratz echo).
- Command acks that parse as commands.
