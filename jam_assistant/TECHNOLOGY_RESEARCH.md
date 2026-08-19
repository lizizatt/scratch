# Technology research

Research date: 2026-08-19

## Recommendation

Build a static client-side application with:

| Concern | MVP choice | Why |
|---|---|---|
| Application | React, TypeScript, Vite | Small client-only app, fast development, no server required |
| Live capture | `getUserMedia()` and Web Audio API | Native microphone and audio graph support, with music-oriented constraints |
| PCM capture | AudioWorklet adapter | Low-latency processing off the main thread |
| File input | `decodeAudioData()` feeding the analyzer directly | Deterministic processing without real-time playback |
| Features | Compare Essentia.js HPCP and Meyda chroma | Measure accuracy, integration cost, and license fit before selection |
| Chord labels | Local template scorer plus temporal smoothing | Small, explainable MVP vocabulary; replaceable later |
| Music theory | Tonal | Chord intervals, pitch classes, scales, and note naming |
| Unit/integration tests | Vitest | Fits Vite and supports pure TypeScript analyzer tests |
| Browser tests | Playwright with Chromium first | File/UI coverage and synthetic microphone plumbing |

Do not introduce a backend for the MVP. Local processing is better for latency,
privacy, deployment, and offline fixtures. Add a server only if a future model is
too large for browsers or collaborative/storage features require one.

## Compatibility findings

### Browser audio

`navigator.mediaDevices.getUserMedia()` is widely available, but microphone
access requires user permission and a secure context. `localhost` qualifies for
development; deployment should use HTTPS. A permission request may remain
unanswered, so the UI needs a cancellable waiting state rather than assuming the
promise settles immediately.

AudioWorklet is widely available in current Chrome, Edge, Firefox, and Safari.
It runs custom processing on the Web Audio rendering thread and communicates
through an `AudioWorkletNode` message port. Keep worklet code limited to framing
and transfer; heavier analysis belongs in a worker to protect audio and UI
responsiveness.

For musical input, request `echoCancellation`, `autoGainControl`, and
`noiseSuppression` as `false`; each can alter the captured signal. Bare boolean
constraints are best effort, and Safari does not currently expose all three, so
the adapter must inspect the resulting track's `getSettings()` values and report
which controls could not be disabled rather than rejecting usable input.

The Start user gesture must create or resume the `AudioContext` and wait until
its state is `running`. Browsers may initially block startup without user
activation; while suspended, real-time stream data is lost and AudioWorklet
processors are not invoked. Listen for state changes so suspension,
interruption, or device failure becomes a recoverable UI state.

`BaseAudioContext.decodeAudioData()` decodes complete file data into an
`AudioBuffer`. Its normalized PCM channels can be sliced and analyzed in a tight
loop, which is the relevant path for faster-than-real-time tests. An
`OfflineAudioContext` can render an audio graph faster than real time when graph
behavior itself must be tested, but it is unnecessary for pure frame analysis.
The MP3 requirement still needs an end-to-end headless Chromium benchmark that
starts with compressed bytes and includes decode, resampling, framing, feature
extraction, and scoring; a PCM-only benchmark does not cover decode cost.

### Chord analysis

There are three distinct jobs:

- **Pitch detection** estimates one fundamental frequency and is appropriate for
  monophonic sources. CREPE is in this category; it does not solve polyphonic
  chord recognition by itself.
- **Chroma/HPCP extraction** reduces spectrum energy to pitch classes without
  octave. This is an appropriate feature for chord recognition.
- **Chord recognition** assigns a root and quality from those features over
  time. This still needs a template scorer or trained classifier.

Essentia.js exposes WebAssembly builds of Essentia algorithms and supports both
browser and Node.js use. Essentia's algorithm reference includes HPCP and key
analysis, but this should not be mistaken for a documented, turnkey streaming
chord-label API. Its package loading, worker compatibility, output quality, and
bundle cost are Phase 0 spike items.

Essentia HPCP bins begin at A, whereas Meyda documents chroma as C through B and
Tonal numbers C as pitch class zero. The analyzer contract therefore defines a
C-to-B canonical order and requires feature adapters to rotate or otherwise
normalize library output. Validate every adapter with all 12 single pitches.

