# Adventureland Interface Control Document

## 1. Status and scope

This ICD describes the interfaces implemented by the current source tree. It is
descriptive, not a proposal. The revisioned inventory and direct
fighter-to-fighter accessory-transfer protocol is implemented and specified in
section 6. Broader ideas remaining in
`docs/CENTRAL_GEAR_COORDINATION.md` are future design, not current contracts.

The deployed bundles are assembled from `src/` according to
`publish.manifest.js`; `dist/` is generated output. The principal participants
are the fighters `Jazwyn`, `Sarene`, and `Zarook`, and merchant `Puppygirl`
(`src/constants.js`: `FIGHTERS`, `LEADER_ORDER`, `MERCHANT`). This document
covers:

* fighter-to-fighter party messages;
* fighter-to-merchant and merchant-to-fighter CM/PM messages;
* delivery, location, acknowledgement, loot, and gear flows;
* heartbeat, leadership, rare, hold/world, and Monster Hunt controls;
* state persisted across runtime reload/server change;
* the live API adapter and simulator assumptions on which those interfaces rely.

Audit searches included every `send_cm`, `party_say`, PM call/listener, and
`storage.getItem`/`setItem` in `src/`, plus the same operations in `sim/`,
`tests/`, top-level live utilities, and generated `dist/`.

## 2. Interface conventions

### 2.1 Transports

| Transport | Scope and return contract | Current implementation |
|---|---|---|
| Party chat | Text delivered as a `partym` event to party members. The sender receives its own event. | `src/al_api.js`: `party_say`, `on`; `src/fighter.js`: `hearParty`; `sim/character.js`: `party_say`; `sim/server.js`: `broadcastParty` |
| CM | Object message. The code assumes delivery only to a connected character on the same region/identifier. `api.send_cm` resolves to `{receivers: string[]}` and converts errors to an empty list. | `src/al_api.js`: `send_cm`, `on`; `sim/character.js`: `send_cm`; `sim/server.js`: `deliverCm` |
| PM | Text fallback that is expected to work across servers. `api.pm` uses native `pm`, falls back to `say(message,to)`, and returns `{ok, reason?}`. | `src/al_api.js`: `pm`; `src/fighter.js`: `hopPrep`; `src/merchant.js`: PM listener; `sim/server.js`: `deliverPm` |
| Item/gold transfer | Physical side effect, not a protocol message. Requires visibility/range and suitable inventory state. | `src/fighter.js`: `offloadGold`, `tossLoot`; `src/merchant.js`: `deliverActive`; adapter operations in `src/al_api.js` |
| Local storage | Per-character string key/value storage. It survives `change_server`; ordinary heap state and event handlers do not. | `src/fighter.js`: `persist`, `restore`; `src/merchant.js`: `loadQ`, `saveQ`; `sim/storage.js`; `sim/server.js`: `changeServer` |

CM receive normalization is deliberately narrow: `src/al_api.js` converts
`m.data` to `m.message` only when `message` is absent. Sender identity is not
normalized globally. Consumers use `m.name || m.from`, while party handling
uses `msg.from || msg.owner`. The simulator supplies both aliases. Producers
must therefore preserve the Adventure Land event envelope; payload fields such
as `who` and `name` are not trusted sender metadata by the transport adapter.

### 2.2 Required/optional notation and validation

In the schemas below, **R** means required for the intended path and **O** means
optional. This does not imply complete runtime schema validation. CM now has
roster sender gates: fighters reject every CM not attributed to `Puppygirl`,
and Puppygirl rejects every CM not attributed to a configured fighter. Several
message families add payload/sender correlation, detailed below. These are
name-based checks on the platform event envelope, not cryptographic
authentication; there is still no signature, nonce, schema registry, or
version negotiation (`src/gear_coordination.js`: `cmSender`,
`isMerchantMessage`, `isFighterName`; `src/fighter.js`: `hearCm`;
`src/merchant.js`: `hearCm`).

### 2.3 Timing and delivery invariants

* Code-originated party chat and PM share a per-character 15-second simulator
  budget; all chat has a 400 ms floor and any successful human chat resets the
  timestamp (`sim/comms.js`: `trySay`, `humanSayFixed`). The production queue
  waits 16 seconds between successful sends (`CHAT_GAP_MS`).
* `src/chat_queue.js`: `createChatQueue` holds at most one pending message.
  Same-kind messages replace older ones; otherwise priority is
  `echo > rare > diff > heartbeat`. A higher-priority pending message drops a
  lower-priority enqueue. A rejected send is not requeued and starts a
  16-second cool-down.
* Receipt of any parseable self-authored party message calls `setLastOk(now)`.
  The platform's own echo therefore re-arms the 16-second outbound gap from
  receipt (`src/fighter.js`: `hearParty`; `src/chat_queue.js`: `setLastOk`).
* General CM has no application-level queue. `cmFighters` starts three sends
  without awaiting them, and `hunt_quest` repeats its fan-out once after
  800 ms. Peer-gear coordination is the exception: its state machine sends
  commands on a one-second retry cadence (`src/merchant.js`: `cmFighters`,
  `cmFightersReliable`, `tickPeerGearTx`).
* CM and chat are best effort. There is no transport acknowledgement beyond the
  application messages documented below.

## 3. Fighter-to-fighter party protocol

Producer and consumer are `bootFighter` instances. Messages are sent through
`createChatQueue` and parsed by `src/party_state.js`: `parseLine`; effects are
applied by `src/fighter.js`: `hearParty`.

### 3.1 State heartbeat

Wire form:

```text
~S f=<monster-type> m=<mode> h=<0|1> seq=<number>
```

| Field | Semantics |
|---|---|
| `f` (R) | Shared farm/hunt monster type. Formatter emits `-` if absent. Parser accepts any no-space string. |
| `m` (R) | Shared mode; currently normally `farm`, `hold`, or `rare`. No enum validation. |
| `h` (R) | Hold flag. Formatter emits numeric `0`/`1`; parser converts numeric text to a number. |
| `seq` (R) | Sender sequence. Formatter emits the local sequence; parser accepts any finite numeric text. |
| Other `k=v` (O) | Parsed and retained in the temporary object, but ignored by `applyHeartbeat`. |

Direction is current leader to other fighters over party chat. A fighter emits
at most once per 60 seconds, after a 60-second boot quiet period
(`HEARTBEAT_MS`; `src/fighter.js`: `tick`). Before publishing, a new leader
raises its own sequence above the largest heard sequence
(`reseedSeqAboveHeard`).

`seq` is not a message counter. `setSelf` and every successful lead-only
`setIntent` call increment it, even when assigning the same value. Normal
`setSelf({task:...})` calls can occur on each 250 ms fighter tick, so a leader's
counter often rises at roughly four writes per second. Followers likewise
accumulate unpublished task-write increments: they do not emit heartbeats, and
the diff formatter does not include `seq`. The transmitted heartbeat value is
therefore an activity/state-write counter used only for ordering, with gaps
expected (`src/party_state.js`: `bump`, `setSelf`, `setIntent`;
`src/fighter.js`: `tick`).

