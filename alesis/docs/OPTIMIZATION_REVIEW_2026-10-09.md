# First-pass test and runtime snapshot optimization

Baseline: `336dea215445b010968688c5b3ccb996389f3a56`. Scope is exact-byte test assertions and internal snapshot reduction only. No scheduling, quantization, overdub, rendering, protocol or WebSocket schema algorithms changed. The October 9 measurements and review were local, with no Pi access or physical audio.

Commit preparation on 2026-10-19 reran all 748 tests, workspace typecheck,
production build and whitespace checks successfully. Deployment is a separate
operation and is not established by these validation results.

## Exact-byte test assertions (preserved from the preceding pass)

Three large Buffer equality assertions in [loop-audio-fidelity.test.ts](../apps/server/src/loop-audio-fidelity.test.ts) use [expectExactBuffer](../apps/server/src/test-helpers/exact-buffer.ts): explicit length equality, exact `Buffer.equals()` comparison, then a bounded first-different-byte diagnostic on failure. No hashing, tolerance, omitted decode, reduced repeat count or removed MIDI/audio coverage. Nine helper cases include independent allocations, slices, length mismatches and single-byte negative controls.

The preceding matched measurements used the same npm runner, default workers, STH fixture, preload and GNU-time accounting on both sides:

| Test workload | Before process wall | After process wall |
| --- | ---: | ---: |
| Fidelity, 12 tests | 63.00 s | 18.06 s |
| Full suite, 729 → 738 tests | 70.92 s | 17.91 s |

Those improvements are **test assertion costs**, not host runtime gains. They are single ordered workstation observations, not statistical guarantees. Full-suite maximum process RSS did not decrease. All preceding edits and profiling baselines remain intact.

## Runtime design

[SimulatedHostEngine](../packages/engine/src/index.ts) now provides `runtimeSnapshot()` and `subscribeRuntime()` alongside the unchanged public `snapshot()` and `subscribe()`:

- Each runtime read creates a **fresh detached value**: settings, transport, arp/drum settings, selected instrument IDs, pad mode/kit ID, capture flags and scalar take identity/cycle/level/mute metadata. It excludes catalogs, instrument controls, parameter recipes, pad assignments/sample lists and waveform arrays.
- Every retained runtime object, including nested take summaries, is copied. There are no references into mutable engine state, shared immutable metadata caches, unsafe casts, or revision-based caches. Existing full snapshots remain `structuredClone(this.state)`, including all nested metadata. Full snapshots still work at scheduler interfaces; session/export paths still require full take waveforms and render metadata.
- A single ordered subscription registry preserves registration order across public and runtime listeners. `publish()` prepares each required view before invoking callbacks, so a nested publication cannot change the outer publication's values. It skips the full clone only when there are no public subscribers. Public listeners still share one detached full snapshot per publication, as before.
- Revision is **not** a complete mutation generation: `advance()` can move within a cycle at the same revision; `markCaptureActivity()`, `ensureOverdubStaged()`, `setStagedWaveform()` and `setCaptureError()` can mutate without publication. Fresh reads cover those cases without an invalidation scheme.
- [TransportPlayback](../apps/server/src/transport-playback.ts) uses runtime subscriptions and reads, but retains its existing read boundaries. It reads again after `advance()` and loop feedback, after input delivery, and after transaction cleanup. It does not reuse a pre-advance or pending transaction snapshot. Existing `processing`, `pendingSnapshot`, cancellation and transaction behavior is unchanged.
- [The host input/capture path](../apps/server/src/main.ts) uses runtime state for velocity settings, routed/drum capture and metronome polling. [Loop playback](../apps/server/src/loop-playback.ts), [drum playback](../apps/server/src/drum-playback.ts), [clock projection](../apps/server/src/transport-clock.ts) and [metronome](../apps/server/src/metronome.ts) accept narrower types; their algorithms are unchanged.
- The host's pad-state subscription remains full, preserving existing pad assignment reads. [Control-server](../apps/server/src/control-server.ts) is unchanged: public full snapshots, synchronous pad invalidation, 30 Hz update coalescing and identical payloads. Consequently, actual host publications still clone full state. This pass removes repeated internal copies, not all catalog cloning or WebSocket serialization.

## Runtime measurements

Sequential, unprofiled Node 20.20.2 runs on the Linux workstation; no other tests ran concurrently. Both sides used the same original runtime workloads via an adapter that changes only internal snapshot reads. Original baseline reports, metrics and profiles were not overwritten. The original focused review was inspected, not rerun over its existing outputs. New evidence is retained under `artifacts/profiling-20261009/optimization-runtime-*` (ignored).