Meyda supports real-time and offline extraction from Web Audio or arrays and
provides a `chroma` feature. It is a credible lower-complexity fallback to
compare in the spike. Its chroma implementation and guitar accuracy still need
measurement; feature extraction alone does not provide chord labels.

Tonal is a modular music-theory library. Once the detector emits `Cmaj7`, Tonal
can resolve its chord tones for the fretboard. It can also return multiple scales
that contain a chord, but cannot choose the player's intended scale. The MVP
therefore shows chord tones by default and only shows scale tones after the user
selects a named scale. Tonal does not analyze audio.

### Testing

Vitest should own most correctness tests because the analyzer contract accepts
arrays and sample metadata rather than browser nodes. Browser tests should cover
only browser-owned behavior: decode support, permissions/error states, worker
packaging, controls, and rendering.

For synthetic live-input tests, Chromium supports fake-media launch switches,
but exact behavior is browser-runner and platform dependent. Treat this as a
small Playwright spike rather than making the whole signal-processing suite
depend on it. A test-only `PcmSource` adapter is the portable fallback.

MP3 decoding can vary slightly by browser and codec implementation. Keep golden
analyzer fixtures as PCM/WAV where exact samples matter, but include one MP3 in
the end-to-end headless throughput gate and a broader decode compatibility test.

### Licensing

Essentia.js is offered under AGPLv3, and UPF offers separate commercial terms.
That is not automatically compatible with every intended web-app distribution.
Licensing must be resolved before selecting or shipping it, including the terms
of any compiled dependencies used by the chosen build. Meyda is the baseline
fallback if Essentia.js's terms or dependency set are unsuitable.

## Alternatives considered

### Meyda instead of Essentia.js

Potentially smaller and simpler. Compare its chroma output on the same fixture
corpus. Choose it if accuracy is comparable and Essentia.js creates material
WASM, worker, or test-runner friction.

### TensorFlow.js model

Useful if a measured template baseline fails on realistic guitar audio. It adds
model acquisition/training, download size, warm-up, hardware variability, and
less explainable failure modes. It is a second-stage option, not the MVP default.

### Server-side Python analysis

Libraries such as librosa and specialized chord-recognition models would make
experimentation convenient, but uploading microphone audio harms latency and
privacy and complicates deployment. Python is useful for offline corpus
evaluation, not the initial product path.

### Handwritten FFT-to-chroma

This can reduce dependencies but is easy to get wrong around tuning, harmonics,
windowing, spectral leakage, and normalization. Build it only as a measured
fallback, not before evaluating established implementations.

## Phase 0 decision matrix

Run the same clean guitar and generated fixtures through Essentia.js and Meyda.
Record:

- per-quality stable-chord accuracy across every root and no-chord false
  positives;
- median transition latency;
- processing speed relative to fixture duration;
- package and WASM transfer size;
- worker initialization time;
- reproducibility in Vitest and headless Chromium.
- license compatibility with the intended distribution.

Select the smallest option that meets the acceptance targets in the project
README. Escalate to a learned classifier only with a retained failure corpus
showing why template matching is insufficient.

## Primary sources

- MDN, [MediaDevices.getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- MDN, [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
- MDN, [BaseAudioContext.decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData)
- MDN, [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext)
- W3C, [Web Audio API](https://www.w3.org/TR/webaudio/)
- W3C, [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
- MTG, [Essentia.js repository](https://github.com/MTG/essentia.js)
- Essentia, [Algorithm reference](https://essentia.upf.edu/reference/)
- Essentia, [licensing information](https://essentia.upf.edu/licensing_information.html)
- Meyda, [official documentation](https://meyda.js.org/)
- Tonal, [official documentation](https://tonaljs.github.io/tonal/docs/)
- Spotify, [Basic Pitch repository](https://github.com/spotify/basic-pitch) (polyphonic transcription alternative; not selected for MVP)
- Playwright, [test configuration](https://playwright.dev/docs/test-configuration)
- Vitest, [official guide](https://vitest.dev/guide/)
- Vite, [official guide](https://vite.dev/guide/)

Note: Spotify's Basic Pitch is a polyphonic transcription model and is more
relevant than CREPE if note-event transcription becomes a requirement. Neither
is necessary to establish the chroma-template baseline.