Acceptance is based on the receiver's current `get_party()` membership:
`currentLeader` nominally selects the first present name whose cached
`S.members[name].rip` is false, in `Jazwyn, Sarene, Zarook` order. No current
producer sets its own member `rip`, however, so no `rip=1` diff is emitted and
this death exclusion is unreachable end to end. For a dead character that
remains present, fighter succession is therefore presence-only and does not
advance. Only a heartbeat whose event sender equals that computed leader may
change shared `f`, `m`, and `h`. A sequence lower than the stored sender
sequence is ignored; an equal sequence is accepted. There is no wall-clock
TTL. A delayed heartbeat can therefore remain authoritative if its sequence
passes these checks. See `src/party_state.js`: `currentLeader`,
`applyHeartbeat`, `formatHeartbeat`.

### 3.2 Member-state diff

Wire form (the marker must be followed by a space and content):

```text
~d p=<ok|low|dry> [rip=1] [task=<string>]
```

`p` is the local minimum HP/MP potion bucket, `rip` is emitted only when true,
and `task` is normally emitted because the default is `idle`. The parser also
accepts `seq=<text>`, although the current formatter does not emit it.
`applyDiff` accepts updates only for a sender already present in the fixed
`members` map; unknown senders are ignored. Values are weakly validated:
`p`/`task` are arbitrary strings and `rip` uses JavaScript truthiness, so
`rip=0` would incorrectly become `true`. Diffs are queued only when the
formatted local snapshot changes (`diffNeeded`), and may be superseded by a
higher-priority pending message. Current runtime code calls `diffNeeded` only
inside the branch where `refreshPots` observes a changed potion bucket. A
task- or rip-only state change therefore emits no diff at all until the potion
bucket later changes; merely calling `refreshPots` with the same bucket does not
flush it. Sources: `src/party_state.js`:
`formatDiff`, `parseLine`, `applyDiff`; `src/fighter.js`: `refreshPots`.

### 3.3 Rare sighting

Wire form:

```text
~R <monster-type>
```

Any fighter that sees a non-dead `phoenix` or `goldenbat` emits this message and
immediately enters rare mode (`src/motion.js`: `spotRare`;
`src/fighter.js`: `tickRare`). `parseLine` trims first and then requires the
literal `~R ` prefix, so bare `~R` (or `~R` followed only by whitespace) is
invalid; the same rule makes bare `~S` and `~d` invalid. Receivers accept any
nonempty monster suffix from any party-message sender; there is no whitelist
check on receipt and no sequence/id. State becomes
`{mtype, by: sender, t: Date.now()}`, mode becomes `rare`, and the prior
`{kind,mtype,hold}` is snapshotted.

Fighters chase the spotter's party/player coordinates and fight the visible
rare. Rare mode exits on observed kill, more than 20 seconds without seeing the
rare, or the 60-second assembly deadline (`RARE_GONE_MS`,
`ASSEMBLE_TIMEOUT_MS`). Exit restores the pre-rare intent and mode `farm`.
Duplicate sightings reset the assembly deadline but do not replace the original
pre-rare snapshot.

### 3.4 Text commands and informational echoes

Wire form is `!<command> [first-argument]`.

| Command | Argument | Effect |
|---|---|---|
| `!hold` | none | Sets `hold=1`, mode `hold`; lead uses owner-write `setIntent`, followers mutate locally. |
| `!resume` | none | Clears hold, mode `farm`, clears rare state, and preserves `kind=hunt` when already hunting. |
| `!hunt` | monster type (R) | Sets kind `hunt`, target, and clears hold. |
| `!grind` | ignored | Sets kind `farm` and clears hold; it does **not** reset the monster type. |
| `!world` | `REGION/IDENTIFIER` (R) | Stores the two strings as `intent.world`, clears hold, and sets kind `farm`. No region/id validation occurs in this parser. |
| Other | any | Parsed but has no effect. |

Every fighter applies commands received through `partym`; sender leadership is
not checked. Party membership is the only transport-level boundary. The
`mine` argument controls an echo path, but `hearParty` returns early on its own
messages, so ordinary self-echo does not execute the command. Programmatic
`ctrl.applyCmd` applies locally and queues an echo. Its parseable self-echo
still updates `chat.lastOk` on receipt and re-arms the outbound gap. See
`src/fighter.js`: `hearParty`, `applyCmd`.

Two unstructured notices are also produced:

* `Transfer <monster-type>` before a leader changes maps toward a pack;
* `World <region>/<identifier>` immediately before a server change.

They do not reach the later stop logic: `hearParty` calls `parseLine` first and
returns immediately when it gets `null`, and neither plain-text format is
recognized by `parseLine`. Consequently current `World ...` and
`Transfer ...` messages are dropped and cannot call `stop("smart")`. The later
branch that tests for a line beginning `World ` or containing `port town` is
dead for all current producers; there is also no current `port town` producer.
(`src/fighter.js`: `tickFarm`, `hopPrep`, `hearParty`;
`src/party_state.js`: `parseLine`).

### 3.5 Party roster and live entity state

There is also a non-message fighter-to-fighter interface through Adventure
Land's party/player state. Every five seconds the current lead calls
`send_party_invite` for each configured fighter absent from `get_party()`;
`on_party_invite` accepts an invite only when its sender is one of the three
configured fighters (`src/live_fighter_runtime.js`: `v2_invite_party`,
`on_party_invite`). There is no acknowledgement, retry limit, or persisted
membership; retries continue while a member is absent.

This invite/accept exchange is live-only. The simulator does not model those
calls or invite events. Instead `src/boot_party.js` invokes simulator
`formParty` initially and `inviteAll` after reconnect; both directly replace
the server-scoped party map out of band (`sim/server.js`: `formParty`,
`inviteAll`). Simulator tests therefore do not exercise live invitation
delivery, rejection, or throttling.

Consumers treat `get_party()` entries as presence, authority, map/coordinate,
death, task, and formation inputs. `get_player()` supplies the stronger
same-map/in-vision entity view. Followers use the current leader's coordinates
for movement and, when visible, the leader's `target` identifier for combat;
the priest additionally reads visible party HP/rip state for heal/revive
selection (`src/motion.js`: `leadEnt`, `followersNear`, `followLeader`,
`followFormation`; `src/slots/warrior.js`, `mage.js`, `priest.js`: `combat`,
`pre_combat`). Missing/stale party coordinates cause pack fallback or wait
timeouts rather than a protocol error. This shared-state interface has no
application versioning and is constrained by the live/simulator visibility
differences in section 9.

## 4. Merchant control interfaces

### 4.1 CM controls: Puppygirl/operator to fighters

All are CM object messages consumed by `src/fighter.js`: `hearCm`. The normal
producer is Puppygirl's console surface in
`src/live_merchant_runtime.js`: `v2_start_merchant`, calling methods in
`src/merchant.js`. Top-level live utilities also directly produce `{hunt:...}`
and `{hunt_quest:1}`.

| Schema | Required fields and accepted values | State transition / failure behavior |
|---|---|---|
| `{hunt: mtype}` | `hunt` truthy; converted to string | Same as `!hunt`. Empty/falsy is ignored. |
| `{grind: 1}` | Any truthy `grind` | Same as `!grind`. |
| `{world: [region,id]}` | Truthy array; elements are concatenated into `region/id` | Same as `!world`; malformed/short arrays are still accepted. The console producer validates region `US|EU|ASIA` and identifier syntax in `parseWorld`. |
| `{hold: 1}` | Strict numeric `1` | Same as `!hold`; also triggers the legacy hold assignment at the end of `hearCm`. |
| `{hold: 0}` | Strict numeric `0` | Same as `!resume`. |
| `{hunt_quest: value}` | Field must be non-null; only `1` or `true` enable | Toggles and persists the lead-only Daisy loop; every other non-null value disables. |
| `{job:"meet_home"}` | Exact string | Sets hold through the legacy branch. |

