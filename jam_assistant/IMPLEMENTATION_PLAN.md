# Implementation plan

This plan delivers the smallest useful product while resolving chord-analysis
risk before committing the application to a feature library.

## Milestone 0: analysis spike

**Goal:** select a chroma implementation and prove the source-independent
analyzer contract.

1. Scaffold a minimal TypeScript package with Vite and Vitest.
2. Define `PcmChunk`, `ChromaFrame`, and `ChordEstimate` contracts in
   `src/analysis/types.ts`.
3. Generate deterministic WAV fixtures for all 12 roots across the MVP chord
   qualities, plus silence and representative transitions.
4. Implement Essentia.js and Meyda feature adapters that normalize output to
   canonical C-to-B chroma bins.
5. Implement chord-template scoring, a no-chord threshold, and temporal
   smoothing without coupling them to either feature adapter.
6. Build an evaluation command that reports accuracy by quality, false-positive
   rate on silence, transition latency, throughput, initialization time, and
   bundle size.
7. Run the same corpus in Vitest and headless Chromium, including one MP3 test
   from compressed bytes through decoding and analysis.
8. Record the library decision, measured results, and license decision in an
   architecture decision record.

**Exit gate:** one legally suitable adapter meets the README acceptance targets
for every supported quality. If neither does, retain the failure corpus and
evaluate a learned classifier before building the UI.

## Milestone 1: file-to-fretboard vertical slice

**Goal:** deliver the complete user loop using local audio files.

1. Build the application shell with source controls, transport state, chord,
   root, confidence, and uncertainty displays.
2. Implement an audio-file adapter using `decodeAudioData()` and direct PCM
   chunk iteration; do not depend on audible or wall-clock playback.
3. Move selected feature extraction and chord scoring into a Web Worker.
4. Add a `ChordEstimate` store that rejects stale estimates when sources change.
5. Use Tonal to derive chord tones and validate a user-selected scale contains
   the current chord tones.
6. Implement a standard-tuning, 12-fret model and responsive fretboard view with
   distinct root, chord-tone, and optional scale-tone layers.
7. Add file progress, scrub, speed, silence, decode-error, and unsupported-file
   states.

**Tests:** unit tests for music and fretboard mappings; integration tests from
decoded PCM to estimates; Playwright tests for file selection, source changes,
uncertainty, controls, and desktop/mobile fretboard rendering.

**Exit gate:** a user can load a fixture, receive stable chord/root estimates,
and inspect correct fretboard positions while the headless MP3 throughput gate
remains at least 10 times real time.

## Milestone 2: live microphone input

**Goal:** run the same analyzer continuously from a microphone without leaking
resources or presenting stale results.

1. Add a microphone adapter with music-oriented media constraints and report
   the actual settings returned by the browser.
2. Create or resume `AudioContext` only from the Start gesture and expose
   suspended, interrupted, and failed states.
3. Add an AudioWorklet that frames PCM and transfers bounded chunks to the
   analysis worker; keep feature extraction out of the audio render thread.
4. Implement request generations so canceled or superseded permission requests
   cannot later activate a microphone; stop all obsolete tracks immediately.
5. Handle track mute, unmute, end, device loss, source switching, and teardown.
6. Clear stale chord output whenever usable audio is unavailable.
7. Tune frame size, hop size, confidence, and smoothing against recorded and
   live guitar sessions while preserving the evaluation corpus results.

**Tests:** adapter lifecycle tests with delayed permission settlement; browser
tests for permission denial and track events; repeated start/stop leak test;
manual current-Chrome, Firefox, and Safari smoke matrix.

**Exit gate:** live input stabilizes within 500 ms on clean held chords, source
transitions release every track and worker, and the UI never retains a chord
through mute, end, or failure states.

## Milestone 3: product hardening

**Goal:** make the static application reliable enough to publish.

1. Add keyboard and screen-reader semantics, reduced-motion behavior, contrast
   checks, and responsive overflow tests.
2. Add worker crash recovery, actionable error messages, and capability checks
   for unsupported browsers.
3. Establish budgets for initial JavaScript/WASM size, worker startup, analysis
   CPU use, and UI update frequency.
4. Expand recorded-guitar fixtures without changing the supported chord contract
   unless evaluation justifies it.
5. Configure static HTTPS deployment with a restrictive microphone permissions
   policy and no audio upload or persistence.
6. Document browser support, privacy behavior, known recognition limits, and
   local development commands.

**Exit gate:** all automated suites pass in CI, the browser smoke matrix is
recorded, performance budgets hold, and deployment serves the application over
HTTPS with microphone access working only after an explicit user gesture.

## Proposed implementation order

```text
M0.1 scaffold and contracts
M0.2 fixture generator and evaluation harness
M0.3 feature adapters
M0.4 scorer and smoothing
M0.5 browser benchmark and library decision
M1.1 file adapter and worker pipeline
M1.2 theory and fretboard model
M1.3 application UI and browser tests
M2.1 microphone lifecycle adapter
M2.2 AudioWorklet bridge
M2.3 live tuning and cross-browser checks
M3.1 accessibility, resilience, and budgets
M3.2 deployment and documentation
```

Each item should land as a small commit with its focused tests. Do not begin the
microphone work until file-mode analysis and stale-source rejection are passing;
that keeps browser lifecycle failures separate from detector failures.
