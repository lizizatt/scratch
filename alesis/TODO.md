# Raspberry Pi V1 TODO

Priority order is strict within each section. Do not begin kiosk or systemd work
until the P0 readiness slice passes with fake devices.

## P0 - Safe bring-up

- [x] Model SoundFont, FluidSynth, audio, and MIDI readiness independently.
- [x] Expose readiness through `/health` and WebSocket snapshots; show every
  failure reason in the UI.
- [x] Reject Play while Not Ready and keep startup/restart transport stopped.
- [x] Send comprehensive all-notes-off/controller reset during FluidSynth
  startup, renderer recovery, and shutdown.
- [x] Add MIDI/audio hotplug monitors. Panic immediately on MIDI loss; stop
  transport on audio loss; never auto-resume transport after reconnect.
- [x] Replace PulseAudio discovery/output with direct ALSA CM108 discovery and
  48 kHz, 16-bit dual-mono output using conservative 20-30 ms buffering.
- [x] Match Vortex and CM108 by USB vendor/product plus ALSA name, select the
  first duplicate deterministically, and expose the selected identity.
- [ ] Add a persistent touchscreen Panic button and test that it silences direct
  notes, arpeggiator, drums, metronome, staged playback, and promoted loops.
- [x] Locate `STH.sf2` and record its SHA-256.
- [ ] Document `STH.sf2` provenance, add an external-asset manifest/deploy
  check, and remove broad recursive production discovery.
- [ ] Add fake-device tests for startup failure, MIDI disconnect/reconnect,
  audio disconnect/reconnect, crash recovery, and no surprise playback.
- [x] Verify the full Pi USB/ALSA stack without opening PCM or consuming MIDI:
  Vortex `13b2:005e`, CM108 `0d8c:013c`, S16_LE stereo at 48/44.1 kHz.
- [x] Confirm the Pi 4B, PiSugar S Plus, Waveshare display, Vortex receiver,
  amplifier, and unplugged fan inventory.
- [ ] Purchase or confirm the remaining P0 BOM accessories.

## P1 - Pi deployment

- [x] Create an idempotent Raspberry Pi OS Desktop 64-bit ARM64 setup script.
- [x] Configure hostname `alesis`, direct Ethernet/Wi-Fi networking, key-only
  SSH, and default-user runtime.
- [ ] Audit and reduce the runtime user's audio/input/device group access.
- [x] Add separate rate-limited systemd units for server and Chromium kiosk;
  every restart must begin silent and stopped.
- [ ] Bind the server to localhost and make kiosk startup wait for HTTP
  readiness, reconnect after server restart, never blank, and hide the cursor
  after brief inactivity.
- [ ] Implement PiSugar two-second shutdown handling with bounded fallback:
  stop/panic, atomic settings save, filesystem sync, UI progress, then poweroff.
- [ ] Persist settings/patches only through explicit Save and orderly shutdown;
  never persist transport, held notes, recording arm, or running loops.
- [ ] Implement atomic replacement plus file and directory sync; retain the
  previous valid settings file after interruption.
- [ ] Cap persistent journal at 64 MB and cap Chromium caches.
- [ ] Add hardware-readiness diagnostics for model/RAM, OS/architecture,
  undervoltage, throttling, temperature, storage, display/touch, USB, ALSA,
  SoundFont checksum, synth process, and network advisory state.
- [x] Document and test a manual SSH probe/sync/asset bridge; never update on
  boot.

## P2 - Acceptance and hardening

- [x] Validate persistent display and synchronized touch rotation at 800 by 480
  on the Trixie bench image.
- [ ] Validate every Alesis UI control at 800 by 480.
- [ ] Tune latency below the initial 20-30 ms buffer only after dense-load tests.
- [ ] Run the four-hour bench acceptance gate with sustained performance,
  Chromium load, USB hotplug, service crashes, orderly shutdowns, and one hard
  power cutoff.
- [ ] Record PiSugar runtime, undervoltage flags, peak temperature, throttling,
  audio integrity, and filesystem checks from acceptance.
- [ ] Add active cooling only if throttling occurs or temperature remains above
  75 C; prove mechanical clearance before installation.
- [ ] After acceptance, evaluate overlay/read-only root with settings/assets on
  an excluded writable path.
- [ ] Begin enclosure design only after the complete acceptance gate passes.

## Deferred beyond v1

- Hardware Panic mapping.
- WS2812B lighting.
- Battery telemetry board replacement.
- Automatic updates and unattended remote deployment.