The fighter's top-level CM gate requires envelope sender `Puppygirl`, so other
fighters and unknown same-server characters cannot invoke these controls.
Within that trust boundary there is no per-command authorization or payload
signature. `hunt`, `grind`, `hold`, `resume`, and `world` fan out once to all
named fighters; `hunt_quest` fans out immediately and again after 800 ms. A
missed cross-server CM is not delivered.

For `hunt`, `grind`, `world`, and `hold` (`1` or `0`), each recipient passes
`isLead()` as `applyCmd`'s `mine` argument. The current lead therefore applies
the control and enqueues a corresponding `!hunt`, `!grind`, `!world`, `!hold`,
or `!resume` party-chat echo; followers apply locally without echoing. The echo
uses highest-priority `echo` queue priority, immediately attempts `chat.tick`,
and consumes the lead's shared party-chat/PM budget when sent. It can replace a
lower-priority pending heartbeat/diff/rare message, or be delayed/dropped by
the chat queue. `hunt_quest` and legacy `job:"meet_home"` do not use this
`applyCmd(mine=true)` echo path.

The merchant console validates `hunt` by lowercase alphanumeric/underscore and
rejects `spider`, `scorpion`, and `bigbird`; this validation does not exist at
the fighter CM boundary. `world(spec)` accepts `I`-`V`/`PVP` as US shorthand or
`US|EU|ASIA` plus an alphanumeric identifier
(`src/merchant.js`: `hunt`, `hunt_quest`, `grind`, `hold`, `resume`,
`parseWorld`, `world`).

### 4.2 PM hold fallback

Wire text is `meet_home`. During lead hop preparation to `US/II`, the fighter
first sends CM `{job:"meet_home"}` and uses PM only if CM returns no receivers
(`src/fighter.js`: `hopPrep`). Puppygirl accepts any PM whose text contains
either `meet_home` or `hold`, from any sender, and enqueues a `meet_home` job.
The CM roster gates do not apply to this PM listener. It does not acknowledge
the PM. PM shares the chat throttle in the simulator, and `hopPrep` ignores the
`{ok:false}` result.

## 5. Delivery protocol

### 5.1 Job request and queue

Direction: fighter to Puppygirl over CM. Producer:
`src/fighter.js`: `requestPots`. Consumer: `src/merchant.js`: `hearCm`.
Operational scripts `live_force_gold_scoop.js`,
`live_restock_verify.js`, and `live_post_overnight_verify.js` produce the same
request, sometimes without server fields.

```js
{
  v: 1,                    // O; emitted, but ignored by consumer
  job: "dlv_pots",         // R discriminator; "dlv_gear" also accepted
  id: "p<ms>_<3 chars>",   // R operational correlation key
  who: "Jazwyn",           // R destination name
  items: [{name, q}],      // R for useful pot delivery
  farm: "bat",             // O target/meeting hint
  map: "main", x: 0, y: 0,// O location hint
  serverRegion: "US",      // O; defaults at receiver
  serverIdentifier: "III",// O; defaults at receiver
  gear: {name,level,slot}  // O; accepted for gear jobs/internal batching
}
```

The merchant first requires a configured fighter sender, then requires
`d.who === sender` for `dlv_pots`/`dlv_gear`. It does not require `id`,
constrain `items` at ingestion, or validate `v`. During sending, only `hpot1`
and `mpot1` requests are honored. The request is transformed to an internal job
with `kind=job`, `t0`, and `locAt`; farm/location may be normalized by
`meetFarmAt`.

The earlier buy phase is less restrictive than the send phase:
`buyPots(job.items, ...)` passes every supplied `items[].name` to `api.buy` and
uses `G.items[name].g` when present (otherwise a fallback price). Quantity is
`item.q || POTION_TARGET`, so zero/falsy defaults to 200 and positive values
have no upper bound or integer/type validation. An arbitrary purchasable item
can therefore consume merchant gold but will not be transferred by the later
pot-only send loop. Large/untrusted quantities also affect the merchant-float
test and can repeatedly drive the `buy_float`/gold-scoop wait path. This
interface assumes trusted roster fighters despite the remaining absent item
schema checks (`src/merchant.js`: `buyPots`, `potBuyNeedGold`,
`deliverActive`).

Queue capacity is eight waiting jobs. Duplicate `id` among waiting jobs is
treated as successful and not inserted; the active job is not included in this
deduplication check. On capacity failure the merchant returns a negative ACK.
Queue order is FIFO and one job is active at a time
(`src/merchant.js`: `enqueue`, `tick`).

Internal `meet_home` jobs use:

```js
{id: "hold_<ms>" | "pm_hold_<ms>", kind: "meet_home", who: "party", t0: <ms>}
```

They are created locally by `hold()`, incoming `{job:"meet_home"}`, or PM. They
change Puppygirl to `HOME` (`US/II`) and then complete without a CM response.

Merchant-planned standalone gear work uses a separate internal-only job shape
(`src/merchant.js`: `tryPlanGearGift`):

```js
{
  id: "g<ms>_<3 chars>",       // R
  kind: "dlv_gear",            // R internal discriminator (not `job`)
  who: "<fighter>",            // R
  gear: {name, level, slot},   // R
  farm: "bat",                 // R as currently constructed
  items: [],                   // present but unused
  t0: <enqueue time>           // added by enqueue
}
```

Unlike a fighter-originated delivery request, this job has no initial
`map`/`x`/`y`, server fields, or `locAt`. It relies on the ordinary
`status:1`/`dlv_loc` handshake to obtain a route before delivery. There is no
request ACK because no CM created the job. Although `hearCm` also accepts an
external `job:"dlv_gear"` request, current runtime gift planning constructs the
internal form directly.

### 5.2 Delivery acknowledgement

Direction: Puppygirl to `d.who`, CM:

```js
{dlv_ack: 1, id, ok: 1|0, reason: null|"queue"}
```

The fighter accepts it only when `dlvPending` exists and `id` exactly matches,
after the top-level `Puppygirl` sender gate. `ok` truthiness sets `acked`; false
clears the pending request. A request with no CM receivers remains pending. Without an
ACK, `requestPots` contains code to clear it after 20 seconds (`ACK_MS`), and
contains analogous 480-second (`PENDING_MS`) cleanup for acknowledged work.
Those branches are unreachable through current production callers: every call
to `requestPots` is guarded by `!dlvPending` (including `townFallback`'s
alternate branch). Consequently a low-but-not-dry fighter whose request or ACK
is lost retains `dlvPending` and will not retry or self-clear. Dry handling can
eventually clear/cancel through `townFallback`, but not through the
`requestPots` timeout code. There is no resend with the same ID
(`src/fighter.js`: `requestPots`, `hearCm`).

### 5.3 Status/location handshake

Merchant-to-fighter status:

```js
{
  status: 1,               // R discriminator
  id,                      // R for meet response; matching is optional for phase update
  phase: "preflight"|"enroute"|"arrived", // O/no enum enforcement at receiver
  meet: 1,                 // truthy asks for a location reply
  map, x, y                // O merchant/staging coordinates; fighter ignores
}
```

Only status whose envelope sender is `Puppygirl` passes the top-level gate. If `id` is
absent or matches the pending request, the fighter refreshes `lastStatusAt` and
copies `phase`. If `meet` is truthy and `id` exists, it replies even when that
ID does not match its current pending request:

