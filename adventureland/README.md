# Adventure Land party — V2

Sim-first rewrite. Spec: [`V2_PLAN.md`](V2_PLAN.md). Server lessons: [`LESSONS.md`](LESSONS.md). V1 reference: [`legacy/`](legacy/).

## Layout

```
sim/           # multi-character simulator (clock, comms §4.0, path, invariants, trace)
src/           # readable bot code (fighters + merchant)
tests/         # unit + integration scenarios
tools/         # compress_code.js, record_viz.js
viz/           # scrubbable sim explorer (static UI)
legacy/        # frozen V1
```

## Run tests

```bash
node tests/run.js
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

Sim + party scenarios green (comms rules from `server.js`, delivery, rare, hold hop-prep, 30‑min compressed farm, boot order). Next: live path explorers for calibration, compressor slot map, Mainframe 30‑min gate.
