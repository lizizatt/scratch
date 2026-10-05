# Recording fidelity and kiosk QA — 2026-10-05

These follow-up fixes are on `mistress`, not part of the
release activated on the Pi earlier that day. SSH to the Pi was unreachable
during this pass. No live transport, recordings, settings, or assets were changed.

## UI findings

Browser QA used 800×480 (the kiosk's logical viewport), 844×390, and 1280×800,
including populated current/staged lanes, twelve promoted takes, expanded
effects, long SoundFont names, dialogs, and error states.

- Populated waveform SVGs contributed intrinsic height to flexible grid rows:
  the current lane reached 766px on the 480px kiosk. SVGs now fill their lane
  without determining its intrinsic size.
- The short-screen media rule squeezed drum settings into seven columns.
  Drums retain three columns; shared MIDI-effect labels are larger.
- SoundFont selectors now have enough room for the Miku Sustain name.
- Undefined CSS colors made the MP3 save panel transparent. It now has an
  explicit opaque background and border.
- Connection telemetry and notices occupy layout space rather than covering
  controls. Navigation still floats, with scroll clearance below content.

`tests/e2e/visual-layout.spec.ts` adds geometry, text-width and hit-testing
regressions. Before/after screenshots are under `artifacts/ui-qa/`.

## Recording and replay findings

The integration harness connects the real engine, performance router,
arpeggiator/transport adapter, loop scheduler and command helper. It compares
live delivered MIDI with recorded events and subsequent staged/promoted replay.

- Loop replay formerly depended on 50ms polling: a live 125ms gate could replay
  as 150ms. Loop-event deadlines now participate in transport scheduling.
- A gate ending at rollover could create a synthetic continuation attack in the
  next take. Boundary-release metadata prevents that, including noninteger
  cycle durations, while preserving genuinely held notes.
- Circular quantization now keeps attacks and releases paired, releases before
  same-bin retriggers, and discards releases belonging to discarded attacks.
- Sustain and pitch bend held across capture boundaries are initialized for
  channels that contribute notes. Unused channels' remembered state must not
  overwrite the sounding channel after loop-channel remapping.
- Internal renderer resets reapply delivered controls directly without recording
  a new performance event. Ownership checks exclude prepared/retired renderers.
  Explicit panic clears input intent and finalizes completed takes first.
- Older v1 sessions remain loadable through exact legacy-quantizer validation.
  Their saved MIDI is preserved; an explicit quantization change regenerates
  staging. Frozen previous/promoted recordings are not silently rewritten.

Tests cover rates, triplets, swing, gates, velocity mapping, count-in lateness,
rollover, promotion, undo, clear, controller state, renderer replacement, and
session compatibility. A differential check matched legacy quantization against
the original implementation over 2,000 cases. Controller regressions also use
offline Neon DSP and native FluidSynth with ALSA null sinks, not speakers.

## Validation and limits

- 562 unit/integration tests pass; typecheck and production build pass.
- 72 browser tests pass across the three viewport projects.
- Final independent controller review found no further actionable regressions
  in scope; its two focused suites passed 41 tests.
- Quantization Off preserves delivered event positions. Quantization intentionally
  changes timing. Existing take-level scaling remains: the default 0.8 scales
  note velocity and can alter a velocity-sensitive instrument's timbre. Unity
  level is covered separately; this pass does not change that product behavior.
- Loop channels are isolated per take, not per original melodic input channel;
  arbitrary simultaneous multichannel controller independence is not promised.
- Deterministic timer tests and null-sink/DSP checks do not establish physical
  speaker timing, seamless sustained-voice continuity across loop boundaries,
  or the absence of Pi scheduling stalls.
- A bounded workstation load probe found increased internal engine publication
  with dense loop deadlines, while WebSocket coalescing remained effective.
  Dense-session CPU/load and acoustic acceptance still need Pi verification.

Before deployment, save the current live session and back up the app. Restore
only after checking for new work; do not overwrite a session created after restart.