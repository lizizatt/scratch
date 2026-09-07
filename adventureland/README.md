# Adventure Land party — V2

Sim-first rewrite. Spec: [`V2_PLAN.md`](V2_PLAN.md). Server lessons: [`LESSONS.md`](LESSONS.md). V1 reference: [`legacy/`](legacy/).

## Layout

```
sim/           # multi-character simulator (clock, comms §4.0, path, invariants)
src/           # readable bot code (fighters + merchant)
tests/         # unit + integration scenarios
tools/         # compress_code.js → dist/
legacy/        # frozen V1
```

## Run tests

```bash
node tests/run.js
```

## Status

Sim + party scenarios green (comms rules from `server.js`, delivery, rare, hold hop-prep, 30‑min compressed farm, boot order). Next: live path explorers for calibration, compressor slot map, Mainframe 30‑min gate.