```js
{
  dlv_loc: 1, id, farm,
  map, x, y, serverRegion, serverIdentifier
}
```

The merchant accepts location only when `id` names an active/queued job and the
envelope sender (`name || from`) equals `job.who`. It updates location/server,
increments internal `locSeq`, and may retarget the farm and interrupt/reroute
an active move. This adds job-owner correlation beyond the roster sender gate.
For the location schema, `dlv_loc` and `id` are required by the handler;
`farm`, `map`, `x`, `y`, `serverRegion`, and `serverIdentifier` are optional at
the syntax boundary, although usable routing requires location or a resolvable
farm/player.

A location older than 16 seconds (`2 * BEACON_MS`) causes the merchant to send
a status probe. Probes are limited to one per 8 seconds, wait 250 ms for the
synchronous/event-loop reply, and leave the job pending if no new `locSeq`
appears. This stale-location probe is not the only status producer. When the
stored location is fresh, every invocation of `deliverActive` that reaches the
location-selection branch sends
`{status:1,id,phase:"enroute",meet:1,map,x,y}` directly, with no
`BEACON_MS` throttle. The fighter immediately replies with `dlv_loc` for each
such status. On a normal live 400 ms single-flight merchant loop this can occur
once per completed delivery tick (actual spacing can be longer while awaited
work is running).

There are exactly three runtime writers of `lastStatusAt`: a matching
`dlv_ack`, an accepted Puppygirl status with absent or matching `id`, and the
low-gold branch of `townFallback` immediately before it sends `dlv_loc`.
Therefore the fresh-location per-tick status stream continually renews
dry-wait silence grace: 480 seconds for acknowledged work or 90 seconds
otherwise, measured from the latest status rather than request age. While dry
and receiving recent status, a fighter also emits its independent location
beacon no more often than every 8 seconds.

The low-gold `townFallback` branch cannot buy locally and deliberately keeps
the pending request. By self-refreshing `lastStatusAt` on every fallback pass,
it can indefinitely defer another fallback even when Puppygirl is dead or
silent; there is no dead-merchant expiry in that path. Sources:
`src/merchant.js`: `refreshDeliveryLocation`, `deliverActive`, `hearCm`;
`src/fighter.js`: `hearCm`, `tickFarm`, `townFallback`.

### 5.4 Delivery execution, completion, and failure

The active state path is:

```text
queued -> active -> correct server -> route confirmed
       -> pots bought / optional gear pulled -> destination approached
       -> loot requested -> items/gold sent -> done -> cleared -> retreat
```

The merchant changes server when necessary, asks for fresh location before its
first route, keeps three bag slots for take-backs, routes to a safe meeting
point, and requires physical send range (320). Potion jobs buy requested
amounts, with special gold-scoop behavior; gear may be batched onto the job.

Related messages:

| Direction/schema | Consumer behavior |
|---|---|
| Merchant → fighter `{dlv_loot_q:1,id?}` | `dlv_loot_q` is required/truthy; `id` is optional. After the Puppygirl sender gate, the fighter offloads gold above 100,000 and up to 12 non-reserved/non-keep items while Puppygirl is visible and within range, then sends `{dlv_loot_done:1,id,n}`. ID is not validated. |
| Fighter → merchant `{dlv_loot_done:1,id?,n?}` | Only the truthy discriminator is required after the configured-fighter sender gate. `id` and count `n` are informational; the message is logged only, with no correlation check or state transition. |
| Merchant → fighter `{nack:"path",id}` | Both fields are produced, but currently ignored by the fighter; therefore they have no consumer-side required semantics. The merchant leaves the job active for a later tick. |
| Merchant → fighter `{dlv_done:1,id,ok,reason?}` | Truthy discriminator and an ID matching `dlvPending.id` are required after the Puppygirl sender gate. `ok` and `reason` are optional/ignored: success and failure both clear pending. |
| Fighter → merchant `{job:"cancel_all",who?,id?}` | `job` is required; normal producers supply `who` and sometimes `id`. A supplied `who` must equal the configured-fighter sender. It removes waiting jobs where `who` or `id` matches and similarly clears active. With neither selector, nothing matches. |

The merchant emits successful `dlv_done` after its send loops, even though
individual non-distance potion send failures can have been skipped; it requires
only that at least one potion stack was sent for a potion job. Five
zero-item-send outcomes abort with `reason:"empty"`. Merchant death aborts an
active delivery with `reason:"rip"`. Explicit aborts send `ok:0`; expiration
does not send a completion message.

Every active job expires when `now - t0 > 480000` (`JOB_MS`), including time
spent queued. It is silently dropped and Puppygirl retreats. Path failures
produce `nack` and retry on later ticks until TTL. Missing location, visibility,
funds, inventory space, or gear generally leaves the active job for later
ticks. Sources: `src/merchant.js`: `deliverActive`, `abortDelivery`,
`noteEmptySend`; `src/constants.js`.

There are two explicit `dlv_loot_q` polling loops:

* If Puppygirl cannot fund a potion purchase while preserving her float,
  `scoopGoldForBuy` approaches the fighter and polls until the required gold is
  reached or 25 seconds elapse. It polls after each peer tick in simulation or
  approximately every 500 ms live.
* After arrival in send range, `deliverActive` polls for up to approximately
  3.5 seconds while the visible fighter has more than 100,500 gold. It advances
  a peer tick in simulation or sleeps approximately 400 ms live.

Each query can trigger loot toss as well as gold offload. Fighter
`offloadGold` imposes a 2,500 ms attempt damper, so repeated queries
do not produce gold sends at the polling frequency; a failed send resets that
damper only when it throws (a resolved failure object is not inspected). After
the post-arrival polling window, if the visible fighter has less
than the 100,000 fighter float, Puppygirl calls `send_gold` for the difference
before sending delivery items. This merchant-to-fighter top-up is a physical
transfer with no CM acknowledgement or application retry
(`src/merchant.js`: `scoopGoldForBuy`, `deliverActive`;
`src/fighter.js`: `offloadGold`, `offloadToMerchant`).

### 5.5 Fighter dry/fallback behavior

Potion state uses the smaller total of HP and MP pots: `dry` at zero, `low`
below 80, otherwise `ok` (`src/party_state.js`: `potBucket`). Low triggers a
request. Dry fighters wait while merchant status is recent. An unacknowledged
or silent request uses a 90-second fallback window; acknowledged work can be
given up to 480 seconds. A fighter with at least 100,000 gold cancels and buys
in town after fallback; a poorer fighter retains/creates the delivery and sends
a location update instead (`src/fighter.js`: `tickFarm`, `townFallback`).

## 6. Gear interfaces

Two current paths coexist:

1. Puppygirl-held items use the legacy delivery `gear_offer`/`gear_got` path.
2. Fighter-held accessories use the revisioned, journaled peer-transfer
   protocol in sections 6.3-6.7.

### 6.1 Revisioned inventory advertisement

Direction: each fighter to Puppygirl by CM every 20 seconds and immediately
after peer-transaction finish, cancellation, or local expiry
(`GEAR_AD_MS`; `src/fighter.js`: `sendGearAd`,
`currentInventorySnapshot`):

