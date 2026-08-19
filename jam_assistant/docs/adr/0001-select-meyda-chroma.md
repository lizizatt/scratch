# ADR 0001: Select Meyda for MVP chroma extraction

- **Status:** accepted
- **Date:** 2026-08-19

## Context

Milestone 0 compared Essentia.js HPCP and Meyda chroma behind the same
`ChromaExtractor` contract. Both adapters normalize to C-through-B pitch-class
bins and feed the same template scorer and temporal smoother.

The generated evaluation corpus contains every combination of 12 roots and the
seven MVP qualities, silence, and a C-major-to-D-minor transition. A committed
C-major MP3 also exercises browser decoding and analysis in headless Chromium.
Generated harmonic tones are a feasibility baseline, not evidence of accuracy
on recorded guitars or mixed music.

## Decision

Use Meyda 5.6.3 for the MVP. Keep Essentia.js as a development-only comparison
dependency until a recorded-guitar corpus confirms the decision.

## Evidence

The accepted evaluation run reported:

| Metric | Meyda | Essentia.js |
|---|---:|---:|
| Generated-corpus accuracy | 100% | 100% |
| Lowest per-quality accuracy | 100% | 100% |
| Silence false positive | No | No |
| Transition latency | 224 ms | 256 ms |
| Processing speed | 269x real time | 257x real time |
| Candidate browser assets | 16,094 bytes | 2,644,889 bytes |
| License | MIT | AGPL-3.0/commercial |

The selected production browser build is approximately 20 KB uncompressed and
7 KB gzip. Headless Chromium decodes and analyzes the MP3 fixture at 46.9x real
time, above the 10x acceptance threshold; the exact machine-dependent timing is
retained in `artifacts/browser-mp3-benchmark.json`.

## Consequences

- Production code depends only on the MIT-licensed Meyda package.
- The detector remains library-independent, so the feature extractor can be
  replaced without changing UI or source adapters.
- The scorer includes a measured complexity prior to avoid treating a strong
  harmonic as weak evidence for a seventh chord.
- Milestone 1 must add recorded-guitar fixtures. A material regression there
  reopens this decision and uses the retained failure corpus to compare Essentia
  or a learned classifier.

## Reproduce

```bash
npm install
npm run fixtures
npm test
npm run evaluate
npm run build
npm run test:browser
```

Structured results are written to `artifacts/milestone-0-evaluation.json` and
`artifacts/browser-mp3-benchmark.json`.