Each input row has 12 promoted tracks × 64 recorded events and 1,000 routed input events. The original virtual-clock workload advances 1 ms/input, disables actual deadline callbacks, and omits the host delivery callback's additional advance. It is CPU throughput, **not input latency**.

Baseline versus final-tree repeat:

| Catalog presets | Before wall / Node CPU | After wall / Node CPU | Full clones before → after | Runtime reads after |
| --- | ---: | ---: | ---: | ---: |
| 0 | 792 / 965 ms | 107 / 316 ms | 7,000 → 0 | 7,000 |
| 128 | 1,240 / 1,324 ms | 64 / 154 ms | 7,000 → 0 | 7,000 |
| 1,024 synthetic stress | 4,812 / 4,922 ms | 53 / 108 ms | 7,000 → 0 | 7,000 |
| 293, STH cardinality | 2,352 / 2,369 ms | 44 / 80 ms | 7,000 → 0 | 7,000 |

The 293-preset extension uses the same ordinary phrase fixture, synthetic preset names and STH's previously verified cardinality, not its actual catalog contents. It is not the earlier focused harness's continuation-heavy fixture. In that row, time within full snapshot calls was 2,300 ms before; time within runtime reads was 3.08 ms after.

**Closer host mirror:** retains the performance and control-server full subscriptions, routes through `PerformanceRouter`, and performs the additional `playback.advance()` inside delivery with a fixed positive 0.05 ms clock increment. It excludes WebSocket serialization/network I/O and side-effectful host startup. Every case asserts 1,000 deliveries and preserves transport position (0.5 original; 0.525 mirror). Baseline versus final-tree repeat:

| 293-preset host mirror | Before | After |
| --- | ---: | ---: |
| Wall | 2,816 ms | 996 ms |
| Node process CPU | 2,859 ms | 1,061 ms |
| Full snapshot calls | 10,000 | 3,000 |
| Runtime snapshot calls | 0 | 10,000 |
| Time inside full snapshots | 2,753 ms | 943 ms |

This is a **70% full-clone count reduction**, with observed wall reduction of **64.6%** and Node CPU reduction of **62.9%**. Runtime snapshot reads took 3.47 ms. The earlier after run measured 1,400 ms wall / 1,470 ms CPU and the same clone counts; it temporarily used a runtime performance listener, before retaining the original full listener for pad mappings. The control-server listener already required the same one full clone per publication. Both runs are retained; the spread is a warning against treating a single ratio as a guarantee. Do not use the runtime-only harness as a host-wide speedup claim.

**Public snapshot cloning is not optimized.** The separate 2,000-public-snapshot microbenchmark still clones everything. Before → final-after wall observations were 331 → 394 ms (0 presets), 375 → 429 ms (128), and 1,313 → 1,804 ms (1,024). The first after run measured 371 / 695 / 1,794 ms. These measurements illustrate substantial machine/JIT variability and do not support a public-snapshot speedup claim. No scheduling/overdub speedup is claimed from the other unchanged workload rows.

Local raw evidence: [adapter](../artifacts/profiling-20261009/optimization-runtime-run.mjs), [baseline workloads](../artifacts/profiling-20261009/optimization-runtime-before-metrics.json), [baseline host mirror](../artifacts/profiling-20261009/optimization-runtime-before-host.json), [final workloads](../artifacts/profiling-20261009/optimization-runtime-after-final-metrics.json), [final host mirror](../artifacts/profiling-20261009/optimization-runtime-after-final-host.json). The adapter requires baseline production code for `before` and optimized code for `after`, and refuses to overwrite existing metric files. Invocation: Node with `--expose-gc --import tsx`, adapter path, then phase and optional unique suffix (final run: `after final`). Stdout is retained under each matching label. All 26 original workload rows plus two extension rows completed in each run with no assertion failures.

## Validation