```js
{
  gear_ad: 1, inventory_ad: 1, v: 2, // R discriminators/version
  name: "Jazwyn", who: "Jazwyn",     // R and normally identical
  revision: 42, observed_at: 1789080000000,
  server_region: "US", server_identifier: "III",
  map: "main", x: 0, y: 0,
  esize: 7, ctype: "warrior",
  slots: { earring1: <item-ref>|null, ... },
  bag: [<item-ref>, ...],
  reservations: ["<fingerprint>", ...]
}
```

`slots` contains all 15 names in `EQUIPMENT_SLOTS`, including explicit nulls;
`bag` contains only occupied indices. `inventoryDigest` covers sorted equipped
slots and indexed bag contents. A fighter increments `revision` only when that
digest changes, not merely because location, free-space, or reservations
changed. `observed_at` and location/server fields are observations, not part of
the revision digest. `inventoryRevision` persists; `lastInventoryDigest` does
not, so the first post-reload snapshot increments the restored revision.

The merchant requires a configured-fighter envelope sender and
`d.name === sender`. Older revisions are ignored; equal revisions are accepted
and replace the prior ad, which allows reservation/location-only updates.
Every accepted ad is also stamped with merchant-local `_seq=++gearAdSeq`;
rejected decreasing revisions do not advance that receipt sequence. `_seq` is
neither sent by fighters nor durable across merchant boot.
Advertisements remain heap-only on Puppygirl. Peer planning additionally
requires all three fighters' `inventory_ad===1`, `v===2`, non-null revisions,
and receipt `_t` no older than 60 seconds. Legacy gift and vendor-base planners
can still consume stored ads without that freshness/version gate
(`src/merchant.js`: `hearCm`, `gearAdFresh`, `startPeerGearTx`).

The normal producer supplies every displayed field. At the receive boundary
only truthy `gear_ad`, `name`, and an allowed envelope sender are required;
`name` must match that sender. Peer planning then requires `inventory_ad`,
`v`, `revision`, `slots`, and `ctype`; range checks effectively require finite
coordinates and matching server/map fields. Missing `bag` or `reservations`
means an empty array, and missing/falsy `esize` means zero. `who` and
`observed_at` are informational to current consumers. `_t` is not transmitted:
Puppygirl adds it on receipt.

### 6.2 Item fingerprints and observed references

`src/gear_coordination.js` defines the wire identity:

```js
// fingerprint is JSON.stringify of exactly:
{name, level: level || 0, p: p ?? null, stat_type: stat_type ?? null, l: l ? 1 : 0}

// item reference:
{
  ...compactGearItem(item),
  uid: "<revision>:<where>:<shortHash(fingerprint)>",
  where: "slot:<slot>" | "bag:<zero-based-index>",
  fingerprint: "<JSON string>",
  observed_revision: <revision>
}
```

`compactGearItem` recursively sorts object keys and removes properties named
`index` or `slot`; all other serializable primitive/array/object properties are
retained. The fingerprint deliberately excludes location and is therefore
stable across unequip/bag movement, but it includes only the five fields shown:
quantity and other item attributes are not fingerprinted. `uid` is an
observation reference, not a permanent game item ID.

`resolveObservedItem` requires the exact current `where` and an exact
fingerprint match. It does not validate `uid`, `observed_revision`, or the other
compact fields. During prepare, an equipped item is re-resolved, unequipped,
found by fingerprint in the bag, and rewritten to a transaction-local
`<tx>:bag:<index>` reference. Unrelated inventory revision changes do not by
themselves stale a plan.

### 6.3 Party-wide accessory planner

`src/gear_coordination.js`: `planPeerGearTransfers` evaluates one of these slot
groups at a time:

```text
earring1+earring2 | ring1+ring2 | amulet | belt | cape | orb
```

It requires ads for all three fighters and considers both equipped items and
bag-held accessories when they are unlocked, unreserved, class-legal, and have
a candidate slot in the direct accessory group. A bag-held candidate may be
assigned only to a different fighter: assignment back to any slot owned by the
bag item's current owner is explicitly excluded. It uses the existing class
score plus a 10,000-point named
`GEAR_TARGETS` bonus. A dynamic-programming assignment may leave items/slots
unassigned, but is rejected if any fighter's aggregate score for that group
decreases. The selected group must improve total score by more than `0.001`;
only cross-owner assignments become transfer legs. Leg order is deterministic
by sender, recipient, destination slot, then item name.

Current scope is accessories only: armor, mainhand, and offhand are excluded.
No merchant bag/bank item participates in this peer planner. Only the single
highest-gain group is started.

Before starting, `peerPlanInRange` requires every leg's advertised endpoints
to have identical server, identifier, and map and be within 320 Euclidean
units. It requires each participant's advertised `esize` to be at least:

```text
outgoing-leg count + (has any incoming leg ? 1 : 0)
```

This reserves room for all unequips and one sequential incoming item, not one
slot per incoming leg. It is conservative for bag-origin sends because the
pre-plan counts every outgoing leg; the fighter's preparation check in section
6.6 counts only outgoing items that must be unequipped. The planner does not
move fighters together.

### 6.4 Transaction schemas

All commands are Puppygirl-to-fighter CM and pass the fighter's strict merchant
sender gate. All reports are fighter-to-Puppygirl CM and pass the merchant's
configured-fighter gate plus transaction/participant checks. `v:2` is emitted
but not validated by either handler.

#### `gear_plan`

```js
{
  gear_plan: 1, v: 2, tx, plan_revision, expires_at,
  outgoing: [{
    index, from, to, fromSlot, toSlot,
    item: <observed-item-ref>, sent: 0, done: 0
  }],
  incoming: [{index, from, toSlot, item: <observed-item-ref>}]
}
```

The discriminator, `tx`, and both arrays are required by the fighter.
`plan_revision` and `expires_at` are syntactically optional and copied into
local state; an already-expired truthy `expires_at` is rejected as
`failed/expired`. For an outgoing leg, `item.where` and `item.fingerprint` are
required at prepare, while `index`, `to`, and the rewritten item reference are
required when executing it. For an incoming leg, `item.fingerprint`, `index`,
and `toSlot` are required when checking/equipping. `from`, `fromSlot`,
participant names, and `v` are not independently validated at the fighter
boundary; malformed values generally cause a later silent no-op or API error.

#### `gear_tx_report`

```js
{
  gear_tx_report: 1, tx, who, phase, revision,
  outgoing?, index?, slot?, error?, need?
}
```

The merchant requires the discriminator and `tx` matching its journal, `who`
equal to envelope sender, and sender membership in `tx.participants`. `phase`
is required to cause a recognized transition; other top-level fields are
phase-dependent or diagnostic. Recognized phases are:

| Phase | Additional fields | Meaning |
|---|---|---|
| `prepared` | `outgoing` (normally present) | Participant reserved capacity/items; merchant replaces matching sender-leg refs with prepared bag refs. |
| `sent` | `index` (R to advance) | Matching sender leg is marked sent. |
| `equipped` | `index` (R to advance), `slot` (informational) | Matching recipient leg is marked done. |
| `blocked` | `error`, `index?`, `need?`, `slot?` | Temporary/operational failure; coordinator applies policy below. |
| `failed` | `error` | Terminal transaction failure. |
| `complete` / `cancelled` | none | Fighter emits after finish/cancel, but merchant has no phase branch for either; at most they update the journal timestamp if it has not yet been cleared. |

`revision` is always emitted but not used for coordinator decisions.
Unrecognized phases also only update `updatedAt`.

#### Execution commands

