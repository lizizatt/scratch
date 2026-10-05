# Alesis deployment candidate — 2026-09-26

## Deployment completed — 17:43 PDT

Deployed to the Pi at `alesis@10.42.0.69` using its existing trusted SSH host
key. The operator stopped and started `alesis-server.service` directly because
service management requires a sudo password. Code and production assets were
synced, then checksum-compared with the local release; both external SoundFont
checksums matched. Existing dependencies were retained (lockfile unchanged).

- Service active/running, zero automatic restarts, `/health` reports Ready.
- Vortex MIDI, CM108 audio, and the sample library report ready.
- Live catalog includes the Vocaloid SoundFont. On-Pi inspection confirms
  **Miku (Soft)** at 0:6 and **Miku (Sweet)** at 0:7.
- Served frontend matches the installed production build. Kiosk service active.
- Previous instrument selection preserved; no test notes or transport playback
  were triggered. Physical navigation and listening acceptance remain manual.
- Rollback code/build archive on Pi:
  `/home/alesis/deployment-backups/alesis-before-20260927T003902Z.tar.gz`.

## Pre-deployment record

Local, uncommitted changes on `mistress`, based on
`701e066726d96f3b8c33da23001db6bed2d60f4b`. No remote deployment, service
restart, hardware playback, or asset redistribution was performed.

## Changes

- Physical Vortex Program Change navigation no longer rejects the upper wire
  numbers when a bank has fewer than 128 entries. Adjacent messages step through
  the catalog, including 127/0 wraparound; first/nonadjacent messages select
  modulo the catalog size. Repeated messages are ignored. Browser absolute
  selection remains unchanged. See [controller behavior](SAMPLE_PADS.md).
- Hardware mapping runs inside the command queue. Catalog changes invalidate
  adjacency; MIDI reconnection invalidates stale queued messages.
- Newly played/reused channels inherit the current held pitch bend, not an
  older bend left on that channel.
- FluidSynth's implicit chorus is disabled, matching the dry offline renderer.
- Metronome woodblocks are replaced with a side-stick click. At the default
  volume, accent/ordinary velocities are 32/23 rather than 64/64. This remains
  monitor-only and is not included in loop exports.
- The newly downloaded Vocaloid SoundFont is already supported by discovery.
  **Miku (Soft)** is bank 0, program 6. A non-silent offline render was verified.
  The optional `miku-asset` bridge action verifies the external asset before and
  after transfer. See [deployment instructions](../README.md#raspberry-pi-bridge).

## Tuning limitation

The reported string-patch tuning is **not fully resolved or listening-verified**.
No blanket pitch correction or SoundFont modification was applied.

Offline FluidSynth 2.3.4 output at 48 kHz, chorus/reverb off, measured at A4:

| Patch | Bank:program | Measured Hz | Cents from 440 Hz |
| --- | --- | ---: | ---: |
| FluidR3 piano | 0:0 | 440.944 | +3.71 |
| FluidR3 slow violin | 8:40 | 440.297 | +1.17 |
| FluidR3 synth strings | 0:50 | 436.806 | -12.61 |
| STH piano | 0:0 | 436.818 | -12.57 |
| STH violin | 0:40 | 436.972 | -11.95 |
| STH strings | 0:48 | 436.872 | -12.35 |

The autocorrelation estimator was checked against generated 220/440/880 Hz
sines. These measurements describe dominant periodic components, not a full
perceptual pitch model for ensemble patches. Multiple octaves showed varying
offsets for FluidR3, so a global correction would be unjustified. The specific
SoundFont sample/generator origin of the offsets was not established.

[The opt-in diagnostic](../scripts/soundfont-pitch-diagnosis.mjs) validates actual
preset existence, uses the WAV's sample rate, and supports MIDI/select and
chorus comparisons. MIDI diagnostics explicitly use MMA 14-bit bank selection;
MIDI/select PCM matched exactly for FluidR3 8:40 and STH 128:0. Percussion
presets may have no measurable stable pitch.

## Validation and adversarial review

Final checks on the reviewed implementation:

- 270 unit/integration tests passed across 24 files, with
  `ALESIS_TEST_SOUNDFONT=$HOME/Downloads/STH.sf2`.
- 20 Playwright tests passed on isolated port 8897 with disposable settings and
  sample fixtures.
- Workspace typecheck, production build, shell syntax, and diff whitespace
  checks passed.
- Miku SHA-256:
  `92c7cf7b32bb67720f4f1ba1954e6fb01aba0925362e18f68a3ed123657121df`.

Most investigation/fix/review passes used cheaper agents; one expensive
cross-cutting sweep checked the resulting work. Findings were verified before
fixing. The final independent sweep found no additional concrete defects within
the inspected paths and executed tests.

| Coverage | Files | Result |
| --- | --- | --- |
| Runtime, queue, API, tests | server control-server, main, pad-controls, performance-router and tests | Fixed font-identity reset, stale queue mapping, reconnect generation, and reused-channel bend findings |
| Audio/numerics, compatibility, tests | audio index, renderers and tests | Chorus/click changes checked; unsupported global pitch correction rejected |
| Packaging, safety, tests | pi-bridge, bridge tests, README | External Miku checksum flow tested with mocked SSH/rsync; no remote actions |
| Diagnostics, portability, test adequacy | pitch-diagnosis script and tests | Fixed invalid numeric/preset acceptance and explicit MMA bank selection; removed test-only catalog bypass |
| Documentation | SAMPLE_PADS and README | Hardware mapping and Miku setup agree with code |

A speculative duplicate-preset-ID fix was removed: none of the nine installed
SoundFonts had duplicate bank/program entries, and it did not explain the
confirmed physical-controller symptom.

## Deployment and acceptance

1. Review/stage the complete change set, including the new diagnostic script
   and its test; it has not been committed or pushed.
2. Use the existing bridge code-sync operation and the optional `miku-asset`
   operation for the intended Pi. The bridge does not install dependencies or
   start services. Keep the required STH asset in place.
3. Build/restart using the target's existing deployment procedure and verify
   `/health`. No target-specific service restart was attempted here.
4. Refresh SoundFonts and select the Vocaloid file, then **Miku (Soft)**.
5. On hardware, test forward/back navigation across 112/113 and 127/0, small
   banks, target changes and MIDI reconnection. The Vortex display remains its
   own preset number, not the host's catalog index.
6. Listen to the new click at normal playing volume and compare slow violin /
   synth strings against a reference tone with the pitch wheel centered. The
   remaining patch-tuning report needs this acceptance check before claiming
   the original tuning complaint resolved.