- Ten new tests: [seven engine contracts](../packages/engine/src/runtime-snapshot.test.ts) and [three production-module regressions](../apps/server/src/runtime-snapshot.test.ts). They cover nested public/runtime isolation, unchanged-revision feedback, import atomicity, quantization, levels, stop/clear, mixed synchronous reentry, subscriber disposal, and exact full-versus-narrow capture/replay/session-export comparison. A delivery test changes BPM synchronously during `advance()` and advances again before recording; a transaction test mutates capture after the last publication.
- Full STH suite: **748 tests / 50 files passed**, including the existing actual host MIDI/preview tests and independent offline PCM/MP3 fidelity checks. Process wall 17.55 s, Vitest duration 16.87 s. This fresh validation is not a matched measurement of additional test-suite speedup.
- Workspace typecheck, build, editor diagnostics and `git diff --check` passed.
- Full isolated browser suite: **111 passed**, all three viewport projects; 418.51 s process wall (6.9 min Playwright duration), exit 0. Real production WebSocket interfaces were exercised with software MIDI and simulated output on localhost port 8921. Test-owned sample/settings/export fixtures were isolated; the listener was gone after completion. [Browser results](../artifacts/profiling-20261009/optimization-runtime-browser.json), [full STH results](../artifacts/profiling-20261009/optimization-runtime-full-tests.json).

Workstation timing is not a Pi/acoustic deadline guarantee. Node CPU includes all process threads and may exceed wall time. No CPU affinity, exclusive machine, cache flush or statistical repetition protocol was used. Full-state publication remains the dominant clone cost in the host mirror; improving it would require a separate, carefully tested subscription/serialization design.

## Independent dirty-tree review

**Result: no confirmed changed-code regressions in the scoped optimization.** Standards: no documented-standard violations found. Spec: no semantic-preservation violations found. This review compared the actual working tree, not just HEAD, against `336dea215445b010968688c5b3ccb996389f3a56`: eight tracked source/test files plus both new runtime test files and the exact-buffer helper/tests. The tracked source diff SHA-256 was `43e9710cdea2fc54f57cd3c2d45c1be00923a9b236629f1f09ae3e999d39564c` (excludes untracked additions).

Checked against source and executable evidence:

- **Isolation and projection:** [engine snapshots](../packages/engine/src/index.ts#L166-L187) retain the public deep clone. The [current protocol schemas](../packages/protocol/src/index.ts#L42-L111) make settings, transport, arp/drum settings and take summaries scalar-only, so the runtime copies do not leak nested references. Runtime consumers use retained fields; session/export paths still take full snapshots and preserve waveforms, catalogs and render settings. No new casts conceal missing fields.
- **Publication and recency:** [ordered publication](../packages/engine/src/index.ts#L753-L764) prepares both existing subscriber views before callbacks. The mixed reentry test checks nested and outer values and order, not just callback counts. No revision cache was introduced. [TransportPlayback](../apps/server/src/transport-playback.ts#L45-L89) retains fresh reads after advance, capture feedback, delivery and transaction cleanup. Existing command barriers, stop/clear handling, import suspension and cancellation algorithms are unchanged; the focused tests exercise their runtime subscription path.
- **Capture and public delivery:** [runtime differential coverage](../apps/server/src/runtime-snapshot.test.ts#L51-L93) compares complete session JSON, replay events and final full state between full and narrow reads. Additional cases verify reentrant BPM changes, a second delivery advance and unpublished transaction feedback. Waveform feedback remains a copied public value. The host's full pad subscriber and the [control-server queue/subscriber](../apps/server/src/control-server.ts#L57-L118) were not narrowed; WebSocket payload construction and coalescing remain unchanged.
- **Exact bytes:** only three fidelity assertions changed. The [helper](../apps/server/src/test-helpers/exact-buffer.ts) checks equal length and every byte through `Buffer.equals()`, including subarray boundaries; its nine tests reject length changes and first/middle/last-byte corruption. Decode paths, three-pass checks, tolerances elsewhere and the existing missing-note-off/20 ms-gap negative controls are unchanged.
- **Benchmark comparability:** inspected both harnesses and matched recorded commands/environments, all 26 workload input rows, deterministic scheduler delivery/deadline counts and both host-mirror inputs/results. The mirror preserves 1,000 deliveries and identical progress while reducing full clones from 10,000 to 3,000. Reported timing arithmetic matches the saved results. The stated exclusions are material: disabled virtual deadlines, synthetic catalog names, omitted WebSocket work and single ordered measurements; these results establish neither physical latency nor a host-wide 54× gain. Recorded provenance is not an independently rerun baseline checkout.

**Fresh review validation:** 115 tests passed across the two runtime suites, exact-buffer helper, transport playback and drum playback; workspace typecheck and tracked diff whitespace check passed. Independently parsed the existing full-run reports: 748 unit tests passed with none failed/pending; 111 browser tests passed with none unexpected/skipped/flaky. Those full suites and audio fidelity renders were not rerun in this review. No regression test was added because no bug was confirmed. Only this report was edited; no production edits, Pi access, live audio, commit or deployment.