| Schema | Required fields | Fighter behavior |
|---|---|---|
| `{gear_transfer:1,v:2,tx,index}` | Truthy discriminator, matching transaction in `prepared`, matching outgoing `index`; `v` ignored | Re-resolve reserved bag item, require recipient visible, alive, and within 320, then `send_item(to,index,1)`. |
| `{gear_check:1,v:2,tx,index}` | Truthy discriminator, matching transaction and incoming `index`; `v` ignored | Detect a new bag occurrence of the fingerprint beyond `beforeCount`, excluding unsent outgoing slots; equip the last match into `toSlot`. |
| `{gear_finish:1,v:2,tx}` | Truthy discriminator and matching transaction | Clear transaction/reservations, advertise inventory, report `complete`. |
| `{gear_cancel:1,v:2,tx,reason?}` | Truthy discriminator and matching transaction | Clear transaction/reservations, advertise inventory, report `cancelled`. |

### 6.5 State machine, retries, and timeouts

Merchant journal flow (`src/merchant.js`: `startPeerGearTx`,
`tickPeerGearTx`, `finishPeerGearTx`, `cancelPeerGearTx`):

```text
no transaction -> preparing -> transferring -> finished/cleared
                         \-> failed/blocked/expired -> cancelled/cleared
```

Each leg progresses `sent:0,done:0` → `sent:1,done:0` →
`sent:1,done:1`; legs run sequentially. Every one second, Puppygirl resends
`gear_plan` to unprepared participants, then `gear_transfer` for the first
unsent leg or `gear_check` for its recipient. Command `receivers` results are
ignored; periodic resend is the recovery mechanism.

A new transaction starts only while both the delivery queue and active job are
empty. A delivery request arriving after start is still enqueued; the merchant
ticks the transaction and then may also process delivery work, because the
gear-only early return applies only while those delivery fields remain empty.

Duplicate plan handling is idempotent after preparation (the fighter resends
its prepared report) and inert while the same plan is still preparing.
`leg.sending` prevents overlapping duplicate `send_item` calls. A duplicate
transfer after `leg.sent` only resends the `sent` report. A duplicate check
after equip only resends `equipped`.

The merchant transaction expires after 120 seconds. A fighter independently
clears a persisted transaction at `expires_at + 5 seconds`, advertises, and
does not send an expiry report. A `failed` report or any `blocked` reason other
than `not_in_range` cancels on the next coordinator tick. `not_in_range` is
retried once per one-second command cycle for 15 seconds from the first
identical block, then cancels; repeated identical reports preserve the original
`since`.

After cancellation, the same `planKey` receives exponential backoff:
5 seconds times `2^(failureCount-1)`, with count capped at six and duration
nominally capped at 300 seconds (the count cap makes the current maximum 160
seconds). Global planning also pauses five seconds. Successful finish pauses
three seconds and clears that plan's failure record.

Before sending either finish or cancel commands, Puppygirl captures each
participant's current accepted-ad `_seq` in `gearAwaitAds`. Planning remains
blocked until every such participant has a later accepted advertisement
(`ad._seq > gearAwaitAds[who]`). This is receipt ordering, not inventory
revision ordering: an equal-revision location or reservation refresh is
accepted, receives a new `_seq`, and unblocks recovery.

### 6.6 Preparation, reservations, capacity, and range

A fighter rejects a new plan as `blocked/busy` while another transaction
exists. It refreshes its inventory snapshot, resolves every outgoing reference,
and requires free slots equal to:

```text
number of equipped outgoing items + (has incoming items ? 1 : 0)
```

Failure produces `failed/stale_item`, `failed/item_moved`,
`failed/prepared_item_missing`, or `blocked/no_space`/`blocked/unequip`.
Preparation persists `gearTxn`, unequips outgoing slot items, rewrites their
refs to bag locations, and stores `gearReservations[uid]={tx,fingerprint}`.
Incoming `beforeCount` values are persisted to distinguish newly arrived
duplicates. Reservation exclusion is fingerprint-wide: one reserved
fingerprint also excludes/protects otherwise identical copies.

From plan preparation until finish, cancellation, or local expiry, the
existence of `gearTxn` makes the normal tick skip loot, wrong-class stripping,
automatic equip maintenance, and its periodic fighter-to-merchant offload.
This prevents those background operations from consuming the scratch slot
reserved for an inbound item or moving transaction items. Event-driven paths
such as a received `dlv_loot_q` are not globally disabled, although loot
offload skips reserved items. Reservation fingerprints additionally protect
matching items if `freeBagSlot` is invoked by another path. On reload, `gearTxn`,
`inventoryRevision`, and only reservations belonging to that transaction are
restored; transient `sending` flags reset to zero.

At send time the fighter re-resolves the exact prepared bag location and
fingerprint and requires `get_player(to)`, non-rip target, and distance at most
320. It does not move toward the recipient. A thrown/returned send failure
reports `blocked/send_failed` or the returned reason. A successful return is
treated as sent without confirming that the item disappeared. At receive time,
the new fingerprint count must exceed the prepared count; equip success is
verified against the destination slot fingerprint. Class/slot legality is
delegated to the underlying `equip` call rather than rechecked explicitly.

### 6.7 Persistence and current limitations

Puppygirl persists the coordinator journal inside `dlv_q_Puppygirl`:
`gearTx`, `gearPlanRevision`, `gearPlanFailures`, `gearAwaitAds`, and
`gearPlanAfter`. `gearTx` contains ID/revisions/timestamps, phase, legs,
participants, prepared map, baseline revisions, command timestamp, plan key,
and transient failure/block information. Fighters persist `inventoryRevision`,
`gearTxn`, and `gearReservations` inside `v2state_<name>`.

Because `gearAds` and their `_seq` values are heap-only and empty on merchant
boot, `bootMerchant` deletes persisted `gearAwaitAds` and the legacy
`gearAwaitRevisions` field immediately and saves the cleaned store. Freshness
requirements already force all three advertisements to repopulate before a
new plan can start, so a receipt gate from the prior process cannot be compared
meaningfully and is not restored.

Known current limitations:

* The protocol coordinates one accessory group and one leg at a time; it does
  not optimize a complete loadout, armor, weapons, or merchant-held inventory.
* The optimizer may score a same-owner equipped item in another same-owner
  slot, but same-owner assignments generate no transfer leg or local rearrange
  command. This is normally neutral for the interchangeable ring/earring pairs,
  but the modeled final assignment is not explicitly enacted.
* There is no explicit `received` phase. `gear_check` combines receipt
  detection and equip.
* A successful `send_item` result is not reconciled against sender inventory
  before `sent`; an ambiguous live result can therefore be misclassified.
* Runtime send-time capacity is left to `send_item`; only advertised and
  preparation-time capacity are checked.
* Fingerprints omit quantity and most special item properties, so they are not
  globally unique. Duplicate handling is count-based, not instance-based.
* A merchant reload restores its journal but not `gearAds`; it resumes commands
  from the journal without first reconstructing ownership from fresh ads.
* Cancellation/finish messages and reports are best effort and unacknowledged.
  A fighter's local expiry is the eventual reservation-release fallback.
* A new CM `cancel_all` with only an `id` can still target another fighter's
  job because owner correlation is enforced only when `who` is supplied.

### 6.8 Legacy merchant-held gift flow

Puppygirl still attaches one merchant-held gift to a potion job or creates the
internal standalone `dlv_gear` job described in section 5.1. After
`send_item`, she sends:

