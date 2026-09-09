# Adventure Land party — V2

Sim-first rewrite. Spec: [`V2_PLAN.md`](V2_PLAN.md). Server lessons: [`LESSONS.md`](LESSONS.md). Publish: [`PUBLISH.md`](PUBLISH.md). V1 reference: [`legacy/`](legacy/).

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
legacy/        # frozen V1
publish.manifest.js  # slot map (sources → dist → upload names)
publish.js           # build + upload CLI
```

## Run tests

```bash
node tests/run.js
```

## Publish (compress → Mainframe)

Documented in [`PUBLISH.md`](PUBLISH.md). Needs `.al_mcp_token` or `AL_MCP_TOKEN` for upload.

```bash
node publish.js --list              # slot map
node publish.js --build             # src/ → dist/ only
node publish.js --dry-run           # build + show upload plan
node publish.js --test --upload     # suite, then compress + save_code
node publish.js                     # compress + upload
```

`node deploy_mcp.js` remains as a wrapper around `publish.js --upload` for older live scripts.

After upload, **relink** characters — `save_code` does not restart running CODE.

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

Sim suite **72** tests (scenarios cover §6.6.1–8 gaps: resume/world, path-fail, mid-job reload, bee/goo, rejoin, bags). Viz is GPU-light (no auto-draw, flat CSS, ~5fps play). Live explorers measured path + reconnect; vision ~175px low-confidence. Next: 30‑min live farm gate.
