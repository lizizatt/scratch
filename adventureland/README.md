# Adventure Land party — V2

Sim-first rewrite. Spec: `[V2_PLAN.md](V2_PLAN.md)`. Server lessons: `[LESSONS.md](LESSONS.md)`. Publish: `[PUBLISH.md](PUBLISH.md)`. Review pack: `[reviews/](reviews/)`.

## Layout

```
sim/           # multi-character simulator (clock, comms §4.0, path, invariants, trace)
src/           # readable bot code (fighters + merchant + live slots) — edit here
src/slots/     # Mainframe character entrypoints (load_code + class combat)
data/          # path/vision explorer fixtures (*.sim.json committed; *.live.json local)
tests/         # unit + integration scenarios (includes dist smoke tests)
tools/         # compress, viz record, route/live explorers
dist/          # generated ≤176-line slots (gitignored) — do not edit
viz/           # scrubbable sim explorer (static UI)
reviews/       # architecture / risks / backlog
publish.manifest.js  # slot map (sources → dist → upload names)
publish.js           # build + upload CLI
```



## Run tests

```bash
node tests/run.js
```



## Publish (compress → Mainframe)

Documented in `[PUBLISH.md](PUBLISH.md)`. Needs `.al_mcp_token` or `AL_MCP_TOKEN` for upload.

```bash
node publish.js --list              # slot map
node publish.js --build             # src/ → dist/ only
node publish.js --dry-run           # build + show upload plan
node publish.js --test --upload     # suite, then compress + save_code
node publish.js                     # compress + upload
```

`node deploy_mcp.js` remains as a wrapper around `publish.js --upload` for older live scripts.

After upload, **relink** characters — `save_code` does not restart CODE.

## Monte Carlo (MVP)

Seeded short farms with path-fail injection + intermittent merchant silence:

```bash
node tools/mc_mvp.js 20 1 120000
```



## Path / vision explorers

Sim baseline (no auth) writes `data/path_bands.sim.json`:

```bash
node tools/explore_routes.js
node tools/dump_sim_knobs.js   # vision.sim.json + reconnect.sim.json from sim/knobs.js
```

Live stubs (token required; measurement automation still TODO):

```bash
node tools/explore_live.js vision
node tools/explore_live.js path
```



## Sim viz (browse + scrub)

Record timelines from party scenarios, then open the explorer:

```bash
node tools/record_viz.js
node viz/serve.js
# → http://127.0.0.1:8765
```

**How logging works**

1. `sim/trace.js` attaches to the world clock: samples positions (~every 2s sim time) and drains `game_log` / party say / CM / `change_server` into an event stream.
2. `bootParty({ trace: { id, name, tags } })` enables recording for a run.
3. `tools/record_viz.js` builds `viz/public/data/catalog.json` (all suite tests + tags + §6.6 mapping) and writes scrubbable JSON under `viz/public/data/traces/`.
4. The UI browses coverage, opens a recorded trace, and scrubs the map + event log.

Unit/comms tests show up in the catalog for coverage even without a timeline; party scenarios are the ones with scrub data.

## Status

Sim suite via `node tests/run.js` (scenarios cover resume/world, path-fail, mid-job reload, bee/goo, rejoin, bags, avoid, craft, gear score). Viz is GPU-light. Live explorers measured path + reconnect; vision ~175px low-confidence.



















TODO:  
Complexity is mostly duplicated travel / lead / equip / combat dialects — not avoid geometry or party_state. Full board is in the canvas beside chat.

Headline

Debt clusters where the same job has multiple owners. Avoid steering, party_state, packs, publish compression, and pure score() are fine to leave alone.

Priority cuts

DELETE dead stallDone / openStall; thin meet rename-wrappers

SIMPLIFY one goNpc + bank enter/exit (NPC travel copy-pasted ×4)

MERGE sell-name sources (VENDOR_NPC / bank_clean / derive)

MERGE one lead resolver into motion + combat (kill hardcoded Jazwyn in combat)

MERGE one pickBestSlot for pendingBetter / equipPending / handleGearOffer

SIMPLIFY move combat.js under sim/; fold live pots into fighter boot; trim al_api to semantic shims

Contradiction matrix (same idea, two owners)

Theme	Failure mode

Junk policy

park ≠ vendor ≠ ops dump lists

Bank travel

ensureAtBank vs gear bank vs delivery plaza

Engage radius

fighter 280 / avoid 180 / FORM 220–400

Lead

dynamic succession vs combat default Jazwyn

Combat

sim combat.js ≠ live slots/* ≠ live pots

Keep

merchant_avoid geometry · party_state · packs/safeMeet · sim storage/comms/invariants · publish compressor · score() without class gating

Canvas: al-adversary-simplicity-pass — say if you want me to start on the high-confidence DELETE/SIMPLIFY items.

Work through the priority cuts, verifying each diff adversarially before commiting.  Then let's walk through the contradition matrix, grill me on questions to come up with a cleaner design.

Other todo:

SPAM to fix on puppygirl:

Ponty:list 316

ponty:none

Searching for path

Path found!

SPAM to fix on Jazwyn:

Wrong weapon!