```js
{gear_offer:1, id, name, level, slot}
```

Only Puppygirl passes the fighter CM sender gate. `gear_offer` must be truthy
and `name` is required. `id`, `level`, and `slot` are syntactically optional;
absent `id` falls back to `name` for local 120-second gift protection, absent
`level` means zero, and absent `slot` usually makes final `ok` fail. Identity
remains name+level on this legacy path.

The fighter returns:

```js
{
  gear_got:1, id, name, level, slot,
  ok:0|1,
  replaced:{name,level}|null
}
```

Puppygirl accepts it only from a configured fighter but merely logs it; there
is no transaction correlation or retry. `replaced` is emitted whenever `ok=1`
and any prior slot item existed, even if old and new name/level are identical;
only the diagnostic log tests for a difference. Ordinary offload may already
have returned the displaced item and excess gold. Sources:
`src/merchant.js`: `tryPlanGearGift`, `maybeBatchGear`, `deliverActive`,
`hearCm`; `src/fighter.js`: `handleGearOffer`; `src/gear.js`: `markGift`,
`equipPending`.

### 6.9 Rolling duplicate progression

Fresh inventory advertisements also expose safe upgrade challengers. If a
fighter carries, or Puppygirl owns, an unlocked upgradeable item whose
name matches currently equipped gear and whose level does not exceed the
weakest wearer, Puppygirl protects one highest-level copy from sale and
upgrades it regardless of preview chance. The equipped copy is never moved or
risked.

A successful challenger is excluded from further upgrades and delivered
through `gear_offer` with `progression:true`. Once equipped, the displaced copy
is returned directly when possible; otherwise its next inventory advertisement
queues a `pickup_progress_*` rendezvous. That copy then becomes the challenger
against the new equipped level. Destruction ends that branch and reduces stock.
A zero-chance preview or server `max_level` response persists
`progressionUpgradeStop[name]=level`, preventing retry loops at the game cap.
Locked items and peer-transaction reservations are excluded throughout.

### 6.10 Merchant bag working set

Puppygirl treats her bag as a working set rather than long-term storage.
Potions, the merchant stand, permanent tools, upgrade/compound scrolls,
offerings, pending exchanges, vendor junk, listed merchandise, fighter gear
targets, and active progression items remain available to their immediate
handlers. Other inactive stock, including ordinary gathered materials and
reserve currencies, is parked in the bank. Crafting and Hunter purchases count
banked ingredients and tokens and retrieve them only when needed.

The basic vendor armor names `pants`, `gloves`, `helmet`, `shoes`, and `coat`
are obsolete once the Hunter targets are configured. Puppygirl never buys,
upgrades, reserves, or stall-lists these items; unlocked copies at every level
go directly to the NPC vendor. Equipped fighter items are not part of merchant
liquidation.

## 7. Leadership, hold/world, and persistence

### 7.1 Leadership invariants

* Fighter leadership is recomputed from `get_party()` on every `isLead()` call,
  in `Jazwyn`, `Sarene`, `Zarook` order. Its nominal death exclusion reads
  cached `state.S.members[n].rip`, not live `get_party()[n].rip`; because no
  producer currently publishes self-rip, actual fighter succession is
  presence-only for a dead-but-still-present leader.
* If the party list is empty, a fighter considers only itself; if a nonempty
  list contains no configured fighter, the first present name is returned.
* Only the computed lead publishes heartbeat and runs the Daisy quest loop.
  Local command handling deliberately lets followers apply hold/world/hunt so
  they can act before the next heartbeat.
* Puppygirl's `fighterLead()` differs: it filters directly on live
  `get_party()[n].rip`, so its observational leader can advance past a dead
  present fighter. It defaults to `Jazwyn`; control fan-out still targets all
  three fighters.

Sources: `src/party_state.js`: `currentLeader`; `src/fighter.js`: `isLead`;
`src/merchant.js`: `fighterLead`, `cmFighters`.

### 7.2 Hold/world state transitions

`hold` is orthogonal to intent kind/target. On hold, fighters hop to `HOME`
(`US/II`) after cancelling deliveries; the lead first asks Puppygirl to meet
home and announces `World US/II`. Once home they remain in task `hold`.
`resume` clears hold without discarding a hunt target. `world` stores a
one-shot target; on a tick with known current server identifiers it clears the
field, persists, performs hop preparation, and calls `change_server`. If server
metadata is temporarily unavailable, it leaves the intent intact and waits.
Sources: `src/fighter.js`: `applyCmd`, `tickFarm`, `hopPrep`.

The legacy fighter-side CM `{job:"meet_home"}` path has a distinct quirk:
`hearCm` calls `state.setIntent({hold:1})` without a presence list. The
`currentLeader` fallback then considers `[self]`, so every receiving fighter
treats itself as leader for that write and sets its own hold flag/sequence.
Unlike the normal `{hold:1}`/`applyCmd` path, it does not set mode to `hold` and
does not emit a party-chat command echo. In the current normal flow fighters
send `job:"meet_home"` to Puppygirl rather than Puppygirl sending it to
fighters, so this receiver branch is a legacy accepted interface, not the
normal hold producer (`src/fighter.js`: `hearCm`;
`src/party_state.js`: `setIntent`, `currentLeader`).

### 7.3 Storage schemas

#### `v2state_<fighter-name>`

Producer/consumer: the same fighter, JSON in `localStorage`
(`src/fighter.js`: `persist`, `restore`).

| Field | Meaning |
|---|---|
| `intent` | `{kind,mtype,hold,t,world?}` shared-intent snapshot; shape is not validated. |
| `mode`, `lead` | Current mode and remembered leader. |
| `seq` | Per-known-fighter sequence map. |
| `rare` | `{mtype,by,t}` or null. |
| `dlv` | Pending request `{id,kind,t0,acked,phase?}` or null. |
| `lastHb`, `assembleUntil`, `rareGoneAt`, `lastStatusAt` | Millisecond timestamps. Falsy zero values are not restored. |
| `huntQuest` | Persisted as `0|1`. |
| `preRareSnap` | `{kind,mtype,hold}` or null. |
| `mhuntDeaths`, `mhuntDeathForId`, `mhuntSoftSkipId` | Monster Hunt soft-abandon state. |
| `inventoryRevision` | Monotonic local inventory-content revision used in version-2 advertisements. |
| `gearReservations` | Map from observed-item UID to `{tx,fingerprint}` for the restored active gear transaction only. |
| `gearTxn` | Prepared peer-transfer plan, incoming fingerprint baselines, rewritten outgoing bag refs, per-leg progress, and expiry; null when idle. |

Writes occur throughout tick/control transitions and overwrite the whole value.
Malformed JSON or storage errors are silently ignored. There is no schema
version/migration. Unknown fields survive neither the parse-to-state nor the
next write. After restore, boot waits one heartbeat period before publishing.

#### `dlv_q_Puppygirl`

Producer/consumer: Puppygirl, JSON:

```js
{q: [job, ...], active: job|null}
```

