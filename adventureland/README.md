# Adventure Land party — V2

Sim-first rewrite. Spec: [`V2_PLAN.md`](V2_PLAN.md). Server lessons: [`LESSONS.md`](LESSONS.md). V1 reference: [`legacy/`](legacy/).

## Layout

```
sim/           # multi-character simulator (clock, comms §4.0, path, invariants, trace)
src/           # readable bot code (fighters + merchant + live slots)
src/slots/     # Mainframe entrypoints (one slot each)
data/          # path/vision explorer fixtures (*.sim.json committed; *.live.json local)
tests/         # unit + integration scenarios
tools/         # compress, viz record, route/live explorers
viz/           # scrubbable sim explorer (static UI)
legacy/        # frozen V1
```

## Run tests

```bash
node tests/run.js
```

## Deploy (Mainframe)

Needs `.al_mcp_token` or `AL_MCP_TOKEN`. Builds compressed `dist/` slots and pushes via MCP:

```bash
node tools/compress_code.js
node deploy_mcp.js
node live_observe_v2.js   # optional party snapshot dump
```

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

Sim + party scenarios + dist + boot subsets + MVP Monte Carlo green. Live explorers measured path bands + reconnect (~35s); vision ~175px (low-confidence — recheck). Party relinked on US III with V2 CODE. Next: confirm vision, then 30‑min live farm gate.