`loadQ` accepts any parsed object with truthy `q`; it does not require `q` to be
an array or validate `active`. On parse/storage failure it starts with an empty
queue. Jobs persist their public request fields plus internal progress such as
`t0`, `locAt`, `locSeq`, `locProbeAt`, `locProbeSeq`, `farmConfirmed`,
`routeConfirmed`, `reroutePending`, `bought`, `gear`, `pulled`,
`gearWaitUntil`, `scoopUntil`, `emptyFails`, and `awaitLocLogAt`. The same
object also carries the peer-gear fields specified in section 6.7:
`gearTx`, `gearPlanRevision`, `gearPlanFailures`, `gearAwaitAds`, and
`gearPlanAfter`. Persisted `gearAwaitAds` and legacy `gearAwaitRevisions` are
cleared at merchant boot as described there. `saveQ` is called at queue and
progress transitions. The
480-second delivery TTL and 120-second peer-gear TTL use persisted timestamps.

No other production source storage keys implement these interfaces. In
particular, current code does not use the older `hold_*`, `gear_sess_*`, or
`dlv_q_<fighter>` designs.

## 8. Monster Hunt interface

Two different controls exist:

1. `hunt`/`!hunt` directly selects a monster type for party farming.
2. `hunt_quest` enables the lead-only Daisy assignment loop.

With `hunt_quest` enabled and not held, the lead consumes Adventure Land's
`character.s.monsterhunt` shape `{id,c,sn,ms}`. No assignment or `c===0`
causes movement to Daisy and `interact("monsterhunt")`; `c>0` sets shared
intent to `{kind:"hunt",mtype:id,hold:0}` and farms the pack. Merchants are
explicitly excluded. Three lead deaths on the same active assignment soft-skip
that ID and restore the configured default farm until the assignment disappears
or changes. State persists in `v2state_*`. Sources:
`src/monsterhunt.js`: `getHunt`, `shouldInteractDaisy`, `canAcceptHunts`;
`src/fighter.js`: `tickHuntQuest`, `noteHuntQuestDeath`.

Only `id` and `c` affect control flow. `sn` is written to a diagnostic log and
otherwise ignored; `ms` is not consumed. In particular, the assignment's
server (`sn`) is not compared with current region/identifier and does not
trigger a hop or rejection.

`src/monsterhunt_runner.js` is a currently implemented **sim/scenario-only**
driver. It invokes `ctrl.applyCmd({cmd:"hunt",...})` directly rather than using
a transport, runs up to 800 ticks by default, and reports structured
`{success:true,id}` or `{failed:true,reason,...}` results. It is not included in
the live publish manifest.

## 9. Live/simulator compatibility constraints

| Assumption | Live adapter behavior | Simulator behavior / constraint |
|---|---|---|
| CM reachability | Native `send_cm`; thrown errors become `receivers:[]`; a void return is treated optimistically as delivered to requested names. | Same-server and connected-only; exact `receivers` returned. |
| Event envelope | CM `data` is aliased to `message`; sender otherwise left as supplied by AL. | CM and PM emit `{name,from,message}`; party emits `{from,owner,message}`. |
| Party membership | `get_party()` drives authority and follower coordinates. | Parties are server-scoped; server change removes membership and clears handlers/heap. |
| PM | Native `pm` or `say` fallback. | Cross-server, connected-only, and shares code-chat rate limit. |
| Persistence | Browser `localStorage`; calls are caught by owners. | Per-character `createStorage`; survives simulated server change and stringifies values. |
| Clock | `createAlApi` supplies `_now: Date.now` before merchant boot, so CM-created `t0`/`locAt` and later ticks use the same wall clock. Some party-state timestamps also call `Date.now()` directly. | A simulated merchant has no `_now` until its first `tick`, when `bootMerchant` installs `opts.now`. CM received before that first tick creates `t0`/`locAt` with wall-clock `Date.now`; later TTL/freshness checks use the deterministic simulation clock. Such mixed timestamps can be far in the future and prevent normal age/TTL behavior. |
| Visibility/range | `get_player`, `distance`, `send_item`, and `send_gold` are native AL constraints. | `get_player` requires same server, map, and configured vision radius; item/gold send ranges are separately configured. |
| Reload/hop | `change_server` is assumed to wipe heap and later repopulate server metadata. | `sim/server.js`: `changeServer` removes old party membership, clears handlers, and preserves storage. |
| Event-map escape | `src/fighter.js`: `tick` tries `api.transport(map,spawn)` and then a guarded raw `parent.socket.emit("transport",{to:map})` fallback after walking to a door. | `sim/character.js` exposes neither `transport` nor `parent.socket`; its `use("town")` directly places the character on `main`. The raw-socket fallback and actual door transport are therefore live-only and are not simulator-covered. |

The live tick loops are single-flight: fighters tick every 250 ms and merchant
every 400 ms; a pending asynchronous tick suppresses the next normal tick.
Merchant still checks emergency potion use while busy
(`src/live_fighter_runtime.js`, `src/live_merchant_runtime.js`). Hot reload
attempts to clear prior registered CM/party/PM handlers and interval IDs.
Handler deduplication depends on the live character object implementing
`removeListener`: `clearHandlers` returns without removing or clearing its
handler bucket when that method is absent, after which boot registers new
handlers and duplicates can remain. The simulator overrides `clearHandlers`
and directly empties its handler arrays (`src/al_api.js`: `clearHandlers`;
`sim/server.js`: simulator API `clearHandlers`).

## 10. Compatibility and safety invariants

1. Character names and leader order are wire-level compatibility constants.
   Renaming a character or changing `LEADER_ORDER` changes routing/authority.
2. Existing discriminators and casing are exact: `~S`, `~d`, `~R`, `job`,
   `dlv_*`, `gear_*`, `status`, and control keys.
3. Delivery and gear IDs correlate messages but are not globally unique or
   authenticated. Peer gear also uses movement-stable fingerprints and
   location references, but those are not unique game-item IDs.
4. Consumers must tolerate extra fields; current producers must retain fields
   marked required because consumers frequently dereference them without
   validation.
5. Server changes must preserve `localStorage`, and implementations must wait
   for `server_region`/`server_identifier` to become non-null.
6. CM must not be assumed cross-server. The only implemented cross-server
   fallback is PM text for `meet_home`.
7. Party chat and PM share a scarce per-writer budget; control/status CM does
   not use `createChatQueue`.
8. Every CM family is bound to a roster sender gate. Delivery jobs, locations,
   cancellations when `who` is present, advertisements, and transaction reports
   add payload/sender correlation. This remains name-based trust in platform
   metadata, not cryptographic authentication; some legacy fields and IDs are
   not owner-correlated.
9. Delivery completion is at-least-best-effort, not transactional: duplicate
   request handling is partial, physical sends can partially succeed, and
   completion/gear reports are not themselves acknowledged.
10. Merchant inventory advertisements and legacy gift protection are
    heap-only. Delivery jobs and the peer transaction journal persist; fighter
    peer reservations/transaction state and inventory revision also persist.

## 11. Known ambiguities in the implemented contract

* Adventure Land builds may return `undefined` from successful `send_cm`.
  `createAlApi` treats that as delivery to all requested names, so
  `receivers` is not always authoritative on live.
* The live server's exact CM call budget is not modeled; only chat/PM throttling
  is explicit in the simulator.
* The `partym` sender field varies across environments (`from` versus `owner`);
  both are accepted. CM roster checks normalize `name || from`.
* The consumer accepts malformed command/world/job payloads more broadly than
  normal producers emit. This ICD records those weak boundaries rather than
  promising validation that is not present.
* `state.S.intent.t` is written with direct `Date.now()` while most runtime
  deadlines use `api._now()`, so deterministic simulation and persisted
  timestamps may use different clocks.
